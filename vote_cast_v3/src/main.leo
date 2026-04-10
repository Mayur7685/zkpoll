program zkpoll_vote2.aleo {

    @noupgrade
    constructor() {}

    // Credential record — issued and consumed by this program.
    // Both issue_credential and cast_vote live here so the on-chain record
    // commitment is scoped to zkpoll_vote.aleo, allowing cast_vote to verify it.
    record Credential {
        owner:           address,
        issuer:          address,
        community_id:    field,
        credential_type: u8,
        voting_weight:   u64,
        expiry_block:    u32,
        issued_at:       u32,
    }

    // Private ballot — r1..r8 are ZK private witnesses, never in calldata.
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

    // community_id → total credentials issued
    mapping credential_count: field => u32;

    // nullifier → used (public double-vote prevention)
    mapping used_nullifiers: field => bool;
    // poll_id → vote count (public participation counter)
    mapping poll_vote_count: field => u32;
    // poll_id → end_block (registered by poll creator)
    mapping poll_deadlines:  field => u32;
    // poll_id → active flag (false when creator calls close_poll)
    mapping poll_active:     field => bool;
    // poll_id → Pinata result CID hash (published by operator after tally)
    mapping poll_result_hash: field => field;

    // ─── CREDENTIAL ISSUANCE ─────────────────────────────────────────────────
    //
    // Called by the verifier service after all community requirements pass.
    // self.caller = issuer address (visible on-chain — expected).
    fn issue_credential(
        public recipient:      address,
        public community_id:   field,
        public cred_type:      u8,
        public voting_weight:  u64,
        public expiry:         u32,
        public issued_at:      u32,
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

    // ─── POLL MANAGEMENT ─────────────────────────────────────────────────────

    // Called once by poll creator after create_poll on zkpoll_poll_create.aleo.
    fn register_poll_deadline(
        public poll_id:   field,
        public end_block: u32,
    ) -> Final {
        return final {
            let already: bool = poll_deadlines.contains(poll_id);
            assert_eq(already, false);
            poll_deadlines.set(poll_id, end_block);
            poll_active.set(poll_id, true);
        };
    }

    // Called by poll creator to close early — no more votes accepted.
    fn close_poll(public poll_id: field) -> Final {
        return final {
            poll_active.set(poll_id, false);
        };
    }

    // ─── PRIVATE BALLOT CASTING ───────────────────────────────────────────────
    //
    // Public on-chain:    poll_id, nullifier
    // Private (ZK only):  cred record, community_id, required_cred_type,
    //                     cast_at, r1..r8   ← RANKINGS NEVER IN CALLDATA
    fn cast_vote(
        cred:                    Credential,   // private record input
        public poll_id:          field,        // public — finalize lookup
        community_id:            field,        // PRIVATE — ZK only
        required_cred_type:      u8,           // PRIVATE — ZK only
        public nullifier:        field,        // public — finalize double-vote
        cast_at:                 u32,          // PRIVATE — ZK only
        r1: u8, r2: u8, r3: u8, r4: u8,      // PRIVATE — ZK only (ballot)
        r5: u8, r6: u8, r7: u8, r8: u8,      // PRIVATE — ZK only (ballot)
    ) -> (Vote, Final) {
        assert_eq(cred.community_id,     community_id);
        assert(cred.credential_type     >= required_cred_type);
        assert(cred.expiry_block        >  cast_at);
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

        return (vote, final {
            let end: u32 = poll_deadlines.get(poll_id);
            assert(block.height <= end);

            let active: bool = poll_active.get_or_use(poll_id, true);
            assert(active);

            let used: bool = used_nullifiers.get_or_use(nullifier, false);
            assert_eq(used, false);
            used_nullifiers.set(nullifier, true);

            let count: u32 = poll_vote_count.get_or_use(poll_id, 0u32);
            poll_vote_count.set(poll_id, count + 1u32);
        });
    }

    // Called by operator after off-chain tally — anchors Pinata CID hash on-chain.
    fn publish_result(
        public poll_id:     field,
        public result_hash: field,
    ) -> Final {
        return final {
            poll_result_hash.set(poll_id, result_hash);
        };
    }
}
