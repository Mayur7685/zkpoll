// ─── zkpoll_v2_core.aleo ──────────────────────────────────────────────────────
//
// V2 of zkpoll_core — adds per-parent scoped snapshots for independent
// sub-option ranking at each level of the option tree (depth up to 4).
//
// Changes from v1:
//   - Replaced flat Snapshot (8 ranks) with ScopedSnapshot (4 ranks per parent)
//   - Added create_scoped_snapshot transition (operator-only)
//   - Added 3 new mappings: scoped_snapshots, latest_scoped_snapshot, scoped_snapshot_store
//   - Structs moved outside program {} block (Leo 4.0 convention)
//   - Vote / OperatorVote records unchanged — tally engine handles scoping
//
// Privacy model (unchanged from v1):
//   - Vote rankings are NEVER in public calldata (private ZK witnesses)
//   - OperatorVote is encrypted to operator address for automated tally decryption
//   - Voter address (self.caller) is public by design
// ─────────────────────────────────────────────────────────────────────────────

// ── Structs (module level — Leo 4.0 convention) ───────────────────────────────

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

// ScopedSnapshot: ranks the top-4 children of a given parent option.
// parent_option_id = 0 means root level (children of the poll itself).
// Each parent has exactly 4 children, so 4 rank slots are sufficient.
struct ScopedSnapshot {
    snapshot_id:      u32,
    poll_id:          field,
    community_id:     field,
    parent_option_id: u8,
    block_height:     u32,
    total_votes:      u32,
    rank_1_option:    u8,
    rank_2_option:    u8,
    rank_3_option:    u8,
    rank_4_option:    u8,
}

// ── Shared finalization helpers ───────────────────────────────────────────────

// Increments a u32 mapping value by 1, defaulting to 0 if absent.
final fn increment_u32(m: field, mapping_ref: field) {
    // Note: inlined at each call site by the compiler — not a standalone fn.
    // Callers manage their own mapping references directly.
}

program zkpoll_v2_core.aleo {

    @noupgrade
    constructor() {}

    // ── Records ───────────────────────────────────────────────────────────────

    record Credential {
        owner:           address,
        issuer:          address,
        community_id:    field,
        credential_type: u8,
        voting_weight:   u64,
        expiry_block:    u32,
        issued_at:       u32,
    }

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

    record OperatorVote {
        owner:         address,
        poll_id:       field,
        community_id:  field,
        voter:         address,
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
    mapping snapshot_counter: bool  => u32;

    // V2: scoped snapshot mappings (replaces flat snapshots / latest_snapshot)
    // scope_key = BHP256::hash_to_field(poll_id * 256field + parent_option_id as field)
    mapping scoped_snapshots:        field => ScopedSnapshot; // scope_key → latest snapshot
    mapping latest_scoped_snapshot:  field => u32;            // scope_key → snapshot_id
    mapping scoped_snapshot_store:   u32   => ScopedSnapshot; // snapshot_id → full data

    // ── 1. Community Registry ─────────────────────────────────────────────────

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
    //
    // Unchanged from v1. Rankings r1..r8 encode the voter's ranking of options
    // visible at the layer they are currently viewing. The tally engine groups
    // these by parent scope when computing ScopedSnapshots.

    fn cast_vote(
        cred:               Credential,
        public poll_id:     field,
        community_id:       field,
        required_cred_type: u8,
        public nullifier:   field,
        cast_at:            u32,
        public operator:    address,
        r1: u8, r2: u8, r3: u8, r4: u8,
        r5: u8, r6: u8, r7: u8, r8: u8,
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
            assert_eq(poll.operator, operator);

            let used: bool = used_nullifiers.get_or_use(nullifier, false);
            assert_eq(used, false);
            used_nullifiers.set(nullifier, true);

            let count: u32 = poll_vote_count.get_or_use(poll_id, 0u32);
            poll_vote_count.set(poll_id, count + 1u32);
        });
    }

    // ── 5. Scoped Snapshot Publication ───────────────────────────────────────
    //
    // Publishes the ranked result for the children of a single parent option.
    // Called once per parent scope by the tally service after computing MDCT.
    //
    // parent_option_id = 0  → root-level ranking (top-4 of the 8 root options)
    // parent_option_id = N  → ranking of the 4 children of option N
    //
    // scope_key = BHP256::hash_to_field(poll_id * 256field + parent_option_id as field)
    // This key is deterministic and queryable off-chain.

    fn create_scoped_snapshot(
        public poll_id:          field,
        public community_id:     field,
        public parent_option_id: u8,
        public total_votes:      u32,
        public r1: u8, public r2: u8, public r3: u8, public r4: u8,
    ) -> Final {
        let caller: address = self.caller;
        return final {
            let poll: PollMeta = polls.get(poll_id);
            assert_eq(poll.operator, caller);

            let scope_key: field = BHP256::hash_to_field(
                poll_id * 256field + parent_option_id as field
            );

            let counter: u32 = snapshot_counter.get_or_use(true, 0u32);
            let snap_id: u32 = counter + 1u32;

            let snap: ScopedSnapshot = ScopedSnapshot {
                snapshot_id:      snap_id,
                poll_id:          poll_id,
                community_id:     community_id,
                parent_option_id: parent_option_id,
                block_height:     block.height,
                total_votes:      total_votes,
                rank_1_option:    r1,
                rank_2_option:    r2,
                rank_3_option:    r3,
                rank_4_option:    r4,
            };

            scoped_snapshot_store.set(snap_id, snap);
            scoped_snapshots.set(scope_key, snap);
            latest_scoped_snapshot.set(scope_key, snap_id);
            snapshot_counter.set(true, snap_id);
        };
    }
}
