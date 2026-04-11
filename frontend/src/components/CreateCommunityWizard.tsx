// Multi-step wizard: community details → requirements → review & create.
// Design: ref3 — white card, stepper circles, blue border content, bottom nav.

import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { createCommunity } from '../lib/verifier'
import { useAleoWallet } from '../hooks/useAleoWallet'
import type { CommunityConfig, RequirementGroup, Requirement, RequirementType } from '../types'

const FIELD_MODULUS = 8444461749428370424248824938781546531375899335154063827935233455917409239041n
function fieldFromString(s: string): bigint {
  if (/^\d+$/.test(s)) return BigInt(s) % FIELD_MODULUS
  let h = 0n
  for (let i = 0; i < s.length; i++) h = (h * 31n + BigInt(s.charCodeAt(i))) % FIELD_MODULUS
  return h
}

const REQ_TYPES: { value: RequirementType; label: string; needsChain?: boolean }[] = [
  { value: 'FREE',             label: 'Free (anyone)' },
  { value: 'ALLOWLIST',        label: 'Allowlist' },
  { value: 'TOKEN_BALANCE',    label: 'Token Balance',    needsChain: true },
  { value: 'NFT_OWNERSHIP',    label: 'NFT Ownership',    needsChain: true },
  { value: 'ONCHAIN_ACTIVITY', label: 'On-chain Activity', needsChain: true },
  { value: 'DOMAIN_OWNERSHIP', label: 'Domain Ownership', needsChain: true },
  { value: 'X_FOLLOW',         label: 'X / Twitter Follow' },
  { value: 'DISCORD_MEMBER',   label: 'Discord Member' },
  { value: 'DISCORD_ROLE',     label: 'Discord Role' },
  { value: 'GITHUB_ACCOUNT',   label: 'GitHub Account' },
  { value: 'TELEGRAM_MEMBER',  label: 'Telegram Member' },
]

const CHAINS = ['ethereum', 'base', 'optimism', 'arbitrum']

function newReq(): Requirement {
  return { id: crypto.randomUUID(), type: 'FREE', params: {} }
}
function newGroup(): RequirementGroup {
  return { id: crypto.randomUUID(), logic: 'AND', requirements: [newReq()] }
}

// ── Shared input styles ───────────────────────────────────────────────────────

const inputCls = "block w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition-all"
const labelCls = "block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wide"

// ── Step 1: Community details ─────────────────────────────────────────────────

interface DetailsForm {
  name: string; description: string; logo: string
  credential_type: number; credential_expiry_days: number
}

function DetailsStep({ value, onChange }: { value: DetailsForm; onChange: (v: DetailsForm) => void }) {
  const set = (k: keyof DetailsForm, v: DetailsForm[keyof DetailsForm]) => onChange({ ...value, [k]: v })
  return (
    <div className="space-y-4">
      <div>
        <label className={labelCls}>Name *</label>
        <input className={inputCls} placeholder="My DAO" required value={value.name}
          onChange={e => set('name', e.target.value)} />
      </div>
      <div>
        <label className={labelCls}>Description</label>
        <textarea className={`${inputCls} resize-none`} rows={3} placeholder="What is this community about?"
          value={value.description} onChange={e => set('description', e.target.value)} />
      </div>
      <div>
        <label className={labelCls}>Logo URL (optional)</label>
        <input className={inputCls} placeholder="https://…" value={value.logo}
          onChange={e => set('logo', e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Credential Type</label>
          <select className={inputCls} value={value.credential_type}
            onChange={e => set('credential_type', Number(e.target.value))}>
            <option value={1}>Basic (1)</option>
            <option value={2}>Verified (2)</option>
            <option value={3}>Premium (3)</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Validity (days)</label>
          <input className={inputCls} type="number" min={1} value={value.credential_expiry_days}
            onChange={e => set('credential_expiry_days', Number(e.target.value))} />
        </div>
      </div>
    </div>
  )
}

// ── Field wrapper with Required / Optional badge ──────────────────────────────

function Field({ label, optional = false, children }: {
  label: string; optional?: boolean; children: ReactNode
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
        {optional
          ? <span className="text-[10px] font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">Optional</span>
          : <span className="text-[10px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">Required</span>
        }
      </div>
      {children}
    </div>
  )
}

// ── Step 2: Requirements builder ──────────────────────────────────────────────

function RequirementEditor({ req, onChange, onRemove }: {
  req: Requirement; onChange: (r: Requirement) => void; onRemove: () => void
}) {
  const meta = REQ_TYPES.find(t => t.value === req.type)
  const set = (patch: Partial<Requirement>) => onChange({ ...req, ...patch })
  const setParam = (k: string, v: string) => onChange({ ...req, params: { ...req.params, [k]: v } })

  return (
    <div className="bg-gray-50 rounded-xl p-3.5 space-y-2.5 border border-gray-100">
      <div className="flex gap-2">
        <select className={`${inputCls} flex-1`} value={req.type}
          onChange={e => set({ type: e.target.value as RequirementType, params: {}, chain: undefined })}>
          {REQ_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        {meta?.needsChain && (
          <select className={`${inputCls} w-36`} value={req.chain ?? 'ethereum'}
            onChange={e => set({ chain: e.target.value })}>
            {CHAINS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <button onClick={onRemove}
          className="px-3 py-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors text-sm">
          ✕
        </button>
      </div>
      {req.type === 'TOKEN_BALANCE' && (
        <div className="space-y-2">
          <Field label="Token contract address">
            <input className={inputCls} placeholder="0x…" value={req.params.tokenAddress ?? ''}
              onChange={e => setParam('tokenAddress', e.target.value)} />
          </Field>
          <Field label="Minimum amount">
            <input className={inputCls} placeholder="e.g. 100 for 100 USDC" value={req.params.minAmount ?? ''}
              onChange={e => setParam('minAmount', e.target.value)} />
          </Field>
        </div>
      )}
      {req.type === 'NFT_OWNERSHIP' && (
        <Field label="NFT contract address">
          <input className={inputCls} placeholder="0x…" value={req.params.contractAddress ?? ''}
            onChange={e => setParam('contractAddress', e.target.value)} />
        </Field>
      )}
      {req.type === 'DOMAIN_OWNERSHIP' && (
        <Field label="Domain">
          <input className={inputCls} placeholder="e.g. vitalik.eth" value={req.params.domain ?? ''}
            onChange={e => setParam('domain', e.target.value)} />
        </Field>
      )}
      {req.type === 'ALLOWLIST' && (
        <Field label="Allowed addresses">
          <textarea className={`${inputCls} resize-none`} rows={2} placeholder="Comma-separated EVM addresses"
            value={(req.params.addresses ?? []).join(', ')}
            onChange={e => onChange({ ...req, params: {
              addresses: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
            } })} />
        </Field>
      )}
      {req.type === 'X_FOLLOW' && (
        <Field label="Twitter handle to follow">
          <input className={inputCls} placeholder="e.g. @provablehq" value={req.params.handle ?? ''}
            onChange={e => setParam('handle', e.target.value)} />
        </Field>
      )}
      {(req.type === 'DISCORD_MEMBER' || req.type === 'DISCORD_ROLE') && (
        <div className="space-y-2">
          <Field label="Discord Server ID">
            <input className={inputCls} placeholder="e.g. 123456789012345678" value={req.params.serverId ?? ''}
              onChange={e => setParam('serverId', e.target.value)} />
          </Field>
          {req.type === 'DISCORD_ROLE' && (
            <Field label="Role ID">
              <input className={inputCls} placeholder="e.g. 987654321098765432" value={req.params.roleId ?? ''}
                onChange={e => setParam('roleId', e.target.value)} />
            </Field>
          )}
        </div>
      )}
      {req.type === 'ONCHAIN_ACTIVITY' && (
        <Field label="Minimum transactions" optional>
          <input className={inputCls} type="number" min={1} placeholder="e.g. 5 (default 1)"
            value={req.params.minTxCount ?? ''}
            onChange={e => onChange({ ...req, params: { ...req.params, minTxCount: e.target.value ? Number(e.target.value) : undefined } })} />
        </Field>
      )}
      {req.type === 'GITHUB_ACCOUNT' && (
        <div className="space-y-2">
          <Field label="Min public repos" optional>
            <input className={inputCls} type="number" min={0} placeholder="e.g. 5"
              value={req.params.minRepos ?? ''}
              onChange={e => onChange({ ...req, params: { ...req.params, minRepos: e.target.value ? Number(e.target.value) : undefined } })} />
          </Field>
          <Field label="Min followers" optional>
            <input className={inputCls} type="number" min={0} placeholder="e.g. 10"
              value={req.params.minFollowers ?? ''}
              onChange={e => onChange({ ...req, params: { ...req.params, minFollowers: e.target.value ? Number(e.target.value) : undefined } })} />
          </Field>
          <Field label="Must be member of org" optional>
            <input className={inputCls} placeholder="e.g. provablehq"
              value={req.params.orgName ?? ''}
              onChange={e => setParam('orgName', e.target.value)} />
          </Field>
          <Field label="Must have committed to repo" optional>
            <input className={inputCls} placeholder="e.g. provablehq/leo"
              value={req.params.commitsRepo ?? ''}
              onChange={e => setParam('commitsRepo', e.target.value)} />
          </Field>
          {req.params.commitsRepo && (
            <Field label="Min commits in that repo" optional>
              <input className={inputCls} type="number" min={1} placeholder="e.g. 3 (default 1)"
                value={req.params.minCommits ?? ''}
                onChange={e => onChange({ ...req, params: { ...req.params, minCommits: e.target.value ? Number(e.target.value) : undefined } })} />
            </Field>
          )}
          <Field label="Must have starred repo" optional>
            <input className={inputCls} placeholder="e.g. provablehq/leo"
              value={req.params.starredRepo ?? ''}
              onChange={e => setParam('starredRepo', e.target.value)} />
          </Field>
        </div>
      )}
      {req.type === 'TELEGRAM_MEMBER' && (
        <Field label="Telegram chat / channel ID">
          <input className={inputCls} placeholder="e.g. -1001234567890"
            value={req.params.chatId ?? ''}
            onChange={e => setParam('chatId', e.target.value)} />
        </Field>
      )}
    </div>
  )
}

function RequirementsStep({ groups, onChange }: { groups: RequirementGroup[]; onChange: (g: RequirementGroup[]) => void }) {
  const updateGroup = (i: number, patch: Partial<RequirementGroup>) => {
    const next = [...groups]; next[i] = { ...next[i], ...patch }; onChange(next)
  }
  const updateReq = (gi: number, ri: number, req: Requirement) => {
    const reqs = [...groups[gi].requirements]; reqs[ri] = req; updateGroup(gi, { requirements: reqs })
  }
  const removeReq = (gi: number, ri: number) => {
    const reqs = groups[gi].requirements.filter((_, i) => i !== ri)
    if (reqs.length === 0) onChange(groups.filter((_, i) => i !== gi))
    else updateGroup(gi, { requirements: reqs })
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
        Groups use AND between them. Within each group choose AND / OR logic.
      </p>
      {groups.map((group, gi) => (
        <div key={group.id} className="border border-gray-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">Group {gi + 1}</span>
            <div className="flex items-center gap-3">
              {(['AND','OR'] as const).map(l => (
                <label key={l} className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
                  <input type="radio" value={l} checked={group.logic === l}
                    onChange={() => updateGroup(gi, { logic: l })}
                    className="accent-[#0070F3]" />
                  {l}
                </label>
              ))}
              {groups.length > 1 && (
                <button onClick={() => onChange(groups.filter((_, i) => i !== gi))}
                  className="text-xs text-red-400 hover:text-red-600 transition-colors">
                  Remove
                </button>
              )}
            </div>
          </div>
          {group.requirements.map((req, ri) => (
            <RequirementEditor key={req.id} req={req}
              onChange={r => updateReq(gi, ri, r)} onRemove={() => removeReq(gi, ri)} />
          ))}
          <button onClick={() => updateGroup(gi, { requirements: [...group.requirements, newReq()] })}
            className="text-sm font-medium text-[#0070F3] hover:underline">
            + Add requirement
          </button>
        </div>
      ))}
      <button onClick={() => onChange([...groups, newGroup()])}
        className="w-full py-2.5 border border-dashed border-gray-300 rounded-xl text-sm font-medium text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors">
        + Add group
      </button>
    </div>
  )
}

// ── Step 3: Review ────────────────────────────────────────────────────────────

function ReviewStep({ details, groups }: { details: DetailsForm; groups: RequirementGroup[] }) {
  return (
    <div className="space-y-4">
      <div className="border border-gray-100 rounded-xl p-4 space-y-2">
        <h3 className="text-sm font-semibold text-gray-900">{details.name || '—'}</h3>
        {details.description && <p className="text-sm text-gray-500">{details.description}</p>}
        <div className="flex gap-3 flex-wrap mt-1">
          <span className="text-xs bg-blue-50 text-blue-600 px-2.5 py-1 rounded-full">
            Type {details.credential_type}
          </span>
          <span className="text-xs bg-gray-50 text-gray-600 px-2.5 py-1 rounded-full">
            {details.credential_expiry_days} day validity
          </span>
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Requirements</p>
        {groups.map((g, i) => (
          <div key={g.id} className="border border-gray-100 rounded-xl p-3.5 mb-2.5">
            <p className="text-xs font-medium text-gray-500 mb-1.5">Group {i + 1} · {g.logic}</p>
            <div className="flex flex-wrap gap-1.5">
              {g.requirements.map(r => (
                <span key={r.id} className="text-xs bg-gray-50 border border-gray-100 text-gray-700 px-2.5 py-1 rounded-full">
                  {r.type}{r.chain ? ` / ${r.chain}` : ''}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Wizard shell ──────────────────────────────────────────────────────────────

const STEPS = ['Details', 'Requirements', 'Review']

function WizardStepper({ step }: { step: number }) {
  return (
    <div className="flex items-center w-full mb-8">
      {STEPS.map((label, i) => {
        const done = i < step; const active = i === step
        return (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium shrink-0 ring-4 ring-white z-10 transition-all
              ${done   ? 'bg-[#10B981] text-white' : ''}
              ${active ? 'bg-[#0070F3] text-white shadow-sm' : ''}
              ${!done && !active ? 'bg-white border-2 border-gray-200 text-gray-400' : ''}
            `}>
              {done ? (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              ) : i + 1}
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-[2px] -mx-1 ${i < step ? 'bg-[#10B981]' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function CreateCommunityWizard() {
  const navigate = useNavigate()
  const { executeTransaction, connected } = useAleoWallet()
  const [step, setStep]     = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const [details, setDetails] = useState<DetailsForm>({
    name: '', description: '', logo: '', credential_type: 1, credential_expiry_days: 30,
  })
  const [groups, setGroups] = useState<RequirementGroup[]>([newGroup()])

  const canNext = step === 0 ? details.name.trim().length > 0 : true

  const handleCreate = async () => {
    if (!connected || !executeTransaction) { setError('Connect your Aleo wallet first.'); return }
    setSaving(true); setError(null)
    try {
      const community_id = details.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const config: CommunityConfig = {
        community_id, name: details.name, description: details.description, logo: details.logo,
        credential_type: details.credential_type, credential_expiry_days: details.credential_expiry_days,
        requirement_groups: groups,
      }

      // Step 1: save config to verifier (off-chain registry + IPFS pin)
      const { ipfs_cid } = await createCommunity(config) as { community_id: string; ipfs_cid?: string }

      // Step 2: register community on-chain — user wallet pays gas, self.caller = creator
      // config_hash = field derived from IPFS CID (or community_id as fallback)
      const configHashSrc = ipfs_cid ?? community_id
      const communityField = fieldFromString(community_id)
      const configHashField = fieldFromString(configHashSrc)
      await executeTransaction({
        program:    'zkpoll_core.aleo',
        function:   'register_community',
        fee:        20_000,
        privateFee: false,
        inputs: [
          `${communityField}field`,
          `${configHashField}field`,
        ],
      })

      navigate(`/communities/${community_id}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e)); setSaving(false)
    }
  }

  const progress = ((step + 1) / STEPS.length) * 100

  return (
    <div className="max-w-lg mx-auto w-full">

      {/* Outer card — flex column so nav is always at bottom, no overflow-hidden clipping */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col" style={{ minHeight: 640 }}>

        {/* Header — fixed height, doesn't scroll */}
        <div className="shrink-0 px-8 pt-8 pb-2">
          <WizardStepper step={step} />
          <h2 className="text-2xl font-semibold tracking-tight text-gray-900 text-center mb-4">
            {STEPS[step]}
          </h2>
        </div>

        {/* Scrollable content — min-h-0 is required for flex children to scroll */}
        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-8 py-4">
          {step === 0 && <DetailsStep value={details} onChange={setDetails} />}
          {step === 1 && <RequirementsStep groups={groups} onChange={setGroups} />}
          {step === 2 && <ReviewStep details={details} groups={groups} />}

          {error && (
            <div className="mt-4">
              <p className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</p>
            </div>
          )}
        </div>

        {/* Bottom nav — shrink-0 flex footer, never overlaps content */}
        <div className="shrink-0 bg-white px-8 pt-5 pb-7 border-t border-gray-100 shadow-[0_-8px_24px_-8px_rgba(0,0,0,0.06)] flex flex-col items-center">
          <div className="w-full max-w-[300px] flex flex-col gap-4">
            <span className="text-center text-sm font-medium text-gray-900 tracking-tight">{STEPS[step]}</span>
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-[#0070F3] rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="flex gap-3 w-full">
              {step > 0 ? (
                <button onClick={() => setStep(s => s - 1)}
                  className="px-6 py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium rounded-xl text-sm transition-colors shrink-0">
                  Back
                </button>
              ) : (
                <div className="shrink-0 w-12" />
              )}
              {step < STEPS.length - 1 ? (
                <button onClick={() => setStep(s => s + 1)} disabled={!canNext}
                  className="flex-1 py-3.5 font-medium rounded-xl text-sm transition-colors shadow-sm text-white"
                  style={{ background: canNext ? '#0070F3' : '#93c5fd', cursor: canNext ? 'pointer' : 'not-allowed' }}>
                  Continue
                </button>
              ) : (
                <button onClick={() => void handleCreate()} disabled={saving || !connected}
                  className="flex-1 py-3.5 bg-[#0070F3] hover:bg-blue-600 text-white font-medium rounded-xl text-sm transition-colors shadow-sm disabled:opacity-60">
                  {saving ? 'Creating…' : !connected ? 'Connect Wallet' : 'Create Community'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
