// Hook that powers the CredentialHub component.
// Loads the user's held credential + latest vote record for a community,
// computes MetaPoll's EV / VP% / CV numbers, and provides a recast action.

import { useState, useEffect, useCallback } from 'react'
import { useAleoWallet } from './useAleoWallet'
import { useVoting } from './useVoting'
import { getBlockHeight } from '../lib/aleo'
import {
  votingPowerPct,
  countedVotes,
  daysUntilNextDecay,
  completedPeriods,
  daysElapsed,
  periodProgress,
} from '../lib/decay'
import { rankingToSlots } from '../lib/ranking'
import type { Credential, VoteRecord, VoteRanking, CommunityConfig } from '../types'

const FIELD_MODULUS = 8444461749428370424248824938781546531375899335154063827935233455917409239041n

function fieldFromString(id: string): bigint {
  if (/^\d+$/.test(id)) return BigInt(id)
  let h = 0n
  for (let i = 0; i < id.length; i++) {
    h = (h * 31n + BigInt(id.charCodeAt(i))) % FIELD_MODULUS
  }
  return h
}

export interface CredentialHubState {
  // Data
  credential:     Credential | null
  voteRecord:     VoteRecord | null   // most recent vote in this community
  currentBlock:   number
  loading:        boolean

  // MetaPoll 3-number model
  eligibleVotes:  number   // EV — from credential.voting_weight (or 1 for v1 creds)
  vpPct:          number   // VP% — step-function decay
  cv:             number   // CV = floor(EV × VP%)
  periods:        number   // completed decay periods (0–5)
  daysLeft:       number   // days until next decay period
  elapsed:        number   // days since credential issued
  progress:       number   // 0–1 through current period (for progress bar)

  // Status flags
  isExpired:      boolean
  isDeactivated:  boolean  // VP = 0%

  // Actions
  recast:         () => Promise<void>
  refresh:        () => Promise<void>
}

export function useCredentialHub(community: CommunityConfig): CredentialHubState {
  const { requestCredentialRecords, requestVoteRecords, connected } = useAleoWallet()
  const { castVote } = useVoting()

  const [credential, setCredential]   = useState<Credential | null>(null)
  const [voteRecord, setVoteRecord]   = useState<VoteRecord | null>(null)
  const [currentBlock, setCurrentBlock] = useState(0)
  const [loading, setLoading]         = useState(true)

  const communityField = String(fieldFromString(community.community_id))

  const load = useCallback(async () => {
    if (!connected) { setLoading(false); setCredential(null); return }
    setLoading(true)
    try {
      const [creds, votes, block] = await Promise.all([
        requestCredentialRecords(),
        requestVoteRecords(),
        getBlockHeight(),
      ])

      // Find the most recently issued, unspent credential for this community.
      const matching = creds.filter(c =>
        c.community_id.trim() === communityField &&
        (community.credential_type === 0 || c.credential_type === community.credential_type) &&
        c._spent !== true
      )
      const cred = matching.sort((a, b) => b.issued_at - a.issued_at)[0] ?? null
      setCredential(cred)

      // Most recent vote in this community (by cast_at block, descending)
      const communityVotes = votes.filter(v => v.community_id.trim() === communityField)
      const latestVote = communityVotes.sort((a, b) => b.cast_at - a.cast_at)[0] ?? null
      setVoteRecord(latestVote)

      setCurrentBlock(block)
    } finally {
      setLoading(false)
    }
  }, [connected, communityField, community.credential_type, requestCredentialRecords, requestVoteRecords])

  useEffect(() => { void load() }, [load])

  // Recompute decay numbers
  const issuedAt      = credential?.issued_at ?? 0
  const expiryBlock   = credential?.expiry_block ?? 0
  const eligibleVotes = credential?.voting_weight ?? 1
  const vpPct         = credential ? votingPowerPct(issuedAt, currentBlock) : 0
  const cv            = credential ? countedVotes(eligibleVotes, issuedAt, currentBlock) : 0
  const periods       = credential ? completedPeriods(issuedAt, currentBlock) : 0
  const daysLeft      = credential ? daysUntilNextDecay(issuedAt, currentBlock) : 400
  const elapsed       = credential ? daysElapsed(issuedAt, currentBlock) : 0
  const progress      = credential ? periodProgress(issuedAt, currentBlock) : 0
  const isExpired     = !!credential && currentBlock > expiryBlock
  const isDeactivated = vpPct === 0 && !!credential

  // Recast: re-submit the same rankings as the latest vote record
  const recast = useCallback(async () => {
    if (!voteRecord || !credential || !community.polls?.length) return

    // Reconstruct VoteRanking from the stored vote record
    const ranking: VoteRanking = {}
    voteRecord.rankings.forEach((optionId, idx) => {
      if (optionId > 0) ranking[optionId] = idx + 1
    })

    // Find the poll this vote was cast on
    const pollId = voteRecord.poll_id
    const matchedPoll = community.polls?.find(p => p.poll_id === pollId)
    const operatorAddress = matchedPoll?.operator_address

    await castVote(pollId, community.community_id, community.credential_type, ranking, credential, operatorAddress)
    await load()  // refresh after recast
  }, [voteRecord, credential, community, castVote, load])

  return {
    credential,
    voteRecord,
    currentBlock,
    loading,
    eligibleVotes,
    vpPct,
    cv,
    periods,
    daysLeft,
    elapsed,
    progress,
    isExpired,
    isDeactivated,
    recast,
    refresh: load,
  }
}
