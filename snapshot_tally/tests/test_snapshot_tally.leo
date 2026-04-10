// The 'test_snapshot_tally' test program.
import snapshot_tally.aleo;
program test_snapshot_tally.aleo {
    @test
    script test_it() {
        let result: u32 = snapshot_tally.aleo/main(1u32, 2u32);
        assert_eq(result, 3u32);
    }

    @test
    @should_fail
    transition do_nothing() {
        let result: u32 = snapshot_tally.aleo/main(2u32, 3u32);
        assert_eq(result, 3u32);
    }

    @noupgrade
    async constructor() {}
}
