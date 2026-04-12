// Create Poll Wizard — ref3 design: stepper + white card + bottom nav.
// Logic unchanged: 3 steps (Setup → Options → Deploy), sequential wallet txs.

import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAleoWallet } from '../hooks/useAleoWallet'
import { TransactionStatus } from '@provablehq/aleo-types'
import { getBlockHeight } from '../lib/aleo'
import { listCommunities, getCommunity, registerPoll } from '../lib/verifier'
import type { CommunityConfig, PollOptionInfo } from '../types'

const FIELD_MODULUS = 8444461749428370424248824938781546531375899335154063827935233455917409239041n

function fieldFromString(s: string): bigint {
  if (/^\d+$/.test(s)) return BigInt(s) % FIELD_MODULUS
  let h = 0n
  for (let i = 0; i < s.length; i++) h = (h * 31n + BigInt(s.charCodeAt(i))) % FIELD_MODULUS
  return h
}

function generatePollId(communityId: string, title: string): bigint {
  return fieldFromString(`${communityId}:${title}:${Date.now()}`)
}

interface OptionDraft { draftId: number; label: string; parentDraftId: number }

function deriveChildCount(draftId: number, options: OptionDraft[]): number {
  return options.filter(o => o.parentDraftId === draftId).length
}

function buildOptionList(drafts: OptionDraft[]): PollOptionInfo[] {
  const idMap = new Map<number, number>()
  let nextId = 1
  const queue = drafts.filter(d => d.parentDraftId === 0)
  const remaining = drafts.filter(d => d.parentDraftId !== 0)
  while (queue.length > 0 || remaining.length > 0) {
    const current = queue.shift()
    if (!current) break
    idMap.set(current.draftId, nextId++)
    queue.push(...remaining.filter(d => d.parentDraftId === current.draftId))
  }
  return drafts.map(d => ({
    option_id:        idMap.get(d.draftId) ?? 0,
    label:            d.label,
    parent_option_id: d.parentDraftId === 0 ? 0 : (idMap.get(d.parentDraftId) ?? 0),
    child_count:      deriveChildCount(d.draftId, drafts),
  })).sort((a, b) => a.option_id - b.option_id)
}

type DeployStatus = 'idle' | 'creating_poll' | 'registering' | 'done' | 'error'

const inputCls = "block w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition-all"
const labelCls = "block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wide"

const STEP_LABELS = ['Poll Setup', 'Options Tree', 'Deploy']

function WizardStepper({ step }: { step: number }) {
  return (
    <div className="flex items-center w-full mb-8">
      {STEP_LABELS.map((label, i) => {
        const done = i < step - 1; const active = i === step - 1
        return (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium shrink-0 ring-4 ring-white z-10
              ${done   ? 'bg-[#10B981] text-white' : ''}
              ${active ? 'bg-[#0070F3] text-white shadow-sm' : ''}
              ${!done && !active ? 'bg-white border-2 border-gray-200 text-gray-400' : ''}
            `}>
              {done ? (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              ) : i + 1}
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className={`flex-1 h-[2px] -mx-1 ${i < step - 1 ? 'bg-[#10B981]' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function CreatePollWizard() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { executeTransaction, transactionStatus, connected, address } = useAleoWallet()
  const [step, setStep] = useState(1)
  const [communities, setCommunities] = useState<CommunityConfig[]>([])
  const [nextDraftId, setNextDraftId] = useState(1)

  // Step 1
  const [notCreator, setNotCreator]           = useState(false)
  const [communityId, setCommunityId]         = useState('')
  const [title, setTitle]                     = useState('')
  const [description, setDescription]         = useState('')
  const [requiredCredType, setRequiredCredType] = useState(1)
  const [durationDays, setDurationDays]       = useState(7)
  const [pollType, setPollType]               = useState<'flat' | 'hierarchical'>('flat')

  // Step 2
  const [options, setOptions] = useState<OptionDraft[]>([])

  // Step 3
  const [deployStatus, setDeployStatus]   = useState<DeployStatus>('idle')
  const [deployMessage, setDeployMessage] = useState('')
  const [deployError, setDeployError]     = useState('')
  const [createdPollId, setCreatedPollId] = useState('')
  const [createdPollTxId, setCreatedPollTxId] = useState('')

  useEffect(() => { listCommunities().then(setCommunities).catch(() => null) }, [])

  useEffect(() => {
    setNotCreator(false)
    setCommunityId('')
  }, [address])

  useEffect(() => {
    const preselect = searchParams.get('community')
    if (preselect && communities.length > 0 && !communityId) {
      const c = communities.find(c => c.community_id === preselect)
      if (c) { setCommunityId(preselect); setRequiredCredType(c.credential_type) }
    }
  }, [communities, searchParams])

  // Option helpers
  // zkpoll_v2_core limits:
  //   - max 8 options per parent (cast_vote has r1..r8 rank slots)
  //   - max depth 4 (depth 0 = root, depth 3 = deepest sub-option)
  const MAX_OPTIONS_PER_PARENT = 8
  const MAX_DEPTH = 3  // 0-indexed: root=0, sub=1, sub-sub=2, deepest=3

  function getDepth(draftId: number): number {
    let depth = 0
    let current = options.find(o => o.draftId === draftId)
    while (current && current.parentDraftId !== 0) {
      depth++
      current = options.find(o => o.draftId === current!.parentDraftId)
    }
    return depth
  }

  function addOption(parentDraftId = 0) {
    const siblingsCount = options.filter(o => o.parentDraftId === parentDraftId).length
    if (siblingsCount >= MAX_OPTIONS_PER_PARENT) return
    const parentDepth = parentDraftId === 0 ? -1 : getDepth(parentDraftId)
    if (parentDepth >= MAX_DEPTH) return
    setOptions(prev => [...prev, { draftId: nextDraftId, label: '', parentDraftId }])
    setNextDraftId(n => n + 1)
  }
  function updateOption(draftId: number, label: string) {
    setOptions(prev => prev.map(o => o.draftId === draftId ? { ...o, label } : o))
  }
  function removeOption(draftId: number) {
    const toRemove = new Set<number>()
    const queue = [draftId]
    while (queue.length > 0) {
      const id = queue.shift()!
      toRemove.add(id)
      options.filter(o => o.parentDraftId === id).forEach(c => queue.push(c.draftId))
    }
    setOptions(prev => prev.filter(o => !toRemove.has(o.draftId)))
  }

  function renderOptions(parentDraftId: number, depth = 0): React.ReactNode {
    return options.filter(o => o.parentDraftId === parentDraftId).map(opt => {
      const childCount = options.filter(o => o.parentDraftId === opt.draftId).length
      const canAddSub = pollType === 'hierarchical' && childCount < MAX_OPTIONS_PER_PARENT && depth < MAX_DEPTH
      return (
        <div key={opt.draftId} style={{ marginLeft: depth * 16 }}>
          <div className="flex items-center gap-2 mb-2">
            {depth > 0 && <div className="w-4 h-px bg-gray-200 shrink-0" />}
            <input
              className={inputCls}
              placeholder={depth === 0 ? 'Root option label' : 'Sub-option label'}
              value={opt.label}
              onChange={e => updateOption(opt.draftId, e.target.value)}
            />
            {canAddSub && (
              <button
                onClick={() => addOption(opt.draftId)}
                className="shrink-0 text-xs text-[#0070F3] hover:underline font-medium whitespace-nowrap"
                title="Add sub-option"
              >
                + Sub
              </button>
            )}
            <button
              onClick={() => removeOption(opt.draftId)}
              className="shrink-0 text-gray-400 hover:text-red-500 transition-colors text-sm"
            >
              ✕
            </button>
          </div>
          {renderOptions(opt.draftId, depth + 1)}
        </div>
      )
    })
  }

  const step1Valid = communityId.trim() !== '' && title.trim() !== '' && !notCreator
  const step2Valid = options.length >= 2 && options.every(o => o.label.trim() !== '')

  async function handleDeploy() {
    if (!connected || !address || !executeTransaction) {
      setDeployError('Connect your Aleo wallet first.'); return
    }
    setDeployStatus('creating_poll'); setDeployError('')
    try {
      const pollIdField  = generatePollId(communityId, title)
      const pollIdStr    = String(pollIdField)
      const communityFld = fieldFromString(communityId)
      const blockHeight  = await getBlockHeight()
      const optionList   = buildOptionList(options)

      // ~2.5s per block on Aleo testnet → 34560 blocks/day
      const BLOCKS_PER_DAY = 34560
      const endBlock = blockHeight + durationDays * BLOCKS_PER_DAY
      const operator = import.meta.env.VITE_OPERATOR_ADDRESS as string ?? ''

      // Tx 1: create poll on-chain — user wallet is self.caller, must match community.creator
      setDeployMessage('Creating poll on-chain… (wallet signature required)')
      const pollTxResult = await executeTransaction({
        program:    'zkpoll_v2_core.aleo',
        function:   'create_poll',
        fee:        20_000,
        privateFee: false,
        inputs: [
          `${pollIdStr}field`,
          `${communityFld}field`,
          `${requiredCredType}u8`,
          `${blockHeight}u32`,
          `${endBlock}u32`,
          operator,
        ],
      })
      if (pollTxResult?.transactionId) setCreatedPollTxId(pollTxResult.transactionId)

      // Wait for on-chain confirmation + swap to real txId
      if (transactionStatus && pollTxResult?.transactionId) {
        setDeployMessage('Waiting for on-chain confirmation…')
        const walletTxId = pollTxResult.transactionId
        let attempts = 0
        await new Promise<void>((resolve, reject) => {
          const interval = setInterval(async () => {
            attempts++
            try {
              const res = await transactionStatus(walletTxId)
              const s = res.status.toLowerCase()
              const onChainId = (res as unknown as Record<string, unknown>).transactionId as string | undefined
              if (s === TransactionStatus.ACCEPTED) {
                clearInterval(interval)
                if (onChainId) setCreatedPollTxId(onChainId)
                resolve()
              } else if (s === TransactionStatus.FAILED || s === TransactionStatus.REJECTED) {
                clearInterval(interval)
                if (onChainId) setCreatedPollTxId(onChainId)
                reject(new Error(res.error ?? 'Transaction rejected on-chain'))
              } else if (attempts > 72) {
                clearInterval(interval)
                if (onChainId) setCreatedPollTxId(onChainId)
                resolve()
              }
            } catch { /* retry */ }
          }, 2_000)
        })
      }

      // Off-chain: save title, description, options to verifier (+ IPFS pin)
      setDeployStatus('registering'); setDeployMessage('Saving poll metadata…')
      await registerPoll(communityId, {
        poll_id: pollIdStr, title, description: description.trim() || undefined,
        required_credential_type: requiredCredType, created_at_block: blockHeight,
        end_block: endBlock, options: optionList, poll_type: pollType,
        creator_address: address,
      })

      setCreatedPollId(pollIdStr)
      setDeployStatus('done')
    } catch (e: unknown) {
      setDeployError(e instanceof Error ? e.message : String(e))
      setDeployStatus('error')
    }
  }

  const progress = (step / STEP_LABELS.length) * 100

  return (
    <div className="max-w-lg mx-auto w-full">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col" style={{ minHeight: 640 }}>

        {/* Header — fixed, doesn't scroll */}
        <div className="shrink-0 px-8 pt-8 pb-2">
          <WizardStepper step={step} />
          <h2 className="text-2xl font-semibold tracking-tight text-gray-900 text-center mb-4">
            {STEP_LABELS[step - 1]}
          </h2>
        </div>

        {/* Scrollable content — min-h-0 enables flex child scrolling */}
        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-8 py-4">

          {/* Step 1 */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className={labelCls}>Community *</label>
                <select className={inputCls} value={communityId}
                  onChange={async e => {
                    const id = e.target.value
                    setCommunityId(id)
                    setNotCreator(false)
                    if (!id) return
                    const c = communities.find(c => c.community_id === id)
                    if (c) {
                      setRequiredCredType(c.credential_type)
                      // Sync check from already-loaded list
                      if (c.creator && c.creator !== address) { setNotCreator(true); return }
                    }
                    // Async re-check with on-chain backfilled data
                    try {
                      const fresh = await getCommunity(id)
                      if (fresh.creator && fresh.creator !== address) setNotCreator(true)
                    } catch { /* non-fatal */ }
                  }}>
                  <option value="">— Select community —</option>
                  {communities.map(c => (
                    <option key={c.community_id} value={c.community_id}>{c.name}</option>
                  ))}
                </select>
                {address && !notCreator && communities.filter(c => !c.creator || c.creator === address).length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">You haven't created any communities yet.</p>
                )}
                {notCreator && (
                  <p className="text-xs text-red-500 mt-1">You are not the creator of this community and cannot create polls in it.</p>
                )}
              </div>
              <div>
                <label className={labelCls}>Poll Title *</label>
                <input className={inputCls} placeholder="e.g. Treasury Allocation Q1 2026"
                  value={title} onChange={e => setTitle(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Description</label>
                <textarea className={`${inputCls} resize-none`} rows={3} placeholder="Optional context for voters"
                  value={description} onChange={e => setDescription(e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Required Credential Type</label>
                <div className="flex items-center gap-3">
                  <input className={inputCls} type="number" min={0} max={255} style={{ maxWidth: 120 }}
                    value={requiredCredType} onChange={e => setRequiredCredType(Number(e.target.value))} />
                  <span className="text-xs text-gray-400">0 = open to all</span>
                </div>
              </div>
              <div>
                <label className={labelCls}>Poll Duration</label>
                <div className="flex items-center gap-2 flex-wrap">
                  {[1, 3, 7, 14, 30].map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDurationDays(d)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                        durationDays === d
                          ? 'bg-gray-900 text-white border-gray-900'
                          : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-400'
                      }`}
                    >
                      {d}d
                    </button>
                  ))}
                  <div className="flex items-center gap-1.5 ml-1">
                    <input
                      className={`${inputCls} !py-1.5`}
                      type="number" min={1} max={365} style={{ maxWidth: 80 }}
                      value={durationDays}
                      onChange={e => setDurationDays(Math.max(1, Number(e.target.value)))}
                    />
                    <span className="text-xs text-gray-400 whitespace-nowrap">days</span>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  Enforced on-chain — votes rejected after this deadline.
                </p>
              </div>

              {/* Poll type selector */}
              <div>
                <label className={labelCls}>Poll Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { value: 'flat', label: 'Flat', desc: 'Root options only. Single vote tx.', icon: '▤' },
                    { value: 'hierarchical', label: 'Hierarchical', desc: 'Root + sub-options. Experimental.', icon: '▦' },
                  ] as const).map(({ value, label, desc, icon }) => (
                    <button key={value} type="button" onClick={() => setPollType(value)}
                      className={`flex flex-col items-start gap-1 px-3.5 py-3 rounded-xl border text-left transition-colors ${
                        pollType === value
                          ? 'border-[#0070F3] bg-blue-50'
                          : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                      }`}>
                      <div className="flex items-center gap-1.5">
                        <span className="text-base">{icon}</span>
                        <span className="text-sm font-semibold text-gray-900">{label}</span>
                        {value === 'hierarchical' && (
                          <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full font-medium">Beta</span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400">{desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <div className="space-y-4">
              {pollType === 'hierarchical' ? (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                  <span className="text-amber-500 shrink-0 mt-0.5">⚠️</span>
                  <p className="text-xs text-amber-700">
                    <strong>Experimental:</strong> Hierarchical polls require multiple wallet signatures — one per layer ranked. Sub-option rankings are cast as separate transactions.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
                  Add up to 8 root options. Voters rank them in a single transaction.
                </p>
              )}
              <div className="space-y-1">
                {renderOptions(0)}
              </div>
              <button
                onClick={() => addOption(0)}
                disabled={options.filter(o => o.parentDraftId === 0).length >= MAX_OPTIONS_PER_PARENT}
                className="w-full py-2.5 border border-dashed border-gray-300 rounded-xl text-sm font-medium text-gray-500 hover:border-[#0070F3] hover:text-[#0070F3] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-gray-300 disabled:hover:text-gray-500"
              >
                + Add Root Option {options.filter(o => o.parentDraftId === 0).length >= MAX_OPTIONS_PER_PARENT ? `(max ${MAX_OPTIONS_PER_PARENT})` : ''}
              </button>
              {options.length < 2 && options.length > 0 && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                  Add at least 2 options to continue.
                </p>
              )}
            </div>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <div className="space-y-4">
              {/* Review card */}
              <div className="border-[1.5px] border-[#0070F3] rounded-xl overflow-hidden bg-white">
                {(() => {
                  const optionList = buildOptionList(options)
                  const rootCount = optionList.filter(o => o.parent_option_id === 0).length
                  const subCount  = optionList.length - rootCount

                  // Build a depth map for indentation
                  const depthMap = new Map<number, number>()
                  optionList.forEach(o => {
                    if (o.parent_option_id === 0) depthMap.set(o.option_id, 0)
                    else depthMap.set(o.option_id, (depthMap.get(o.parent_option_id) ?? 0) + 1)
                  })

                  return (
                    <>
                      <div className="p-4 space-y-3">
                        {[
                          ['Community', communityId],
                          ['Title', title],
                          ...(description ? [['Description', description]] : []),
                          ['Required Credential', `Type ${requiredCredType}`],
                          ['Duration', `${durationDays} day${durationDays !== 1 ? 's' : ''} (on-chain enforced)`],
                          ['Root options', String(rootCount)],
                          ...(subCount > 0 ? [['Sub-options', String(subCount)]] : []),
                          ['Wallet signatures', '2  (create poll + register deadline)'],
                        ].map(([k, v]) => (
                          <div key={k} className="flex justify-between items-start text-sm">
                            <span className="text-gray-500">{k}</span>
                            <span className="font-medium text-gray-900 text-right ml-4">{v}</span>
                          </div>
                        ))}
                      </div>
                      {/* Option preview — tree hierarchy */}
                      <div className="border-t border-gray-100 bg-[#f8fafc] p-4 space-y-1.5">
                        {optionList.map(opt => {
                          const depth = depthMap.get(opt.option_id) ?? 0
                          const isRoot = depth === 0
                          return (
                            <div key={opt.option_id} className="flex items-center gap-2 text-sm"
                              style={{ marginLeft: depth * 20 }}>
                              {depth > 0 && (
                                <svg className="w-3 h-3 text-gray-300 shrink-0" viewBox="0 0 12 12" fill="none">
                                  <path d="M2 0v6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                </svg>
                              )}
                              <span className={`flex items-center justify-center shrink-0 rounded text-xs font-medium
                                ${isRoot ? 'w-6 h-6 bg-[#0070F3] text-white' : 'w-5 h-5 bg-gray-100 text-gray-500'}`}>
                                {opt.option_id}
                              </span>
                              <span className={isRoot ? 'font-medium text-gray-800' : 'text-gray-600'}>{opt.label}</span>
                              {opt.child_count > 0 && (
                                <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                                  {opt.child_count} sub
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                      <div className="bg-[#0070F3] text-white px-4 py-3 text-sm font-medium">
                        1 wallet signature. Options are stored off-chain — no per-option transactions.
                      </div>
                    </>
                  )
                })()}
              </div>

              {/* Deploy progress / success */}
              {deployStatus === 'creating_poll' || deployStatus === 'registering' ? (
                <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                  <div className="w-4 h-4 border-2 border-[#0070F3] border-t-transparent rounded-full animate-spin shrink-0" />
                  <p className="text-sm text-blue-700 font-medium">{deployMessage}</p>
                </div>
              ) : deployStatus === 'done' ? (
                <div className="flex flex-col items-center gap-3 bg-green-50 border border-green-100 rounded-xl p-6 text-center">
                  <div className="w-10 h-10 rounded-full bg-[#10B981] flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">Poll created!</p>
                    <p className="text-xs text-gray-500 mt-1">ID: {createdPollId.slice(0, 20)}…</p>
                  </div>
                  {createdPollTxId && (
                    <a href={`https://testnet.explorer.provable.com/transaction/${createdPollTxId}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-sm font-medium text-[#0070F3] hover:underline">
                      View transaction ↗
                    </a>
                  )}
                  <button
                    onClick={() => navigate(`/communities/${communityId}/polls/${createdPollId}`)}
                    className="bg-gray-900 text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-gray-800 transition-colors"
                  >
                    View Poll →
                  </button>
                </div>
              ) : null}

              {deployError && (
                <p className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{deployError}</p>
              )}
            </div>
          )}
        </div>

        {/* Bottom nav — shrink-0 flex footer, never overlaps content */}
        {deployStatus !== 'done' && (
          <div className="shrink-0 bg-white px-8 pt-5 pb-7 border-t border-gray-100 shadow-[0_-8px_24px_-8px_rgba(0,0,0,0.06)] flex flex-col items-center">
            <div className="w-full max-w-[300px] flex flex-col gap-4">
              <span className="text-center text-sm font-medium text-gray-900 tracking-tight">
                {STEP_LABELS[step - 1]}
              </span>
              <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-[#0070F3] rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
              <div className="flex gap-3 w-full">
                {(step > 1 && (deployStatus === 'idle' || deployStatus === 'error')) ? (
                  <button onClick={() => setStep(s => s - 1)}
                    className="px-6 py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium rounded-xl text-sm transition-colors shrink-0">
                    Back
                  </button>
                ) : <div className="shrink-0 w-12" />}

                {step < 3 ? (
                  (() => {
                    const disabled = step === 1 ? !step1Valid : !step2Valid
                    return (
                      <button
                        disabled={disabled}
                        onClick={() => setStep(s => s + 1)}
                        className="flex-1 py-3.5 font-medium rounded-xl text-sm shadow-sm text-white transition-colors"
                        style={{ background: disabled ? '#93c5fd' : '#0070F3', cursor: disabled ? 'not-allowed' : 'pointer' }}
                      >
                        Continue
                      </button>
                    )
                  })()
                ) : (
                  (deployStatus === 'idle' || deployStatus === 'error') && (
                    <button onClick={() => void handleDeploy()} disabled={!connected}
                      className="flex-1 py-3.5 bg-[#0070F3] hover:bg-blue-600 text-white font-medium rounded-xl text-sm transition-colors shadow-sm disabled:opacity-60">
                      {connected ? 'Deploy Poll' : 'Connect Wallet'}
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
