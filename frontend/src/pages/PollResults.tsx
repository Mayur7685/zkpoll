import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAleoWallet } from '../hooks/useAleoWallet'
import { useVoteHistory } from '../hooks/useVoteHistory'
import { getPollMeta, getAllScopedSnapshots } from '../lib/aleo'
import { getCommunity } from '../lib/verifier'
import type { PollMeta, ScopedSnapshot, ScopedSnapshotMap, PollOption } from '../types'

function decayScore(rank: number): number { return rank > 0 ? 1 / rank : 0 }

function optionLabel(optionId: number, options: PollOption[]): string {
  return options.find(o => o.option_id === optionId)?.label ?? `Option ${optionId}`
}

function ScopedRankedList({ snap, options }: { snap: ScopedSnapshot; options: PollOption[] }) {
  const ranked = [snap.rank_1_option, snap.rank_2_option, snap.rank_3_option, snap.rank_4_option]
    .map((optionId, idx) => ({ rank: idx + 1, optionId, label: optionLabel(optionId, options) }))
    .filter(r => r.optionId > 0)

  if (ranked.length === 0) return <p className="text-sm text-gray-400 text-center py-2">No results yet.</p>

  return (
    <div className="space-y-2">
      {ranked.map(({ rank, optionId, label }) => {
        const score = decayScore(rank)
        const pct   = (score / decayScore(1)) * 100
        const color = rank === 1 ? '#10B981' : rank <= 2 ? '#0070F3' : '#9ca3af'
        return (
          <div key={optionId} className="flex items-center gap-3">
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 text-white"
              style={{ background: color }}>{rank}</span>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-sm font-medium text-gray-900">{label}</span>
                <span className="text-xs text-gray-400">{score.toFixed(2)}×</span>
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

function ScopedResultsTree({
  snapshots, options, parentId = 0, depth = 0
}: {
  snapshots: ScopedSnapshotMap
  options: PollOption[]
  parentId?: number
  depth?: number
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const snap = snapshots.get(parentId)
  const children = options.filter(o => o.parent_option_id === parentId)

  if (children.length === 0) return null

  return (
    <div className={depth > 0 ? 'ml-4 border-l border-gray-100 pl-3 mt-2' : ''}>
      {snap && (
        <div className="mb-3">
          <p className="text-xs text-gray-400 mb-1.5">
            {parentId === 0 ? 'Root ranking' : `Under: ${optionLabel(parentId, options)}`}
            {' · '}{snap.total_votes} vote{snap.total_votes !== 1 ? 's' : ''}
          </p>
          <ScopedRankedList snap={snap} options={options} />
        </div>
      )}
      {children.filter(c => c.child_count > 0).map(child => (
        <div key={child.option_id}>
          <button
            onClick={() => setExpanded(prev => {
              const next = new Set(prev)
              next.has(child.option_id) ? next.delete(child.option_id) : next.add(child.option_id)
              return next
            })}
            className="flex items-center gap-1.5 text-xs text-[#0070F3] font-medium hover:underline mt-2"
          >
            <svg className={`w-3 h-3 transition-transform ${expanded.has(child.option_id) ? 'rotate-90' : ''}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {child.label} ({child.child_count} sub)
          </button>
          {expanded.has(child.option_id) && (
            <ScopedResultsTree
              snapshots={snapshots} options={options}
              parentId={child.option_id} depth={depth + 1}
            />
          )}
        </div>
      ))}
    </div>
  )
}

export default function PollResults() {
  const { communityId, pollId } = useParams<{ communityId: string; pollId: string }>()
  const { connected } = useAleoWallet()
  const { forPoll } = useVoteHistory()

  const [meta, setMeta] = useState<PollMeta | null>(null)
  const [snapshots, setSnapshots] = useState<ScopedSnapshotMap>(new Map())
  const [options, setOptions] = useState<PollOption[]>([])
  const [pollTitle, setPollTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [noSnapshot, setNoSnapshot] = useState(false)

  useEffect(() => {
    if (!pollId || !communityId) return
    setLoading(true)
    Promise.all([
      getPollMeta(pollId).then(setMeta),
      getCommunity(communityId).then(c => {
        const poll = c.polls?.find(p => p.poll_id === pollId)
        if (poll?.options) setOptions(poll.options)
        if (poll?.title) setPollTitle(poll.title)
        const scopeKeys = poll?.scope_keys ?? []
        if (scopeKeys.length > 0) {
          return getAllScopedSnapshots(scopeKeys).then(snaps => {
            if (snaps.size === 0) setNoSnapshot(true)
            else setSnapshots(snaps)
          })
        } else {
          setNoSnapshot(true)
        }
      }).catch(() => { setNoSnapshot(true) }),
    ]).finally(() => setLoading(false))
  }, [pollId, communityId])

  const myVotes = pollId ? forPoll(pollId) : []

  return (
    <div className="max-w-lg mx-auto w-full">
      <Link to={`/communities/${communityId}/polls/${pollId}`}
        className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-900 mb-4 transition-colors group">
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
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-semibold text-gray-900">{pollTitle || 'Results'}</h1>
                {meta && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Block {meta.created_at} · {meta.active ? 'Active' : 'Closed'}
                  </p>
                )}
              </div>
              <span className="text-xs text-gray-400">{communityId?.slice(0, 12)}…</span>
            </div>
          </div>

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
          ) : (
            <div className="border-[1.5px] border-[#0070F3] rounded-xl overflow-hidden bg-white shadow-sm">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-900">Latest Tally</h2>
                <p className="text-xs text-gray-400 mt-0.5">Per-parent ranked results · MDCT decay scoring</p>
              </div>
              <div className="p-5">
                <ScopedResultsTree snapshots={snapshots} options={options} />
              </div>
              <div className="bg-[#0070F3] text-white px-5 py-3.5 text-sm font-medium">
                Rankings are independent per parent. Expand sub-options to see nested results.
              </div>
            </div>
          )}

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
