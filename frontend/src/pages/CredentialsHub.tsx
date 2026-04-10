import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAleoWallet } from '../hooks/useAleoWallet'
import { listCommunities } from '../lib/verifier'
import ConnectorSelector from '../components/ConnectorSelector'
import RequirementsPanel from '../components/RequirementsPanel'
import type { CommunityConfig, ConnectedAccount, Credential } from '../types'

// ── Small status badge ────────────────────────────────────────────────────────
function CredentialBadge({ status }: { status: 'active' | 'expired' | 'none' }) {
  if (status === 'active')  return <span className="text-xs font-semibold text-[#10B981] bg-green-50 border border-green-100 px-2.5 py-1 rounded-full">Credential active</span>
  if (status === 'expired') return <span className="text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-full">Expired</span>
  return <span className="text-xs font-semibold text-gray-500 bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-full">No credential</span>
}

// ── Community accordion row ────────────────────────────────────────────────────
function CommunityCredentialRow({
  community,
  credentials,
  connectedAccounts,
  onAccountsChange,
  aleoAddress,
  connected,
  executeTransaction,
}: {
  community:         CommunityConfig
  credentials:       Credential[]
  connectedAccounts: ConnectedAccount[]
  onAccountsChange:  (a: ConnectedAccount[]) => void
  aleoAddress:       string
  connected:         boolean
  executeTransaction: ((opts: {
    program: string; function: string; fee: number; privateFee: boolean; inputs: string[]
  }) => Promise<{ transactionId: string } | undefined>) | undefined
}) {
  const [expanded, setExpanded] = useState(false)

  // Check if user has an active credential for this community
  const FIELD_MODULUS = 8444461749428370424248824938781546531375899335154063827935233455917409239041n
  function communityIdToField(id: string): string {
    if (/^\d+$/.test(id)) return id
    let h = 0n
    for (let i = 0; i < id.length; i++) h = (h * 31n + BigInt(id.charCodeAt(i))) % FIELD_MODULUS
    return String(h)
  }
  const communityField = communityIdToField(community.community_id)
  const matchingCred = credentials.find(c => c.community_id === communityField && c.credential_type === community.credential_type)
  const credStatus = matchingCred
    ? (matchingCred.expiry_block > 0 ? 'active' : 'expired')
    : 'none'

  const allFree = community.requirement_groups.flatMap(g => g.requirements).every(r => r.type === 'FREE')

  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden hover:border-gray-200 transition-colors">
      {/* Row header */}
      <button
        className="w-full flex items-center gap-4 px-5 py-4 text-left"
        onClick={() => setExpanded(e => !e)}
      >
        {/* Avatar */}
        {community.logo ? (
          <img src={community.logo} alt={community.name}
            className="w-10 h-10 rounded-full object-cover shrink-0 border border-gray-100" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
            <span className="text-blue-500 font-semibold text-xs">
              {community.name.slice(0, 2).toUpperCase()}
            </span>
          </div>
        )}

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900 text-sm">{community.name}</span>
            {allFree && (
              <span className="text-xs text-gray-400 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full">Free</span>
            )}
          </div>
          {community.description && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">{community.description}</p>
          )}
        </div>

        {/* Status + chevron */}
        <div className="flex items-center gap-3 shrink-0">
          <CredentialBadge status={credStatus} />
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
          >
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </button>

      {/* Expanded requirements panel */}
      {expanded && (
        <div className="border-t border-gray-100 p-4">
          {credStatus === 'active' ? (
            <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3.5">
              <div className="w-8 h-8 rounded-full bg-[#10B981] flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-green-800">You have an active credential</p>
                <p className="text-xs text-green-600 mt-0.5">
                  Type {matchingCred!.credential_type} · Expires at block {matchingCred!.expiry_block.toLocaleString()}
                </p>
              </div>
            </div>
          ) : (
            <RequirementsPanel
              groups={community.requirement_groups}
              communityId={community.community_id}
              aleoAddress={aleoAddress}
              connected={connected}
              connectedAccounts={connectedAccounts}
              onAccountsChange={onAccountsChange}
              executeTransaction={executeTransaction}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function CredentialsHub() {
  const { address, connected, requestCredentialRecords, executeTransaction } = useAleoWallet()

  const [communities, setCommunities]         = useState<CommunityConfig[]>([])
  const [credentials, setCredentials]         = useState<Credential[]>([])
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([])
  const [loading, setLoading]                 = useState(true)
  const [credsLoading, setCredsLoading]       = useState(false)

  useEffect(() => {
    listCommunities()
      .then(setCommunities)
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!connected) { setCredentials([]); return }
    setCredsLoading(true)
    requestCredentialRecords()
      .then(setCredentials)
      .catch(() => null)
      .finally(() => setCredsLoading(false))
  // requestCredentialRecords is stable (useCallback) — only re-run when connection changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected])

  const aleoAddress = address ?? ''

  return (
    <div className="max-w-2xl mx-auto w-full space-y-8">

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Credentials Hub</h1>
        <p className="text-sm text-gray-500 mt-1">
          Connect your accounts, verify community requirements, and claim ZK credentials to your wallet.
        </p>
      </div>

      {/* How it works — brief explainer */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 rounded-full bg-[#0070F3]" />
          <h2 className="text-sm font-semibold text-gray-900">How it works</h2>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[
            { n: '1', title: 'Connect accounts', desc: 'Link your EVM wallet, X / Twitter, or Discord as needed.' },
            { n: '2', title: 'Verify requirements', desc: 'The verifier checks your eligibility off-chain.' },
            { n: '3', title: 'Your wallet signs', desc: 'You sign the credential transaction — no server key involved.' },
          ].map(({ n, title, desc }) => (
            <div key={n} className="flex flex-col gap-1.5">
              <div className="w-7 h-7 rounded-full bg-[#0070F3] text-white text-xs font-bold flex items-center justify-center shrink-0">
                {n}
              </div>
              <p className="text-xs font-semibold text-gray-800">{title}</p>
              <p className="text-xs text-gray-400 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Wallet connection gate */}
      {!connected && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl px-5 py-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div>
            <p className="text-sm font-semibold text-amber-800">Connect your Aleo wallet</p>
            <p className="text-xs text-amber-600 mt-0.5">Your Aleo wallet is needed to sign and store credentials on-chain.</p>
          </div>
        </div>
      )}

      {/* Connected external accounts */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-[#10B981]" />
          <h2 className="text-sm font-semibold text-gray-900">Connected Accounts</h2>
          <span className="text-xs text-gray-400">For requirement checks</span>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-4">
          <ConnectorSelector accounts={connectedAccounts} onChange={setConnectedAccounts} />
        </div>
      </div>

      {/* Community credentials */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-gray-400" />
            <h2 className="text-sm font-semibold text-gray-900">Community Credentials</h2>
          </div>
          {connected && (
            <div className="flex items-center gap-2">
              {credsLoading && (
                <div className="w-3.5 h-3.5 border-2 border-[#0070F3] border-t-transparent rounded-full animate-spin" />
              )}
              <span className="text-xs text-gray-400">
                {credentials.length} credential{credentials.length !== 1 ? 's' : ''} in wallet
              </span>
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-[#0070F3] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : communities.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center">
            <p className="text-sm text-gray-500 mb-3">No communities found.</p>
            <Link
              to="/create"
              className="inline-flex items-center gap-1.5 bg-gray-900 text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-gray-800 transition-colors"
            >
              Create Community →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {communities.map(community => (
              <CommunityCredentialRow
                key={community.community_id}
                community={community}
                credentials={credentials}
                connectedAccounts={connectedAccounts}
                onAccountsChange={setConnectedAccounts}
                aleoAddress={aleoAddress}
                connected={connected}
                executeTransaction={executeTransaction}
              />
            ))}
          </div>
        )}
      </div>

      {/* Link to My Credentials page */}
      {connected && credentials.length > 0 && (
        <div className="text-center">
          <Link
            to="/my-credentials"
            className="text-sm text-[#0070F3] hover:underline font-medium"
          >
            View all credentials in detail →
          </Link>
        </div>
      )}
    </div>
  )
}
