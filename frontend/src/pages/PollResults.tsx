import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAleoWallet } from '../hooks/useAleoWallet'
import { useVoteHistory } from '../hooks/useVoteHistory'
import { getPollMeta, getLatestSnapshot } from '../lib/aleo'
import { getCommunity } from '../lib/verifier'
import type { PollMeta, Snapshot, PollOption } from '../types'

function decayScore(rank: number): number { return rank > 0 ? 1 / rank : 0 }

function optionLabel(optionId: number, options: PollOption[]): string {
  return options.find(o => o.option_id === optionId)?.label ?? `Option ${optionId}`
}

function RankedList({ snapshot, options }: { snapshot: Snapshot; options: PollOption[] }) {
  const ranked = (['rank_1_option','rank_2_option','rank_3_option','rank_4_option',
    'rank_5_option','rank_6_option','rank_7_option','rank_8_option'] as (keyof Snapshot)[])
    .map((field, idx) => {
      const optionId = snapshot[field] as number
      return { rank: idx + 1, optionId, label: optionLabel(optionId, options) }
    })
    .filter(r => r.optionId > 0)

  if (ranked.length === 0) return <p className="text-sm text-gray-400 text-center py-4">No results yet.</p>

  return (
    <div className="space-y-3">
      {ranked.map(({ rank, optionId, label }) => {
        const score = decayScore(rank)
        const pct   = (score / decayScore(1)) * 100
        const color = rank === 1 ? '#10B981' : rank <= 3 ? '#0070F3' : '#9ca3af'
        return (
          <div key={optionId} className="flex items-center gap-3">
            <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 text-white"
              style={{ background: color }}>
              {rank}
            </span>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-900">{label}</span>
                <span className="text-xs text-gray-400 font-medium">{score.toFixed(2)}×</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function PollResults() {
  const { communityId, pollId } = useParams<{ communityId: string; pollId: string }>()
  const { connected } = useAleoWallet()
  const { forPoll } = useVoteHistory()

  const [meta, setMeta] = useState<PollMeta | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [options, setOptions] = useState<PollOption[]>([])
  const [loading, setLoading] = useState(true)
  const [noSnapshot, setNoSnapshot] = useState(false)

  useEffect(() => {
    if (!pollId || !communityId) return
    setLoading(true)
    Promise.all([
      getPollMeta(pollId).then(setMeta),
      getLatestSnapshot(pollId).then(snap => { if (!snap) setNoSnapshot(true); else setSnapshot(snap) }),
      getCommunity(communityId).then(c => {
        const poll = c.polls?.find(p => p.poll_id === pollId)
        if (poll?.options) setOptions(poll.options)
      }).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [pollId, communityId])

  const myVotes = pollId ? forPoll(pollId) : []

  return (
    <div className="max-w-lg mx-auto w-full">
      {/* Back */}
      <Link
        to={`/communities/${communityId}/polls/${pollId}`}
        className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-900 mb-4 transition-colors group"
      >
        <svg className="w-4 h-4 mr-1 group-hover:-translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Back to Poll
      </Link>

      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 flex items-center justify-center gap-3">
          <div className="w-5 h-5 border-2 border-[#0070F3] border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-500">Loading results…</span>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Header card */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-semibold text-gray-900">Results</h1>
                {meta && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Block {meta.created_at} · {meta.active ? 'Active' : 'Closed'}
                  </p>
                )}
              </div>
              <span className="text-xs text-gray-400">{communityId?.slice(0, 12)}…</span>
            </div>
          </div>

          {/* Tally snapshot */}
          {noSnapshot ? (
            <div className="border-[1.5px] border-[#0070F3] rounded-xl overflow-hidden bg-white shadow-sm">
              <div className="p-6 text-center">
                <div className="w-10 h-10 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-3">
                  <span className="text-amber-500 text-lg">⏳</span>
                </div>
                <p className="text-sm font-medium text-gray-700">No tally snapshot yet.</p>
                <p className="text-xs text-gray-400 mt-1">The operator publishes results after collecting encrypted votes.</p>
              </div>
              <div className="bg-[#0070F3] text-white px-5 py-3.5 text-sm font-medium">
                Snapshots are published on-chain by the tally operator. Check back later.
              </div>
            </div>
          ) : snapshot && (
            <div className="border-[1.5px] border-[#0070F3] rounded-xl overflow-hidden bg-white shadow-sm">
              <div className="px-5 py-4 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-900">Latest Tally</h2>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span>{snapshot.total_votes} vote{snapshot.total_votes !== 1 ? 's' : ''}</span>
                    <span>Block {snapshot.block_height}</span>
                    <span>Snapshot #{snapshot.snapshot_id}</span>
                  </div>
                </div>
              </div>
              <div className="p-5">
                <RankedList snapshot={snapshot} options={options} />
              </div>
              <div className="bg-[#0070F3] text-white px-5 py-3.5 text-sm font-medium">
                Rankings use MDCT decay-weighted scoring (1/rank). Computed from encrypted ballots.
              </div>
            </div>
          )}

          {/* My votes */}
          {connected && myVotes.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Your Votes</h2>
              {myVotes.map((v, i) => (
                <div key={i} className="border-b border-gray-50 last:border-0 pb-3 last:pb-0 mb-3 last:mb-0">
                  <p className="text-xs text-gray-400 mb-2">Cast at block {v.cast_at}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {v.rankings.map((optId, idx) =>
                      optId > 0 ? (
                        <span key={idx} className="text-xs bg-blue-50 text-blue-600 border border-blue-100 px-2.5 py-1 rounded-full">
                          #{idx + 1} → {optionLabel(optId, options)}
                        </span>
                      ) : null
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!connected && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              <p className="text-sm text-amber-700">Connect your wallet to see your personal vote history.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
