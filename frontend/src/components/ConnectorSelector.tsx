import { useState } from 'react'
import type { ConnectedAccount } from '../types'

interface Props {
  accounts: ConnectedAccount[]
  onChange: (accounts: ConnectedAccount[]) => void
}

const CONNECTORS = [
  { type: 'EVM_WALLET', icon: '🦊', name: 'EVM Wallet',   hint: 'MetaMask, Coinbase, etc.' },
  { type: 'X_TWITTER',  icon: '𝕏',  name: 'X / Twitter', hint: 'Required for follow checks' },
  { type: 'DISCORD',    icon: '💬', name: 'Discord',      hint: 'Required for server/role checks' },
] as const

export default function ConnectorSelector({ accounts, onChange }: Props) {
  const [evmError, setEvmError] = useState<string | null>(null)

  const get = (type: string) => accounts.find(a => a.type === type)

  const connectEVM = async () => {
    setEvmError(null)
    const eth = (window as unknown as { ethereum?: { request: (args: { method: string }) => Promise<string[]> } }).ethereum
    if (!eth) { setEvmError('No injected wallet found. Install MetaMask.'); return }
    try {
      const addrs = await eth.request({ method: 'eth_requestAccounts' })
      const address = addrs[0]
      onChange([...accounts.filter(a => a.type !== 'EVM_WALLET'),
        { type: 'EVM_WALLET', identifier: address, displayName: `${address.slice(0, 6)}…${address.slice(-4)}` }])
    } catch (e: unknown) {
      setEvmError(e instanceof Error ? e.message : 'Connection rejected')
    }
  }

  const connectX = () => {
    const w = window.open('/api/auth/twitter', 'zkpoll-twitter', 'width=520,height=640')
    if (!w) return
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'TWITTER_CONNECTED') return
      window.removeEventListener('message', onMsg)
      onChange([...accounts.filter(a => a.type !== 'X_TWITTER'),
        { type: 'X_TWITTER', identifier: e.data.userId, displayName: `@${e.data.username}` }])
    }
    window.addEventListener('message', onMsg)
  }

  const connectDiscord = () => {
    const w = window.open('/api/auth/discord', 'zkpoll-discord', 'width=520,height=640')
    if (!w) return
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'DISCORD_CONNECTED') return
      window.removeEventListener('message', onMsg)
      onChange([...accounts.filter(a => a.type !== 'DISCORD'),
        { type: 'DISCORD', identifier: e.data.userId, displayName: e.data.username }])
    }
    window.addEventListener('message', onMsg)
  }

  const handleConnect = (type: typeof CONNECTORS[number]['type']) => {
    if (type === 'EVM_WALLET') void connectEVM()
    else if (type === 'X_TWITTER') connectX()
    else connectDiscord()
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Connected Accounts</p>
      {CONNECTORS.map(({ type, icon, name, hint }) => {
        const account = get(type)
        return (
          <div key={type} className="flex items-center justify-between p-3 bg-gray-50 border border-gray-100 rounded-xl">
            <div className="flex items-center gap-2.5">
              <span className="text-base w-7 text-center">{icon}</span>
              <div>
                <div className="text-sm font-medium text-gray-800">{name}</div>
                <div className="text-xs text-gray-400">
                  {account ? (account.displayName ?? account.identifier) : hint}
                </div>
              </div>
            </div>
            {account ? (
              <button
                onClick={() => onChange(accounts.filter(a => a.type !== type))}
                className="text-xs text-gray-500 hover:text-red-500 border border-gray-200 hover:border-red-200 px-3 py-1.5 rounded-lg transition-colors"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={() => handleConnect(type)}
                className="text-xs font-medium text-[#0070F3] border border-blue-200 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"
              >
                Connect
              </button>
            )}
          </div>
        )
      })}
      {evmError && (
        <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{evmError}</p>
      )}
    </div>
  )
}
