// Off-chain MDCT tally engine.
// Reads on-chain vote counts via Aleo REST, computes ranked scores,
// and returns a snapshot struct that can be posted to the on-chain
// zkpoll_tally.aleo contract by the operator.
//
// Tally model: MetaPoll MDCT step-decay
//   score(option) = Σ vp(vote) × (1 / rank_position)
//   vp = votingPowerPct(issued_at, current_block) / 100

const BLOCKS_PER_DAY = 5760
const PERIOD_BLOCKS  = 400 * BLOCKS_PER_DAY  // 2_304_000
const MAX_PERIODS    = 5
const NODE_URL       = () => process.env.ALEO_NODE_URL  ?? "https://api.explorer.provable.com/v1"
const NETWORK        = () => process.env.ALEO_NETWORK   ?? "testnet"

// ─── Decay helpers (mirrored from frontend lib/decay.ts) ─────────────────────

function completedPeriods(issuedAt: number, current: number): number {
  if (current <= issuedAt) return 0
  return Math.min(Math.floor((current - issuedAt) / PERIOD_BLOCKS), MAX_PERIODS)
}

function votingPowerPct(issuedAt: number, current: number): number {
  const p = completedPeriods(issuedAt, current)
  if (p >= MAX_PERIODS) return 0
  return 100 / Math.pow(2, p)
}

// ─── On-chain data types ──────────────────────────────────────────────────────

export interface OnChainVote {
  nullifier:   string
  poll_id:     string
  cast_at:     number   // block height vote was cast
  issued_at:   number   // credential issuance block (for decay)
  rankings:    number[] // length 8; 0 = unranked
}

export interface TallyResult {
  poll_id:      string
  block_height: number
  total_votes:  number
  scores:       Array<{ option_id: number; score: number }>
  // Top-8 ranked options (for on-chain snapshot struct)
  rank_1_option: number
  rank_2_option: number
  rank_3_option: number
  rank_4_option: number
  rank_5_option: number
  rank_6_option: number
  rank_7_option: number
  rank_8_option: number
}

// ─── Aleo REST helpers ────────────────────────────────────────────────────────

async function aleoGet<T>(path: string): Promise<T> {
  const res = await fetch(`${NODE_URL()}/${NETWORK()}${path}`)
  if (!res.ok) throw new Error(`Aleo RPC ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

async function getMappingValue(program: string, mapping: string, key: string): Promise<string | null> {
  try {
    return await aleoGet<string>(`/program/${program}/mapping/${mapping}/${key}`)
  } catch {
    return null
  }
}

export async function getCurrentBlockHeight(): Promise<number> {
  const block = await aleoGet<{ header: { metadata: { height: number } } }>("/block/latest")
  return block.header.metadata.height
}

// ─── Vote fetching ────────────────────────────────────────────────────────────

/**
 * Read vote count for a poll from on-chain mappings (v3 + v2).
 * Returns the total number of votes cast (not the individual ballots —
 * ballots are private ZK witnesses and cannot be read on-chain).
 */
export async function getPollVoteCount(pollId: string): Promise<number> {
  const val = await getMappingValue("zkpoll_vote2.aleo", "poll_vote_count", `${pollId}field`)
  return val ? parseInt(val.replace(/u32$/, "")) : 0
}

// ─── Tally computation ────────────────────────────────────────────────────────

/**
 * Compute MDCT tally from a set of votes.
 *
 * NOTE: because rankings are private ZK inputs in v3, the verifier cannot
 * read individual ballots from the chain. Instead, votes must be submitted
 * to the verifier's POST /polls/:id/snapshot endpoint by the operator
 * (who collects votes from participating wallets that choose to share them,
 * or from a trusted aggregator). This is consistent with MetaPoll's model
 * where the operator runs the tally.
 */
export function computeTally(pollId: string, votes: OnChainVote[], currentBlock: number): TallyResult {
  const scores: Record<number, number> = {}

  for (const vote of votes) {
    const vp = votingPowerPct(vote.issued_at, currentBlock) / 100
    if (vp === 0) continue

    vote.rankings.forEach((optId, idx) => {
      if (optId === 0) return
      const posWeight = 1 / (idx + 1)   // rank 1=1.0, rank 2=0.5, rank 3=0.333…
      scores[optId] = (scores[optId] ?? 0) + vp * posWeight
    })
  }

  const ranked = Object.entries(scores)
    .map(([id, score]) => ({ option_id: Number(id), score }))
    .sort((a, b) => b.score - a.score)

  const slot = (i: number) => ranked[i]?.option_id ?? 0

  return {
    poll_id:       pollId,
    block_height:  currentBlock,
    total_votes:   votes.length,
    scores:        ranked,
    rank_1_option: slot(0),
    rank_2_option: slot(1),
    rank_3_option: slot(2),
    rank_4_option: slot(3),
    rank_5_option: slot(4),
    rank_6_option: slot(5),
    rank_7_option: slot(6),
    rank_8_option: slot(7),
  }
}
