// My Votes — shows all vote records from the connected wallet.
// For each vote: community name, poll title, EV/VP%/CV at the current block,
// and a Recast button to re-submit the same rankings with restored VP.

import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAleoWallet } from '../hooks/useAleoWallet'
import { useVoting } from '../hooks/useVoting'
import { getBlockHeight } from '../lib/aleo'
import { listCommunities } from '../lib/verifier'
import { votingPowerPct, countedVotes, daysUntilNextDecay, vpTextColour, vpBarColour } from '../lib/decay'
import type { VoteRecord, Credential, CommunityConfig, PollInfo, VoteRanking } from '../types'

interface EnrichedVote {
  record:      VoteRecord
  credential:  Credential | null
  community:   CommunityConfig | null
  poll:        PollInfo | null
  // Decay numbers at current block
  ev:          number
  vpPct:       number
  cv:          number
  daysLeft:    number
}

function VoteCard({
  vote,
  currentBlock,
}: {
  vote: EnrichedVote
  currentBlock: number
}) {
  const { record, community, poll, credential, ev, vpPct, cv, daysLeft } = vote
  const vpColour  = vpTextColour(vpPct)
  const barColour = vpBarColour(vpPct)
  const vpStr     = vpPct % 1 === 0 ? `${vpPct}%` : `${vpPct.toFixed(2)}%`
  const isDeactivated = vpPct === 0

  return (
    <div className={`bg-white border rounded-2xl overflow-hidden shadow-sm transition-colors
      ${isDeactivated ? 'border-red-100' : 'border-gray-100'}`}>

      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-gray-50">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-gray-400 font-medium mb-0.5">
              {community?.name ?? record.community_id.slice(0, 12) + '…'}
            </p>
            <p className="text-sm font-semibold text-gray-900 leading-snug truncate">
              {poll?.title ?? `Poll ${record.poll_id.slice(0, 8)}…`}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
            <div className={`w-1.5 h-1.5 rounded-full ${isDeactivated ? 'bg-red-400' : 'bg-emerald-400'}`} />
            <span className="text-xs text-gray-400">block {record.cast_at.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* EV / VP% / CV */}
      <div className="px-5 py-3 flex items-center divide-x divide-gray-100">
        {[
          { label: 'EV', value: ev.toLocaleString() },
          { label: 'VP', value: vpStr, colour: vpColour },
          { label: 'CV', value: cv.toLocaleString() },
        ].map(({ label, value, colour }) => (
          <div key={label} className="flex-1 flex flex-col items-center pr-4 last:pr-0 first:pl-0 pl-4">
            <span className={`text-base font-semibold tabular-nums ${colour ?? 'text-gray-800'}`}>{value}</span>
            <span className="text-[10px] font-mono text-gray-400">{label}</span>
          </div>
        ))}
      </div>

      {/* Decay bar */}
      {credential && vpPct > 0 && (
        <div className="px-5 pb-3 space-y-1">
          <div className="flex justify-between text-[10px] text-gray-400">
            <span>Voting power</span>
            <span>Decays in {daysLeft}d</span>
          </div>
          <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${barColour}`}
              style={{ width: `${vpPct}%` }} />
          </div>
        </div>
      )}

      {/* Deactivated warning */}
      {isDeactivated && (
        <div className="mx-5 mb-3 bg-red-50 border border-red-100 rounded-xl px-3 py-2 text-xs text-red-600 font-medium text-center">
          Vote deactivated — voting power has fully decayed
        </div>
      )}

      {/* Rankings summary */}
      {record.rankings.filter(r => r > 0).length > 0 && (
        <div className="px-5 pb-3">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Your Rankings</p>
          <div className="flex flex-wrap gap-1.5">
            {record.rankings.map((optId, idx) => optId > 0 ? (
              <span key={idx}
                className="text-[11px] bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full font-medium">
                #{idx + 1} · {poll?.options.find(o => o.option_id === optId)?.label ?? `Option ${optId}`}
              </span>
            ) : null)}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="px-5 pb-4 flex gap-2">
        {community && poll && (
          <Link
            to={`/communities/${community.community_id}/polls/${record.poll_id}`}
            className="flex-1 py-2 text-xs font-medium text-center text-gray-600 bg-gray-50 border border-gray-100 rounded-xl hover:bg-gray-100 transition-colors"
          >
            View Poll
          </Link>
        )}
        {community && poll && (
          <Link
            to={`/communities/${community.community_id}/polls/${record.poll_id}/results`}
            className="flex-1 py-2 text-xs font-medium text-center text-[#0070F3] bg-blue-50 border border-blue-100 rounded-xl hover:bg-blue-100 transition-colors"
          >
            View Results
          </Link>
        )}
      </div>
    </div>
  )
}

export default function MyVotes() {
  const { connected, requestVoteRecords, requestCredentialRecords } = useAleoWallet()
  const { castVote } = useVoting()

  const [votes, setVotes]           = useState<EnrichedVote[]>([])
  const [loading, setLoading]       = useState(true)
  const [currentBlock, setCurrentBlock] = useState(0)
  const [recastingId, setRecastingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!connected) { setLoading(false); return }
    setLoading(true)
    try {
      const [records, creds, communities, block] = await Promise.all([
        requestVoteRecords(),
        requestCredentialRecords(),
        listCommunities().catch(() => [] as CommunityConfig[]),
        getBlockHeight(),
      ])

      setCurrentBlock(block)

      // Build a lookup: communityField → CommunityConfig
      const FIELD_MODULUS = 8444461749428370424248824938781546531375899335154063827935233455917409239041n
      function fieldOf(id: string): string {
        if (/^\d+$/.test(id)) return id
        let h = 0n
        for (let i = 0; i < id.length; i++) h = (h * 31n + BigInt(id.charCodeAt(i))) % FIELD_MODULUS
        return String(h)
      }
      const commByField = new Map<string, CommunityConfig>()
      for (const c of communities) commByField.set(fieldOf(c.community_id), c)

      // Sort by most recent
      const sorted = [...records].sort((a, b) => b.cast_at - a.cast_at)

      const enriched: EnrichedVote[] = sorted.map(record => {
        const communityField = record.community_id.trim()
        const community      = commByField.get(communityField) ?? null
        const poll           = community?.polls?.find(p => p.poll_id === record.poll_id) ?? null

        // Find matching credential (same community_id field + any type)
        const credential = creds.find(c => c.community_id.trim() === communityField) ?? null

        const issuedAt = credential?.issued_at ?? 0
        const ev       = credential?.voting_weight ?? 1
        const vpPct    = credential ? votingPowerPct(issuedAt, block) : 0
        const cv       = Math.floor(ev * (vpPct / 100))
        const daysLeft = credential ? daysUntilNextDecay(issuedAt, block) : 400

        return { record, credential, community, poll, ev, vpPct, cv, daysLeft }
      })

      setVotes(enriched)
    } finally {
      setLoading(false)
    }
  }, [connected, requestVoteRecords, requestCredentialRecords])

  useEffect(() => { void load() }, [load])

  const handleRecast = async (vote: EnrichedVote) => {
    if (!vote.credential || !vote.community) return
    setRecastingId(vote.record.poll_id)
    try {
      const ranking: VoteRanking = {}
      vote.record.rankings.forEach((optId, idx) => {
        if (optId > 0) ranking[optId] = idx + 1
      })
      const matchedPoll = vote.community.polls?.find(p => p.poll_id === vote.record.poll_id)
      await castVote(
        vote.record.poll_id,
        vote.community.community_id,
        vote.community.credential_type,
        ranking,
        vote.credential,
        matchedPoll?.operator_address,
      )
      await load()
    } finally {
      setRecastingId(null)
    }
  }

  // ── Not connected ──────────────────────────────────────────────────────────
  if (!connected) return (
    <div className="max-w-md mx-auto w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">My Votes</h1>
        <p className="text-sm text-gray-500 mt-1">Private vote records from your wallet.</p>
      </div>
      <div className="bg-amber-50 border border-amber-100 rounded-2xl px-5 py-4 text-sm text-amber-700 font-medium">
        Connect your Aleo wallet to see your votes.
      </div>
    </div>
  )

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="max-w-md mx-auto w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">My Votes</h1>
      </div>
      <div className="flex items-center gap-3 py-10 justify-center">
        <div className="w-5 h-5 border-2 border-[#0070F3] border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-gray-400">Loading from wallet…</span>
      </div>
    </div>
  )

  return (
    <div className="max-w-md mx-auto w-full">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">My Votes</h1>
          <p className="text-sm text-gray-500 mt-1">
            {votes.length > 0
              ? `${votes.length} vote record${votes.length !== 1 ? 's' : ''} · block ${currentBlock.toLocaleString()}`
              : 'Private vote records from your wallet.'}
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="text-xs text-gray-400 hover:text-gray-700 transition-colors mt-1 border border-gray-200 rounded-lg px-3 py-1.5 hover:border-gray-300"
        >
          Refresh
        </button>
      </div>

      {votes.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center">
          <p className="text-sm text-gray-500 mb-4">You haven't voted in any polls yet.</p>
          <Link to="/polls"
            className="inline-flex items-center gap-1.5 bg-gray-900 text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-gray-800 transition-colors">
            Browse Polls →
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {votes.map(vote => (
            <VoteCard
              key={`${vote.record.poll_id}-${vote.record.cast_at}`}
              vote={vote}
              currentBlock={currentBlock}
              onRecast={handleRecast}
              recasting={recastingId === vote.record.poll_id}
            />
          ))}
        </div>
      )}
    </div>
  )
}
