// Aleo network client — reads public state from the REST API.
// All writes happen through the wallet (Leo/Puzzle) via the adapter.

import type { PollMeta, Snapshot } from '../types'

const NODE_URL = import.meta.env.VITE_ALEO_NODE_URL ?? 'https://api.explorer.provable.com/v1'
const NETWORK  = import.meta.env.VITE_ALEO_NETWORK  ?? 'testnet'

async function rpc<T>(path: string): Promise<T> {
  const res = await fetch(`${NODE_URL}/${NETWORK}${path}`)
  if (!res.ok) throw new Error(`Aleo RPC error ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

// ── Leo struct parsing ────────────────────────────────────────────────────────
// The Aleo REST API returns struct values as Leo literal strings, e.g.:
//   "{creator: aleo1..., community_id: 123field, active: true}"
function parseLeoStruct(raw: string): Record<string, string> {
  const inner = raw.trim().replace(/^\{|\}$/g, '')
  const result: Record<string, string> = {}
  let depth = 0
  let current = ''
  for (const ch of inner) {
    if (ch === '{') depth++
    else if (ch === '}') depth--
    if (ch === ',' && depth === 0) {
      addKV(current.trim(), result)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) addKV(current.trim(), result)
  return result
}

function addKV(pair: string, out: Record<string, string>) {
  const colon = pair.indexOf(':')
  if (colon === -1) return
  out[pair.slice(0, colon).trim()] = pair.slice(colon + 1).trim()
}

const stripU8    = (v: string) => parseInt(v.replace(/u8$/,    ''))
const stripU32   = (v: string) => parseInt(v.replace(/u32$/,   ''))
const stripField = (v: string) => v.replace(/field$/, '')
const stripBool  = (v: string) => v === 'true'

// ─────────────────────────────────────────────────────────────────────────────

export async function getBlockHeight(): Promise<number> {
  const block = await rpc<{ header: { metadata: { height: number } } }>('/block/latest')
  return block.header.metadata.height
}

export async function getMappingValue(
  program: string,
  mapping: string,
  key: string,
): Promise<string | null> {
  try {
    const data = await rpc<string>(`/program/${program}/mapping/${mapping}/${key}`)
    return data
  } catch {
    return null
  }
}

export async function getPollVoteCount(pollId: string): Promise<number> {
  const raw = await getMappingValue('zkpoll_core.aleo', 'poll_vote_count', `${pollId}field`)
  return stripU32(raw ?? '0u32')
}

export async function isNullifierUsed(nullifier: string): Promise<boolean> {
  const val = await getMappingValue('zkpoll_core.aleo', 'used_nullifiers', nullifier)
  return val === 'true'
}

export async function getPollMeta(pollId: string): Promise<PollMeta | null> {
  const raw = await getMappingValue('zkpoll_core.aleo', 'polls', `${pollId}field`)
  if (!raw) return null
  const f = parseLeoStruct(raw)
  return {
    creator:                    f.creator ?? '',
    community_id:               stripField(f.community_id ?? ''),
    required_credential_type:   stripU8(f.required_credential_type ?? '0u8'),
    created_at:                 stripU32(f.created_at ?? '0u32'),
    active:                     stripBool(f.active ?? 'false'),
  }
}

export async function getLatestSnapshot(pollId: string): Promise<Snapshot | null> {
  // Step 1: look up the latest snapshot ID for this poll
  const snapIdRaw = await getMappingValue('zkpoll_core.aleo', 'latest_snapshot', `${pollId}field`)
  if (!snapIdRaw) return null
  const snapId = snapIdRaw.replace(/u32$/, '')

  // Step 2: fetch the snapshot struct
  const raw = await getMappingValue('zkpoll_core.aleo', 'snapshots', snapId)
  if (!raw) return null
  const f = parseLeoStruct(raw)
  return {
    snapshot_id:    stripU32(f.snapshot_id   ?? '0u32'),
    poll_id:        stripField(f.poll_id      ?? ''),
    community_id:   stripField(f.community_id ?? ''),
    block_height:   stripU32(f.block_height   ?? '0u32'),
    total_votes:    stripU32(f.total_votes    ?? '0u32'),
    rank_1_option:  stripU8(f.rank_1_option   ?? '0u8'),
    rank_2_option:  stripU8(f.rank_2_option   ?? '0u8'),
    rank_3_option:  stripU8(f.rank_3_option   ?? '0u8'),
    rank_4_option:  stripU8(f.rank_4_option   ?? '0u8'),
    rank_5_option:  stripU8(f.rank_5_option   ?? '0u8'),
    rank_6_option:  stripU8(f.rank_6_option   ?? '0u8'),
    rank_7_option:  stripU8(f.rank_7_option   ?? '0u8'),
    rank_8_option:  stripU8(f.rank_8_option   ?? '0u8'),
  }
}
