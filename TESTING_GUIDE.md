# ZKPoll — End-to-End Testing Guide

**Live Demo:** https://zkpoll-aleo.vercel.app  
**Verifier API:** https://zkpoll-verifier.onrender.com  
**Contract:** [`zkpoll_v2_core.aleo`](https://testnet.explorer.provable.com/program/zkpoll_v2_core.aleo) on Aleo Testnet  
**Note:** The live demo backend runs on Render free tier — first request after idle may take 30–60s to wake up. For instant response, run locally using this guide.

---

## Quick Start — Testing on the Live Demo (Vercel + Render)

The deployed site at **https://zkpoll-three.vercel.app** is fully functional for:

| Feature | Works on Live Demo |
|---|---|
| Create Community | ✅ |
| Credential Issuance (all requirement types) | ✅ |
| Create Poll | ✅ |
| Cast Vote | ✅ |
| Browse Communities & Polls | ✅ |
| View Results (after tally) | ✅ |
| **Tally / Snapshot publishing** | ⚠️ Slow — test locally |

**Why tally is slow on the live demo:** The tally engine uses `@provablehq/sdk` WASM to generate ZK proofs for `create_scoped_snapshot`. On Render's free tier (0.1 CPU), this takes 10–30 minutes. On a local machine it takes 2–5 minutes.

### To test tally on the live demo:
All OAuth API keys (GitHub, Discord, Twitter, Telegram) and the operator keypair are already configured on the Render backend. You don't need to set up anything.

1. Use the live demo for everything up to voting
2. For the tally step, **run it locally** pointing at the live community data:

```bash
# Trigger tally against the live verifier
curl -X POST https://zkpoll-verifier.onrender.com/operator/tally/<pollId> \
  -H "Content-Type: application/json" \
  -d '{"communityId": "<communityId>", "force": true}'
```

Or run the full local setup below and use `FREE` credential type — no API keys needed, no OAuth setup, instant credential issuance.

### Important: Operator Address

Each poll is locked to the operator address set at creation time. `OperatorVote` records are encrypted to that address — only the matching view key can decrypt them for tallying.

**To test the full tally flow with your own operator:**
1. Generate a keypair: `leo account new`
2. Set `OPERATOR_ADDRESS` in `frontend/.env` and `OPERATOR_PRIVATE_KEY` + `OPERATOR_VIEW_KEY` in `verifier/.env`
3. Create a **new community + poll** — this registers your operator on-chain
4. Vote, then run force tally

You cannot tally polls created with a different operator (e.g. the pre-existing `provablehq` community on the live demo).

---

## Full Local Setup (Recommended for Tally Testing)

| Tool | Version | Install |
|---|---|---|
| Node.js | 18+ | https://nodejs.org |
| Leo CLI | 4.x | `curl -L https://raw.githubusercontent.com/ProvableHQ/leo/main/install.sh \| sh` |
| Shield Wallet | Latest | https://shield.aleo.org (browser extension) |
| Git | Any | https://git-scm.com |

---

## 1. Clone & Setup

```bash
git clone https://github.com/<your-repo>/zkpoll
cd zkpoll/zkpoll
```

---

## 2. Verifier Backend

> **Fastest path for local testing:** Use `FREE` requirement type when creating a community — no OAuth keys, no EVM wallet, no GitHub needed. Any connected Aleo wallet gets a credential instantly. All social/EVM connector API keys are already live on the Render deployment if you want to test those on the live demo instead.

```bash
cd verifier
cp .env.example .env
```

Edit `.env` with the following minimum config:

```env
ALEO_NODE_URL=https://api.explorer.provable.com/v1
ALEO_NETWORK=testnet
ALEO_API_V2_URL=https://api.provable.com/v2

# Operator keypair — generate a fresh one with: leo account new
# This is YOUR local operator — independent from the live demo's operator.
# Any keypair works; just make sure OPERATOR_ADDRESS matches the private/view key.
OPERATOR_PRIVATE_KEY=<your_operator_private_key>
OPERATOR_VIEW_KEY=<your_operator_view_key>
OPERATOR_ADDRESS=<your_operator_address>

# Same keypair used as issuer for simplicity
ALEO_ISSUER_PRIVATE_KEY=<your_operator_private_key>

# Alchemy — for EVM token/NFT checks (get free key at alchemy.com)
ALCHEMY_API_KEY=<your_alchemy_key>

# Pinata IPFS — optional but recommended for production
# Communities and polls are pinned to IPFS and restored automatically on startup
# PINATA_GATEWAY: subdomain only, e.g. "beige-quiet-bear-123" (NOT the full domain)
PINATA_JWT=<your_pinata_jwt>
PINATA_GATEWAY=<your_gateway_subdomain>

APP_URL=http://localhost:5173
PORT=3001
```

> **Quick start:** Use `FREE` requirement type when creating a community — no OAuth keys needed. 

```bash
npm install
npm run dev
```

Verify:
```bash
curl http://localhost:3001/health
# → {"status":"ok","service":"zkpoll-verifier"}
```

---

## 3. Frontend

```bash
cd ../frontend
```

Create `.env`:
```env
VITE_ALEO_NODE_URL=https://api.explorer.provable.com/v1
VITE_ALEO_NETWORK=testnet
VITE_VERIFIER_URL=http://localhost:3001
VITE_OPERATOR_ADDRESS=<your_operator_address>
```

```bash
npm install
npm run dev
```

Frontend runs at `http://localhost:5173`.

---

## 4. Wallet Setup

1. Install [Shield Wallet](https://shield.aleo.org) browser extension
2. Create or import an Aleo testnet account
3. Fund with testnet credits: https://faucet.aleo.org (need ~0.1 ALEO)
4. Connect wallet at `http://localhost:5173`

---

## 5. Full E2E Test Flow

### Step 1 — Create a Community

1. Go to **Communities → New Community**
2. Fill in name and description
3. Select **Credential Type:**
   - **Open (Type 1)** — anyone with an Aleo wallet gets a credential. No requirements. Best for quick testing.
   - **Gated (Type 2)** — 1 requirement group, up to 3 requirements (e.g. hold a token OR follow on X)
   - **Multi-gate (Type 3)** — unlimited groups and requirements (full Guild.xyz-style eligibility)
4. Poll type: **Flat**
5. Click **Create Community** → approve wallet transaction
6. Wait for on-chain confirmation (~30–60s)

### Step 2 — Get a Credential

1. Go to your community page
2. Click **Get Credential** → **Verify & Get Credential**
3. Approve the `issue_credential` wallet transaction
4. Wait for confirmation

**Requirement types and what you need to connect:**

| Requirement | What it checks | Setup needed |
|---|---|---|
| **FREE** | Always passes | Nothing — instant credential |
| **ALLOWLIST** | Your EVM address is in the list | Connect EVM wallet (MetaMask) + sign challenge |
| **TOKEN_BALANCE** | ERC-20 balance ≥ minimum | Connect EVM wallet + have tokens |
| **NFT_OWNERSHIP** | Owns an ERC-721 NFT | Connect EVM wallet + own the NFT |
| **ONCHAIN_ACTIVITY** | Sent ≥ N transactions | Connect EVM wallet |
| **DOMAIN_OWNERSHIP** | Owns an ENS domain | Connect EVM wallet + own ENS |
| **X_FOLLOW** | Follows a Twitter handle | Connect X/Twitter via OAuth popup |
| **DISCORD_MEMBER** | Member of a Discord server | Connect Discord via OAuth popup |
| **DISCORD_ROLE** | Has a specific Discord role | Connect Discord via OAuth popup |
| **GITHUB_ACCOUNT** | Repos / followers / org / starred repo / commits | Connect GitHub via OAuth popup |
| **TELEGRAM_MEMBER** *(Beta)* | Member of a Telegram channel | Connect Telegram + **add @zkpollbot as admin to your channel** |

**Supported EVM chains:** `ethereum`, `base`, `optimism`, `arbitrum`, `ethereum-sepolia`, `base-sepolia`, `arbitrum-sepolia`, `optimism-sepolia`

> **Tip for testing:** Use `FREE` (Open tier) or `ALLOWLIST` with your own address — no tokens or OAuth needed.

### Step 3 — Create a Poll

1. Go to **Communities → [Your Community] → Create Poll**
2. Add title + 2–8 options
3. Set duration (minimum 1 day)
4. Click **Deploy** → approve wallet transaction

### Step 4 — Vote

1. Go to the poll page → **Vote** tab
2. Click options to rank them (1 = top choice)
3. Click **Submit Vote** → approve wallet transaction

### Step 5 — Trigger Tally (No need to wait for poll to end)

```bash
curl -X POST http://localhost:3001/operator/tally/<pollId> \
  -H "Content-Type: application/json" \
  -d '{"communityId": "<communityId>", "force": true}'
```

Get `<pollId>` from the poll URL: `/communities/<communityId>/polls/<pollId>`

Expected response:
```json
{
  "tallies": [{"total_votes": 1, "rank_1_option": 3, "rank_2_option": 1, ...}],
  "txIds": ["at1..."]
}
```

### Step 6 — View Results

1. Go to **Poll → Results**
2. Results show ranked options with MDCT decay scores
3. Click the snapshot transaction link to verify on-chain

---

## 6. Useful Curl Commands

```bash
# Health check
curl http://localhost:3001/health

# List communities
curl http://localhost:3001/communities

# Check vote count
curl http://localhost:3001/polls/<pollId>/vote-count

# Preview tally (no publish)
curl -X POST http://localhost:3001/operator/tally/<pollId> \
  -H "Content-Type: application/json" \
  -d '{"communityId": "<communityId>", "force": false}'

# Force publish tally
curl -X POST http://localhost:3001/operator/tally/<pollId> \
  -H "Content-Type: application/json" \
  -d '{"communityId": "<communityId>", "force": true}'

# Register a vote tx manually (if tally shows 0 votes)
curl -X POST http://localhost:3001/polls/<pollId>/vote-tx \
  -H "Content-Type: application/json" \
  -d '{"txId": "at1...", "communityId": "<communityId>"}'
```

---

## 7. Contract Reference

**Program:** `zkpoll_v2_core.aleo` — [View on Explorer](https://testnet.explorer.provable.com/program/zkpoll_v2_core.aleo)

| Transition | Caller | Purpose |
|---|---|---|
| `register_community` | Community creator | Register community on-chain |
| `create_poll` | Community creator | Create a poll (only owner can) |
| `issue_credential` | Voter | Mint private ZK credential |
| `cast_vote` | Voter | Submit private ranked ballot |
| `create_scoped_snapshot` | Operator | Publish tally results per parent scope |

**Privacy model:**
- Rankings are **ZK private witnesses** — never in public calldata
- `OperatorVote` encrypted to operator — only tally service decrypts
- "Who voted" is public, "how they voted" is private

---

## 8. Architecture

```
Browser (React + Shield Wallet)
    │
    ├── zkpoll_v2_core.aleo (Aleo Testnet)
    │       cast_vote → Vote record (voter) + OperatorVote record (operator)
    │
    └── Verifier (Node.js)
            ├── Requirement checks (GitHub, Discord, EVM, etc.)
            ├── Credential params → user wallet calls issue_credential
            └── Tally Runner
                    ├── Provable v2 API → find cast_vote txs by operator address
                    ├── SDK decrypt → OperatorVote records
                    ├── MDCT scoring → weighted ranked results
                    └── create_scoped_snapshot → publish on-chain
```

---

## 9. Troubleshooting

| Issue | Fix |
|---|---|
| Render backend slow | Use local setup — first request wakes the instance |
| `No credential found` | Wait 1–2 min for wallet indexing, retry |
| `Already voted` | Nullifier enforced on-chain — one vote per address per poll |
| `Transaction rejected` | Ensure you are the community creator for poll creation |
| Tally shows 0 votes | Register tx IDs manually via `/polls/:pollId/vote-tx` curl |
| Results not showing | Run force tally, then refresh results page |

---

## 10. Known Limitations

- **Render cold start:** Live demo sleeps after 15 min idle. Local setup recommended for judging.
- **Tally time:** Snapshot proof generation takes 2–5 min. Use `force: true` curl to skip waiting.
- **Wallet indexing:** Credential/vote records take 1–2 min to appear in wallet after confirmation.
- **Block time:** ~2.5s/block on testnet. Transactions confirm in ~30–60s.
