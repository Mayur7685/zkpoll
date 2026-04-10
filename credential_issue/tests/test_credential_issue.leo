// The 'test_credential_issue' test program.
import credential_issue.aleo;
program test_credential_issue.aleo {
    @test
    script test_it() {
        let result: u32 = credential_issue.aleo/main(1u32, 2u32);
        assert_eq(result, 3u32);
    }

    @test
    @should_fail
    transition do_nothing() {
        let result: u32 = credential_issue.aleo/main(2u32, 3u32);
        assert_eq(result, 3u32);
    }

    @noupgrade
    async constructor() {}
}
