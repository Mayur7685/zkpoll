export type RequirementType =
  | "TOKEN_BALANCE"
  | "NFT_OWNERSHIP"
  | "ONCHAIN_ACTIVITY"
  | "CONTRACT_INTERACTION"
  | "DOMAIN_OWNERSHIP"
  | "X_FOLLOW"
  | "DISCORD_MEMBER"
  | "DISCORD_ROLE"
  | "GITHUB_ACCOUNT"
  | "ALLOWLIST"
  | "FREE"

export type LogicOperator = "AND" | "OR"

export interface Requirement {
  id: string
  type: RequirementType
  chain?: string
  params: {
    tokenAddress?: string
    minAmount?: string
    contractAddress?: string
    handle?: string
    serverId?: string
    roleId?: string
    domain?: string
    addresses?: string[]
    vote_weight?: number   // per-requirement EV override; falls back to DEFAULT_WEIGHTS
  }
}

export interface RequirementGroup {
  logic: LogicOperator
  requirements: Requirement[]
}

export interface PollOptionInfo {
  option_id: number
  label: string
  parent_option_id: number
  child_count: number
}

export interface PollInfo {
  poll_id: string            // field value as numeric string
  title: string
  description?: string
  required_credential_type: number
  created_at_block: number
  options: PollOptionInfo[]
  ipfs_cid?: string          // CID of the full poll metadata on IPFS (Pinata)
}

export interface CommunityConfig {
  community_id: string
  name: string
  description: string
  logo?: string
  credential_type: number        // 1–255, tier issued on pass
  credential_expiry_days: number // e.g. 365
  requirement_groups: RequirementGroup[]
  polls?: PollInfo[]
}

export type ConnectorType =
  | "EVM_WALLET"
  | "ALEO_WALLET"
  | "DISCORD"
  | "X_TWITTER"
  | "GITHUB"

export interface ConnectedAccount {
  type: ConnectorType
  identifier: string   // wallet address, username, etc.
  verified: boolean
  verifiedAt: number
}

export interface CheckResult {
  requirementId: string
  passed: boolean
  error?: string
}
