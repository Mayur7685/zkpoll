program zkpoll_vote_v2.aleo {

    @noupgrade
    constructor() {}

    // Redeclared from lp_credential_issue.aleo.
    record Credential {
        owner: address,
        issuer: address,
        community_id: field,
        credential_type: u8,
        expiry_block: u32,
        issued_at: u32,
    }

    // Encrypted — only the owner (real voter) can read the rankings via their view key.
    record Vote {
        owner: address,
        poll_id: field,
        community_id: field,
        rank_1: u8,
        rank_2: u8,
        rank_3: u8,
        rank_4: u8,
        rank_5: u8,
        rank_6: u8,
        rank_7: u8,
        rank_8: u8,
        cast_at: u32,
        nullifier: field,
    }

    // nullifier => used
    mapping used_nullifiers: field => bool;
    // poll_id => vote count
    mapping poll_vote_count: field => u32;
    // poll_id => end_block (set when creator registers poll deadline on-chain)
    mapping poll_deadlines: field => u32;
    // poll_id => active (false when creator calls close_poll)
    mapping poll_active: field => bool;

    // Creator registers the poll's on-chain deadline.
    // Called once after poll_create.aleo/create_poll.
    fn register_poll_deadline(
        public poll_id: field,
        public end_block: u32,
    ) -> Final {
        return final {
            let already: bool = poll_deadlines.contains(poll_id);
            assert_eq(already, false);
            poll_deadlines.set(poll_id, end_block);
            poll_active.set(poll_id, true);
        };
    }

    // Creator closes the poll early — no more votes accepted.
    fn close_poll(public poll_id: field) -> Final {
        return final {
            poll_active.set(poll_id, false);
        };
    }

    // self.caller = real voter address (visible on-chain).
    // Rankings go into an encrypted Vote record — how they voted is private.
    // end_block is verified against the on-chain registry (block.height cannot be forged).
    fn cast_vote(
        cred: Credential,
        public poll_id: field,
        public community_id: field,
        public required_cred_type: u8,
        public nullifier: field,
        public cast_at: u32,
        public r1: u8, public r2: u8, public r3: u8, public r4: u8,
        public r5: u8, public r6: u8, public r7: u8, public r8: u8,
    ) -> (Vote, Final) {
        assert_eq(cred.community_id, community_id);
        assert(cred.credential_type >= required_cred_type);
        assert(cred.expiry_block > cast_at);
        assert_eq(cred.owner, self.caller);

        let vote: Vote = Vote {
            owner: self.caller,
            poll_id: poll_id,
            community_id: community_id,
            rank_1: r1, rank_2: r2, rank_3: r3, rank_4: r4,
            rank_5: r5, rank_6: r6, rank_7: r7, rank_8: r8,
            cast_at: cast_at,
            nullifier: nullifier,
        };

        return (vote, final {
            // On-chain deadline: block.height is network-provided, cannot be forged.
            let end: u32 = poll_deadlines.get(poll_id);
            assert(block.height <= end);

            // Early-close check.
            let active: bool = poll_active.get_or_use(poll_id, true);
            assert(active);

            let used: bool = used_nullifiers.get_or_use(nullifier, false);
            assert_eq(used, false);
            used_nullifiers.set(nullifier, true);
            let count: u32 = poll_vote_count.get_or_use(poll_id, 0u32);
            poll_vote_count.set(poll_id, count + 1u32);
        });
    }
}
