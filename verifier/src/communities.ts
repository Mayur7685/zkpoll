import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { CommunityConfig } from "./types.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const COMMUNITIES_DIR = path.join(__dirname, "..", "communities")

// Load all community configs from the communities/ directory at startup.
const configs: Map<string, CommunityConfig> = new Map()

export function loadCommunities(): void {
  if (!fs.existsSync(COMMUNITIES_DIR)) {
    fs.mkdirSync(COMMUNITIES_DIR, { recursive: true })
    return
  }
  const files = fs.readdirSync(COMMUNITIES_DIR).filter(f => f.endsWith(".json"))
  for (const file of files) {
    const raw    = fs.readFileSync(path.join(COMMUNITIES_DIR, file), "utf-8")
    const config = JSON.parse(raw) as CommunityConfig
    configs.set(config.community_id, config)
  }
  console.log(`Loaded ${configs.size} community config(s)`)
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
