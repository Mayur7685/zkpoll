import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getPollVoteCount, getBlockHeight } from '../lib/aleo'
import type { PollInfo } from '../types'

interface Props {
  communityId: string
  communityName: string
  poll: PollInfo
}


function deadlineLabel(endBlock: number, currentBlock: number): { text: string; cls: string } {
  if (currentBlock === 0) return { text: `ends #${endBlock.toLocaleString()}`, cls: 'text-gray-400 bg-gray-50 border-gray-100' }
  const blocksLeft = endBlock - currentBlock
  if (blocksLeft <= 0) return { text: 'Closed', cls: 'text-gray-400 bg-gray-50 border-gray-100' }
  // ~2.5s per block on Aleo testnet → 34560 blocks/day
  return {
    text: `${blocksLeft.toLocaleString()} blocks left`,
    cls: blocksLeft < 34560 ? 'text-red-500 bg-red-50 border-red-100'
       : blocksLeft < 103680 ? 'text-amber-600 bg-amber-50 border-amber-100'
       : 'text-gray-500 bg-gray-50 border-gray-100',
  }
}

export default function PollCard({ communityId, communityName, poll }: Props) {
  const [voteCount, setVoteCount] = useState<number | null>(null)
  const [currentBlock, setCurrentBlock] = useState(0)

  useEffect(() => {
    getPollVoteCount(poll.poll_id).then(setVoteCount).catch(() => null)
    getBlockHeight().then(setCurrentBlock).catch(() => null)
  }, [poll.poll_id])

  const rootOptions = poll.options.filter(o => o.parent_option_id === 0)
  const deadline = poll.end_block ? deadlineLabel(poll.end_block, currentBlock) : null

  return (
    <Link
      to={`/communities/${communityId}/polls/${poll.poll_id}`}
      className="border border-gray-100 bg-white rounded-[1.25rem] p-5 hover:border-gray-200 hover:shadow-[0_4px_20px_-10px_rgba(0,0,0,0.08)] transition-all group flex flex-col justify-between min-h-[160px] block"
    >
      <div>
        <div className="flex justify-between items-start gap-4">
          <h3 className="text-base font-medium text-gray-900 leading-snug">{poll.title}</h3>
          <div className="flex items-center gap-1.5 shrink-0">
            {deadline?.text && (
              <span className={`text-xs font-medium border px-2 py-0.5 rounded-full ${deadline.cls}`}>
                {deadline.text}
              </span>
            )}
            <div className="flex items-center gap-1 bg-gray-50 px-2.5 py-1 rounded-lg">
              <span className="text-sm font-semibold text-gray-700">
                {voteCount !== null ? voteCount : '—'}
              </span>
              <svg className="w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          </div>
        </div>

        {poll.description && (
          <p className="text-sm text-gray-500 mt-2 line-clamp-2 leading-relaxed">{poll.description}</p>
        )}
      </div>

      <div className="mt-4 flex justify-between items-end">
        <div className="flex flex-wrap gap-1.5">
          {rootOptions.slice(0, 3).map(opt => (
            <span
              key={opt.option_id}
              className="text-xs font-medium bg-gray-50 text-gray-600 border border-gray-100 px-2.5 py-1 rounded-full"
            >
              {opt.label}
            </span>
          ))}
          {rootOptions.length > 3 && (
            <span className="text-xs font-medium text-gray-400 px-1 py-1">
              +{rootOptions.length - 3}
            </span>
          )}
        </div>
        <span className="text-xs font-medium text-gray-400 shrink-0 ml-2">
          {communityName}
        </span>
      </div>
    </Link>
  )
}
