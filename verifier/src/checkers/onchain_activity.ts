import axios from "axios"

/**
 * Check on-chain activity for an EVM wallet.
 * Uses eth_getTransactionCount (nonce) — works on any public RPC, no API key needed.
 *
 * `minTxCount` defaults to 1 (wallet has ever sent at least one transaction).
 * Community creators can set higher values to require more active wallets.
 */
export async function checkOnchainActivity(
  walletAddress: string,
  alchemyApiKey: string,
  chain: string,
  minTxCount = 1,
): Promise<boolean> {
  // Prefer public RPC — eth_getTransactionCount doesn't need an API key
  const url = alchemyApiKey
    ? chainToAlchemyUrl(chain, alchemyApiKey)
    : chainToPublicUrl(chain)

  const res = await axios.post(url, {
    jsonrpc: "2.0",
    method:  "eth_getTransactionCount",
    params:  [walletAddress, "latest"],
    id:      1,
  })
  const txCount = parseInt(res.data.result, 16)
  return txCount >= minTxCount
}

function chainToAlchemyUrl(chain: string, key: string): string {
  const map: Record<string, string> = {
    base:     `https://base-mainnet.g.alchemy.com/v2/${key}`,
    ethereum: `https://eth-mainnet.g.alchemy.com/v2/${key}`,
    optimism: `https://opt-mainnet.g.alchemy.com/v2/${key}`,
    arbitrum: `https://arb-mainnet.g.alchemy.com/v2/${key}`,
  }
  return map[chain] ?? map["ethereum"]
}

function chainToPublicUrl(chain: string): string {
  const map: Record<string, string> = {
    base:     "https://mainnet.base.org",
    ethereum: "https://eth.llamarpc.com",
    optimism: "https://mainnet.optimism.io",
    arbitrum: "https://arb1.arbitrum.io/rpc",
  }
  return map[chain] ?? map["ethereum"]
}
