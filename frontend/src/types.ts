// ─── Verifier / Community types ───────────────────────────────────────────────

export type RequirementType =
  | 'FREE'
  | 'ALLOWLIST'
  | 'TOKEN_BALANCE'
  | 'NFT_OWNERSHIP'
  | 'ONCHAIN_ACTIVITY'
  | 'DOMAIN_OWNERSHIP'
  | 'X_FOLLOW'
  | 'DISCORD_MEMBER'
  | 'DISCORD_ROLE'
  | 'GITHUB_ACCOUNT'
  | 'TELEGRAM_MEMBER'

export interface Requirement {
  id: string
  type: RequirementType
  chain?: string
  params: {
    tokenAddress?: string
    minAmount?: string
    contractAddress?: string
    addresses?: string[]
    domain?: string
    handle?: string
    serverId?: string
    roleId?: string
    chatId?: string          // Telegram chat/channel ID for TELEGRAM_MEMBER
    minTxCount?: number      // ONCHAIN_ACTIVITY: minimum transaction count (default 1)
    minRepos?: number        // GITHUB_ACCOUNT: minimum public repos
    minFollowers?: number    // GITHUB_ACCOUNT: minimum followers
    orgName?: string         // GITHUB_ACCOUNT: must be member of GitHub org
    commitsRepo?: string     // GITHUB_ACCOUNT: "owner/repo" — must have committed here
    minCommits?: number      // GITHUB_ACCOUNT: minimum commits to commitsRepo (default 1)
    starredRepo?: string     // GITHUB_ACCOUNT: "owner/repo" — user must have starred this
    /** Eligible votes this requirement contributes when passed. Default varies by type. */
    vote_weight?: number
  }
}

export interface RequirementGroup {
  id: string
  logic: 'AND' | 'OR'
  requirements: Requirement[]
}

export interface PollOptionInfo {
  option_id: number
  label: string
  parent_option_id: number
  child_count: number
}

export interface PollInfo {
  poll_id: string
  title: string
  description?: string
  required_credential_type: number
  created_at_block: number
  end_block?: number
  operator_address?: string  // Aleo address of tally operator — needed for cast_vote
  options: PollOptionInfo[]
  ipfs_cid?: string   // IPFS CID of full poll metadata (set by verifier on registration)
}

export interface CommunityConfig {
  community_id: string
  name: string
  description: string
  logo: string
  credential_type: number
  credential_expiry_days: number
  requirement_groups: RequirementGroup[]
  polls?: PollInfo[]
}

// ─── Connected accounts ───────────────────────────────────────────────────────

export type AccountType = 'EVM_WALLET' | 'X_TWITTER' | 'DISCORD' | 'GITHUB' | 'TELEGRAM'

export interface ConnectedAccount {
  type: AccountType
  identifier: string   // address / user-id / username
  displayName?: string
}

// ─── Poll types ───────────────────────────────────────────────────────────────

export interface PollOption {
  option_id: number
  label: string
  parent_option_id: number
  child_count: number
}

export interface Poll {
  poll_id: string         // field value as hex string
  community_id: string
  required_credential_type: number
  created_at: number      // block height
  active: boolean
  options: PollOption[]
  vote_count?: number
  operator_address?: string
}

// ─── Vote state ───────────────────────────────────────────────────────────────

export interface VoteRanking {
  [optionId: number]: number  // optionId → rank (1-8, 0 = unranked)
}

// ─── Credential ───────────────────────────────────────────────────────────────

export interface Credential {
  owner: string
  issuer: string
  community_id: string
  credential_type: number
  /** Eligible votes (EV) at issuance — 0 for v1 credentials that predate voting_weight */
  voting_weight: number
  expiry_block: number
  issued_at: number
  /** Raw wallet recordPlaintext (with _nonce) — passed as Leo transition record input. */
  _raw?: string
  /** Whether the record has been spent on-chain (from wallet's local state). */
  _spent?: boolean
}

// ─── On-chain structs ─────────────────────────────────────────────────────────

export interface PollMeta {
  creator: string
  community_id: string    // field value (numeric string)
  required_credential_type: number
  created_at: number      // block height
  active: boolean
}

export interface Snapshot {
  snapshot_id: number
  poll_id: string
  community_id: string
  block_height: number
  total_votes: number
  rank_1_option: number
  rank_2_option: number
  rank_3_option: number
  rank_4_option: number
  rank_5_option: number
  rank_6_option: number
  rank_7_option: number
  rank_8_option: number
}

// Private Vote record from zkpoll_vote2.aleo / zkpoll_vote_v2.aleo (read from wallet)
export interface VoteRecord {
  owner: string
  poll_id: string
  community_id: string
  cast_at: number
  nullifier: string
  rankings: number[]   // [rank_1..rank_8], 0 = unranked
}

// ─── Check result ─────────────────────────────────────────────────────────────

export interface CheckResult {
  requirementId: string
  passed: boolean
  error?: string
}

export interface VerifyResponse {
  passed: boolean
  results: CheckResult[]
  txId?: string
}

/** Returned by /verify/credential-params — inputs the user's wallet needs to call issue_credential */
export interface CredentialParams {
  recipient:      string
  communityId:    string
  credentialType: number
  votingWeight:   number   // EV computed by verifier from requirements passed
  expiryBlock:    number
  issuedAt:       number
}

export interface CredentialParamsResponse {
  passed:           boolean
  results:          CheckResult[]
  credentialParams: CredentialParams
}
