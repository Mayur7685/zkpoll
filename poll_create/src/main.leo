struct PollMeta {
    creator: address,
    community_id: field,
    required_credential_type: u8,
    created_at: u32,
    end_block: u32,
    active: bool,
}

struct PollOption {
    poll_id: field,
    option_id: u8,
    parent_option_id: u8,
    child_count: u8,
}

program zkpoll_create_v1.aleo {

    @noupgrade
    constructor() {}

    mapping polls: field => PollMeta;
    mapping options: field => PollOption;
    mapping vote_count: field => u32;

    fn create_poll(
        public poll_id: field,
        public community_id: field,
        public required_cred_type: u8,
        public created_at: u32,
        public end_block: u32,
    ) -> Final {
        let creator: address = self.caller;
        return final {
            let exists: bool = polls.contains(poll_id);
            assert_eq(exists, false);
            assert(end_block > created_at);
            polls.set(poll_id, PollMeta {
                creator: creator,
                community_id: community_id,
                required_credential_type: required_cred_type,
                created_at: created_at,
                end_block: end_block,
                active: true,
            });
            vote_count.set(poll_id, 0u32);
        };
    }

    fn add_option(
        public poll_id: field,
        public option_id: u8,
        public parent_id: u8,
        public child_count: u8,
    ) -> Final {
        return final {
            let exists: bool = polls.contains(poll_id);
            assert_eq(exists, true);
            let key: field = BHP256::hash_to_field(poll_id * 256field + option_id as field);
            options.set(key, PollOption {
                poll_id: poll_id,
                option_id: option_id,
                parent_option_id: parent_id,
                child_count: child_count,
            });
        };
    }

    // Creator can close the poll early — no more votes accepted after this.
    fn close_poll(public poll_id: field) -> Final {
        let caller: address = self.caller;
        return final {
            let poll: PollMeta = polls.get(poll_id);
            assert_eq(poll.creator, caller);
            polls.set(poll_id, PollMeta {
                creator: poll.creator,
                community_id: poll.community_id,
                required_credential_type: poll.required_credential_type,
                created_at: poll.created_at,
                end_block: poll.end_block,
                active: false,
            });
        };
    }
}
