import { useState, useCallback, useRef } from 'react'
import { TransactionStatus } from '@provablehq/aleo-types'
import { useAleoWallet } from './useAleoWallet'
import { getBlockHeight, isNullifierUsed } from '../lib/aleo'
import { rankingToSlots } from '../lib/ranking'
import type { Credential, VoteRanking } from '../types'

type VoteStatus = 'idle' | 'building' | 'signing' | 'confirming' | 'done' | 'error'

const FIELD_MODULUS = 8444461749428370424248824938781546531375899335154063827935233455917409239041n

function fieldFromString(id: string): bigint {
  if (/^\d+$/.test(id)) return BigInt(id)
  let h = 0n
  for (let i = 0; i < id.length; i++) {
    h = (h * 31n + BigInt(id.charCodeAt(i))) % FIELD_MODULUS
  }
  return h
}

// Fees are in MICROCREDITS (1 credit = 1,000,000 microcredits)
const VOTE_FEE = 30_000

export function useVoting() {
  const { executeTransaction, transactionStatus, address, connected, requestCredentialRecords } = useAleoWallet()
  const [status, setStatus] = useState<VoteStatus>('idle')
  const [txId, setTxId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  const castVote = useCallback(async (
    pollId: string,
    communityId: string,
    requiredCredType: number,
    ranking: VoteRanking,
    /** Optional: pass credential if already fetched; otherwise auto-fetched from wallet */
    credential?: Credential,
  ) => {
    if (!connected || !address) { setError('Wallet not connected'); return }

    setStatus('building'); setError(null); setTxId(null); stopPolling()

    try {
      // ── Step 1: resolve credential ──────────────────────────────────
      let credInput: string

      if (credential?._raw) {
        credInput = credential._raw
      } else if (credential) {
        credInput = buildCredentialPlaintext(credential)
      } else {
        // Fetch from wallet, find one matching this community + cred type
        const creds = await requestCredentialRecords()
        const communityField = String(fieldFromString(communityId))

        // Use newest unspent credential matching this community + type.
        const eligible = creds
          .filter(c =>
            c.community_id.trim() === communityField &&
            (requiredCredType === 0 || c.credential_type === requiredCredType) &&
            c._spent !== true &&
            c._raw !== undefined   // must have on-chain plaintext to prove ownership
          )
          .sort((a, b) => b.issued_at - a.issued_at)
        const match = eligible[0]

        if (!match) {
          if (creds.length === 0) {
            // Wallet returned no credentials at all — likely a sync delay
            throw new Error('NO_CREDENTIAL_SYNC')
          }
          // Credentials exist but none match this community/type
          throw new Error('NO_CREDENTIAL')
        }
        console.debug('[zkpoll] using credential issued_at:', match.issued_at, 'spent:', match._spent, '_raw prefix:', match._raw?.slice(0, 60))
        credInput = match._raw ?? buildCredentialPlaintext(match)
      }

      // ── Step 2: build remaining inputs ─────────────────────────────
      const blockHeight = await getBlockHeight()

      // Nullifier — deterministic per (community, poll, voter)
      const nullifierInput = `${communityId}${pollId}${address}`
      let h = 0n
      for (let i = 0; i < nullifierInput.length; i++) {
        h = (h * 31n + BigInt(nullifierInput.charCodeAt(i))) % FIELD_MODULUS
      }
      const nullifier = `${h}field`

      // ── Check if already voted ──────────────────────────────────────
      const alreadyVoted = await isNullifierUsed(nullifier)
      if (alreadyVoted) throw new Error('ALREADY_VOTED')

      const slots = rankingToSlots(ranking, 8)
      const [r1, r2, r3, r4, r5, r6, r7, r8] = slots

      setStatus('signing')
      console.debug('[zkpoll] castVote credInput (first 120 chars):', credInput?.slice(0, 120))
      console.debug('[zkpoll] castVote all inputs:', [`${pollId}field`, `${fieldFromString(communityId)}field`, `${requiredCredType}u8`, nullifier, `${blockHeight}u32`])

      // v3: community_id, required_cred_type, cast_at, and r1-r8 are all PRIVATE inputs.
      // Only poll_id and nullifier are public (needed by the finalize mapping updates).
      const result = await executeTransaction!({
        program:  'zkpoll_vote2.aleo',
        function: 'cast_vote',
        fee:      VOTE_FEE,
        privateFee: false,
        inputs: [
          credInput,                              // private Credential record
          `${pollId}field`,                       // public  — finalize lookup
          `${fieldFromString(communityId)}field`, // PRIVATE — ZK only
          `${requiredCredType}u8`,                // PRIVATE — ZK only
          nullifier,                              // public  — finalize double-vote
          `${blockHeight}u32`,                    // PRIVATE — ZK only
          `${r1}u8`, `${r2}u8`, `${r3}u8`, `${r4}u8`,  // PRIVATE — ballot
          `${r5}u8`, `${r6}u8`, `${r7}u8`, `${r8}u8`,  // PRIVATE — ballot
        ],
      })

      const walletTxId = result?.transactionId
      if (!walletTxId) throw new Error('No transaction ID returned from wallet')

      // Show wallet-internal ID immediately; swap to real on-chain ID when confirmed
      setTxId(walletTxId)
      setStatus('confirming')

      // ── Step 3: poll for confirmation + real on-chain txId ──────────
      if (transactionStatus) {
        let attempts = 0
        pollRef.current = setInterval(async () => {
          attempts++
          try {
            const res = await transactionStatus(walletTxId)
            const s = res.status.toLowerCase()
            // Capture real on-chain ID emitted by the indexer/adapter
            const onChainId = (res as unknown as Record<string, unknown>).transactionId as string | undefined

            if (s === TransactionStatus.ACCEPTED) {
              stopPolling()
              // Prefer real on-chain ID for the explorer link
              if (onChainId) setTxId(onChainId)
              setStatus('done')
            } else if (s === TransactionStatus.FAILED || s === TransactionStatus.REJECTED) {
              stopPolling()
              setError(res.error ?? 'Transaction rejected on-chain')
              setStatus('error')
            } else if (attempts > 72) { // 72 × 2s ≈ 2.4 min — optimistic fallback
              stopPolling()
              if (onChainId) setTxId(onChainId)
              setStatus('done')
            }
          } catch { /* network hiccup — retry next tick */ }
        }, 2_000)
      } else {
        // Wallet doesn't support status polling — optimistic done after 10s
        setTimeout(() => setStatus('done'), 10_000)
      }
    } catch (e: unknown) {
      stopPolling()
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setStatus('error')
    }
  }, [executeTransaction, transactionStatus, address, connected, requestCredentialRecords])

  return { castVote, status, txId, error }
}

/**
 * Construct a Leo record plaintext string from a parsed Credential object.
 * Used as fallback when the wallet doesn't expose record.plaintext.
 */
function buildCredentialPlaintext(c: Credential): string {
  // v2 credential includes voting_weight; v1 credentials have voting_weight=1 (default)
  const weight = c.voting_weight ?? 1
  return `{ owner: ${c.owner}.private, issuer: ${c.issuer}.private, community_id: ${c.community_id}field.private, credential_type: ${c.credential_type}u8.private, voting_weight: ${weight}u64.private, expiry_block: ${c.expiry_block}u32.private, issued_at: ${c.issued_at}u32.private }`
}
