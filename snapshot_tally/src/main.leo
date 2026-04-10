struct Snapshot {
    snapshot_id: u32,
    poll_id: field,
    community_id: field,
    block_height: u32,
    total_votes: u32,
    rank_1_option: u8,
    rank_2_option: u8,
    rank_3_option: u8,
    rank_4_option: u8,
    rank_5_option: u8,
    rank_6_option: u8,
    rank_7_option: u8,
    rank_8_option: u8,
}

program zkpoll_tally.aleo {

    @noupgrade
    constructor() {}

    mapping snapshots: u32 => Snapshot;
    mapping latest_snapshot: field => u32;
    mapping snapshot_counter: bool => u32;

    fn create_snapshot(
        public poll_id: field,
        public community_id: field,
        public block_height: u32,
        public total_votes: u32,
        public r1: u8, public r2: u8, public r3: u8, public r4: u8,
        public r5: u8, public r6: u8, public r7: u8, public r8: u8,
    ) -> Final {
        return final {
            let counter: u32 = snapshot_counter.get_or_use(true, 0u32);
            let snap_id: u32 = counter + 1u32;
            snapshots.set(snap_id, Snapshot {
                snapshot_id: snap_id,
                poll_id: poll_id,
                community_id: community_id,
                block_height: block_height,
                total_votes: total_votes,
                rank_1_option: r1, rank_2_option: r2, rank_3_option: r3, rank_4_option: r4,
                rank_5_option: r5, rank_6_option: r6, rank_7_option: r7, rank_8_option: r8,
            });
            latest_snapshot.set(poll_id, snap_id);
            snapshot_counter.set(true, snap_id);
        };
    }
}
