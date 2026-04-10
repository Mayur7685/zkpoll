import { Account, ProgramManager, AleoNetworkClient, NetworkRecordProvider, AleoKeyProvider } from "@provablehq/sdk"

// Issues a private Credential record to the recipient's Aleo address.
// Called after all community requirements pass.
export async function issueCredential(
  recipientAleoAddress: string,
  communityId: string,
  credentialType: number,
  votingWeight: number,
  expiryBlock: number,
  issuedAt: number,
): Promise<string> {
  const issuerAccount  = new Account({ privateKey: process.env.ALEO_ISSUER_PRIVATE_KEY! })
  const networkClient  = new AleoNetworkClient(process.env.ALEO_NODE_URL!)
  const recordProvider = new NetworkRecordProvider(issuerAccount, networkClient)

  // Cache synthesized keys in memory so repeated calls don't re-synthesize
  const keyProvider = new AleoKeyProvider()
  keyProvider.useCache(true)

  const manager = new ProgramManager(process.env.ALEO_NODE_URL!, keyProvider, recordProvider)
  manager.setAccount(issuerAccount)

  const communityField = stringToField(communityId)

  const txId = await manager.execute({
    programName:  "zkpoll_vote2.aleo",
    functionName: "issue_credential",
    priorityFee:  0.03,
    privateFee:   false,
    inputs: [
      recipientAleoAddress,          // recipient: address
      `${communityField}field`,      // community_id: field
      `${credentialType}u8`,         // cred_type: u8
      `${votingWeight}u64`,          // voting_weight: u64  ← NEW
      `${expiryBlock}u32`,           // expiry: u32
      `${issuedAt}u32`,              // issued_at: u32
    ],
  })

  return txId
}

export async function getCurrentBlockHeight(): Promise<number> {
  const res  = await fetch(`${process.env.ALEO_NODE_URL}/${process.env.ALEO_NETWORK}/block/latest`)
  if (!res.ok) throw new Error(`Aleo RPC ${res.status}: /block/latest`)
  const data = await res.json() as any
  const height = data?.header?.metadata?.height
  if (typeof height !== 'number' || height <= 0) {
    throw new Error(`Invalid block height from RPC: ${JSON.stringify(height)}`)
  }
  return height
}

// Convert a community_id string (UUID or slug) to a stable field value.
// Uses a simple hash: sum of char codes mod field modulus (safe for IDs < 32 chars).
function stringToField(id: string): bigint {
  // Use the community_id directly if it's already numeric
  if (/^\d+$/.test(id)) return BigInt(id)
  // Otherwise hash the string to a field-safe number
  let h = 0n
  for (let i = 0; i < id.length; i++) {
    h = (h * 31n + BigInt(id.charCodeAt(i))) % FIELD_MODULUS
  }
  return h
}

const FIELD_MODULUS = 8444461749428370424248824938781546531375899335154063827935233455917409239041n
