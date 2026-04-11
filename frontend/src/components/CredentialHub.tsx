// CredentialHub — MetaPoll-style voting eligibility panel.
// Replaces both FreeAccessCard and RequirementsPanel in CommunityDetail.
//
// Shows:
//   1. Requirements breakdown with per-requirement vote weights
//   2. EV / VP% / CV three-number panel (when credential held)
//   3. Decay progress bar + "Decays in X days"
//   4. Get credential / Recast actions
//   5. Credential expiry info

import { useState, useRef, useEffect } from 'react'
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react'
import { useCredentialHub } from '../hooks/useCredentialHub'
import { useAleoWallet } from '../hooks/useAleoWallet'
import { getCredentialParams } from '../lib/verifier'
import { vpTextColour, vpBarColour } from '../lib/decay'
import ConnectorSelector from './ConnectorSelector'
import type { CommunityConfig, ConnectedAccount, CheckResult, Requirement } from '../types'

// ─── Vote weight defaults per requirement type ────────────────────────────────
const DEFAULT_WEIGHTS: Record<string, number> = {
  FREE:             1,
  ALLOWLIST:        1,
  TOKEN_BALANCE:    10,
  NFT_OWNERSHIP:    10,
  ONCHAIN_ACTIVITY: 3,
  DOMAIN_OWNERSHIP: 5,
  X_FOLLOW:         2,
  DISCORD_MEMBER:   5,
  DISCORD_ROLE:     5,
}

const REQ_LABELS: Record<string, string> = {
  FREE:             'Open access',
  ALLOWLIST:        'Allowlist',
  TOKEN_BALANCE:    'Token Balance',
  NFT_OWNERSHIP:    'NFT Ownership',
  ONCHAIN_ACTIVITY: 'On-chain Activity',
  DOMAIN_OWNERSHIP: 'Domain Ownership',
  X_FOLLOW:         'X / Twitter Follow',
  DISCORD_MEMBER:   'Discord Member',
  DISCORD_ROLE:     'Discord Role',
}

const REQ_ICONS: Record<string, string> = {
  FREE:             '🌐',
  ALLOWLIST:        '📋',
  TOKEN_BALANCE:    '🪙',
  NFT_OWNERSHIP:    '🖼',
  ONCHAIN_ACTIVITY: '⛓',
  DOMAIN_OWNERSHIP: '🌍',
  X_FOLLOW:         '𝕏',
  DISCORD_MEMBER:   '💬',
  DISCORD_ROLE:     '🏷',
}

function reqVoteWeight(req: Requirement): number {
  return req.params.vote_weight ?? DEFAULT_WEIGHTS[req.type] ?? 1
}

const FIELD_MODULUS = 8444461749428370424248824938781546531375899335154063827935233455917409239041n
function communityIdToField(id: string): string {
  if (/^\d+$/.test(id)) return id
  let h = 0n
  for (let i = 0; i < id.length; i++) h = (h * 31n + BigInt(id.charCodeAt(i))) % FIELD_MODULUS
  return String(h)
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ThreeNumbers({ ev, vp, cv }: { ev: number; vp: number; cv: number }) {
  return (
    <div className="grid grid-cols-3 divide-x divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
      {[
        { label: 'Eligible Votes', value: ev.toLocaleString(), sub: 'EV' },
        { label: 'Voting Power',   value: `${vp % 1 === 0 ? vp : vp.toFixed(2)}%`, sub: 'VP', colour: vpTextColour(vp) },
        { label: 'Counted Votes',  value: cv.toLocaleString(), sub: 'CV' },
      ].map(({ label, value, sub, colour }) => (
        <div key={sub} className="flex flex-col items-center py-3 px-2 bg-white">
          <span className={`text-lg font-semibold tabular-nums ${colour ?? 'text-gray-900'}`}>{value}</span>
          <span className="text-xs text-gray-400 mt-0.5">{label}</span>
          <span className="text-[10px] font-mono text-gray-300 mt-0.5">{sub}</span>
        </div>
      ))}
    </div>
  )
}

function DecayBar({
  progress, daysLeft, periods, vpPct,
}: {
  progress: number; daysLeft: number; periods: number; vpPct: number
}) {
  if (vpPct === 0) return (
    <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-center">
      <p className="text-sm font-semibold text-red-600">Vote deactivated</p>
      <p className="text-xs text-red-400 mt-0.5">Recast your vote to restore 100% voting power.</p>
    </div>
  )

  const barColour = vpBarColour(vpPct)
  const nextVp = vpPct / 2

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span className="font-medium">Period {periods + 1} of 5</span>
        <span>Decays in <strong className="text-gray-800">{daysLeft} days</strong> → {nextVp.toFixed(2)}%</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColour}`}
          style={{ width: `${Math.min(progress * 100, 100)}%` }}
        />
      </div>
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

interface Props {
  community: CommunityConfig
}

export default function CredentialHub({ community }: Props) {
  const { transactionStatus } = useWallet()
  const { address: aleoAddress, connected, executeTransaction } = useAleoWallet()
  const hub = useCredentialHub(community)

  const allReqs      = community.requirement_groups.flatMap(g => g.requirements)
  const isFreeOnly   = allReqs.every(r => r.type === 'FREE')
  const needsEVM     = allReqs.some(r => ['TOKEN_BALANCE','NFT_OWNERSHIP','ONCHAIN_ACTIVITY','DOMAIN_OWNERSHIP','ALLOWLIST'].includes(r.type))
  const needsTwitter = allReqs.some(r => r.type === 'X_FOLLOW')
  const needsDiscord = allReqs.some(r => ['DISCORD_MEMBER','DISCORD_ROLE'].includes(r.type))
  const needsGitHub  = allReqs.some(r => r.type === 'GITHUB_ACCOUNT')
  const needsTelegram = allReqs.some(r => r.type === 'TELEGRAM_MEMBER')
  const needsConnectors = needsEVM || needsTwitter || needsDiscord || needsGitHub || needsTelegram

  // Issuance flow state
  const [accounts, setAccounts]   = useState<ConnectedAccount[]>(() => {
    try { return JSON.parse(localStorage.getItem('zkpoll:accounts') ?? '[]') } catch { return [] }
  })

  // Persist accounts across page refreshes / navigation
  useEffect(() => {
    localStorage.setItem('zkpoll:accounts', JSON.stringify(accounts))
  }, [accounts])
  const [results, setResults]     = useState<CheckResult[] | null>(null)
  const [issuing, setIssuing]     = useState(false)
  const [issueStatus, setIssueStatus] = useState<'idle' | 'issuing' | 'confirming' | 'done' | 'error'>('idle')
  const [issueTxId, setIssueTxId] = useState<string | null>(null)
  const [issueError, setIssueError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [recasting, setRecasting] = useState(false)

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }

  const handleGetCredential = async () => {
    if (!connected || !aleoAddress || !executeTransaction) return
    setIssuing(true); setIssueError(null); setResults(null); setIssueStatus('idle'); setIssueTxId(null)

    try {
      const res = await getCredentialParams(community.community_id, aleoAddress, accounts)
      setResults(res.results ?? null)

      if (!res.passed) {
        setIssueStatus('error')
        setIssueError('Requirements not met. Check the items above.')
        return
      }

      const { credentialParams: cp } = res
      const commField = communityIdToField(cp.communityId)

      setIssueStatus('issuing')
      const result = await executeTransaction({
        program:    'zkpoll_core.aleo',
        function:   'issue_credential',
        fee:        60_000,
        privateFee: false,
        inputs: [
          cp.recipient,
          `${commField}field`,
          `${cp.credentialType}u8`,
          `${cp.votingWeight ?? 1}u64`,
          `${cp.expiryBlock}u32`,
          `${cp.issuedAt}u32`,
        ],
      })

      const walletTxId = result?.transactionId ?? null
      setIssueTxId(walletTxId)
      setIssueStatus('confirming')

      if (walletTxId && transactionStatus) {
        let attempts = 0
        pollRef.current = setInterval(async () => {
          attempts++
          try {
            const r = await transactionStatus(walletTxId)
            const s = r.status.toLowerCase()
            const onChainId = (r as unknown as Record<string, unknown>).transactionId as string | undefined
            if (s === 'accepted' || s === 'completed' || s === 'finalized') {
              stopPoll()
              if (onChainId) setIssueTxId(onChainId)
              setIssueStatus('done')
              // Refresh hub to pick up the new credential after wallet indexes it
              setTimeout(() => void hub.refresh(), 5_000)
            } else if (s === 'failed' || s === 'rejected') {
              stopPoll()
              setIssueError('Transaction failed. Try again.')
              setIssueStatus('error')
            } else if (attempts > 60) {
              stopPoll()
              if (onChainId) setIssueTxId(onChainId)
              setIssueStatus('done')
              setTimeout(() => void hub.refresh(), 5_000)
            }
          } catch { /* retry */ }
        }, 3_000)
      } else {
        setIssueStatus('done')
        setTimeout(() => void hub.refresh(), 5_000)
      }
    } catch (e: unknown) {
      stopPoll()
      setIssueError(e instanceof Error ? e.message : String(e))
      setIssueStatus('error')
    } finally {
      setIssuing(false)
    }
  }

  const handleRecast = async () => {
    setRecasting(true)
    try {
      await hub.recast()
    } finally {
      setRecasting(false)
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (hub.loading) return (
    <div className="border border-gray-100 rounded-2xl p-6 bg-white flex items-center justify-center gap-3 shadow-sm">
      <div className="w-4 h-4 border-2 border-[#0070F3] border-t-transparent rounded-full animate-spin" />
      <span className="text-sm text-gray-400">Loading credential status…</span>
    </div>
  )

  const hasCred = !!hub.credential && !hub.isExpired

  return (
    <div className="border border-gray-100 rounded-2xl overflow-hidden bg-white shadow-sm">

      {/* ── Header ── */}
      <div className="px-5 pt-5 pb-4 border-b border-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm
              ${hasCred ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
              {hasCred ? '✓' : '🔑'}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Voting Eligibility</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {isFreeOnly ? 'Open to everyone' : 'Token-curated access'}
              </p>
            </div>
          </div>
          {hasCred && (
            <span className="text-xs bg-emerald-50 text-emerald-600 border border-emerald-100 px-2.5 py-1 rounded-full font-medium">
              Active credential
            </span>
          )}
          {hub.isExpired && (
            <span className="text-xs bg-amber-50 text-amber-600 border border-amber-100 px-2.5 py-1 rounded-full font-medium">
              Expired — renew
            </span>
          )}
        </div>
      </div>

      <div className="p-5 space-y-4">

        {/* ── Requirements breakdown ── */}
        {!isFreeOnly && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Eligible Tokens &amp; Requirements
            </p>
            {allReqs.map(req => {
              const result = results?.find(r => r.requirementId === req.id)
              const weight = reqVoteWeight(req)
              return (
                <div key={req.id}
                  className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-sm transition-colors
                    ${result?.passed === true  ? 'bg-emerald-50 border-emerald-100' :
                      result?.passed === false ? 'bg-red-50 border-red-100' :
                      'bg-gray-50 border-gray-100'}`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-base leading-none">{REQ_ICONS[req.type] ?? '●'}</span>
                    <div>
                      <span className="font-medium text-gray-800">{REQ_LABELS[req.type] ?? req.type}</span>
                      {req.chain && (
                        <span className="ml-1.5 text-xs text-gray-400 bg-white border border-gray-100 px-1.5 py-0.5 rounded-full">
                          {req.chain}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-gray-400">
                      {weight} vote{weight !== 1 ? 's' : ''}
                    </span>
                    {result && (
                      <span className={`text-xs font-semibold ${result.passed ? 'text-emerald-600' : 'text-red-500'}`}>
                        {result.passed ? '✓' : '✕'}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {isFreeOnly && !hasCred && (
          <div className="flex items-start gap-3 bg-gray-50 rounded-xl px-4 py-3">
            <span className="text-xl leading-none mt-0.5">🌐</span>
            <div>
              <p className="text-sm font-medium text-gray-800">Open to everyone</p>
              <p className="text-xs text-gray-500 mt-0.5">
                No requirements — get a free credential to vote in this community's polls.
              </p>
            </div>
          </div>
        )}

        {/* ── Account connectors ── */}
        {needsConnectors && !hasCred && issueStatus !== 'done' && (
          <ConnectorSelector accounts={accounts} onChange={setAccounts} />
        )}

        {/* ── 3-number panel (when credential held) ── */}
        {hasCred && (
          <>
            <ThreeNumbers ev={hub.eligibleVotes} vp={hub.vpPct} cv={hub.cv} />
            <DecayBar
              progress={hub.progress}
              daysLeft={hub.daysLeft}
              periods={hub.periods}
              vpPct={hub.vpPct}
            />
          </>
        )}

        {/* ── Issuance feedback ── */}
        {issueStatus === 'confirming' && (
          <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
            <div className="w-4 h-4 border-2 border-[#0070F3] border-t-transparent rounded-full animate-spin shrink-0" />
            <p className="text-sm text-blue-700 font-medium">Credential being created on Aleo…</p>
          </div>
        )}

        {issueStatus === 'done' && (
          <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-100 rounded-xl p-4">
            <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center shrink-0 mt-0.5">
              <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-emerald-800">Credential in your wallet!</p>
              <p className="text-xs text-emerald-600 mt-0.5">
                Wait 1–2 minutes for your wallet to index it, then refresh this page.
              </p>
              {issueTxId && (
                <a href={`https://testnet.explorer.provable.com/transaction/${issueTxId}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-xs text-emerald-600 hover:underline mt-1 block">
                  View transaction ↗
                </a>
              )}
            </div>
          </div>
        )}

        {issueStatus === 'error' && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            <p className="text-sm text-red-600">{issueError ?? 'Requirements not met. Check items above.'}</p>
          </div>
        )}

        {/* ── Actions ── */}
        {!connected ? (
          <p className="text-center text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
            Connect your Aleo wallet to check eligibility.
          </p>
        ) : (
          <div className={`flex gap-3 ${hasCred ? '' : 'flex-col'}`}>
            {/* Get / Renew credential */}
            {(!hasCred || hub.isExpired) && issueStatus !== 'done' && (
              <button
                onClick={() => void handleGetCredential()}
                disabled={issuing || issueStatus === 'issuing' || issueStatus === 'confirming'}
                className="flex-1 py-3 bg-[#0070F3] hover:bg-blue-600 text-white font-medium rounded-xl text-sm transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {(issuing || issueStatus === 'issuing' || issueStatus === 'confirming') && (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                )}
                {hub.isExpired
                  ? 'Renew Credential'
                  : isFreeOnly
                  ? 'Get Free Credential'
                  : 'Verify & Get Credential'}
              </button>
            )}

            {/* Recast vote — shown when credential held and user has a vote record */}
            {hasCred && hub.voteRecord && (
              <button
                onClick={() => void handleRecast()}
                disabled={recasting}
                className={`flex items-center justify-center gap-2 py-3 font-medium rounded-xl text-sm transition-colors border
                  ${hub.isDeactivated
                    ? 'flex-1 bg-red-500 hover:bg-red-600 text-white border-transparent shadow-sm'
                    : 'px-4 bg-white text-gray-700 border-gray-200 hover:border-gray-300 hover:bg-gray-50'}
                  disabled:opacity-60 disabled:cursor-not-allowed`}
                title="Recast your vote with the same rankings to restore 100% voting power"
              >
                {recasting
                  ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  : <span>↺</span>
                }
                {hub.isDeactivated ? 'Recast to Restore' : 'Recast'}
              </button>
            )}

            {/* Prompt to get credential first if none held */}
            {hasCred && !hub.voteRecord && (
              <p className="text-xs text-center text-gray-400 pt-1">
                Cast your first vote to see the recast option here.
              </p>
            )}
          </div>
        )}

        {/* ── Credential metadata ── */}
        {hub.credential && (
          <div className="flex items-center justify-between text-xs text-gray-400 pt-1 border-t border-gray-50">
            <span>
              {hub.isExpired
                ? 'Credential expired'
                : `Expires in ${Math.ceil((hub.credential.expiry_block - hub.currentBlock) / 5760)} days`}
            </span>
            <span>Issued {hub.elapsed} day{hub.elapsed !== 1 ? 's' : ''} ago</span>
          </div>
        )}
      </div>

      {/* ── Footer bar ── */}
      <div className={`px-5 py-3 text-xs font-medium text-white
        ${hasCred ? 'bg-emerald-500' : 'bg-[#0070F3]'}`}>
        {hasCred
          ? `${hub.cv.toLocaleString()} counted vote${hub.cv !== 1 ? 's' : ''} · ${hub.vpPct}% voting power · recast to restore`
          : isFreeOnly
          ? 'Open community — anyone can vote. One credential per wallet.'
          : 'Verifier checks eligibility off-chain. Credential is stored privately on Aleo.'}
      </div>
    </div>
  )
}
