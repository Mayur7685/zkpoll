// ─── Automated tally engine ───────────────────────────────────────────────────
//
// Scans on-chain transactions for zkpoll_core.aleo/cast_vote outputs,
// decrypts OperatorVote records using the operator view key,
// computes the MDCT weighted tally, and publishes the result via create_snapshot.
//
// MDCT model (MetaPoll step-decay):
//   score(option) = Σ  voting_weight × (1 / rank_position)
//   voting_weight comes from the credential (computed by verifier at issuance)

import {
  Account,
  ProgramManager,
  AleoNetworkClient,
  NetworkRecordProvider,
  AleoKeyProvider,
  ViewKey,
  RecordCiphertext,
} from "@provablehq/sdk"

// ─── Constants ────────────────────────────────────────────────────────────────

const PROGRAM     = "zkpoll_core.aleo"
const NODE_URL    = () => process.env.ALEO_NODE_URL  ?? "https://api.explorer.provable.com/v1"
const NETWORK     = () => process.env.ALEO_NETWORK   ?? "testnet"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DecryptedVote {
  poll_id:       string   // field value as numeric string
  community_id:  string
  voter:         string   // aleo address
  rankings:      number[] // [r1..r8], 0 = unranked
  cast_at:       number
  nullifier:     string
  voting_weight: number
}

export interface TallyResult {
  poll_id:       string
  community_id:  string
  block_height:  number
  total_votes:   number
  scores:        Array<{ option_id: number; score: number }>
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

export async function getCurrentBlockHeight(): Promise<number> {
  const block = await aleoGet<{ header: { metadata: { height: number } } }>("/block/latest")
  return block.header.metadata.height
}

export async function getMappingValue(mapping: string, key: string): Promise<string | null> {
  try {
    return await aleoGet<string>(`/program/${PROGRAM}/mapping/${mapping}/${key}`)
  } catch {
    return null
  }
}

export async function getPollVoteCount(pollId: string): Promise<number> {
  const val = await getMappingValue("poll_vote_count", `${pollId}field`)
  return val ? parseInt(val.replace(/u32$/, "")) : 0
}

export async function getPollEndBlock(pollId: string): Promise<number | null> {
  try {
    const val = await aleoGet<any>(`/program/${PROGRAM}/mapping/polls/${pollId}field`)
    if (!val) return null
    // val is a PollMeta struct — parse end_block field
    const match = String(val).match(/end_block:\s*(\d+)u32/)
    return match ? parseInt(match[1]) : null
  } catch {
    return null
  }
}

// ─── Record scanning and decryption ──────────────────────────────────────────

/** Strip Leo type suffixes — "10u64" → 10, "5field" → "5", "true" → true */
function parseField(v: string): string {
  return v.replace(/field$/, "").trim()
}
function parseU(v: string): number {
  return parseInt(v.replace(/u\d+$/, "").trim())
}

/**
 * Fetch all cast_vote transactions for the program and decrypt OperatorVote records
 * that belong to the operator (using the operator view key).
 *
 * Aleo REST: GET /program/{program}/transitions returns paginated transition list.
 * Each transition output has a `value` field containing the record ciphertext.
 */
export async function fetchAndDecryptVotes(pollId: string): Promise<DecryptedVote[]> {
  const viewKeyStr = process.env.OPERATOR_VIEW_KEY
  if (!viewKeyStr) throw new Error("OPERATOR_VIEW_KEY not set in .env")

  const viewKey = ViewKey.from_string(viewKeyStr)
  const votes: DecryptedVote[] = []

  // Fetch all transitions for the program, filter to cast_vote, decrypt OperatorVote outputs.
  // Aleo REST: GET /{network}/program/{program}/transitions?page={n}&pageSize={n}
  let page = 0
  const pageSize = 50

  while (true) {
    let transitions: any[]
    try {
      transitions = await aleoGet<any[]>(
        `/program/${PROGRAM}/transitions?page=${page}&pageSize=${pageSize}`
      )
    } catch {
      break
    }
    if (!transitions || transitions.length === 0) break

    for (const tx of transitions) {
      // Filter to cast_vote transitions only
      if (tx.function !== "cast_vote" && tx.function_name !== "cast_vote") continue

      // cast_vote returns (Vote, OperatorVote, Final) — OperatorVote is at index 1
      const outputs: any[] = tx.outputs ?? []
      const opCiphertext = outputs[1]?.value as string | undefined
      if (!opCiphertext || !opCiphertext.startsWith("record")) continue

      try {
        const ciphertext = RecordCiphertext.fromString(opCiphertext)

        // Skip records not owned by operator
        if (!ciphertext.isOwner(viewKey)) continue
        const plaintext = ciphertext.decrypt(viewKey)
        if (!plaintext) continue

        // Parse plaintext — format: "{ owner: aleo1..., poll_id: 123field, rank_1: 3u8, ... }"
        const str = plaintext.toString()
        const get = (field: string): string => {
          const m = str.match(new RegExp(`\\b${field}:\\s*([^,}\\n]+)`))
          return m ? m[1].trim() : "0"
        }

        const recordPollId = parseField(get("poll_id"))
        if (recordPollId !== pollId) continue  // different poll — skip

        votes.push({
          poll_id:       recordPollId,
          community_id:  parseField(get("community_id")),
          voter:         get("voter"),
          rankings: [
            parseU(get("rank_1")), parseU(get("rank_2")),
            parseU(get("rank_3")), parseU(get("rank_4")),
            parseU(get("rank_5")), parseU(get("rank_6")),
            parseU(get("rank_7")), parseU(get("rank_8")),
          ],
          cast_at:       parseU(get("cast_at")),
          nullifier:     parseField(get("nullifier")),
          voting_weight: parseU(get("voting_weight")),
        })
      } catch {
        continue
      }
    }

    if (transitions.length < pageSize) break
    page++
  }

  return votes
}

// ─── MDCT weighted tally ──────────────────────────────────────────────────────

/**
 * Compute MDCT tally from decrypted OperatorVote records.
 *
 * Score formula (MetaPoll model):
 *   score(option) += voting_weight × (1 / rank_position)
 *   rank 1 = full weight, rank 2 = half, rank 3 = third, etc.
 */
export function computeTally(
  pollId: string,
  communityId: string,
  votes: DecryptedVote[],
  currentBlock: number,
): TallyResult {
  const scores: Record<number, number> = {}

  for (const vote of votes) {
    vote.rankings.forEach((optId, idx) => {
      if (optId === 0) return                    // 0 = unranked
      const posWeight  = 1 / (idx + 1)           // rank 1=1.0, rank 2=0.5 …
      const totalScore = vote.voting_weight * posWeight
      scores[optId] = (scores[optId] ?? 0) + totalScore
    })
  }

  const ranked = Object.entries(scores)
    .map(([id, score]) => ({ option_id: Number(id), score }))
    .sort((a, b) => b.score - a.score)

  const slot = (i: number) => ranked[i]?.option_id ?? 0

  return {
    poll_id:       pollId,
    community_id:  communityId,
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

// ─── Snapshot submission ──────────────────────────────────────────────────────

/**
 * Submit create_snapshot transaction to zkpoll_core.aleo using the operator key.
 * Called automatically by the tally runner after computing the result.
 */
export async function publishSnapshot(tally: TallyResult): Promise<string> {
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY
  if (!operatorKey) throw new Error("OPERATOR_PRIVATE_KEY not set in .env")

  const operatorAccount  = new Account({ privateKey: operatorKey })
  const networkClient    = new AleoNetworkClient(NODE_URL())
  const recordProvider   = new NetworkRecordProvider(operatorAccount, networkClient)
  const keyProvider      = new AleoKeyProvider()
  keyProvider.useCache(true)

  const manager = new ProgramManager(NODE_URL(), keyProvider, recordProvider)
  manager.setAccount(operatorAccount)

  const txId = await manager.execute({
    programName:  PROGRAM,
    functionName: "create_snapshot",
    priorityFee:  0.03,
    privateFee:   false,
    inputs: [
      `${tally.poll_id}field`,
      `${tally.community_id}field`,
      `${tally.total_votes}u32`,
      `${tally.rank_1_option}u8`,
      `${tally.rank_2_option}u8`,
      `${tally.rank_3_option}u8`,
      `${tally.rank_4_option}u8`,
      `${tally.rank_5_option}u8`,
      `${tally.rank_6_option}u8`,
      `${tally.rank_7_option}u8`,
      `${tally.rank_8_option}u8`,
    ],
  })

  return txId
}
