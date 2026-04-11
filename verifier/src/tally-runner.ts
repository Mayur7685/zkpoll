// ─── Automated tally runner ───────────────────────────────────────────────────
//
// Runs as a background service alongside the verifier.
// Every POLL_INTERVAL_MS it:
//   1. Gets current block height
//   2. Checks all active polls — have they passed end_block?
//   3. If yes and no snapshot exists yet → decrypt votes, compute tally, publish
//
// Start by calling startTallyRunner() from index.ts on server boot.

import {
  getCurrentBlockHeight,
  getPollEndBlock,
  getPollVoteCount,
  getMappingValue,
  fetchAndDecryptVotes,
  computeTally,
  publishSnapshot,
} from "./tally.js"
import { getAllCommunities } from "./communities.js"

const POLL_INTERVAL_MS = 60_000   // check every 60 seconds
const FIELD_MODULUS = 8444461749428370424248824938781546531375899335154063827935233455917409239041n

function communityIdToField(id: string): string {
  if (/^\d+$/.test(id)) return id
  let h = 0n
  for (let i = 0; i < id.length; i++) {
    h = (h * 31n + BigInt(id.charCodeAt(i))) % FIELD_MODULUS
  }
  return String(h)
}

// Track which polls we've already published to avoid re-publishing
const published = new Set<string>()

async function runOnce() {
  if (!process.env.OPERATOR_PRIVATE_KEY || !process.env.OPERATOR_VIEW_KEY) return

  let currentBlock: number
  try {
    currentBlock = await getCurrentBlockHeight()
  } catch {
    return  // Network hiccup — try again next interval
  }

  for (const config of getAllCommunities()) {
    const communityId = config.community_id
    if (!config.polls) continue

    for (const poll of config.polls) {
      const pollField = poll.poll_id
      const cacheKey  = `${communityId}:${pollField}`

      // Already published this session
      if (published.has(cacheKey)) continue

      // Check if snapshot already exists on-chain
      const existingSnap = await getMappingValue("latest_snapshot", `${pollField}field`)
      if (existingSnap && existingSnap !== "null") {
        published.add(cacheKey)
        continue
      }

      // Fetch end_block from on-chain poll mapping
      const endBlock = await getPollEndBlock(pollField)
      const pollEnded = endBlock !== null && currentBlock > endBlock

      // Only auto-publish snapshot when poll has ended
      if (!pollEnded) {
        console.log(`[tally] Poll ${pollField.slice(0,12)}… still active (end_block=${endBlock}, now=${currentBlock})`)
        continue
      }

      // Poll has ended — check if there are any votes
      const voteCount = await getPollVoteCount(pollField)
      if (voteCount === 0) {
        // No votes — publish empty snapshot so results page shows "0 votes"
        const communityField = communityIdToField(communityId)
        try {
          const txId = await publishSnapshot({
            poll_id:       pollField,
            community_id:  communityField,
            block_height:  currentBlock,
            total_votes:   0,
            scores:        [],
            rank_1_option: 0,
            rank_2_option: 0,
            rank_3_option: 0,
            rank_4_option: 0,
            rank_5_option: 0,
            rank_6_option: 0,
            rank_7_option: 0,
            rank_8_option: 0,
          })
          console.log(`[tally] Published empty snapshot for poll ${pollField} — txId: ${txId}`)
          published.add(cacheKey)
        } catch (e: any) {
          console.error(`[tally] Failed to publish empty snapshot for poll ${pollField}:`, e?.message)
        }
        continue
      }

      // Decrypt OperatorVote records and compute MDCT tally
      console.log(`[tally] Poll ${pollField} ended at block ${endBlock}. Decrypting ${voteCount} votes…`)
      try {
        const votes = await fetchAndDecryptVotes(pollField)

        if (votes.length === 0) {
          console.warn(`[tally] Poll ${pollField}: on-chain vote count=${voteCount} but decrypted 0 records. Check OPERATOR_VIEW_KEY.`)
          continue
        }

        const communityField = communityIdToField(communityId)
        const tally = computeTally(pollField, communityField, votes, currentBlock)

        console.log(`[tally] Tally for poll ${pollField}:`, tally.scores.slice(0, 5))

        const txId = await publishSnapshot(tally)
        console.log(`[tally] Snapshot published for poll ${pollField} — txId: ${txId}`)
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

  // Run immediately on start, then on interval
  void runOnce()
  setInterval(() => void runOnce(), POLL_INTERVAL_MS)
}

/**
 * Manual trigger — called by POST /operator/tally/:pollId
 * Returns the tally result without publishing (for preview) or publishes if force=true.
 */
export async function manualTally(
  pollId: string,
  communityId: string,
  force = false,
): Promise<{ tally: ReturnType<typeof computeTally>; txId?: string }> {
  const currentBlock = await getCurrentBlockHeight()
  const communityField = communityIdToField(communityId)

  const votes = await fetchAndDecryptVotes(pollId)
  const tally = computeTally(pollId, communityField, votes, currentBlock)

  if (force) {
    const txId = await publishSnapshot(tally)
    return { tally, txId }
  }

  return { tally }
}
