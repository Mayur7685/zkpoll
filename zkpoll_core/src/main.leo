// ─── zkpoll_core.aleo ────────────────────────────────────────────────────────
//
// Single consolidated contract covering:
//   1. Community registry   — on-chain creator ownership, config hash anchor
//   2. Poll management      — gated by community creator, operator address per poll
//   3. Credential issuance  — private record issued by verifier after off-chain checks
//   4. Vote casting         — dual output: voter gets Vote record, operator gets OperatorVote
//   5. Snapshot publication — only the poll's registered operator can publish results
//
// Privacy model:
//   - Vote rankings are NEVER in public calldata (private ZK witnesses)
//   - OperatorVote is encrypted to operator address for automated tally decryption
//   - Voter address (self.caller) is public by design — "who voted" is public,
//     "how they voted" is private
// ─────────────────────────────────────────────────────────────────────────────

struct CommunityMeta {
    creator:     address,
    config_hash: field,
    active:      bool,
}

struct PollMeta {
    creator:                  address,
    community_id:             field,
    operator:                 address,
    required_credential_type: u8,
    created_at:               u32,
    end_block:                u32,
    active:                   bool,
}

struct PollOption {
    poll_id:          field,
    option_id:        u8,
    parent_option_id: u8,
    child_count:      u8,
}

struct Snapshot {
    snapshot_id:   u32,
    poll_id:       field,
    community_id:  field,
    block_height:  u32,
    total_votes:   u32,
    rank_1_option: u8,
    rank_2_option: u8,
    rank_3_option: u8,
    rank_4_option: u8,
    rank_5_option: u8,
    rank_6_option: u8,
    rank_7_option: u8,
    rank_8_option: u8,
}

program zkpoll_core.aleo {

    @noupgrade
    constructor() {}

    // ── Records ───────────────────────────────────────────────────────────────

    // Private credential — issued after off-chain requirement verification.
    // Consumed by cast_vote to prove community membership.
    record Credential {
        owner:           address,
        issuer:          address,
        community_id:    field,
        credential_type: u8,
        voting_weight:   u64,   // eligible votes (EV) computed by verifier
        expiry_block:    u32,
        issued_at:       u32,
    }

    // Private ballot — owned by voter.
    // Rankings are private ZK witnesses — never appear in public calldata.
    record Vote {
        owner:        address,
        poll_id:      field,
        community_id: field,
        rank_1:       u8,
        rank_2:       u8,
        rank_3:       u8,
        rank_4:       u8,
        rank_5:       u8,
        rank_6:       u8,
        rank_7:       u8,
        rank_8:       u8,
        cast_at:      u32,
        nullifier:    field,
    }

    // Operator copy — encrypted to operator address.
    // Decrypted by the tally service using the operator view key.
    // Also contains voting_weight for weighted MDCT scoring.
    record OperatorVote {
        owner:         address,   // operator address
        poll_id:       field,
        community_id:  field,
        voter:         address,   // self.caller — already public on-chain
        rank_1:        u8,
        rank_2:        u8,
        rank_3:        u8,
        rank_4:        u8,
        rank_5:        u8,
        rank_6:        u8,
        rank_7:        u8,
        rank_8:        u8,
        cast_at:       u32,
        nullifier:     field,
        voting_weight: u64,
    }

    // ── Mappings ──────────────────────────────────────────────────────────────

    mapping communities:      field => CommunityMeta;
    mapping polls:            field => PollMeta;
    mapping poll_options:     field => PollOption;
    mapping credential_count: field => u32;
    mapping used_nullifiers:  field => bool;
    mapping poll_vote_count:  field => u32;
    mapping snapshots:        u32   => Snapshot;
    mapping latest_snapshot:  field => u32;
    mapping snapshot_counter: bool  => u32;

    // ── 1. Community Registry ─────────────────────────────────────────────────

    // Anyone can register a community — creator = self.caller.
    // config_hash anchors the full community config stored on IPFS (Pinata).
    fn register_community(
        public community_id: field,
        public config_hash:  field,
    ) -> Final {
        let creator: address = self.caller;
        return final {
            let exists: bool = communities.contains(community_id);
            assert_eq(exists, false);
            communities.set(community_id, CommunityMeta {
                creator:     creator,
                config_hash: config_hash,
                active:      true,
            });
        };
    }

    // Only the original creator can update the config hash.
    fn update_community(
        public community_id: field,
        public config_hash:  field,
    ) -> Final {
        let caller: address = self.caller;
        return final {
            let meta: CommunityMeta = communities.get(community_id);
            assert_eq(meta.creator, caller);
            communities.set(community_id, CommunityMeta {
                creator:     meta.creator,
                config_hash: config_hash,
                active:      meta.active,
            });
        };
    }

    // Deactivate — only creator. Prevents new polls being created.
    fn deactivate_community(public community_id: field) -> Final {
        let caller: address = self.caller;
        return final {
            let meta: CommunityMeta = communities.get(community_id);
            assert_eq(meta.creator, caller);
            communities.set(community_id, CommunityMeta {
                creator:     meta.creator,
                config_hash: meta.config_hash,
                active:      false,
            });
        };
    }

    // ── 2. Poll Management ────────────────────────────────────────────────────

    // Only the community creator can create polls for their community.
    // operator: address of the tally service keypair that will publish snapshots.
    fn create_poll(
        public poll_id:            field,
        public community_id:       field,
        public required_cred_type: u8,
        public created_at:         u32,
        public end_block:          u32,
        public operator:           address,
    ) -> Final {
        let creator: address = self.caller;
        return final {
            let community: CommunityMeta = communities.get(community_id);
            assert_eq(community.creator, creator);
            assert(community.active);

            let exists: bool = polls.contains(poll_id);
            assert_eq(exists, false);
            assert(end_block > created_at);

            polls.set(poll_id, PollMeta {
                creator:                  creator,
                community_id:             community_id,
                operator:                 operator,
                required_credential_type: required_cred_type,
                created_at:               created_at,
                end_block:                end_block,
                active:                   true,
            });
            poll_vote_count.set(poll_id, 0u32);
        };
    }

    // Only the poll creator can add options.
    fn add_option(
        public poll_id:     field,
        public option_id:   u8,
        public parent_id:   u8,
        public child_count: u8,
    ) -> Final {
        let caller: address = self.caller;
        return final {
            let poll: PollMeta = polls.get(poll_id);
            assert_eq(poll.creator, caller);
            let key: field = BHP256::hash_to_field(poll_id * 256field + option_id as field);
            poll_options.set(key, PollOption {
                poll_id:          poll_id,
                option_id:        option_id,
                parent_option_id: parent_id,
                child_count:      child_count,
            });
        };
    }

    // Only the poll creator can close a poll early.
    fn close_poll(public poll_id: field) -> Final {
        let caller: address = self.caller;
        return final {
            let poll: PollMeta = polls.get(poll_id);
            assert_eq(poll.creator, caller);
            polls.set(poll_id, PollMeta {
                creator:                  poll.creator,
                community_id:             poll.community_id,
                operator:                 poll.operator,
                required_credential_type: poll.required_credential_type,
                created_at:               poll.created_at,
                end_block:                poll.end_block,
                active:                   false,
            });
        };
    }

    // ── 3. Credential Issuance ────────────────────────────────────────────────

    // Called by the verifier service after all community requirements pass.
    // self.caller = issuer address (visible on-chain — expected).
    fn issue_credential(
        public recipient:     address,
        public community_id:  field,
        public cred_type:     u8,
        public voting_weight: u64,
        public expiry:        u32,
        public issued_at:     u32,
    ) -> (Credential, Final) {
        let cred: Credential = Credential {
            owner:           recipient,
            issuer:          self.caller,
            community_id:    community_id,
            credential_type: cred_type,
            voting_weight:   voting_weight,
            expiry_block:    expiry,
            issued_at:       issued_at,
        };
        return (cred, final {
            let count: u32 = credential_count.get_or_use(community_id, 0u32);
            credential_count.set(community_id, count + 1u32);
        });
    }

    // ── 4. Vote Casting ───────────────────────────────────────────────────────

    // Dual output:
    //   Vote        → owned by voter    (private ballot, voter decrypts)
    //   OperatorVote → owned by operator (tally service decrypts for MDCT)
    //
    // operator must be passed as public input so the OperatorVote record can be
    // created for the correct owner. Finalize verifies it matches poll.operator.
    fn cast_vote(
        cred:               Credential,   // private — credential record
        public poll_id:     field,        // public — finalize lookup
        community_id:       field,        // private — ZK only
        required_cred_type: u8,           // private — ZK only
        public nullifier:   field,        // public — double-vote guard
        cast_at:            u32,          // private — ZK only
        public operator:    address,      // public — OperatorVote owner
        r1: u8, r2: u8, r3: u8, r4: u8,  // private — ZK only (ballot)
        r5: u8, r6: u8, r7: u8, r8: u8,  // private — ZK only (ballot)
    ) -> (Vote, OperatorVote, Final) {
        assert_eq(cred.community_id,    community_id);
        assert(cred.credential_type    >= required_cred_type);
        assert(cred.expiry_block       >  cast_at);
        assert_eq(cred.owner, self.caller);

        let vote: Vote = Vote {
            owner:        self.caller,
            poll_id:      poll_id,
            community_id: community_id,
            rank_1: r1, rank_2: r2, rank_3: r3, rank_4: r4,
            rank_5: r5, rank_6: r6, rank_7: r7, rank_8: r8,
            cast_at:      cast_at,
            nullifier:    nullifier,
        };

        let op_vote: OperatorVote = OperatorVote {
            owner:         operator,
            poll_id:       poll_id,
            community_id:  community_id,
            voter:         self.caller,
            rank_1: r1, rank_2: r2, rank_3: r3, rank_4: r4,
            rank_5: r5, rank_6: r6, rank_7: r7, rank_8: r8,
            cast_at:       cast_at,
            nullifier:     nullifier,
            voting_weight: cred.voting_weight,
        };

        return (vote, op_vote, final {
            let poll: PollMeta = polls.get(poll_id);
            assert(poll.active);
            assert(block.height <= poll.end_block);
            // Verify the operator passed by the caller matches the registered one
            assert_eq(poll.operator, operator);

            let used: bool = used_nullifiers.get_or_use(nullifier, false);
            assert_eq(used, false);
            used_nullifiers.set(nullifier, true);

            let count: u32 = poll_vote_count.get_or_use(poll_id, 0u32);
            poll_vote_count.set(poll_id, count + 1u32);
        });
    }

    // ── 5. Snapshot Publication ───────────────────────────────────────────────

    // Only the poll's registered operator can publish results.
    // Called automatically by the tally service after decrypting OperatorVote records.
    fn create_snapshot(
        public poll_id:      field,
        public community_id: field,
        public total_votes:  u32,
        public r1: u8, public r2: u8, public r3: u8, public r4: u8,
        public r5: u8, public r6: u8, public r7: u8, public r8: u8,
    ) -> Final {
        let caller: address = self.caller;
        return final {
            let poll: PollMeta = polls.get(poll_id);
            assert_eq(poll.operator, caller);

            let counter: u32 = snapshot_counter.get_or_use(true, 0u32);
            let snap_id: u32 = counter + 1u32;

            snapshots.set(snap_id, Snapshot {
                snapshot_id:   snap_id,
                poll_id:       poll_id,
                community_id:  community_id,
                block_height:  block.height,
                total_votes:   total_votes,
                rank_1_option: r1, rank_2_option: r2, rank_3_option: r3, rank_4_option: r4,
                rank_5_option: r5, rank_6_option: r6, rank_7_option: r7, rank_8_option: r8,
            });
            latest_snapshot.set(poll_id, snap_id);
            snapshot_counter.set(true, snap_id);
        };
    }
}
