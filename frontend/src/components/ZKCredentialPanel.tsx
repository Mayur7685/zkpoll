// ZK Credential Panel — matches ref1 "Voting History and Power" card design.

import { useEffect, useState } from 'react'
import { useAleoWallet } from '../hooks/useAleoWallet'
import { getBlockHeight } from '../lib/aleo'
import { computeVotePower, daysUntilNextDecay, decayCycle, MAX_DECAY_CYCLES } from '../lib/decay'
import type { Credential } from '../types'

const CRED_LABELS: Record<number, string> = {
  0: 'Open',
  1: 'Basic',
  2: 'Verified',
  3: 'Twitter',
  4: 'Twitter (Min Followers)',
  5: 'GitHub',
  6: 'Discord',
}

interface CardProps {
  credential: Credential
  currentBlock: number
  onRecast?: () => void
}

function CredentialCard({ credential, currentBlock, onRecast }: CardProps) {
  const power   = computeVotePower(credential.issued_at, currentBlock)
  const daysLeft = daysUntilNextDecay(credential.issued_at, currentBlock)
  const cycle   = decayCycle(credential.issued_at, currentBlock)
  const expired = currentBlock > credential.expiry_block
  const typeLabel = CRED_LABELS[credential.credential_type] ?? `Type ${credential.credential_type}`
  const pct = Math.round(power * 100)

  const barColor = pct === 100
    ? 'bg-[#10B981]'
    : pct >= 50
    ? 'bg-[#FBBF24]'
    : 'bg-[#EF4444]'

  return (
    <div className={`border-[1.5px] rounded-xl overflow-hidden shadow-sm bg-white flex flex-col ${expired ? 'border-gray-200' : 'border-[#0070F3]'}`}>
      <div className="p-5 flex flex-col gap-4">

        {/* Token row */}
        <div className="grid grid-cols-12 gap-2 mb-1">
          <div className="col-span-6 text-xs text-gray-500 font-medium">Credential</div>
          <div className="col-span-3 text-right text-xs text-gray-500 font-medium">Community</div>
          <div className="col-span-3 text-right text-xs text-gray-500 font-medium">Status</div>
        </div>
        <div className="grid grid-cols-12 gap-2 items-center pb-5 border-b border-gray-100">
          <div className="col-span-6 flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-50 rounded-full flex items-center justify-center shrink-0 border border-blue-100 shadow-sm">
              <span className="text-blue-500 text-xs font-bold">ZK</span>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-900 leading-tight">{typeLabel}</div>
              <div className="text-xs text-gray-500 mt-0.5">Block {credential.issued_at}</div>
            </div>
          </div>
          <div className="col-span-3 text-right text-xs font-medium text-gray-700 truncate">
            {credential.community_id.slice(0, 8)}…
          </div>
          <div className={`col-span-3 text-right text-sm font-medium ${expired ? 'text-red-500' : 'text-[#10B981]'}`}>
            {expired ? 'Expired' : 'Active'}
          </div>
        </div>

        {/* Stats grid */}
        {!expired && (
          <>
            <div className="grid grid-cols-4 gap-2 mb-1">
              <div className="text-xs text-gray-500 font-medium flex items-center gap-1">
                Voting power
                <svg className="w-3 h-3 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
              </div>
              <div className="text-xs text-gray-500 font-medium flex items-center gap-1">
                Decays in
                <svg className="w-3 h-3 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
              </div>
              <div className="text-xs text-gray-500 font-medium flex items-center gap-1">
                Cycle
                <svg className="w-3 h-3 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
              </div>
              <div className="text-xs text-gray-500 font-medium flex items-center gap-1">
                Expires
                <svg className="w-3 h-3 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 mb-2">
              <div className={`text-sm font-medium ${pct === 0 ? 'text-red-500' : 'text-gray-900'}`}>{pct}%</div>
              <div className="text-sm font-medium text-gray-900">{daysLeft > 0 ? `${daysLeft}d` : '—'}</div>
              <div className="text-sm font-medium text-gray-900">{cycle}/{MAX_DECAY_CYCLES}</div>
              <div className="text-sm font-medium text-gray-500">#{credential.expiry_block}</div>
            </div>

            {/* Power bar */}
            <div className="flex items-center w-full gap-1 h-1.5 mt-1 mb-6">
              <div className={`h-full ${barColor} rounded-full`} style={{ width: `${pct}%` }} />
              <div className="flex-1 h-full bg-gray-100 rounded-full" />
            </div>

            {/* Recast CTA */}
            {pct < 100 && onRecast && (
              <div className="flex items-center justify-end gap-4">
                <span className="text-sm font-medium text-gray-500">Recast your vote to renew voting power</span>
                <div className="p-1 border-2 border-dashed border-[#10B981] rounded-xl">
                  <button
                    onClick={onRecast}
                    className="bg-black hover:bg-gray-900 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors shadow-sm"
                  >
                    Recast
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Blue footer */}
      <div className="bg-[#0070F3] text-white px-5 py-3.5 text-sm font-medium leading-relaxed">
        {expired
          ? 'This credential has expired. Request a new one from the community.'
          : pct === 100
          ? 'Your voting power is at full strength.'
          : 'Recast your vote to restore voting power to 100%.'}
      </div>
    </div>
  )
}

export default function ZKCredentialPanel() {
  const { requestCredentialRecords, connected } = useAleoWallet()
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [currentBlock, setCurrentBlock] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!connected) return
    setLoading(true)
    Promise.all([requestCredentialRecords(), getBlockHeight()])
      .then(([creds, block]) => { setCredentials(creds); setCurrentBlock(block) })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [connected]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!connected) {
    return (
      <div className="border-[1.5px] border-[#0070F3] rounded-xl overflow-hidden shadow-sm bg-white">
        <div className="p-8 text-center">
          <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-blue-500 font-bold text-lg">ZK</span>
          </div>
          <p className="text-sm font-medium text-gray-700">Connect your wallet to view credentials.</p>
        </div>
        <div className="bg-[#0070F3] text-white px-5 py-3.5 text-sm font-medium">
          ZK credentials unlock voting in gated communities.
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="border-[1.5px] border-[#0070F3] rounded-xl bg-white p-8 flex items-center justify-center gap-3 shadow-sm">
        <div className="w-5 h-5 border-2 border-[#0070F3] border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-gray-500">Loading credentials…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="border-[1.5px] border-red-200 rounded-xl bg-white overflow-hidden shadow-sm">
        <div className="p-5">
          <p className="text-sm text-red-500">{error}</p>
        </div>
        <div className="bg-red-500 text-white px-5 py-3 text-sm font-medium">Failed to load credentials.</div>
      </div>
    )
  }

  if (credentials.length === 0) {
    return (
      <div className="border-[1.5px] border-[#0070F3] rounded-xl overflow-hidden shadow-sm bg-white">
        <div className="p-8 text-center">
          <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-blue-100">
            <span className="text-blue-500 font-bold text-lg">ZK</span>
          </div>
          <p className="text-sm font-medium text-gray-700 mb-1">No credentials found.</p>
          <p className="text-xs text-gray-400">Join a community and verify requirements to receive one.</p>
        </div>
        <div className="bg-[#0070F3] text-white px-5 py-3.5 text-sm font-medium">
          ZK credentials are private records on Aleo — only you can see them.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {credentials.map((cred, i) => (
        <CredentialCard key={i} credential={cred} currentBlock={currentBlock} />
      ))}
    </div>
  )
}
