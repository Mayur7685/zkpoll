# ZKPoll — Privacy-Preserving Ranked Voting on Aleo

ZKPoll is a decentralised governance platform built on Aleo that enables communities to run **ranked-choice polls with private ballots**. Voters prove community membership with a zero-knowledge credential without revealing which options they chose. Results are tallied automatically by an operator service using encrypted vote copies.

---

## Live Deployment

| Item | Value |
|------|-------|
| **Contract** | `zkpoll_core.aleo` |
| **Network** | Aleo Testnet |
| **Deploy tx** | `at1ywsyq84d0zshjkc6py34skxgkmexqkhp0xk29nmy5upgr2hpguxq9qkx2c` |
| **Explorer** | https://explorer.provable.com/transaction/at1ywsyq84d0zshjkc6py34skxgkmexqkhp0xk29nmy5upgr2hpguxq9qkx2c |

---

## How It Works

### Privacy model

| What | Visibility |
|------|-----------|
| Who voted (voter address) | Public — `self.caller` in `cast_vote` |
| Which options were ranked | **Private** — encrypted in Vote record, only voter's view key decrypts |
| Credential details (social accounts, token balance) | **Never on-chain** — checked off-chain by verifier |
| Final tally result | Public — published as a `Snapshot` mapping entry |

### Vote flow

```
Voter                     Verifier (server)             zkpoll_core.aleo
  │                              │                              │
  │── meets requirements? ──────>│                              │
  │<── credential params ────────│                              │
  │                              │                              │
  │── issue_credential ─────────────────────────────────────>  │
  │<── Credential record (private, owner = voter) ────────────  │
  │                              │                              │
  │── cast_vote ────────────────────────────────────────────>  │
  │      (credential + rankings as private ZK witnesses)        │
  │<── Vote record (private, owner = voter)  ─────────────────  │
  │<── OperatorVote record (private, owner = operator) ────────  │
  │                              │                              │
  │                    Operator service                         │
  │                    decrypts OperatorVote                    │
  │                    computes MDCT tally                      │
  │                    ── create_snapshot ──────────────────>  │
  │                                                 Snapshot    │
  │                                                 in mapping  │
```

### MDCT Weighted Tally

Scores are computed using **MetaPoll Decay-Weighted Condorcet Tally**:

```
score(option) = Σ voting_weight × (1 / rank_position)
```

- Rank 1 = full weight (1.0×)
- Rank 2 = half weight (0.5×)
- Rank 3 = one-third (0.33×) … and so on
- `voting_weight` comes from the credential (computed by verifier based on requirements passed)

Options are sorted by total score descending. The option with the highest score is the winner.

---

## Architecture

```
zkpoll/
├── zkpoll_core/          Leo contract (single consolidated program)
│   ├── src/main.leo
│   └── program.json
│
├── frontend/             React + Vite + Tailwind
│   └── src/
│       ├── pages/        PollDetail, PollResults, CommunityDetail…
│       ├── components/   CreateCommunityWizard, CreatePollWizard…
│       ├── hooks/        useVoting, useAleoWallet, useCredentialHub…
│       └── lib/          aleo.ts (RPC), verifier.ts (API client)
│
└── verifier/             Node.js + Express (off-chain service)
    └── src/
        ├── index.ts      REST API server
        ├── evaluator.ts  Requirement checking logic
        ├── issuer.ts     On-chain tx helpers (issue_credential)
        ├── tally.ts      OperatorVote decryption + MDCT computation
        ├── tally-runner.ts  Background auto-tally service
        ├── checkers/     Per-requirement checkers (GitHub, Discord…)
        └── communities/  JSON config store (one file per community)
```

### Contract — `zkpoll_core.aleo`

Single Leo program covering all functionality:

| Transition | Caller | Purpose |
|-----------|--------|---------|
| `register_community` | Community creator (wallet) | Register community on-chain, creator = self.caller |
| `update_community` | Community creator | Update IPFS config hash |
| `deactivate_community` | Community creator | Disable community |
| `create_poll` | Community creator (wallet) | Create poll gated to their community |
| `add_option` | Poll creator | Add option to poll (on-chain metadata) |
| `close_poll` | Poll creator | Close poll early |
| `issue_credential` | Verifier service | Issue private Credential record to eligible voter |
| `cast_vote` | Voter (wallet) | Cast ranked vote — dual output (Vote + OperatorVote) |
| `create_snapshot` | Operator service | Publish MDCT tally result on-chain |

**Mappings:**

| Mapping | Key | Value |
|---------|-----|-------|
| `communities` | `field` (community_id) | `CommunityMeta` |
| `polls` | `field` (poll_id) | `PollMeta` |
| `poll_options` | `field` (hash of poll+option) | `PollOption` |
| `used_nullifiers` | `field` (nullifier) | `bool` |
| `poll_vote_count` | `field` (poll_id) | `u32` |
| `credential_count` | `field` (community_id) | `u32` |
| `snapshots` | `u32` (snapshot_id) | `Snapshot` |
| `latest_snapshot` | `field` (poll_id) | `u32` (snapshot_id) |

### Verifier Service

Off-chain Node.js server that:
- Stores community configs (requirements, poll metadata, options) as JSON + IPFS
- Evaluates requirements against connected accounts (EVM wallets, Twitter, Discord, GitHub, Telegram)
- Returns credential params for the user's wallet to call `issue_credential`
- Runs the **automated tally runner** — decrypts `OperatorVote` records using operator view key, computes MDCT, calls `create_snapshot`

### Frontend

React SPA that:
- Connects to Leo / Puzzle / Shield wallets via the Aleo wallet adapter
- Calls verifier for requirement verification and credential params
- Submits `issue_credential`, `cast_vote`, `register_community`, `create_poll` transactions from the user's wallet
- Reads on-chain state (vote counts, snapshots) via Aleo RPC
- Displays ranked results with real option labels

---

## Supported Requirement Types

| Type | What it checks |
|------|---------------|
| `FREE` | Always passes — open to everyone |
| `ALLOWLIST` | Wallet address in a hardcoded list |
| `TOKEN_BALANCE` | ERC-20 balance on EVM chain ≥ minAmount |
| `NFT_OWNERSHIP` | Holds NFT from a contract |
| `ONCHAIN_ACTIVITY` | Min transaction count on EVM chain |
| `DOMAIN_OWNERSHIP` | ENS / Unstoppable domain owner |
| `X_FOLLOW` | Follows a Twitter/X account |
| `DISCORD_MEMBER` | Member of a Discord server |
| `DISCORD_ROLE` | Has a specific role in a Discord server |
| `GITHUB_ACCOUNT` | GitHub account with min repos / followers / org / commits / starred repo |
| `TELEGRAM_MEMBER` | Member of a Telegram group/channel |

Multiple requirements can be combined with AND / OR logic within groups.

---

## Setup

### Prerequisites

- Node.js 20+
- Leo 4.0.0 (`cargo install leo-lang`)
- An Aleo wallet (Leo / Puzzle / Shield)
- Testnet credits (from the Aleo faucet)

### 1. Install dependencies

```bash
cd zkpoll/frontend && npm install
cd ../verifier && npm install
```

### 2. Configure environment

**`verifier/.env`**
```env
ALEO_ISSUER_PRIVATE_KEY=APrivateKey1...   # verifier's signing key for issue_credential
ALEO_NODE_URL=https://api.explorer.provable.com/v1
ALEO_NETWORK=testnet

OPERATOR_PRIVATE_KEY=APrivateKey1...      # operator key — signs create_snapshot
OPERATOR_VIEW_KEY=AViewKey1...            # operator view key — decrypts OperatorVote records
OPERATOR_ADDRESS=aleo1...                 # operator public address

PINATA_JWT=...                            # optional — IPFS pinning for community configs
GITHUB_CLIENT_ID=...                      # optional — GitHub OAuth
GITHUB_CLIENT_SECRET=...
TWITTER_CLIENT_ID=...                     # optional — Twitter OAuth
TWITTER_CLIENT_SECRET=...
DISCORD_CLIENT_ID=...                     # optional — Discord OAuth
DISCORD_CLIENT_SECRET=...
TELEGRAM_BOT_TOKEN=...                    # optional — Telegram widget auth
TELEGRAM_BOT_USERNAME=...

APP_URL=http://localhost:5173
PORT=3001
```

**`frontend/.env`**
```env
VITE_ALEO_NODE_URL=https://api.explorer.provable.com/v1
VITE_ALEO_NETWORK=testnet
VITE_OPERATOR_ADDRESS=aleo1...            # same as OPERATOR_ADDRESS above
```

### 3. Run locally

```bash
# Terminal 1
cd zkpoll/verifier && npm run dev

# Terminal 2
cd zkpoll/frontend && npm run dev
```

Open `http://localhost:5173`

---

## Deploying the Contract

The contract is already deployed. To redeploy from source:

```bash
cd zkpoll/zkpoll_core

# Build
leo build

# Deploy (requires credits in .env PRIVATE_KEY account)
leo deploy --network testnet \
  --endpoint https://api.explorer.provable.com/v1 \
  --yes --broadcast
```

To generate a new operator keypair:

```bash
leo account new
# Copy Private Key → OPERATOR_PRIVATE_KEY
# Copy View Key   → OPERATOR_VIEW_KEY
# Copy Address    → OPERATOR_ADDRESS + VITE_OPERATOR_ADDRESS
```

---

## Operator & Tally Service

The tally runner starts automatically with the verifier (`startTallyRunner()` in `index.ts`).

**Automatic mode:** checks every 60 seconds — publishes snapshot when `block.height > poll.end_block`

**Force mode (for testing):**

```bash
curl -X POST http://localhost:3001/operator/tally/POLL_ID \
  -H "Content-Type: application/json" \
  -d '{"communityId": "your-community-id", "force": true}'
```

This bypasses the `end_block` check and publishes immediately. Use this during demos or testing so judges don't have to wait for the poll to naturally expire.

**What the tally service does:**
1. Scans all `cast_vote` transitions on `zkpoll_core.aleo`
2. For each `OperatorVote` output, attempts decryption with `OPERATOR_VIEW_KEY`
3. Parses rankings and `voting_weight` from decrypted plaintext
4. Computes MDCT scores: `score[optionId] += voting_weight × (1 / rank_position)`
5. Sorts by score descending → fills `rank_1_option` through `rank_8_option`
6. Calls `create_snapshot` on-chain using `OPERATOR_PRIVATE_KEY`

The operator account must hold testnet credits to pay the `create_snapshot` fee.

---

## API Reference (Verifier)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service health check |
| `GET` | `/communities` | List all communities |
| `GET` | `/communities/:id` | Get community config + polls |
| `POST` | `/communities` | Create community (saves config, pins to IPFS) |
| `POST` | `/communities/:id/polls` | Register poll metadata |
| `POST` | `/verify/check` | Check requirements, no on-chain action |
| `POST` | `/verify/credential-params` | Verify + return inputs for `issue_credential` |
| `POST` | `/verify` | Legacy: verify + issue credential via verifier wallet |
| `POST` | `/operator/tally/:pollId` | Trigger tally (preview or force publish) |
| `GET` | `/polls/:id/vote-count` | Read on-chain vote count |
| `GET` | `/auth/twitter` | Twitter OAuth flow |
| `GET` | `/auth/discord` | Discord OAuth flow |
| `GET` | `/auth/github` | GitHub OAuth flow |
| `GET` | `/auth/telegram` | Telegram widget page |

---

## On-Chain Verification

```bash
BASE="https://api.explorer.provable.com/v1/testnet"
PROGRAM="zkpoll_core.aleo"
POLL_ID="<numeric_field>"
COMMUNITY_ID="<numeric_field>"

# Poll metadata
curl "$BASE/program/$PROGRAM/mapping/polls/${POLL_ID}field"

# Vote count
curl "$BASE/program/$PROGRAM/mapping/poll_vote_count/${POLL_ID}field"

# Nullifier check (double-vote guard)
curl "$BASE/program/$PROGRAM/mapping/used_nullifiers/<NULLIFIER>field"

# Latest snapshot ID for a poll
curl "$BASE/program/$PROGRAM/mapping/latest_snapshot/${POLL_ID}field"

# Snapshot data (replace 1 with snapshot ID)
curl "$BASE/program/$PROGRAM/mapping/snapshots/1"

# Community on-chain record
curl "$BASE/program/$PROGRAM/mapping/communities/${COMMUNITY_ID}field"

# Transaction details
curl "$BASE/transaction/<TX_ID>"
```

---

## Privacy Guarantees

**What ZKPoll guarantees:**
- Rankings (`rank_1`–`rank_8`) are **never in plaintext on-chain** — they are ZK private witnesses in the proof, stored only in the encrypted Vote record
- Credential eligibility details (social follows, token balances) are **never submitted on-chain** — verified off-chain, used only to compute credential parameters
- Only the voter (with their view key) can read their own Vote record
- Only the operator (with the operator view key) can read OperatorVote records for tallying

**What is intentionally public:**
- Voter address — `self.caller` in `cast_vote` — "who voted" is public, mirroring real ballot rolls
- Nullifier — proves a vote was cast, does not reveal the ranking
- Final tally — published as a public on-chain snapshot

---

## Project Structure (Detailed)

```
frontend/src/
  pages/
    CommunityFeed.tsx       Browse all communities
    CommunityDetail.tsx     Community page + credential hub
    PollDetail.tsx          MDCT tree navigation + vote submission
    PollResults.tsx         Tally snapshot + personal vote history
    CredentialsHub.tsx      Manage credentials + connected accounts
    MyVotes.tsx             Vote history across all communities
    CreateCommunity.tsx     → CreateCommunityWizard
    CreatePoll.tsx          → CreatePollWizard

  components/
    CreateCommunityWizard.tsx   3-step: details → requirements → create
    CreatePollWizard.tsx        3-step: setup → options → deploy
    RequirementsPanel.tsx       Requirement check + credential issuance
    CredentialHub.tsx           Credential display + recast action
    ConnectorSelector.tsx       Connect EVM / Twitter / Discord / GitHub / Telegram

  hooks/
    useAleoWallet.ts         Wallet connection + record fetching
    useVoting.ts             castVote — credential resolution + tx submission
    useCredentialHub.ts      Credential state + VP% decay model
    useVoteHistory.ts        Read Vote records from wallet

  lib/
    aleo.ts                  Aleo RPC helpers (mapping reads, block height)
    verifier.ts              Verifier API client
    ranking.ts               rankingToSlots helper
    decay.ts                 VP% step-decay model (MetaPoll)

verifier/src/
  index.ts                   Express server + all routes
  evaluator.ts               Requirement group evaluation + voting weight
  issuer.ts                  On-chain tx helpers
  tally.ts                   OperatorVote decryption + MDCT tally + snapshot publish
  tally-runner.ts            Background 60s loop + manualTally endpoint
  communities.ts             JSON file store for community configs
  oauth.ts                   PKCE state + token store helpers
  pinata.ts                  IPFS pinning via Pinata
  checkers/
    evm.ts                   Token balance, NFT, on-chain activity, domain
    social_follow.ts         Twitter follow check + Telegram auth
    discord.ts               Server membership + role check
    github.ts                Repos, followers, org, commits, starred repo

zkpoll_core/
  src/main.leo               Single consolidated Leo contract
  program.json               Program metadata (leo 4.0.0)
  .env                       PRIVATE_KEY for deployment
```

---

## License

MIT
