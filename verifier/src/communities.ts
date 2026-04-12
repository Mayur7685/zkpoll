import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { CommunityConfig } from "./types.js"
import { isPinataConfigured, listPinsByPrefix, fetchFromIPFS } from "./pinata.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const COMMUNITIES_DIR = path.join(__dirname, "..", "communities")

const configs: Map<string, CommunityConfig> = new Map()

export function loadCommunities(): void {
  if (!fs.existsSync(COMMUNITIES_DIR)) {
    fs.mkdirSync(COMMUNITIES_DIR, { recursive: true })
  }
  const files = fs.readdirSync(COMMUNITIES_DIR).filter(f => f.endsWith(".json"))
  for (const file of files) {
    const raw    = fs.readFileSync(path.join(COMMUNITIES_DIR, file), "utf-8")
    const config = JSON.parse(raw) as CommunityConfig
    configs.set(config.community_id, config)
  }
  console.log(`Loaded ${configs.size} community config(s)`)

  // Restore any communities pinned to IPFS that are missing locally (e.g. after redeploy)
  if (isPinataConfigured()) {
    void restoreFromIPFS()
  }
}

async function restoreFromIPFS(): Promise<void> {
  try {
    const pins = await listPinsByPrefix("community-")
    let restored = 0
    for (const pin of pins) {
      // pin.name is like "community-akindohq" — extract community_id
      const communityId = pin.name.replace(/^community-/, '')
      if (configs.has(communityId)) continue  // already loaded locally
      try {
        const config = await fetchFromIPFS<CommunityConfig>(pin.cid)
        if (!config.community_id) continue
        saveCommunityConfig(config)
        restored++
        console.log(`[restore] Restored community "${communityId}" from IPFS (${pin.cid})`)
      } catch (e: any) {
        console.warn(`[restore] Failed to restore "${communityId}": ${e.message}`)
      }
    }
    if (restored > 0) console.log(`[restore] Restored ${restored} community config(s) from IPFS`)
  } catch (e: any) {
    console.warn("[restore] IPFS restore failed (non-fatal):", e.message)
  }
}

export function getCommunityConfig(communityId: string): CommunityConfig | undefined {
  return configs.get(communityId)
}

export function getAllCommunities(): CommunityConfig[] {
  return Array.from(configs.values())
}

export function saveCommunityConfig(config: CommunityConfig): void {
  const filePath = path.join(COMMUNITIES_DIR, `${config.community_id}.json`)
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2))
  configs.set(config.community_id, config)
}
