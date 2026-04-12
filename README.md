# ZKPoll

Privacy-first ranked-choice voting on Aleo. Votes are zero-knowledge proofs — rankings are never in public calldata. Results are verifiable on-chain.


## How it works

```
User wallet  ──►  zkpoll_v2_core.aleo  ──►  OperatorVote (encrypted)
                                                    │
Verifier  ──►  issue_credential  ──►  Vote record   │
                                                    ▼
                                         Tally operator decrypts
                                         → create_scoped_snapshot
```

1. **Community creator** registers a community on-chain and defines membership requirements (token balance, NFT, Discord role, X follow, etc.)
2. **Voter** connects external accounts, verifier checks eligibility off-chain, voter's own wallet signs `issue_credential` — no server key involved
3. **Voter** casts a ranked ballot via `cast_vote` — rankings are private ZK witnesses, never in calldata
4. **Tally operator** decrypts `OperatorVote` records and publishes `create_scoped_snapshot` on-chain
5. Anyone can verify results by reading the on-chain snapshot mappings

## Features

### Communities
- Create a community with a name, description, logo, and credential type
- Define membership requirements with `AND`/`OR` group logic — mix token balance, NFT ownership, social follows, Discord roles, GitHub accounts, and more
- Each requirement type carries a configurable `vote_weight` — token holders can be given more votes than social followers
- Community metadata is optionally pinned to IPFS via Pinata for decentralised discoverability
- Only the community creator can create polls in their community — enforced both in the UI and at the verifier API

### Credentials
- Verifier checks requirements off-chain, then returns signed inputs
- The voter's own wallet calls `issue_credential` — a private `Vote` record is minted directly to their wallet
- No server-side signing key in the recommended flow
- Credentials have an on-chain expiry block — expired credentials cannot be used to vote
- The Credentials Hub page shows all communities, per-community eligibility status, and lets users claim or renew credentials

### Voting
- Ranked-choice ballot — voters drag/tap to rank options in order of preference
- Rankings are private ZK witnesses — never appear in public calldata or transaction inputs
- Double-vote prevention via on-chain nullifier mapping
- `cast_vote` is a single wallet transaction for flat polls
- After voting, the UI shows the voter's submitted rankings and links to the transaction on the explorer

### Voting power decay
Voting power decays over 5 periods (~90 days each at 5760 blocks/day) to incentivise active participation:

```
Period 1: 100% → Period 2: 50% → Period 3: 25% → Period 4: 12.5% → Period 5: 6.25% → deactivated
```

`CountedVotes (CV) = EligibleVotes (EV) × VotingPower% (VP)`

The UI shows a live EV / VP% / CV panel on the poll page and in My Votes. Voters can recast their ballot at any time with the same rankings to restore 100% VP.

### Tally & Results
- Background tally runner polls on-chain every 5 minutes for new `cast_vote` transactions
- Scores using MDCT (Modified Decay Condorcet Tally): `score(rank) = 1/rank`
- Operator publishes `create_scoped_snapshot` on-chain — one snapshot per parent option
- Results page reads snapshots directly from on-chain mappings — no trust in the verifier
- Manual tally trigger available via `POST /operator/tally/:pollId`

### My Votes
- Reads private `Vote` records directly from the connected wallet
- Shows EV / VP% / CV at the current block for each past vote
- Decay bar shows days until next VP halving
- Deactivated votes (VP = 0%) are highlighted in red

## Project structure

```
zkpoll/
├── zkpoll_v2_core/          # Leo smart contract (active)
│   └── src/main.leo         # register_community, create_poll, issue_credential,
│                            # cast_vote, create_scoped_snapshot
├── frontend/                # React + Vite UI
│   └── src/
│       ├── pages/           # PollFeed, CommunityFeed, CommunityDetail,
│       │                    # PollDetail, PollResults, CredentialsHub, MyVotes
│       ├── components/      # CreateCommunityWizard, CreatePollWizard,
│       │                    # CredentialHub, ConnectorSelector, VotingMode
│       ├── hooks/           # useAleoWallet, useVoting, useCredentialHub
│       └── lib/             # aleo.ts (RPC), verifier.ts (HTTP client), decay.ts
├── verifier/                # Node.js + Express off-chain service
│   └── src/
│       ├── index.ts         # REST API
│       ├── evaluator.ts     # requirement group evaluation
│       ├── tally.ts         # on-chain vote decryption + MDCT scoring
│       ├── tally-runner.ts  # background tally loop
│       ├── oauth.ts         # Twitter, Discord, GitHub, Telegram OAuth
│       ├── issuer.ts        # legacy server-side credential issuance
│       ├── pinata.ts        # IPFS pinning (optional)
│       └── checkers/        # per-requirement-type check implementations
└── communities/             # JSON store — one file per community + polls
```

Legacy Leo programs (`poll_create`, `vote_cast`, `credential_issue`, `snapshot_tally`, v2 variants, `vote_cast_v3`) are kept for reference. The active contract is `zkpoll_v2_core.aleo`.

---

## Real-world scenario

**A DAO wants to decide their Q3 budget allocation across 5 departments.**

1. **Alice (DAO admin)** opens ZKPoll, connects her Aleo wallet, and creates a community called "Acme DAO". She sets the membership requirement to "hold ≥ 100 ACME tokens on Ethereum". She clicks "Register" — her wallet signs `register_community` on Aleo testnet.

2. **Alice creates a poll** "Q3 Budget Allocation" with 5 options: Engineering, Marketing, Operations, Research, Community. She sets a 14-day voting window. Her wallet signs `create_poll`.

3. **Bob (a DAO member)** visits ZKPoll, finds Acme DAO, and clicks "Get Credential". He connects his MetaMask — the verifier checks his ACME balance off-chain. He passes. His own Aleo wallet signs `issue_credential` — a private `Vote` record lands in his wallet. The verifier never touched a signing key.

4. **Bob votes**. He ranks: 1. Engineering, 2. Research, 3. Community. He clicks Submit — his wallet signs `cast_vote`. His rankings are private ZK witnesses. The transaction shows his address publicly (he voted) but not what he voted.

5. **14 days later**, the tally operator's background service decrypts all `OperatorVote` records using the operator view key, scores them with MDCT decay, and publishes `create_scoped_snapshot` on-chain.

6. **Anyone** can visit the Results page and see the ranked outcome — verified directly from on-chain snapshot mappings. No trust in ZKPoll required.


---

## Prerequisites

- Node.js 18+
- An Aleo wallet (Leo Wallet, Puzzle, Fox, Shield, or Soter)
- Leo CLI (for contract deployment): `curl -sSf https://raw.githubusercontent.com/ProvableHQ/leo/mainline/install.sh | sh`

## Quick start

### 1. Deploy the contract (skip if using existing testnet deployment)

```bash
cd zkpoll_v2_core
cp .env.example .env   # set PRIVATE_KEY
leo deploy --network testnet
```

### 2. Verifier

```bash
cd verifier
cp .env.example .env
# Fill in: OPERATOR_PRIVATE_KEY, OPERATOR_VIEW_KEY, OPERATOR_ADDRESS
# Optional: ALCHEMY_API_KEY, TWITTER_*, DISCORD_*, GITHUB_*, TELEGRAM_*, PINATA_*
npm install
npm run dev
```

Runs on `http://localhost:3001`.

### 3. Frontend

```bash
cd frontend
cp .env.example .env
# Set VITE_OPERATOR_ADDRESS to match verifier's OPERATOR_ADDRESS
npm install
npm run dev
```

Runs on `http://localhost:5173`.

## Environment variables

### `frontend/.env`

| Variable | Description |
|---|---|
| `VITE_ALEO_NODE_URL` | Aleo node RPC URL (default: `https://api.explorer.provable.com/v1`) |
| `VITE_ALEO_NETWORK` | `testnet` or `mainnet` |
| `VITE_VERIFIER_URL` | Verifier backend URL (default: `http://localhost:3001`) |
| `VITE_OPERATOR_ADDRESS` | Tally operator public address — must match verifier's `OPERATOR_ADDRESS` |

### `verifier/.env`

| Variable | Required | Description |
|---|---|---|
| `OPERATOR_PRIVATE_KEY` | Yes | Operator keypair for tally decryption + snapshot publishing |
| `OPERATOR_VIEW_KEY` | Yes | Operator view key for decrypting `OperatorVote` records |
| `OPERATOR_ADDRESS` | Yes | Operator public address |
| `ALEO_ISSUER_PRIVATE_KEY` | Legacy | Only needed for `/verify` (legacy credential issuance) |
| `ALCHEMY_API_KEY` | EVM checks | Token balance, NFT, on-chain activity requirements |
| `TWITTER_BEARER_TOKEN` | X follow | Twitter API v2 bearer token |
| `TWITTER_CLIENT_ID/SECRET` | X OAuth | For X connect flow |
| `DISCORD_BOT_TOKEN` | Discord | Guild membership checks |
| `DISCORD_CLIENT_ID/SECRET` | Discord OAuth | For Discord connect flow |
| `GITHUB_CLIENT_ID/SECRET` | GitHub OAuth | For GitHub connect flow |
| `TELEGRAM_BOT_TOKEN` | Telegram | Widget auth verification |
| `TELEGRAM_BOT_USERNAME` | Telegram | Bot username (without @) |
| `PINATA_JWT` | Optional | IPFS pinning for community/poll metadata |
| `PINATA_GATEWAY` | Optional | Pinata gateway subdomain |
| `APP_URL` | OAuth | Frontend URL for OAuth callbacks (default: `http://localhost:5173`) |
| `PORT` | Optional | Verifier port (default: `3001`) |

## Requirement types

Communities can gate membership with any combination of:

| Type | What it checks |
|---|---|
| `FREE` | Open to everyone |
| `ALLOWLIST` | EVM address in a predefined list |
| `TOKEN_BALANCE` | ERC-20 balance ≥ threshold (via Alchemy) |
| `NFT_OWNERSHIP` | ERC-721/1155 ownership (via Alchemy) |
| `ONCHAIN_ACTIVITY` | Minimum tx count on EVM chain |
| `DOMAIN_OWNERSHIP` | ENS / domain ownership |
| `X_FOLLOW` | Follows a specific X/Twitter account |
| `DISCORD_MEMBER` | Member of a Discord server |
| `DISCORD_ROLE` | Holds a specific Discord role |
| `GITHUB_ACCOUNT` | Has a GitHub account |
| `TELEGRAM_MEMBER` | Member of a Telegram group |

Requirements are grouped with `AND`/`OR` logic. Each requirement type carries a configurable `vote_weight` that determines the voter's `EligibleVotes (EV)`.

## Voting power decay

Voting power decays over 5 periods (each ~90 days at 5760 blocks/day):

```
Period 1: 100%  →  Period 2: 50%  →  Period 3: 25%  →  Period 4: 12.5%  →  Period 5: 6.25%  →  deactivated
```

`CountedVotes (CV) = EligibleVotes × VotingPower%`

Voters can recast their ballot at any time to restore 100% voting power.

## Verifier API

Full API reference: [`VERIFIER_API.md`](./VERIFIER_API.md)

Key endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/communities` | List all communities |
| `POST` | `/communities` | Create community (called after on-chain `register_community`) |
| `POST` | `/communities/:id/polls` | Register poll metadata (called after on-chain `create_poll`) |
| `POST` | `/verify/check` | Check requirements, return pass/fail per requirement |
| `POST` | `/verify/credential-params` | Verify + return inputs for user's wallet to call `issue_credential` |
| `POST` | `/operator/tally/:pollId` | Manually trigger tally (preview or force publish snapshot) |
| `GET` | `/polls/:id/vote-count` | On-chain vote count for a poll |

## Poll types

- **Flat** — root options only, single `cast_vote` transaction
- **Hierarchical** *(experimental)* — root + sub-options up to depth 4, separate vote transaction per layer

## Tally

The tally runner polls on-chain every 5 minutes for new `cast_vote` transactions. It:
1. Fetches `OperatorVote` records encrypted to the operator address
2. Decrypts rankings using the operator view key
3. Scores using MDCT (Modified Decay Condorcet Tally) — `score(rank) = 1/rank`
4. Publishes `create_scoped_snapshot` on-chain per parent option when the poll closes

Manual tally trigger: `POST /operator/tally/:pollId` with `{ communityId, force: true }`.

## Deployment

### Frontend (Vercel)

```bash
cd frontend
npm run build
# deploy dist/ to Vercel — vercel.json already configures SPA rewrites
```

Set env vars in Vercel dashboard matching `frontend/.env.example`.

### Verifier (Render / Railway / VPS)

```bash
cd verifier
npm run build
npm start
```

Set env vars in your hosting dashboard. The `communities/` directory must be persistent (use a volume mount on Render/Railway).

## Contract functions

All in `zkpoll_v2_core.aleo`:

| Function | Caller | Description |
|---|---|---|
| `register_community` | Community creator | Register community on-chain with config hash |
| `create_poll` | Community creator | Create poll, lock operator address |
| `issue_credential` | Voter (after verifier check) | Mint private `Vote` credential to wallet |
| `cast_vote` | Voter | Submit ranked ballot (rankings are private) |
| `create_scoped_snapshot` | Operator | Publish tally result per parent option |

## Security notes

- Rankings are private ZK witnesses — never appear in public calldata or transaction inputs
- `self.caller` (voter address) is public by design — vote privacy is about *what* you voted, not *that* you voted
- Double-vote prevention via on-chain nullifier mapping (`poll_nullifiers`)
- Credential issuance uses the voter's own wallet — the verifier never holds a signing key in the recommended flow
- Poll creation is enforced creator-only both in the UI and at the verifier API level (`POST /communities/:id/polls` returns 403 for non-creators)

## Future enhancements

### Hierarchical polls (in beta)

The contract, tally engine, and UI all support hierarchical ranked-choice polls — polls where options have sub-options up to depth 4.

**Example:** A DAO votes on "Budget Allocation" with root options (Engineering, Marketing, Research) and sub-options under each (e.g. Engineering → Frontend, Backend, Infrastructure, Security).

**Current state:**
- `zkpoll_v2_core.aleo` supports `ScopedSnapshot` per parent option — one snapshot per node in the tree
- The tally engine scores each parent's children independently using MDCT
- The frontend wizard supports building option trees (up to 8 children per parent, depth 4)
- The poll detail page supports drilling into sub-options and casting sub-rankings as separate transactions
- The results page renders the full tree with expandable sub-option results

**Why it's restricted to beta:**

The ZK proof computation scales exponentially with the option tree size. A full tree of 8 root options × 8 children × 8 grandchildren × 8 great-grandchildren = 4,096 leaf options. Each `cast_vote` transaction generates a ZK proof over all private ranking inputs — at depth 4 with 8 children per node, proof generation time in the browser becomes impractical (minutes per transaction on consumer hardware).

The current `cast_vote` circuit has 8 rank slots (`r1`–`r8`). For hierarchical polls, each layer requires a separate `cast_vote` transaction — so a depth-4 poll with full trees requires up to 4 wallet signatures per voter.

**Path to production:**

- Reduce max children per parent from 8 to 4 — cuts proof size significantly
- Batch sub-layer rankings into a single transaction using recursive proofs (Leo 4.x)
- Move proof generation server-side with a trusted execution environment, or use WASM workers with streaming progress UI
- Add a "lazy ranking" mode — voters only rank layers they care about, skipping branches

### Other planned features

- **On-chain community config hash verification** — currently `config_hash` is stored in `CommunityMeta` but not verified against the off-chain JSON. A future version will pin the config to IPFS and verify the CID hash on-chain.
- **Delegated voting** — allow credential holders to delegate their CV to another address for a specific poll
- **Poll templates** — pre-built requirement group templates for common DAO setups (token-weighted, NFT-gated, open)
- **Multi-network EVM support** — currently Alchemy-based checks support Ethereum, Base, Optimism, Arbitrum; expanding to Polygon, Avalanche, and others
- **Credential renewal notifications** — push alerts (via wallet or email) when VP drops below a threshold
- **Mainnet deployment** — currently testnet only; mainnet deployment pending Aleo mainnet stability
