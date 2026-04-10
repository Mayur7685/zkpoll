import "dotenv/config"
import express, { Request, Response } from "express"
import cors from "cors"
import { evaluateRequirements, calculateVotingWeight } from "./evaluator.js"
import { issueCredential, getCurrentBlockHeight } from "./issuer.js"
import { loadCommunities, getCommunityConfig, getAllCommunities, saveCommunityConfig } from "./communities.js"
import { pinJSON, isPinataConfigured, ipfsUrl } from "./pinata.js"
import { computeTally, getCurrentBlockHeight as getTallyBlock, OnChainVote } from "./tally.js"
import { ConnectedAccount, CommunityConfig, PollInfo } from "./types.js"

const app = express()
app.use(cors())
app.use(express.json())

// ─── Health ──────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "zkpoll-verifier" })
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
app.get("/communities", (_req, res) => {
  res.json(getAllCommunities().map(serializeCommunity))
})

// GET /communities/:id — get a single community config
app.get("/communities/:id", (req, res) => {
  const community = getCommunityConfig(req.params.id)
  if (!community) return res.status(404).json({ error: "Community not found" })
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

// ─── Tally / Snapshot ────────────────────────────────────────────────────────

// POST /polls/:id/snapshot
// Body: { votes: OnChainVote[] }
// Operator submits the collected vote ballots; verifier tallies with MDCT
// decay model, pins result to IPFS, and returns the snapshot struct ready
// for on-chain submission via zkpoll_tally.aleo::record_snapshot.
//
// Because v3 rankings are private ZK witnesses (not readable on-chain),
// the operator must supply ballots collected from participating wallets.
app.post("/polls/:id/snapshot", async (req: Request, res: Response) => {
  const pollId = req.params.id
  const { votes } = req.body as { votes: OnChainVote[] }

  if (!Array.isArray(votes) || votes.length === 0) {
    return res.status(400).json({ error: "votes array required" })
  }

  try {
    const currentBlock = await getTallyBlock()
    const tally        = computeTally(pollId, votes, currentBlock)

    // Pin tally result to IPFS for auditability (best-effort)
    let ipfs_cid: string | undefined
    let ipfs_url: string | undefined
    if (isPinataConfigured()) {
      try {
        ipfs_cid = await pinJSON(tally, `snapshot-${pollId}-${currentBlock}`)
        ipfs_url  = ipfsUrl(ipfs_cid)
        console.log(`Snapshot for poll ${pollId} pinned: ${ipfs_cid}`)
      } catch (e: any) {
        console.warn("Pinata snapshot upload failed (non-fatal):", e.message)
      }
    }

    res.json({ ...tally, ipfs_cid, ipfs_url })
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

const PORT = Number(process.env.PORT ?? 3001)
app.listen(PORT, () => {
  console.log(`ZKPoll verifier running on http://localhost:${PORT}`)
})
