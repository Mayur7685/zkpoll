import "dotenv/config"
import express, { Request, Response } from "express"
import cors from "cors"
import axios from "axios"
import { evaluateRequirements, calculateVotingWeight } from "./evaluator.js"
import { issueCredential, getCurrentBlockHeight } from "./issuer.js"
import { loadCommunities, getCommunityConfig, getAllCommunities, saveCommunityConfig } from "./communities.js"
import { pinJSON, isPinataConfigured, ipfsUrl } from "./pinata.js"

import { startTallyRunner, manualTally } from "./tally-runner.js"
import { ConnectedAccount, CommunityConfig, PollInfo } from "./types.js"
import { generateState, consumeState, pkce, popupSuccess, popupError, storeUserToken } from "./oauth.js"
import { verifyTelegramAuth } from "./checkers/social_follow.js"

const app = express()
app.use(cors())
app.use(express.json())

// ─── Health ──────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "zkpoll-verifier" })
})

// ─── OAuth — Twitter (X) ─────────────────────────────────────────────────────
// Requires env: TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET
// Register callback: <APP_URL>/api/auth/twitter/callback   (APP_URL default: http://localhost:5173)

const APP_URL = process.env.APP_URL ?? "http://localhost:5173"

app.get("/auth/twitter", (_req, res) => {
  const clientId = process.env.TWITTER_CLIENT_ID
  if (!clientId) return res.status(500).send(popupError("zkpoll-twitter", "TWITTER_CLIENT_ID not configured"))
  const { codeVerifier, codeChallenge } = pkce()
  const state = generateState({ codeVerifier })
  const params = new URLSearchParams({
    response_type:         "code",
    client_id:             clientId,
    redirect_uri:          `${APP_URL}/auth/twitter/callback`,
    scope:                 "tweet.read users.read follows.read",
    state,
    code_challenge:        codeChallenge,
    code_challenge_method: "S256",
  })
  res.redirect(`https://twitter.com/i/oauth2/authorize?${params}`)
})

app.get("/auth/twitter/callback", async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>
  if (error) return res.send(popupError("zkpoll-twitter", error))
  const entry = consumeState(state)
  if (!entry) return res.send(popupError("zkpoll-twitter", "Invalid or expired OAuth state"))

  try {
    const clientId     = process.env.TWITTER_CLIENT_ID!
    const clientSecret = process.env.TWITTER_CLIENT_SECRET!

    // Twitter OAuth 2.0 token exchange.
    // Confidential clients (Web App type) send credentials as Basic auth.
    // Public clients (Native App type) send client_id in the body only.
    // We try confidential first; fall back to public if 403.
    let tokenData: Record<string, unknown> | null = null

    const body = new URLSearchParams({
      code,
      grant_type:    "authorization_code",
      redirect_uri:  `${APP_URL}/auth/twitter/callback`,
      code_verifier: entry.codeVerifier!,
      client_id:     clientId,
    })

    try {
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
      const r = await axios.post("https://api.twitter.com/2/oauth2/token", body, {
        headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
      })
      tokenData = r.data
    } catch (firstErr: any) {
      const status = firstErr?.response?.status
      console.warn("[oauth/twitter] confidential client exchange failed:", status, firstErr?.response?.data)
      if (status === 403 || status === 401) {
        // Retry as public client (no Basic auth, client_id already in body)
        const r2 = await axios.post("https://api.twitter.com/2/oauth2/token", body, {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        })
        tokenData = r2.data
      } else {
        throw firstErr
      }
    }

    const accessToken = tokenData!.access_token as string
    const expiresIn   = (tokenData!.expires_in as number | undefined) ?? 7200
    const meRes = await axios.get("https://api.twitter.com/2/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const { id, username } = meRes.data.data as { id: string; username: string }
    // Store user token + username so twitterapi.io follow checks can use the handle
    storeUserToken('twitter', id, accessToken, expiresIn, username)
    res.send(popupSuccess("zkpoll-twitter", { userId: id, username }))
  } catch (e: any) {
    const detail = e?.response?.data
    console.error("[oauth/twitter] final error:", e?.response?.status, detail)
    const msg = detail?.error_description ?? detail?.detail ?? detail?.error ?? e.message ?? "Twitter OAuth failed"
    res.send(popupError("zkpoll-twitter", `${msg} (status: ${e?.response?.status ?? 'unknown'})`))
  }
})

// ─── OAuth — Discord ─────────────────────────────────────────────────────────
// Requires env: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET
// Register callback: <APP_URL>/api/auth/discord/callback

app.get("/auth/discord", (_req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID
  if (!clientId) return res.status(500).send(popupError("zkpoll-discord", "DISCORD_CLIENT_ID not configured"))
  const state  = generateState()
  const params = new URLSearchParams({
    response_type: "code",
    client_id:     clientId,
    redirect_uri:  `${APP_URL}/auth/discord/callback`,
    scope:         "identify guilds",   // guilds needed to check server membership via user token
    state,
  })
  res.redirect(`https://discord.com/oauth2/authorize?${params}`)
})

app.get("/auth/discord/callback", async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>
  if (error) return res.send(popupError("zkpoll-discord", error))
  if (!consumeState(state)) return res.send(popupError("zkpoll-discord", "Invalid or expired OAuth state"))

  try {
    const tokenRes = await axios.post(
      "https://discord.com/api/oauth2/token",
      new URLSearchParams({
        client_id:     process.env.DISCORD_CLIENT_ID!,
        client_secret: process.env.DISCORD_CLIENT_SECRET!,
        grant_type:    "authorization_code",
        code,
        redirect_uri:  `${APP_URL}/auth/discord/callback`,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    )

    const accessToken = tokenRes.data.access_token as string
    const meRes = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const { id, username, discriminator } = meRes.data as { id: string; username: string; discriminator: string }
    const displayName = discriminator && discriminator !== "0" ? `${username}#${discriminator}` : username
    // Store user token so guild membership checks use user context instead of bot
    storeUserToken('discord', id, accessToken, tokenRes.data.expires_in ?? 604800)
    res.send(popupSuccess("zkpoll-discord", { userId: id, username: displayName }))
  } catch (e: any) {
    console.error("[oauth/discord]", e?.response?.data ?? e.message)
    res.send(popupError("zkpoll-discord", e?.response?.data?.error_description ?? e.message ?? "Discord OAuth failed"))
  }
})

// ─── OAuth — GitHub ──────────────────────────────────────────────────────────
// Requires env: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
// Register callback: <APP_URL>/api/auth/github/callback

app.get("/auth/github", (_req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID
  if (!clientId) return res.status(500).send(popupError("zkpoll-github", "GITHUB_CLIENT_ID not configured"))
  const state  = generateState()
  const params = new URLSearchParams({
    client_id:    clientId,
    redirect_uri: `${APP_URL}/auth/github/callback`,
    scope:        "read:user user:email",
    state,
  })
  res.redirect(`https://github.com/login/oauth/authorize?${params}`)
})

app.get("/auth/github/callback", async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>
  if (error) return res.send(popupError("zkpoll-github", error))
  if (!consumeState(state)) return res.send(popupError("zkpoll-github", "Invalid or expired OAuth state"))

  try {
    const tokenRes = await axios.post(
      "https://github.com/login/oauth/access_token",
      { client_id: process.env.GITHUB_CLIENT_ID!, client_secret: process.env.GITHUB_CLIENT_SECRET!, code },
      { headers: { Accept: "application/json" } },
    )

    const accessToken = tokenRes.data.access_token as string
    const meRes = await axios.get("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
    })
    const { login, id } = meRes.data as { login: string; id: number }
    // Key by login (username) so public API calls like GET /users/{username} work
    storeUserToken('github', login, accessToken, 60 * 60 * 24 * 30, login)
    res.send(popupSuccess("zkpoll-github", { userId: login, username: login }))
  } catch (e: any) {
    console.error("[oauth/github]", e?.response?.data ?? e.message)
    res.send(popupError("zkpoll-github", e?.message ?? "GitHub OAuth failed"))
  }
})

// ─── Telegram Login Widget ───────────────────────────────────────────────────
// Requires env: TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME
// Telegram can't do OAuth in a popup (widget requires page redirect), so we
// redirect the current tab — same approach Guild.xyz uses for Telegram.

app.get("/auth/telegram", (_req, res) => {
  const botUsername = process.env.TELEGRAM_BOT_USERNAME
  if (!botUsername) return res.status(500).send(popupError("zkpoll-telegram", "TELEGRAM_BOT_USERNAME not configured"))
  const callbackUrl = `${APP_URL}/auth/telegram/callback`
  res.send(`<!DOCTYPE html><html><head>
<title>Connect Telegram</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f5}
.card{background:#fff;border-radius:16px;padding:40px;text-align:center;box-shadow:0 2px 16px rgba(0,0,0,.08)}
h2{margin:0 0 8px;font-size:18px;color:#111}p{color:#666;font-size:14px;margin:0 0 24px}</style>
</head><body><div class="card">
<h2>Connect Telegram</h2>
<p>Click the button below to authenticate with your Telegram account.</p>
<script async src="https://telegram.org/js/telegram-widget.js"
  data-telegram-login="${botUsername}"
  data-size="large"
  data-auth-url="${callbackUrl}"
  data-request-access="write"></script>
</div></body></html>`)
})

app.get("/auth/telegram/callback", (req: Request, res: Response) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) return res.send(popupError("zkpoll-telegram", "TELEGRAM_BOT_TOKEN not configured"))

  const data = req.query as Record<string, string>
  const userId = verifyTelegramAuth(data, botToken)
  if (!userId) return res.send(popupError("zkpoll-telegram", "Telegram auth verification failed"))

  const username = data.username ?? data.first_name ?? `tg_${userId}`
  res.send(popupSuccess("zkpoll-telegram", { userId, username }))
})

// ─── EVM Signature Verification ──────────────────────────────────────────────

// In-memory nonce store: address → { challenge, expiresAt }
const evmChallenges = new Map<string, { challenge: string; expiresAt: number }>()

// GET /auth/evm/challenge?address=0x...
// Returns a signed challenge message for the given EVM address.
app.get("/auth/evm/challenge", (req: Request, res: Response) => {
  const address = (req.query.address as string)?.toLowerCase()
  if (!address || !/^0x[0-9a-f]{40}$/i.test(address)) {
    return res.status(400).json({ error: "Invalid address" })
  }
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36)
  const challenge = `Sign this message to verify your EVM wallet for ZKPoll.\n\nAddress: ${address}\nNonce: ${nonce}`
  evmChallenges.set(address, { challenge, expiresAt: Date.now() + 5 * 60 * 1000 }) // 5 min TTL
  res.json({ challenge })
})

// POST /auth/evm/verify
// Verifies the signature and confirms the address owns the wallet.
app.post("/auth/evm/verify", async (req: Request, res: Response) => {
  const { address, challenge, signature } = req.body as {
    address: string; challenge: string; signature: string
  }
  if (!address || !challenge || !signature) {
    return res.status(400).json({ error: "Missing address, challenge, or signature" })
  }

  const stored = evmChallenges.get(address.toLowerCase())
  if (!stored || stored.challenge !== challenge) {
    return res.status(400).json({ error: "Invalid or expired challenge" })
  }
  if (Date.now() > stored.expiresAt) {
    evmChallenges.delete(address.toLowerCase())
    return res.status(400).json({ error: "Challenge expired" })
  }

  try {
    // Recover signer from personal_sign (EIP-191 prefixed hash)
    const { ethers } = await import("ethers")
    const recovered = ethers.verifyMessage(challenge, signature)
    const verified = recovered.toLowerCase() === address.toLowerCase()
    if (verified) evmChallenges.delete(address.toLowerCase())
    res.json({ verified })
  } catch (e: any) {
    res.status(400).json({ error: "Signature verification failed", detail: e.message })
  }
})

// ─── Communities ──────────────────────────────────────────────────────────────

function serializeCommunity(c: CommunityConfig) {
  return {
    community_id:           c.community_id,
    name:                   c.name,
    description:            c.description,
    logo:                   c.logo,
    credential_type:        c.credential_type,
    credential_expiry_days: c.credential_expiry_days,
    requirement_groups:     c.requirement_groups,
    polls:                  c.polls ?? [],   // ← include polls in every response
  }
}

// GET /communities — list all communities (for frontend browse)
// Also backfills creator field from on-chain for any community missing it
app.get("/communities", async (_req, res) => {
  const communities = getAllCommunities()
  const missing = communities.filter(c => !c.creator)

  if (missing.length > 0) {
    const NODE_URL = process.env.ALEO_NODE_URL ?? "https://api.explorer.provable.com/v1"
    const NETWORK  = process.env.ALEO_NETWORK  ?? "testnet"
    const FIELD_MODULUS = 8444461749428370424248824938781546531375899335154063827935233455917409239041n

    await Promise.all(missing.map(async (community) => {
      try {
        const id = community.community_id
        let h = /^\d+$/.test(id) ? BigInt(id) : 0n
        if (h === 0n) for (let i = 0; i < id.length; i++) h = (h * 31n + BigInt(id.charCodeAt(i))) % FIELD_MODULUS
        const r = await fetch(`${NODE_URL}/${NETWORK}/program/zkpoll_v2_core.aleo/mapping/communities/${h}field`)
        if (r.ok) {
          const raw = await r.text()
          const m = raw.match(/creator:\s*(aleo1[a-z0-9]+)/)
          if (m) { community.creator = m[1]; saveCommunityConfig(community) }
        }
      } catch { /* non-fatal */ }
    }))
  }

  res.json(getAllCommunities().map(serializeCommunity))
})

// GET /communities/:id — get a single community config
app.get("/communities/:id", async (req, res) => {
  const community = getCommunityConfig(req.params.id)
  if (!community) return res.status(404).json({ error: "Community not found" })

  // Backfill creator from on-chain if missing (communities created before this field was added)
  if (!community.creator) {
    try {
      const FIELD_MODULUS = 8444461749428370424248824938781546531375899335154063827935233455917409239041n
      const id = req.params.id
      let h = /^\d+$/.test(id) ? BigInt(id) : 0n
      if (h === 0n) for (let i = 0; i < id.length; i++) h = (h * 31n + BigInt(id.charCodeAt(i))) % FIELD_MODULUS
      const NODE_URL = process.env.ALEO_NODE_URL ?? "https://api.explorer.provable.com/v1"
      const NETWORK  = process.env.ALEO_NETWORK  ?? "testnet"
      const res2 = await fetch(`${NODE_URL}/${NETWORK}/program/zkpoll_v2_core.aleo/mapping/communities/${h}field`)
      if (res2.ok) {
        const raw = await res2.text()
        const m = raw.match(/creator:\s*(aleo1[a-z0-9]+)/)
        if (m) {
          community.creator = m[1]
          saveCommunityConfig(community)
        }
      }
    } catch { /* non-fatal */ }
  }

  res.json(serializeCommunity(community))
})

// POST /communities — create a new community (called from CreateCommunityWizard)
app.post("/communities", async (req: Request, res: Response) => {
  const config = req.body as CommunityConfig
  if (!config.community_id || !config.name || !config.requirement_groups) {
    return res.status(400).json({ error: "Missing required fields" })
  }

  // Pin community metadata to IPFS for decentralised discoverability (best-effort)
  let ipfs_cid: string | undefined
  if (isPinataConfigured()) {
    try {
      ipfs_cid = await pinJSON(config, `community-${config.community_id}`)
      console.log(`Community ${config.community_id} pinned to IPFS: ${ipfs_cid}`)
    } catch (e: any) {
      console.warn("Pinata upload failed (non-fatal):", e.message)
    }
  }

  saveCommunityConfig(config)
  // On-chain register_community is called by the user's wallet in the frontend (Option A).
  res.status(201).json({ community_id: config.community_id, ipfs_cid })
})

// POST /communities/:id/polls — register a poll created on-chain
app.post("/communities/:id/polls", async (req: Request, res: Response) => {
  const community = getCommunityConfig(req.params.id)
  if (!community) return res.status(404).json({ error: "Community not found" })
  const poll = req.body as PollInfo
  if (!poll.poll_id || !poll.title) {
    return res.status(400).json({ error: "Missing poll_id or title" })
  }

  // Enforce creator-only poll registration
  if (!poll.creator_address) {
    return res.status(400).json({ error: "Missing creator_address" })
  }
  if (community.creator && community.creator !== poll.creator_address) {
    return res.status(403).json({ error: "Only the community creator can create polls" })
  }

  // Stamp operator address so the frontend knows who to pass to cast_vote
  if (process.env.OPERATOR_ADDRESS) {
    poll.operator_address = process.env.OPERATOR_ADDRESS
  }

  // Pin full poll metadata to IPFS — includes options + description (best-effort)
  if (isPinataConfigured() && !poll.ipfs_cid) {
    try {
      poll.ipfs_cid = await pinJSON(
        { ...poll, community_id: community.community_id, community_name: community.name },
        `poll-${poll.poll_id}`,
      )
      console.log(`Poll ${poll.poll_id} pinned to IPFS: ${poll.ipfs_cid}`)
    } catch (e: any) {
      console.warn("Pinata poll upload failed (non-fatal):", e.message)
    }
  }

  community.polls = [...(community.polls ?? []), poll]
  saveCommunityConfig(community)
  // On-chain create_poll is called by the user's wallet in the frontend (Option A).
  res.status(201).json({ poll_id: poll.poll_id, ipfs_cid: poll.ipfs_cid })
})

// ─── Requirement Verification ─────────────────────────────────────────────────

// POST /verify/check — check requirements only, no on-chain action
// Returns { passed, results } — use this to show requirement status in UI
app.post("/verify/check", async (req: Request, res: Response) => {
  const { communityId, aleoAddress, connectedAccounts } = req.body as {
    communityId:       string
    aleoAddress:       string
    connectedAccounts: ConnectedAccount[]
  }

  if (!communityId || !aleoAddress) {
    return res.status(400).json({ error: "Missing communityId or aleoAddress" })
  }

  const community = getCommunityConfig(communityId)
  if (!community) return res.status(404).json({ error: "Community not found" })

  const { passed, results } = await evaluateRequirements(
    community.requirement_groups,
    connectedAccounts ?? [],
  )

  res.json({ passed, results })
})

// POST /verify/credential-params — verify requirements and return inputs for user's wallet
// The user's wallet calls zkpoll_vote2.aleo::issue_credential with these params.
// Re-verifies requirements server-side so params are only issued when eligible.
app.post("/verify/credential-params", async (req: Request, res: Response) => {
  const { communityId, aleoAddress, connectedAccounts } = req.body as {
    communityId:       string
    aleoAddress:       string
    connectedAccounts: ConnectedAccount[]
  }

  if (!communityId || !aleoAddress) {
    return res.status(400).json({ error: "Missing communityId or aleoAddress" })
  }

  const community = getCommunityConfig(communityId)
  if (!community) return res.status(404).json({ error: "Community not found" })

  // Always re-verify server-side — never trust client claim of "passed"
  const { passed, results } = await evaluateRequirements(
    community.requirement_groups,
    connectedAccounts ?? [],
  )

  if (!passed) {
    return res.status(403).json({ error: "Requirements not met", results })
  }

  try {
    const currentBlock  = await getCurrentBlockHeight()
    const expiryBlock   = currentBlock + community.credential_expiry_days * 24 * 60 * 4
    const votingWeight  = calculateVotingWeight(community.requirement_groups, results)

    // Sanity check: expiryBlock must be meaningfully in the future
    if (expiryBlock <= currentBlock) {
      return res.status(500).json({
        error: "Computed expiryBlock is not in the future — check credential_expiry_days and block height",
        currentBlock,
        expiryBlock,
      })
    }

    res.json({
      passed: true,
      results,
      credentialParams: {
        recipient:      aleoAddress,
        communityId,
        credentialType: community.credential_type,
        votingWeight,
        expiryBlock,
        issuedAt:       currentBlock,
      },
    })
  } catch (e: any) {
    res.status(500).json({ error: "Failed to compute credential params", detail: e.message })
  }
})

// POST /verify — legacy: check requirements and issue credential via verifier wallet
// Kept for backward compatibility. Prefer /verify/credential-params + user wallet.
app.post("/verify", async (req: Request, res: Response) => {
  const { communityId, aleoAddress, connectedAccounts } = req.body as {
    communityId:       string
    aleoAddress:       string
    connectedAccounts: ConnectedAccount[]
  }

  if (!communityId || !aleoAddress || !connectedAccounts) {
    return res.status(400).json({ error: "Missing communityId, aleoAddress, or connectedAccounts" })
  }

  const community = getCommunityConfig(communityId)
  if (!community) return res.status(404).json({ error: "Community not found" })

  const { passed, results } = await evaluateRequirements(
    community.requirement_groups,
    connectedAccounts,
  )

  if (!passed) {
    return res.json({ passed: false, results })
  }

  try {
    const currentBlock = await getCurrentBlockHeight()
    const expiryBlock  = currentBlock + community.credential_expiry_days * 24 * 60 * 4

    const votingWeight = calculateVotingWeight(community.requirement_groups, results)
    const txId = await issueCredential(
      aleoAddress,
      communityId,
      community.credential_type,
      votingWeight,
      expiryBlock,
      currentBlock,
    )

    res.json({ passed: true, results, txId })
  } catch (e: any) {
    console.error("Credential issuance failed:", e)
    res.status(500).json({ error: "Credential issuance failed", detail: e.message })
  }
})

// DELETE /communities/:id/polls/:pollId — remove a poll from community (admin only)
// Protected by ADMIN_SECRET env var
app.delete("/communities/:id/polls/:pollId", (req: Request, res: Response) => {
  const secret = process.env.ADMIN_SECRET
  if (!secret || req.headers['x-admin-secret'] !== secret) {
    return res.status(401).json({ error: "Unauthorized" })
  }
  const community = getCommunityConfig(req.params.id)
  if (!community) return res.status(404).json({ error: "Community not found" })
  const before = (community.polls ?? []).length
  community.polls = (community.polls ?? []).filter(p => p.poll_id !== req.params.pollId)
  if (community.polls.length === before) return res.status(404).json({ error: "Poll not found" })
  saveCommunityConfig(community)
  res.json({ ok: true, removed: req.params.pollId })
})

// POST /polls/:pollId/vote-tx — called by frontend after cast_vote confirms
// Persists the tx ID to the community JSON file so tally engine can fetch it
app.post("/polls/:pollId/vote-tx", (req: Request, res: Response) => {
  const { txId, communityId } = req.body as { txId: string; communityId: string }
  if (!txId || !communityId) return res.status(400).json({ error: "txId and communityId required" })
  const community = getCommunityConfig(communityId)
  if (!community) return res.status(404).json({ error: "Community not found" })
  const poll = community.polls?.find(p => p.poll_id === req.params.pollId)
  if (!poll) return res.status(404).json({ error: "Poll not found" })
  poll.vote_txids = [...new Set([...(poll.vote_txids ?? []), txId])]
  saveCommunityConfig(community)
  res.json({ ok: true })
})

// ─── Tally / Snapshot ────────────────────────────────────────────────────────

// POST /polls/:id/snapshot
// Body: { communityId: string, force?: boolean }
// POST /operator/tally/:pollId — manual tally trigger (preview or force publish)
// Body: { communityId: string, force?: boolean }
// Returns the tally result. If force=true, also publishes snapshot on-chain.
app.post("/operator/tally/:pollId", async (req: Request, res: Response) => {
  const { communityId, force = false } = req.body as { communityId: string; force?: boolean }
  if (!communityId) return res.status(400).json({ error: "communityId required" })

  const community = getCommunityConfig(communityId)
  if (!community) return res.status(404).json({ error: "Community not found" })

  const poll = community.polls?.find(p => p.poll_id === req.params.pollId)
  if (!poll) return res.status(404).json({ error: "Poll not found in community config" })

  try {
    const result = await manualTally(req.params.pollId, communityId, poll, !!force)

    // If force-published, persist updated scope_keys back to community config + re-pin to IPFS
    if (force && result.txIds?.length) {
      saveCommunityConfig(community)
      if (isPinataConfigured()) {
        try {
          const cid = await pinJSON(community, `community-${communityId}`)
          console.log(`[tally] Re-pinned community config with scope_keys: ${cid}`)
        } catch (e: any) {
          console.warn("[tally] Re-pin failed (non-fatal):", e.message)
        }
      }
    }

    res.json(result)
  } catch (e: any) {
    res.status(500).json({ error: "Tally failed", detail: e.message })
  }
})

// GET /polls/:id/vote-count
// Lightweight endpoint — reads on-chain poll_vote_count mappings (v3 + v2).
app.get("/polls/:id/vote-count", async (req: Request, res: Response) => {
  const { getPollVoteCount } = await import("./tally.js")
  try {
    const count = await getPollVoteCount(req.params.id)
    res.json({ poll_id: req.params.id, total_votes: count })
  } catch (e: any) {
    res.status(500).json({ error: "Failed to fetch vote count", detail: e.message })
  }
})

// ─── Start ────────────────────────────────────────────────────────────────────

loadCommunities()
startTallyRunner()

const PORT = Number(process.env.PORT ?? 3001)
app.listen(PORT, () => {
  console.log(`ZKPoll verifier running on http://localhost:${PORT}`)
})
