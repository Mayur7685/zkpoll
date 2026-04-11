import { Account, ProgramManager, AleoNetworkClient, NetworkRecordProvider, AleoKeyProvider } from "@provablehq/sdk"

const PROGRAM  = "zkpoll_core.aleo"
const NODE_URL = () => process.env.ALEO_NODE_URL!
const FIELD_MODULUS = 8444461749428370424248824938781546531375899335154063827935233455917409239041n

export function stringToField(id: string): bigint {
  if (/^\d+$/.test(id)) return BigInt(id)
  let h = 0n
  for (let i = 0; i < id.length; i++) {
    h = (h * 31n + BigInt(id.charCodeAt(i))) % FIELD_MODULUS
  }
  return h
}

function issuerManager(): ProgramManager {
  const account        = new Account({ privateKey: process.env.ALEO_ISSUER_PRIVATE_KEY! })
  const networkClient  = new AleoNetworkClient(NODE_URL())
  const recordProvider = new NetworkRecordProvider(account, networkClient)
  const keyProvider    = new AleoKeyProvider()
  keyProvider.useCache(true)
  const manager = new ProgramManager(NODE_URL(), keyProvider, recordProvider)
  manager.setAccount(account)
  return manager
}

// ─── Credential issuance ──────────────────────────────────────────────────────

export async function issueCredential(
  recipientAleoAddress: string,
  communityId: string,
  credentialType: number,
  votingWeight: number,
  expiryBlock: number,
  issuedAt: number,
): Promise<string> {
  const communityField = stringToField(communityId)
  return issuerManager().execute({
    programName:  PROGRAM,
    functionName: "issue_credential",
    priorityFee:  0.03,
    privateFee:   false,
    inputs: [
      recipientAleoAddress,
      `${communityField}field`,
      `${credentialType}u8`,
      `${votingWeight}u64`,
      `${expiryBlock}u32`,
      `${issuedAt}u32`,
    ],
  })
}

// ─── Community registry ───────────────────────────────────────────────────────

/**
 * Register a community on-chain. Called by the verifier after saving the config JSON.
 * config_hash is a simple field derived from the community_id (Pinata CID hash in production).
 */
export async function registerCommunity(
  communityId: string,
  configHash: string,
): Promise<string> {
  const communityField = stringToField(communityId)
  const hashField      = stringToField(configHash)
  return issuerManager().execute({
    programName:  PROGRAM,
    functionName: "register_community",
    priorityFee:  0.03,
    privateFee:   false,
    inputs: [
      `${communityField}field`,
      `${hashField}field`,
    ],
  })
}

// ─── Poll creation ────────────────────────────────────────────────────────────

/**
 * Register a poll on-chain. Called after the community creator creates a poll.
 * operator: the OPERATOR_ADDRESS from .env — only this address can publish snapshots.
 */
export async function createPollOnChain(
  pollId: string,
  communityId: string,
  requiredCredType: number,
  createdAt: number,
  endBlock: number,
): Promise<string> {
  const pollField      = stringToField(pollId)
  const communityField = stringToField(communityId)
  const operator       = process.env.OPERATOR_ADDRESS!

  return issuerManager().execute({
    programName:  PROGRAM,
    functionName: "create_poll",
    priorityFee:  0.03,
    privateFee:   false,
    inputs: [
      `${pollField}field`,
      `${communityField}field`,
      `${requiredCredType}u8`,
      `${createdAt}u32`,
      `${endBlock}u32`,
      operator,
    ],
  })
}

export async function addOptionOnChain(
  pollId: string,
  optionId: number,
  parentId: number,
  childCount: number,
): Promise<string> {
  const pollField = stringToField(pollId)
  return issuerManager().execute({
    programName:  PROGRAM,
    functionName: "add_option",
    priorityFee:  0.03,
    privateFee:   false,
    inputs: [
      `${pollField}field`,
      `${optionId}u8`,
      `${parentId}u8`,
      `${childCount}u8`,
    ],
  })
}

// ─── Block height ─────────────────────────────────────────────────────────────

export async function getCurrentBlockHeight(): Promise<number> {
  const res  = await fetch(`${NODE_URL()}/${process.env.ALEO_NETWORK}/block/latest`)
  if (!res.ok) throw new Error(`Aleo RPC ${res.status}: /block/latest`)
  const data = await res.json() as any
  const height = data?.header?.metadata?.height
  if (typeof height !== "number" || height <= 0) {
    throw new Error(`Invalid block height: ${JSON.stringify(height)}`)
  }
  return height
}
