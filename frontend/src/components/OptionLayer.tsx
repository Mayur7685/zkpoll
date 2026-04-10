// Shows all options at one MDCT layer — ref2/ref3 design.

import type { PollOption, Snapshot } from '../types'

interface Props {
  options: PollOption[]
  parentId: number
  snapshot: Snapshot | null
  onDrillIn: (option: PollOption) => void
}

function snapshotRankedIds(snapshot: Snapshot): number[] {
  return [
    snapshot.rank_1_option, snapshot.rank_2_option, snapshot.rank_3_option,
    snapshot.rank_4_option, snapshot.rank_5_option, snapshot.rank_6_option,
    snapshot.rank_7_option, snapshot.rank_8_option,
  ].filter(id => id > 0)
}

export default function OptionLayer({ options, parentId, snapshot, onDrillIn }: Props) {
  const layerOptions = options.filter(o => o.parent_option_id === parentId)
  const rankedIds = snapshot ? snapshotRankedIds(snapshot) : []
  const sorted = [...layerOptions].sort((a, b) => {
    const ra = rankedIds.indexOf(a.option_id)
    const rb = rankedIds.indexOf(b.option_id)
    if (ra === -1 && rb === -1) return a.option_id - b.option_id
    if (ra === -1) return 1
    if (rb === -1) return -1
    return ra - rb
  })

  if (sorted.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-4">No options at this level.</p>
  }

  return (
    <>
      {sorted.map((opt, idx) => {
        const rank = rankedIds.indexOf(opt.option_id)
        const hasChildren = opt.child_count > 0
        return (
          <div
            key={opt.option_id}
            className="flex items-center gap-3 p-2.5 bg-white border border-gray-100 rounded-lg hover:border-gray-200 transition-colors"
          >
            {/* Rank / index badge */}
            <div className="w-6 h-6 rounded flex items-center justify-center bg-gray-100 text-gray-600 text-xs font-medium shrink-0">
              {rank !== -1 ? rank + 1 : idx + 1}
            </div>

            {/* Label */}
            <span className="flex-1 text-sm font-medium text-gray-900">{opt.label}</span>

            {/* Sub-option count badge */}
            {hasChildren && (
              <div className="w-6 h-6 rounded-full flex items-center justify-center bg-gray-100 text-gray-600 text-xs font-medium shrink-0">
                {opt.child_count}
              </div>
            )}

            {/* Drill-in arrow */}
            {hasChildren && (
              <button
                onClick={() => onDrillIn(opt)}
                title={`Explore ${opt.label}`}
                className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </div>
        )
      })}
    </>
  )
}
