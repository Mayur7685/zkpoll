// Aleo network client — reads public state from the REST API.
// All writes happen through the wallet (Leo/Puzzle) via the adapter.

import type { PollMeta, Snapshot, ScopedSnapshot } from '../types'

const NODE_URL = import.meta.env.VITE_ALEO_NODE_URL ?? 'https://api.explorer.provable.com/v1'
const NETWORK  = import.meta.env.VITE_ALEO_NETWORK  ?? 'testnet'
const PROGRAM  = 'zkpoll_v2_core.aleo'

async function rpc<T>(path: string): Promise<T> {
  const res = await fetch(`${NODE_URL}/${NETWORK}${path}`)
  if (!res.ok) throw new Error(`Aleo RPC error ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

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
    return await rpc<string>(`/program/${program}/mapping/${mapping}/${key}`)
  } catch {
    return null
  }
}

export async function getPollVoteCount(pollId: string): Promise<number> {
  const raw = await getMappingValue(PROGRAM, 'poll_vote_count', `${pollId}field`)
  return stripU32(raw ?? '0u32')
}

export async function isNullifierUsed(nullifier: string): Promise<boolean> {
  const val = await getMappingValue(PROGRAM, 'used_nullifiers', nullifier)
  return val === 'true'
}

export async function getPollMeta(pollId: string): Promise<PollMeta | null> {
  const raw = await getMappingValue(PROGRAM, 'polls', `${pollId}field`)
  if (!raw) return null
  const f = parseLeoStruct(raw)
  return {
    creator:                  f.creator ?? '',
    community_id:             stripField(f.community_id ?? ''),
    required_credential_type: stripU8(f.required_credential_type ?? '0u8'),
    created_at:               stripU32(f.created_at ?? '0u32'),
    active:                   stripBool(f.active ?? 'false'),
  }
}

export async function isCommunityRegistered(communityId: string): Promise<boolean> {
  const FIELD_MODULUS = 8444461749428370424248824938781546531375899335154063827935233455917409239041n
  let h = /^\d+$/.test(communityId) ? BigInt(communityId) : 0n
  if (h === 0n) {
    for (let i = 0; i < communityId.length; i++)
      h = (h * 31n + BigInt(communityId.charCodeAt(i))) % FIELD_MODULUS
  }
  const val = await getMappingValue(PROGRAM, 'communities', `${h}field`)
  return val !== null && val !== 'null'
}


export async function getLatestSnapshot(_pollId: string): Promise<Snapshot | null> {
  return null
}

export async function getAllScopedSnapshots(
  scopeKeys: Array<{ parentOptionId: number; scopeKey: string }>
): Promise<Map<number, ScopedSnapshot>> {
  const result = new Map<number, ScopedSnapshot>()
  await Promise.all(scopeKeys.map(async ({ parentOptionId, scopeKey }) => {
    // scopeKey is the snapshot_id (u32) — query scoped_snapshot_store directly
    const raw = await getMappingValue(PROGRAM, 'scoped_snapshot_store', `${scopeKey}u32`)
    if (!raw) return
    const f = parseLeoStruct(raw)
    result.set(parentOptionId, {
      snapshot_id:      stripU32(f.snapshot_id      ?? '0u32'),
      poll_id:          stripField(f.poll_id         ?? ''),
      community_id:     stripField(f.community_id    ?? ''),
      parent_option_id: stripU8(f.parent_option_id   ?? '0u8'),
      block_height:     stripU32(f.block_height      ?? '0u32'),
      total_votes:      stripU32(f.total_votes       ?? '0u32'),
      rank_1_option:    stripU8(f.rank_1_option      ?? '0u8'),
      rank_2_option:    stripU8(f.rank_2_option      ?? '0u8'),
      rank_3_option:    stripU8(f.rank_3_option      ?? '0u8'),
      rank_4_option:    stripU8(f.rank_4_option      ?? '0u8'),
    })
  }))
  return result
}
