import axios from "axios"

export async function checkOnchainActivity(
  walletAddress: string,
  alchemyApiKey: string,
  chain: string,
): Promise<boolean> {
  const url = chainToAlchemyUrl(chain, alchemyApiKey)
  const res = await axios.post(url, {
    jsonrpc: "2.0",
    method: "eth_getTransactionCount",
    params: [walletAddress, "latest"],
    id: 1,
  })
  return parseInt(res.data.result, 16) > 0
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
