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

const PROGRAM  = "zkpoll_v2_core.aleo"
const NODE_URL    = () => process.env.ALEO_NODE_URL  ?? "https://api.explorer.provable.com/v1"
const API_V2_URL  = () => process.env.ALEO_API_V2_URL ?? "https://api.provable.com/v2"
const NETWORK     = () => process.env.ALEO_NETWORK   ?? "testnet"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DecryptedVote {
  poll_id:       string
  community_id:  string
  voter:         string
  rankings:      number[] // [r1..r8], 0 = unranked
  cast_at:       number
  nullifier:     string
  voting_weight: number
}

export interface ScopedTallyResult {
  poll_id:          string
  community_id:     string
  parent_option_id: number   // 0 = root
  block_height:     number
  total_votes:      number
  rank_1_option:    number
  rank_2_option:    number
  rank_3_option:    number
  rank_4_option:    number
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
  return v.replace(/\.private$|\.public$|\.constant$/i, '').replace(/field$/, '').trim()
}
function parseU(v: string): number {
  return parseInt(v.replace(/\.private$|\.public$|\.constant$/i, '').replace(/u\d+$/, '').trim())
}

/**
 * Fetch all cast_vote transactions for the program and decrypt OperatorVote records
 * that belong to the operator (using the operator view key).
 *
 * Aleo REST: GET /program/{program}/transitions returns paginated transition list.
 * Each transition output has a `value` field containing the record ciphertext.
 */
export async function fetchAndDecryptVotes(pollId: string, knownTxIds: string[] = []): Promise<DecryptedVote[]> {
  const viewKeyStr = process.env.OPERATOR_VIEW_KEY
  if (!viewKeyStr) throw new Error("OPERATOR_VIEW_KEY not set in .env")
  const operatorAddress = process.env.OPERATOR_ADDRESS
  if (!operatorAddress) throw new Error("OPERATOR_ADDRESS not set in .env")

  const viewKey = ViewKey.from_string(viewKeyStr)
  const ciphertexts: string[] = []

  // Strategy 1: v2 API — transactions by operator address → fetch each tx for OperatorVote ciphertext
  try {
    let cursor_transition_id: string | undefined
    while (true) {
      const params = new URLSearchParams({ limit: "50" })
      if (cursor_transition_id) params.set("cursor_transition_id", cursor_transition_id)

      const res = await fetch(
        `${API_V2_URL()}/${NETWORK()}/transactions/address/${operatorAddress}?${params}`
      )
      if (!res.ok) throw new Error(`v2 API ${res.status}`)
      const data = await res.json() as {
        transactions: Array<{ transaction_id: string; program_id: string; function_id: string }>
        next_cursor?: { transition_id: string }
      }

      for (const t of data.transactions ?? []) {
        if (t.program_id !== PROGRAM) continue
        if (t.function_id !== "cast_vote") continue
        try {
          const tx = await aleoGet<any>(`/transaction/${t.transaction_id}`)
          for (const transition of tx?.execution?.transitions ?? []) {
            if (transition.function !== "cast_vote") continue
            const val = (transition.outputs ?? [])[1]?.value as string | undefined
            if (val?.startsWith("record")) ciphertexts.push(val)
          }
        } catch (e: any) { continue }
      }

      cursor_transition_id = data.next_cursor?.transition_id
      if (!cursor_transition_id || (data.transactions ?? []).length < 50) break
    }
  } catch (e: any) {
    console.warn("[tally] v2 transactions API failed:", e?.message)
  }

  // Strategy 2: known tx IDs stored in poll metadata
  if (ciphertexts.length === 0) {
    for (const txId of knownTxIds) {
      try {
        const tx = await aleoGet<any>(`/transaction/${txId}`)
        for (const t of tx?.execution?.transitions ?? []) {
          if (t.function !== "cast_vote") continue
          const val = (t.outputs ?? [])[1]?.value as string | undefined
          if (val?.startsWith("record")) ciphertexts.push(val)
        }
      } catch { continue }
    }
  }

  console.log(`[tally] found ${ciphertexts.length} OperatorVote ciphertexts`)

  const votes: DecryptedVote[] = []
  for (const ciphertextStr of ciphertexts) {
    try {
      const ciphertext = RecordCiphertext.fromString(ciphertextStr)
      if (!ciphertext.isOwner(viewKey)) continue
      const plaintext = ciphertext.decrypt(viewKey)
      if (!plaintext) continue
      const str = plaintext.toString()
      if (!str.includes("voting_weight")) continue
      const get = (field: string): string => {
        const m = str.match(new RegExp(`\\b${field}:\\s*([^,}\\n]+)`))
        return m ? m[1].trim() : "0"
      }
      const recordPollId = parseField(get("poll_id"))
      if (recordPollId !== pollId) continue
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
    } catch { continue }
  }

  console.log(`[tally] decrypted ${votes.length} votes for poll ${pollId}`)
  return votes
}

// ─── MDCT scoped tally ───────────────────────────────────────────────────────

export function computeScopedTallies(
  pollId: string,
  communityId: string,
  votes: DecryptedVote[],
  optionTree: Map<number, number[]>,
  currentBlock: number,
): ScopedTallyResult[] {
  const results: ScopedTallyResult[] = []

  for (const [parentId, children] of optionTree) {
    const childSet = new Set(children)
    const scores: Record<number, number> = {}

    for (const vote of votes) {
      vote.rankings.forEach((optId, idx) => {
        if (optId === 0 || !childSet.has(optId)) return
        scores[optId] = (scores[optId] ?? 0) + vote.voting_weight * (1 / (idx + 1))
      })
    }

    const ranked = Object.entries(scores)
      .map(([id, score]) => ({ option_id: Number(id), score }))
      .sort((a, b) => b.score - a.score)

    const slot = (i: number) => ranked[i]?.option_id ?? 0
    const votesInScope = votes.filter(v => v.rankings.some(r => childSet.has(r))).length

    results.push({
      poll_id:          pollId,
      community_id:     communityId,
      parent_option_id: parentId,
      block_height:     currentBlock,
      total_votes:      votesInScope,
      rank_1_option:    slot(0),
      rank_2_option:    slot(1),
      rank_3_option:    slot(2),
      rank_4_option:    slot(3),
    })
  }

  return results
}

// ─── Scope key resolution ─────────────────────────────────────────────────────
// Compute scope_key by querying the on-chain mapping after publishing.
// After create_scoped_snapshot confirms, the snapshot_counter increments.
// We fetch the latest snapshot_id, then read scoped_snapshot_store to get
// the ScopedSnapshot struct which contains parent_option_id — then we
// query latest_scoped_snapshot by iterating known scope_keys.
// 
// Simpler approach: after publish, query snapshot_counter to get snap_id,
// then read scoped_snapshot_store[snap_id].poll_id + parent_option_id,
// then compute scope_key = BHP256 — but we can't compute BHP256 in Node.
//
// Instead: store scope_key as the snap_id string — the frontend queries
// scoped_snapshot_store by snap_id directly (no BHP256 needed).
export async function getScopeKeyFromTx(txId: string): Promise<string | null> {
  // Wait for the tx to confirm, then find the snapshot_id from the transition outputs.
  // create_scoped_snapshot outputs a ScopedSnapshot record — snapshot_id is in it.
  // We read it from the finalized mapping: scoped_snapshot_store is keyed by snapshot_id.
  // The snapshot_counter mapping holds the latest snapshot_id after finalization.
  // We verify by checking that scoped_snapshot_store[snapId] contains our txId's poll_id.
  try {
    // Fetch the confirmed transaction and extract snapshot_id from finalize inputs/outputs
    const tx = await aleoGet<any>(`/transaction/${txId}`)
    for (const transition of tx?.execution?.transitions ?? []) {
      if (transition.function !== "create_scoped_snapshot") continue
      // The finalize section writes to scoped_snapshot_store — snapshot_id is the counter value
      // Try to read it from the transition's finalize inputs (first input is snapshot_id)
      const finalizeInputs = transition.finalize ?? []
      if (finalizeInputs.length > 0) {
        const snapIdRaw = String(finalizeInputs[0]).replace(/u32$/, '').trim()
        if (/^\d+$/.test(snapIdRaw)) return snapIdRaw
      }
    }
    // Fallback: read snapshot_counter (may be off by 1 under concurrent tallies)
    const val = await getMappingValue("snapshot_counter", "true")
    if (!val) return null
    const snapId = val.replace(/u32$/, "").replace(/\.public$|\.private$/, "").trim()
    return snapId
  } catch {
    return null
  }
}

export async function publishScopedSnapshot(tally: ScopedTallyResult): Promise<string> {
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY
  if (!operatorKey) throw new Error("OPERATOR_PRIVATE_KEY not set in .env")

  const operatorAccount = new Account({ privateKey: operatorKey })
  const networkClient   = new AleoNetworkClient(NODE_URL())
  const recordProvider  = new NetworkRecordProvider(operatorAccount, networkClient)
  const keyProvider     = new AleoKeyProvider()
  keyProvider.useCache(true)

  const manager = new ProgramManager(NODE_URL(), keyProvider, recordProvider)
  manager.setAccount(operatorAccount)

  return manager.execute({
    programName:  PROGRAM,
    functionName: "create_scoped_snapshot",
    priorityFee:  0.03,
    privateFee:   false,
    inputs: [
      `${tally.poll_id}field`,
      `${tally.community_id}field`,
      `${tally.parent_option_id}u8`,
      `${tally.total_votes}u32`,
      `${tally.rank_1_option}u8`,
      `${tally.rank_2_option}u8`,
      `${tally.rank_3_option}u8`,
      `${tally.rank_4_option}u8`,
    ],
  })
}
