import { ethers } from "ethers"

const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"]

export async function checkTokenBalance(
  walletAddress: string,
  tokenAddress: string,
  minAmount: string,
  rpcUrl: string,
): Promise<boolean> {
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider)
  const balance: bigint = await contract.balanceOf(walletAddress)
  return balance >= BigInt(minAmount)
}
