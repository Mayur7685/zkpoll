// Thin wrapper over the wallet adaptor's useWallet hook.

import { useCallback } from 'react'
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react'
import type { Credential, VoteRecord } from '../types'

/**
 * Strip Leo type + visibility suffixes: "123field.private" → "123", "5u8.public" → "5"
 * Aleo record plaintext fields always carry a visibility annotation (.private/.public/.constant).
 */
function stripType(value: unknown, suffix: string): string {
  return String(value ?? '')
    .replace(/\.(private|public|constant)$/i, '')   // strip visibility first
    .replace(new RegExp(`\\s*${suffix}$`, 'i'), '')  // then strip Leo type suffix
    .trim()
}

/** parseInt that returns 0 only on genuine 0, not on NaN (missing/unparseable fields). */
function safeParseInt(s: string): number {
  const n = parseInt(s, 10)
  return Number.isNaN(n) ? 0 : n
}

/**
 * Extract a record field value from any wallet adapter format:
 *   - Shield / standard: rec.field_name = "value"
 *   - Puzzle wallet:     rec.data.field_name.value = "value"
 *   - Leo wallet:        rec.plaintext = "{ field_name: value, ... }"
 */
function getField(rec: Record<string, unknown>, field: string): string {
  // 1. Direct field access (Shield, most adapters)
  if (rec[field] !== undefined && rec[field] !== null) {
    return String(rec[field])
  }

  // 2. Puzzle wallet: { data: { field: { type, value } } }
  const data = rec['data'] as Record<string, unknown> | undefined
  if (data) {
    const entry = data[field] as Record<string, unknown> | undefined
    if (entry !== undefined && entry !== null) {
      // entry might be { value: "...", type: "..." } or just the value string
      const v = (entry as Record<string, unknown>)['value'] ?? entry
      if (v !== undefined && v !== null) return String(v)
    }
  }

  // 3. Shield wallet / plaintext string: "{ owner: aleo1..., expiry_block: 123u32, ... }"
  const pt = rec['recordPlaintext'] ?? rec['plaintext'] ?? rec['record_plaintext'] ?? rec['text']
  if (typeof pt === 'string') {
    const m = new RegExp(`\\b${field}\\s*:\\s*([^,}\\s]+)`).exec(pt)
    if (m) return m[1].trim()
  }

  return ''
}

export function useAleoWallet() {
  const {
    wallet,
    address,
    connected,
    connecting,
    disconnecting,
    connect,
    disconnect,
    executeTransaction,
    requestRecords,
    transactionStatus,
  } = useWallet()

  /** Fetch private Vote records from zkpoll_core.aleo. */
  const requestVoteRecords = useCallback(async (): Promise<VoteRecord[]> => {
    if (!connected || !requestRecords) return []
    try {
      const raw: unknown[] = (await requestRecords('zkpoll_v2_core.aleo', true)) ?? []
      // Filter to Vote records only — they have 'rank_1'; Credential records have 'issued_at'
      const voteRaw = raw.filter((r) => {
        const rec = r as Record<string, unknown>
        const pt = rec['recordPlaintext'] ?? rec['plaintext'] ?? ''
        return typeof pt === 'string' ? /\brank_1\b/.test(pt) : getField(rec, 'rank_1') !== ''
      })
      return voteRaw.map((r: unknown) => {
        const rec = r as Record<string, unknown>
        return {
          owner:        String(rec['sender'] ?? getField(rec, 'owner')),
          poll_id:      stripType(getField(rec, 'poll_id'),      'field'),
          community_id: stripType(getField(rec, 'community_id'), 'field'),
          cast_at:      safeParseInt(stripType(getField(rec, 'cast_at'), 'u32')),
          nullifier:    stripType(getField(rec, 'nullifier'), 'field'),
          rankings: [
            safeParseInt(stripType(getField(rec, 'rank_1'), 'u8')),
            safeParseInt(stripType(getField(rec, 'rank_2'), 'u8')),
            safeParseInt(stripType(getField(rec, 'rank_3'), 'u8')),
            safeParseInt(stripType(getField(rec, 'rank_4'), 'u8')),
            safeParseInt(stripType(getField(rec, 'rank_5'), 'u8')),
            safeParseInt(stripType(getField(rec, 'rank_6'), 'u8')),
            safeParseInt(stripType(getField(rec, 'rank_7'), 'u8')),
            safeParseInt(stripType(getField(rec, 'rank_8'), 'u8')),
          ],
        }
      })
    } catch {
      return []
    }
  }, [connected, requestRecords])

  /** Fetch private Credential records from zkpoll_core.aleo (where they are issued and consumed). */
  const requestCredentialRecords = useCallback(async (): Promise<Credential[]> => {
    if (!connected || !requestRecords) {
      console.debug('[zkpoll] requestCredentialRecords: skipped — connected:', connected, 'requestRecords:', !!requestRecords)
      return []
    }
    try {
      // Credentials are issued by zkpoll_v2_core.aleo::issue_credential — same program as cast_vote.
      // This ensures record commitments match (program-scoped in Aleo VM).
      const raw: unknown[] = (await requestRecords('zkpoll_v2_core.aleo', true)) ?? []

      // Filter to Credential records only (Vote records also live in zkpoll_v2_core.aleo).
      // A Credential has 'issued_at'; a Vote has 'rank_1'. Use that to distinguish.
      const v2raw = raw.filter((r) => {
        const rec = r as Record<string, unknown>
        const pt = rec['recordPlaintext'] ?? rec['plaintext'] ?? ''
        const hasIssuedAt = typeof pt === 'string' ? /\bissued_at\b/.test(pt) : getField(rec, 'issued_at') !== ''
        return hasIssuedAt
      })
      const parse = (r: unknown, hasWeight: boolean): Credential => {
        const rec = r as Record<string, unknown>
        const wRaw = safeParseInt(stripType(getField(rec, 'voting_weight'), 'u64'))
        const expiry = safeParseInt(stripType(getField(rec, 'expiry_block'), 'u32'))
        const issuedAt = safeParseInt(stripType(getField(rec, 'issued_at'), 'u32'))
        if (expiry === 0) console.error('[zkpoll] expiry_block parsed as 0 — raw expiry_block field:', getField(rec, 'expiry_block'), '| full record:', rec)
        console.debug('[zkpoll] parsed credential → expiry_block:', expiry, 'issued_at:', issuedAt, 'community_id:', stripType(getField(rec, 'community_id'), 'field'))
        return {
          // Shield wallet: rec.sender has the actual address; rec.owner is a field commitment value
          owner:           String(rec['sender'] ?? getField(rec, 'owner')).replace(/\.(private|public|constant)$/i, ''),
          issuer:          getField(rec, 'issuer').replace(/\.(private|public|constant)$/i, ''),
          community_id:    stripType(getField(rec, 'community_id'),    'field'),
          credential_type: safeParseInt(stripType(getField(rec, 'credential_type'), 'u8')),
          voting_weight:   hasWeight ? (wRaw || 1) : 1,
          expiry_block:    expiry,
          issued_at:       issuedAt,
          // Private record inputs to executeTransaction must be the full Leo plaintext
          // including _nonce (which identifies the on-chain record for proof generation).
          // Shield wallet returns this as rec.recordPlaintext.
          _raw: (rec['recordPlaintext'] as string | undefined)
             ?? (rec['plaintext']       as string | undefined),
          _spent: typeof rec['spent'] === 'boolean' ? rec['spent'] : undefined,
        }
      }

      return v2raw.map(r => parse(r, true))
    } catch {
      return []
    }
  }, [connected, requestRecords])

  return {
    wallet,
    address: address ?? null,
    connected,
    connecting,
    disconnecting,
    connect,
    disconnect,
    /** Execute a program function via the connected wallet. Returns the transaction ID. */
    executeTransaction,
    /** Poll the on-chain status of a submitted transaction by its wallet txId. */
    transactionStatus,
    /** Fetch private Vote records from zkpoll_core.aleo. */
    requestVoteRecords,
    /** Fetch private Credential records from zkpoll_core.aleo. */
    requestCredentialRecords,
  }
}
