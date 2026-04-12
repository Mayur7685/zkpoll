import { useState, useRef } from 'react'
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react'
import { getCredentialParams, verify } from '../lib/verifier'
import ConnectorSelector from './ConnectorSelector'
import type { RequirementGroup, ConnectedAccount, CheckResult } from '../types'

interface Props {
  groups: RequirementGroup[]
  communityId: string
  aleoAddress: string
  connected: boolean
  connectedAccounts?: ConnectedAccount[]
  onAccountsChange?: (accounts: ConnectedAccount[]) => void
  /** Called with the wallet executeTransaction function when user triggers issuance */
  executeTransaction?: (opts: {
    program: string; function: string; fee: number; privateFee: boolean; inputs: string[]
  }) => Promise<{ transactionId: string } | undefined>
}

const REQ_LABELS: Record<string, string> = {
  FREE:             'Open to everyone',
  ALLOWLIST:        'Allowlist',
  TOKEN_BALANCE:    'Token Balance',
  NFT_OWNERSHIP:    'NFT Ownership',
  ONCHAIN_ACTIVITY: 'On-chain Activity',
  DOMAIN_OWNERSHIP: 'Domain Ownership',
  X_FOLLOW:         'X / Twitter Follow',
  DISCORD_MEMBER:   'Discord Member',
  DISCORD_ROLE:     'Discord Role',
  GITHUB_ACCOUNT:   'GitHub Account',
  TELEGRAM_MEMBER:  'Telegram Member',
}

const FIELD_MODULUS = 8444461749428370424248824938781546531375899335154063827935233455917409239041n

function communityIdToField(id: string): string {
  if (/^\d+$/.test(id)) return id
  let h = 0n
  for (let i = 0; i < id.length; i++) h = (h * 31n + BigInt(id.charCodeAt(i))) % FIELD_MODULUS
  return String(h)
}

export default function RequirementsPanel({
  groups, communityId, aleoAddress, connected,
  connectedAccounts: externalAccounts,
  onAccountsChange,
  executeTransaction,
}: Props) {
  const { transactionStatus } = useWallet()
  const [localAccounts, setLocalAccounts] = useState<ConnectedAccount[]>([])
  const connectedAccounts = externalAccounts ?? localAccounts
  const setAccounts = onAccountsChange ?? setLocalAccounts

  const [results, setResults]     = useState<CheckResult[] | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [status, setStatus]       = useState<'idle' | 'verified' | 'issuing' | 'done' | 'error'>('idle')
  const [txId, setTxId]           = useState<string | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [issuedBy, setIssuedBy]   = useState<'wallet' | 'verifier' | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const allReqs      = groups.flatMap(g => g.requirements)
  const needsEVM      = allReqs.some(r => ['TOKEN_BALANCE','NFT_OWNERSHIP','ONCHAIN_ACTIVITY','DOMAIN_OWNERSHIP','ALLOWLIST'].includes(r.type))
  const needsTwitter  = allReqs.some(r => r.type === 'X_FOLLOW')
  const needsDiscord  = allReqs.some(r => ['DISCORD_MEMBER','DISCORD_ROLE'].includes(r.type))
  const needsGitHub   = allReqs.some(r => r.type === 'GITHUB_ACCOUNT')
  const needsTelegram = allReqs.some(r => r.type === 'TELEGRAM_MEMBER')
  const needsConnectors = needsEVM || needsTwitter || needsDiscord || needsGitHub || needsTelegram
  const isFreeOnly = allReqs.every(r => r.type === 'FREE')
  const passed = status === 'done' || status === 'issuing'

  const handleVerifyAndIssue = async () => {
    if (!connected || !aleoAddress) return
    setVerifying(true); setError(null); setResults(null); setStatus('idle'); setTxId(null); setIssuedBy(null)

    try {
      // Step 1: get params from verifier (re-verifies requirements server-side)
      const res = await getCredentialParams(communityId, aleoAddress, connectedAccounts)

      if (!res.passed) {
        setResults(res.results)  // only show results on failure
        setStatus('error')
        setError('Requirements not met. Check the items above.')
        return
      }

      const { credentialParams } = res
      const communityField = communityIdToField(credentialParams.communityId)

      // Step 2: try user's wallet first (user pays gas, no server key)
      if (executeTransaction) {
        setStatus('issuing')
        try {
          const result = await executeTransaction({
            program:    'zkpoll_v2_core.aleo',
            function:   'issue_credential',
            fee:        60_000,   // microcredits
            privateFee: false,
            inputs: [
              credentialParams.recipient,                        // recipient: address
              `${communityField}field`,                          // community_id: field
              `${credentialParams.credentialType}u8`,            // cred_type: u8
              `${credentialParams.votingWeight ?? 1}u64`,        // voting_weight: u64
              `${credentialParams.expiryBlock}u32`,              // expiry: u32
              `${credentialParams.issuedAt}u32`,                 // issued_at: u32
            ],
          })

          const walletTxId = result?.transactionId ?? null
          setTxId(walletTxId)
          setIssuedBy('wallet')

          // Poll for the real on-chain txId (Shield returns a wallet-internal ID
          // that won't resolve on explorer until the indexer picks it up)
          if (walletTxId && transactionStatus) {
            let attempts = 0
            pollRef.current = setInterval(async () => {
              attempts++
              try {
                const res = await transactionStatus(walletTxId)
                const s = res.status.toLowerCase()
                const onChainId = (res as unknown as Record<string, unknown>).transactionId as string | undefined
                if (s === 'accepted' || s === 'completed' || s === 'finalized') {
                  clearInterval(pollRef.current!); pollRef.current = null
                  if (onChainId) setTxId(onChainId)
                  setStatus('done')
                } else if (s === 'failed' || s === 'rejected') {
                  clearInterval(pollRef.current!); pollRef.current = null
                  setError('Transaction failed on-chain. Please try again.')
                  setStatus('error')
                } else if (attempts > 60) { // 60 × 3s = 3 min — optimistic fallback
                  clearInterval(pollRef.current!); pollRef.current = null
                  if (onChainId) setTxId(onChainId)
                  setStatus('done')
                }
              } catch { /* network hiccup — retry */ }
            }, 3_000)
          } else {
            setStatus('done')
          }
          return
        } catch (walletErr: unknown) {
          // Only fall back to verifier for Shield wallet "no response" errors.
          // Any other error (rejected, invalid payload, etc.) surfaces to the user.
          const msg = (walletErr instanceof Error ? walletErr.message : String(walletErr)).toLowerCase()
          const isShieldNoResponse = ['no response', 'did not respond', 'no_response', 'timed out waiting'].some(p => msg.includes(p))
          if (!isShieldNoResponse) throw walletErr
          console.warn('Shield wallet gave no response — retrying via verifier issuance')
        }
      }

      // Step 3: fallback — verifier's wallet issues on user's behalf (Shield no-response only)
      setStatus('issuing')
      const fallback = await verify(communityId, aleoAddress, connectedAccounts)
      if (fallback.passed) {
        setTxId(fallback.txId ?? null)
        setIssuedBy('verifier')
        setStatus('done')
      } else {
        setResults(fallback.results)
        setStatus('error')
        setError('Credential issuance failed. Please try again.')
      }
    } catch (e: unknown) {
      setResults(null)
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="border-[1.5px] border-[#0070F3] rounded-xl overflow-hidden bg-white shadow-sm">
      {/* Requirement groups */}
      <div className="p-4 space-y-3">
        {groups.map((group, gi) => (
          <div key={group.id}>
            {groups.length > 1 && (
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Group {gi + 1} · {group.logic}
              </p>
            )}
            <div className="space-y-1.5">
              {group.requirements.map(req => {
                const result = results?.find(r => r.requirementId === req.id)
                return (
                  <div
                    key={req.id}
                    className={`flex items-center justify-between px-3.5 py-2.5 rounded-lg border text-sm transition-colors
                      ${result?.passed === true  ? 'bg-green-50 border-green-200' :
                        result?.passed === false ? 'bg-red-50 border-red-200' :
                        'bg-gray-50 border-gray-100'}
                    `}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0
                        ${result?.passed === true  ? 'bg-[#10B981]' :
                          result?.passed === false ? 'bg-red-400' :
                          'bg-gray-300'}
                      `} />
                      <span className="font-medium text-gray-700">
                        {REQ_LABELS[req.type] ?? req.type}
                      </span>
                      {req.chain && (
                        <span className="text-xs text-gray-400 bg-white border border-gray-100 px-2 py-0.5 rounded-full">
                          {req.chain}
                        </span>
                      )}
                    </div>
                    {result && (
                      <div className="flex flex-col items-end gap-0.5 min-w-0 max-w-[55%]">
                        <span className={`text-xs font-semibold shrink-0 ${result.passed ? 'text-[#10B981]' : 'text-red-500'}`}>
                          {result.passed ? '✓ PASS' : '✕ FAIL'}
                        </span>
                        {result.error && (
                          <span className="text-[10px] text-red-400 text-right leading-tight">
                            {result.error}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {/* Account connectors — only when needed and not yet done */}
        {needsConnectors && status !== 'done' && (
          <div className="pt-2">
            <ConnectorSelector accounts={connectedAccounts} onChange={setAccounts} />
          </div>
        )}

        {/* Issuing spinner */}
        {status === 'issuing' && (
          <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
            <div className="w-4 h-4 border-2 border-[#0070F3] border-t-transparent rounded-full animate-spin shrink-0" />
            <p className="text-sm text-blue-700 font-medium">Wallet creating credential on Aleo…</p>
          </div>
        )}

        {/* Success */}
        {status === 'done' && (
          <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-xl p-3.5">
            <div className="w-6 h-6 rounded-full bg-[#10B981] flex items-center justify-center shrink-0 mt-0.5">
              <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-green-800">Credential created!</p>
              <p className="text-xs text-green-600 mt-0.5">
                {issuedBy === 'wallet'
                  ? 'Signed by your wallet and stored privately on Aleo.'
                  : 'Issued by verifier and sent to your Aleo address.'}
              </p>
              {txId && (
                <a
                  href={`https://testnet.explorer.provable.com/transaction/${txId}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-xs text-green-600 hover:underline mt-0.5 block"
                >
                  View transaction ↗
                </a>
              )}
            </div>
          </div>
        )}

        {/* Failure / error */}
        {status === 'error' && results && results.some(r => !r.passed) && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3.5">
            <p className="text-sm font-semibold text-red-700">Requirements not met.</p>
            <p className="text-xs text-red-500 mt-0.5">Check the items above and connect the required accounts.</p>
          </div>
        )}

        {error && status === 'error' && !(results && results.some(r => !r.passed)) && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}
      </div>

      {/* Action footer */}
      <div className={`px-4 py-4 border-t border-gray-100 ${status === 'done' ? 'bg-[#f0fdf4]' : 'bg-white'}`}>
        {!connected ? (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5 text-center">
            Connect your Aleo wallet to get a credential.
          </p>
        ) : status !== 'done' ? (
          <button
            onClick={() => void handleVerifyAndIssue()}
            disabled={verifying || status === 'issuing'}
            className="w-full py-3 bg-[#0070F3] hover:bg-blue-600 text-white font-medium rounded-xl text-sm transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {(verifying || status === 'issuing') && (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            )}
            {status === 'issuing'
              ? 'Waiting for wallet…'
              : verifying
              ? 'Verifying…'
              : isFreeOnly
              ? 'Get Free Credential'
              : 'Verify & Get Credential'}
          </button>
        ) : (
          <p className="text-sm text-center text-green-700 font-medium">
            ✓ Credential in your wallet
          </p>
        )}
      </div>

      {/* Blue info footer */}
      <div className="bg-[#0070F3] text-white px-5 py-3.5 text-sm font-medium">
        {isFreeOnly
          ? 'Open to everyone — your wallet signs the credential where supported.'
          : 'Verifier checks eligibility. Your wallet signs the credential, or verifier issues as fallback.'}
      </div>
    </div>
  )
}
