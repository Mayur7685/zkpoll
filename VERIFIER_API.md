# ZKPoll Verifier API Reference

The verifier is a Node.js/Express backend that handles off-chain requirement verification, community/poll registry, OAuth flows, and the automated tally engine. It runs alongside the Aleo smart contract and never holds user funds or private keys beyond the operator keypair.

**Base URL (local):** `http://localhost:3001`  
**Base URL (live):** `https://zkpoll-verifier.onrender.com`

---

## Table of Contents

1. [Health](#1-health)
2. [OAuth — Twitter/X](#2-oauth--twitterx)
3. [OAuth — Discord](#3-oauth--discord)
4. [OAuth — GitHub](#4-oauth--github)
5. [OAuth — Telegram](#5-oauth--telegram)
6. [EVM Wallet Verification](#6-evm-wallet-verification)
7. [Communities](#7-communities)
8. [Polls](#8-polls)
9. [Requirement Verification](#9-requirement-verification)
10. [Tally & Snapshots](#10-tally--snapshots)

---

## 1. Health

### `GET /health`

Returns service status. Use to verify the verifier is running.

**Response:**
```json
{ "status": "ok", "service": "zkpoll-verifier" }
```

---

## 2. OAuth — Twitter/X

Used for `X_FOLLOW` requirement type. Opens a popup OAuth flow.

### `GET /auth/twitter`

Redirects to Twitter OAuth 2.0 authorization page. Called by the frontend popup.

**Query params:** none  
**Env required:** `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`

**Flow:**
1. Frontend opens `GET /auth/twitter` in a popup window
2. User authorizes on Twitter
3. Twitter redirects to `/auth/twitter/callback`
4. Callback posts `{ userId, username }` to a `BroadcastChannel("zkpoll-twitter")`
5. Frontend receives the message and stores the connected account

---

### `GET /auth/twitter/callback`

OAuth callback — exchanges code for access token, fetches user profile, broadcasts result.

**Query params:** `code`, `state`, `error` (from Twitter)

**Success broadcast:**
```json
{ "status": "success", "userId": "123456", "username": "handle" }
```

**Error broadcast:**
```json
{ "status": "error", "message": "OAuth failed" }
```

---

## 3. OAuth — Discord

Used for `DISCORD_MEMBER` and `DISCORD_ROLE` requirement types.

### `GET /auth/discord`

Redirects to Discord OAuth authorization page.

**Env required:** `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`

---

### `GET /auth/discord/callback`

Exchanges code for token, fetches user profile, broadcasts to `BroadcastChannel("zkpoll-discord")`.

**Success broadcast:**
```json
{ "status": "success", "userId": "123456", "username": "user#1234" }
```

---

## 4. OAuth — GitHub

Used for `GITHUB_ACCOUNT` requirement type (repos, followers, org membership, starred repos, commits).

### `GET /auth/github`

Redirects to GitHub OAuth authorization page.

**Env required:** `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`

---

### `GET /auth/github/callback`

Exchanges code for token, fetches GitHub profile, broadcasts to `BroadcastChannel("zkpoll-github")`.

**Success broadcast:**
```json
{ "status": "success", "userId": "octocat", "username": "octocat" }
```

---

## 5. OAuth — Telegram

Used for `TELEGRAM_MEMBER` requirement type. Uses Telegram Login Widget (full-tab redirect, not popup).

### `GET /auth/telegram`

Returns an HTML page with the Telegram Login Widget button.

**Env required:** `TELEGRAM_BOT_USERNAME`

---

### `GET /auth/telegram/callback`

Verifies the Telegram auth hash (HMAC-SHA256 with bot token), broadcasts result.

**Query params:** Telegram auth data (`id`, `first_name`, `username`, `hash`, `auth_date`, etc.)

**Verification:** `HMAC-SHA256(data_check_string, SHA256(TELEGRAM_BOT_TOKEN))` — rejects if hash doesn't match or `auth_date` is >24h old.

**Success broadcast:**
```json
{ "status": "success", "userId": "123456789", "username": "telegramuser" }
```

---

## 6. EVM Wallet Verification

Proves the user controls an EVM address via `personal_sign`. Prevents anyone from claiming another wallet's token balance.

### `GET /auth/evm/challenge?address=0x...`

Generates a one-time challenge message for the given EVM address.

**Query params:**
- `address` — EVM address (0x-prefixed, 42 chars)

**Response:**
```json
{
  "challenge": "Sign this message to verify your EVM wallet for ZKPoll.\n\nAddress: 0x1234...\nNonce: abc123xyz"
}
```

**Notes:**
- Challenge expires after 5 minutes
- One challenge per address at a time
- Frontend passes this to `eth_personal_sign` via MetaMask

---

### `POST /auth/evm/verify`

Verifies the EIP-191 signature and confirms address ownership.

**Body:**
```json
{
  "address": "0x1234...",
  "challenge": "Sign this message...",
  "signature": "0xabc..."
}
```

**Response:**
```json
{ "verified": true }
```

**How it works:**
1. Looks up the stored challenge for the address
2. Checks challenge hasn't expired
3. Uses `ethers.verifyMessage(challenge, signature)` to recover the signer
4. Compares recovered address to claimed address (case-insensitive)
5. Deletes the challenge after successful verification (one-time use)

**Error responses:**
```json
{ "error": "Invalid or expired challenge" }
{ "error": "Challenge expired" }
{ "error": "Signature verification failed" }
```

---

## 7. Communities

Community configs are stored as JSON files in `verifier/communities/`. Each file is named `<community_id>.json`.

### `GET /communities`

Returns all registered communities.

**Response:**
```json
[
  {
    "community_id": "my-community",
    "name": "My Community",
    "description": "...",
    "logo": "https://...",
    "credential_type": 1,
    "credential_expiry_days": 30,
    "requirement_groups": [...],
    "polls": [...],
    "creator": "aleo1..."
  }
]
```

---

### `GET /communities/:id`

Returns a single community config by ID.

**Response:** Same as above (single object)  
**404** if community not found.

---

### `POST /communities`

Registers a new community. Called by the frontend after the `register_community` on-chain transaction confirms.

**Body:**
```json
{
  "community_id": "my-community",
  "name": "My Community",
  "description": "...",
  "logo": "https://...",
  "credential_type": 1,
  "credential_expiry_days": 30,
  "requirement_groups": [
    {
      "id": "uuid",
      "logic": "AND",
      "requirements": [
        { "id": "uuid", "type": "FREE", "params": {} }
      ]
    }
  ],
  "creator": "aleo1..."
}
```

**What it does:**
1. Saves config to `communities/<community_id>.json`
2. Pins config JSON to IPFS via Pinata (if configured)
3. Stamps `operator_address` from env onto the config

**Response:**
```json
{ "community_id": "my-community", "ipfs_cid": "bafkrei..." }
```

---

### `POST /communities/:id/polls`

Registers a poll under a community. Called after `create_poll` on-chain transaction confirms.

**Body:**
```json
{
  "poll_id": "12345field",
  "title": "What should we build next?",
  "description": "Optional context",
  "required_credential_type": 1,
  "created_at_block": 15714541,
  "end_block": 15749101,
  "poll_type": "flat",
  "options": [
    { "option_id": 1, "label": "Option A", "parent_option_id": 0, "child_count": 0 },
    { "option_id": 2, "label": "Option B", "parent_option_id": 0, "child_count": 0 }
  ]
}
```

**What it does:**
1. Stamps `operator_address` from env
2. Pins poll metadata to IPFS (if configured)
3. Appends poll to community's `polls` array
4. Saves updated community JSON

**Response:**
```json
{ "poll_id": "12345", "ipfs_cid": "bafkrei..." }
```

---

## 8. Polls

### `POST /polls/:pollId/vote-tx`

Registers a confirmed `cast_vote` transaction ID. The tally engine uses these to find `OperatorVote` records without scanning the entire blockchain.

**Body:**
```json
{ "txId": "at1...", "communityId": "my-community" }
```

**What it does:**
1. Finds the poll in the community config
2. Appends `txId` to `poll.vote_txids` (deduped)
3. Saves updated community JSON

**Called by:** Frontend automatically after each successful `cast_vote` confirmation.

**Response:**
```json
{ "ok": true }
```

---

### `GET /polls/:id/vote-count`

Returns the on-chain vote count for a poll by reading the `poll_vote_count` mapping from `zkpoll_v2_core.aleo`.

**Response:**
```json
{ "poll_id": "12345", "total_votes": 2 }
```

---

## 9. Requirement Verification

The verifier checks requirements off-chain before the user's wallet calls `issue_credential` on-chain. This ensures credentials are only issued to eligible users.

### Supported Requirement Types

| Type | What it checks | Connected account needed |
|---|---|---|
| `FREE` | Always passes | None |
| `ALLOWLIST` | Address in allowlist | EVM wallet |
| `TOKEN_BALANCE` | ERC-20 balance ≥ min | EVM wallet |
| `NFT_OWNERSHIP` | ERC-721 ownership | EVM wallet |
| `ONCHAIN_ACTIVITY` | Tx count ≥ min | EVM wallet |
| `DOMAIN_OWNERSHIP` | ENS domain ownership | EVM wallet |
| `X_FOLLOW` | Follows a Twitter handle | Twitter OAuth |
| `DISCORD_MEMBER` | Member of a Discord server | Discord OAuth |
| `DISCORD_ROLE` | Has a specific Discord role | Discord OAuth |
| `GITHUB_ACCOUNT` | Repos, followers, org, starred repo, commits | GitHub OAuth |
| `TELEGRAM_MEMBER` | Member of a Telegram channel | Telegram Login |

---

### `POST /verify/check`

Checks requirements without issuing a credential. Use to show requirement status in the UI.

**Body:**
```json
{
  "communityId": "my-community",
  "aleoAddress": "aleo1...",
  "connectedAccounts": [
    { "type": "EVM_WALLET", "identifier": "0x1234..." },
    { "type": "GITHUB", "identifier": "octocat" }
  ]
}
```

**Response:**
```json
{
  "passed": true,
  "results": [
    { "requirementId": "uuid", "passed": true },
    { "requirementId": "uuid2", "passed": false, "error": "Insufficient balance" }
  ]
}
```

**Logic:**
- Evaluates each `RequirementGroup` with its `AND`/`OR` logic
- A group passes if all (`AND`) or any (`OR`) requirements pass
- Overall `passed` = all groups pass

---

### `POST /verify/credential-params`

Verifies requirements server-side and returns the exact inputs the user's wallet needs to call `issue_credential` on `zkpoll_v2_core.aleo`.

**Body:** Same as `/verify/check`

**Response (passed):**
```json
{
  "passed": true,
  "results": [...],
  "credentialParams": {
    "recipient": "aleo1...",
    "communityId": "my-community",
    "credentialType": 1,
    "votingWeight": 15,
    "expiryBlock": 16079101,
    "issuedAt": 15714541
  }
}
```

**Response (failed):**
```json
{ "error": "Requirements not met", "results": [...] }
```

**How `votingWeight` is computed:**
Each passing requirement contributes its `vote_weight` param (or a default based on type). The total is the sum of all passing requirement weights. This becomes the voter's `EV` (Eligible Votes) used in MDCT scoring.

**How `expiryBlock` is computed:**
`currentBlock + (credential_expiry_days × 24 × 60 × 4)` — approximately `credential_expiry_days` days at ~4 blocks/minute on testnet.

**The user's wallet then calls:**
```
zkpoll_v2_core.aleo::issue_credential(
  recipient, communityId, credentialType, votingWeight, expiryBlock, issuedAt
)
```

---

### `POST /verify` (Legacy)

Checks requirements AND issues the credential via the verifier's own wallet (server-side issuance). Kept for backward compatibility.

**Body:** Same as `/verify/check`

**Response:**
```json
{ "passed": true, "results": [...], "txId": "at1..." }
```

**Note:** Prefer `/verify/credential-params` — it lets the user's wallet sign the transaction, which is more decentralized and doesn't require the verifier to hold ALEO credits.

---

## 10. Tally & Snapshots

### `POST /operator/tally/:pollId`

Manually triggers the tally computation for a poll. Can preview results or force-publish a snapshot on-chain.

**Body:**
```json
{ "communityId": "my-community", "force": true }
```

- `force: false` — compute and return tally without publishing (preview)
- `force: true` — compute, publish `create_scoped_snapshot` on-chain, write `scope_keys` to community JSON, re-pin to IPFS

**Response:**
```json
{
  "tallies": [
    {
      "poll_id": "12345...",
      "community_id": "67890...",
      "parent_option_id": 0,
      "block_height": 15731803,
      "total_votes": 2,
      "rank_1_option": 7,
      "rank_2_option": 8,
      "rank_3_option": 6,
      "rank_4_option": 2
    }
  ],
  "txIds": ["at1..."]
}
```

**How the tally engine works:**

1. **Find votes** — queries Provable v2 API (`GET /v2/testnet/transactions/address/{operatorAddress}`) to find all `cast_vote` transactions for `zkpoll_v2_core.aleo`. Falls back to stored `vote_txids` from community JSON.

2. **Fetch full transactions** — for each `cast_vote` tx, fetches the full transaction via `GET /v1/testnet/transaction/{txId}` and extracts `outputs[1].value` (the `OperatorVote` record ciphertext).

3. **Decrypt** — uses `OPERATOR_VIEW_KEY` to decrypt each `OperatorVote` record via `RecordCiphertext.isOwner()` + `RecordCiphertext.decrypt()` from `@provablehq/sdk`.

4. **Parse** — extracts `poll_id`, `rankings[r1..r8]`, `voting_weight`, `voter`, `nullifier` from the decrypted plaintext. Strips Leo visibility annotations (`.private`, `.public`) from field values.

5. **Filter** — keeps only records matching the requested `poll_id`.

6. **MDCT scoring** — for each parent scope (root = `parent_option_id: 0`):
   ```
   score(option) += voting_weight × (1 / rank_position)
   rank 1 = 1.0×, rank 2 = 0.5×, rank 3 = 0.33×, ...
   ```
   Options are sorted by score descending → top 4 become `rank_1..rank_4_option`.

7. **Publish** — calls `zkpoll_v2_core.aleo::create_scoped_snapshot` with the results. Proof generation takes 2–5 minutes.

8. **Resolve scope_key** — after confirmation, reads `snapshot_counter` mapping to get the `snapshot_id`, stores it as `scopeKey` in `poll.scope_keys`.

9. **Persist** — saves updated community JSON with `scope_keys` and re-pins to IPFS.

**The frontend then:**
- Reads `scope_keys` from community config
- Queries `scoped_snapshot_store[snapId]` mapping on-chain
- Displays ranked results

---

### Automated Tally Runner

The tally runner runs as a background process (started on server boot). Every 60 seconds it:

1. Gets current block height
2. For each active poll: checks if `block.height > end_block`
3. If poll has ended and no snapshot exists → runs full tally automatically
4. Skips polls that already have a snapshot (tracked in-memory + via `scope_keys`)

**To disable:** Remove `OPERATOR_PRIVATE_KEY` or `OPERATOR_VIEW_KEY` from `.env` — the runner logs a warning and exits.

---

## Error Codes

| HTTP | Meaning |
|---|---|
| 400 | Missing required fields or invalid input |
| 403 | Requirements not met |
| 404 | Community or poll not found |
| 500 | Internal error (Aleo RPC, IPFS, proof generation) |

All errors return:
```json
{ "error": "Human-readable message", "detail": "Optional technical detail" }
```
