// HTTP client for the off-chain verifier service.

import type { CommunityConfig, ConnectedAccount, VerifyResponse, CredentialParamsResponse, PollInfo } from '../types'

const BASE = '/api'   // proxied to localhost:3001 in dev; set VITE_VERIFIER_URL for prod

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`Verifier ${res.status}: ${path}`)
  return res.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? `Verifier ${res.status}`)
  }
  return res.json()
}

export const listCommunities = (): Promise<CommunityConfig[]> =>
  get('/communities')

export const getCommunity = (id: string): Promise<CommunityConfig> =>
  get(`/communities/${id}`)

export const createCommunity = (config: CommunityConfig): Promise<{ community_id: string }> =>
  post('/communities', config)

/** Check requirements only — no on-chain transaction */
export const checkRequirements = (
  communityId: string,
  aleoAddress: string,
  connectedAccounts: ConnectedAccount[],
): Promise<VerifyResponse> =>
  post('/verify/check', { communityId, aleoAddress, connectedAccounts })

/** Verify requirements and get inputs for user's wallet to call issue_credential */
export const getCredentialParams = (
  communityId: string,
  aleoAddress: string,
  connectedAccounts: ConnectedAccount[],
): Promise<CredentialParamsResponse> =>
  post('/verify/credential-params', { communityId, aleoAddress, connectedAccounts })

/** Legacy: check + issue via verifier wallet in one call */
export const verify = (
  communityId: string,
  aleoAddress: string,
  connectedAccounts: ConnectedAccount[],
): Promise<VerifyResponse> =>
  post('/verify', { communityId, aleoAddress, connectedAccounts })

export const registerPoll = (
  communityId: string,
  poll: PollInfo,
): Promise<{ poll_id: string }> =>
  post(`/communities/${communityId}/polls`, poll)
