// ─── Automated tally runner ───────────────────────────────────────────────────

import {
  getCurrentBlockHeight,
  getPollEndBlock,
  getPollVoteCount,
  getMappingValue,
  fetchAndDecryptVotes,
  computeScopedTallies,
  publishScopedSnapshot,
  getScopeKeyFromTx,
} from "./tally.js"
import { getAllCommunities } from "./communities.js"
import type { PollInfo } from "./types.js"

const POLL_INTERVAL_MS = 60_000
const FIELD_MODULUS = 8444461749428370424248824938781546531375899335154063827935233455917409239041n

function communityIdToField(id: string): string {
  if (/^\d+$/.test(id)) return id
  let h = 0n
  for (let i = 0; i < id.length; i++) {
    h = (h * 31n + BigInt(id.charCodeAt(i))) % FIELD_MODULUS
  }
  return String(h)
}

function buildOptionTree(poll: PollInfo): Map<number, number[]> {
  const tree = new Map<number, number[]>()
  tree.set(0, [])
  for (const opt of poll.options) {
    const parent = opt.parent_option_id
    if (!tree.has(parent)) tree.set(parent, [])
    tree.get(parent)!.push(opt.option_id)
  }
  return tree
}

const published = new Set<string>()

async function runOnce() {
  if (!process.env.OPERATOR_PRIVATE_KEY || !process.env.OPERATOR_VIEW_KEY) return

  let currentBlock: number
  try {
    currentBlock = await getCurrentBlockHeight()
  } catch {
    return
  }

  for (const config of getAllCommunities()) {
    const communityId = config.community_id
    if (!config.polls) continue

    for (const poll of config.polls) {
      const pollField = poll.poll_id
      const cacheKey  = `${communityId}:${pollField}`

      if (published.has(cacheKey)) continue

      // If scope_keys already stored from a prior run, verify root scope still on-chain
      const existingRootKey = poll.scope_keys?.find(s => s.parentOptionId === 0)?.scopeKey
      if (existingRootKey) {
        const existingSnap = await getMappingValue("scoped_snapshots", existingRootKey)
        if (existingSnap && existingSnap !== "null") {
          published.add(cacheKey)
          continue
        }
      }

      const endBlock = await getPollEndBlock(pollField)
      if (endBlock === null || currentBlock <= endBlock) {
        console.log(`[tally] Poll ${pollField.slice(0,12)}… still active (end_block=${endBlock}, now=${currentBlock})`)
        continue
      }

      const voteCount = await getPollVoteCount(pollField)
      const communityField = communityIdToField(communityId)
      const optionTree = buildOptionTree(poll)

      console.log(`[tally] Poll ${pollField} ended. Decrypting ${voteCount} votes…`)

      try {
        const votes = voteCount > 0 ? await fetchAndDecryptVotes(pollField, poll.vote_txids ?? []) : []

        if (voteCount > 0 && votes.length === 0) {
          console.warn(`[tally] Poll ${pollField}: on-chain count=${voteCount} but decrypted 0. Check OPERATOR_VIEW_KEY.`)
          continue
        }

        const scopedTallies = computeScopedTallies(pollField, communityField, votes, optionTree, currentBlock)
        const scopeKeys: Array<{ parentOptionId: number; scopeKey: string }> = []

        for (const tally of scopedTallies) {
          if (tally.total_votes === 0 && tally.parent_option_id !== 0) continue
          const txId = await publishScopedSnapshot(tally)

          // Resolve real BHP256 scope_key from confirmed transaction (retry for indexer lag)
          let realKey: string | null = null
          for (let attempt = 0; attempt < 6 && !realKey; attempt++) {
            await new Promise(r => setTimeout(r, 5_000))
            realKey = await getScopeKeyFromTx(txId)
          }

          if (realKey) {
            scopeKeys.push({ parentOptionId: tally.parent_option_id, scopeKey: realKey })
          } else {
            console.warn(`[tally] Could not resolve scope_key for parent=${tally.parent_option_id} txId=${txId}`)
          }
          console.log(`[tally] parent=${tally.parent_option_id} key=${realKey} txId=${txId}`)
        }

        poll.scope_keys = scopeKeys
        console.log(`[tally] Published ${scopeKeys.length} scoped snapshots for poll ${pollField}`)
        published.add(cacheKey)
      } catch (e: any) {
        console.error(`[tally] Error processing poll ${pollField}:`, e?.message)
      }
    }
  }
}

export function startTallyRunner() {
  if (!process.env.OPERATOR_PRIVATE_KEY || !process.env.OPERATOR_VIEW_KEY) {
    console.warn("[tally] OPERATOR_PRIVATE_KEY or OPERATOR_VIEW_KEY not set — tally runner disabled")
    return
  }
  console.log("[tally] Automated tally runner started — checking every 60s")
  void runOnce()
  setInterval(() => void runOnce(), POLL_INTERVAL_MS)
}

export async function manualTally(
  pollId: string,
  communityId: string,
  poll: PollInfo,
  force = false,
): Promise<{ tallies: ReturnType<typeof computeScopedTallies>; txIds?: string[] }> {
  const currentBlock = await getCurrentBlockHeight()
  const communityField = communityIdToField(communityId)
  const optionTree = buildOptionTree(poll)
  const votes = await fetchAndDecryptVotes(pollId, poll.vote_txids ?? [])
  const tallies = computeScopedTallies(pollId, communityField, votes, optionTree, currentBlock)

  if (force) {
    const txIds: string[] = []
    const scopeKeys: Array<{ parentOptionId: number; scopeKey: string }> = []

    for (const tally of tallies) {
      if (tally.total_votes === 0 && tally.parent_option_id !== 0) continue
      const txId = await publishScopedSnapshot(tally)
      txIds.push(txId)

      // Resolve real BHP256 scope_key from confirmed tx (retry for indexer lag)
      let realKey: string | null = null
      for (let attempt = 0; attempt < 6 && !realKey; attempt++) {
        await new Promise(r => setTimeout(r, 5_000))
        realKey = await getScopeKeyFromTx(txId)
      }
      if (realKey) scopeKeys.push({ parentOptionId: tally.parent_option_id, scopeKey: realKey })
    }

    // Write scope_keys back to poll so frontend can fetch snapshots
    poll.scope_keys = scopeKeys

    return { tallies, txIds }
  }

  return { tallies }
}
