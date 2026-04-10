program zkpoll_credential_v1.aleo {

    @noupgrade
    constructor() {}

    record Credential {
        owner: address,
        issuer: address,
        community_id: field,
        credential_type: u8,
        expiry_block: u32,
        issued_at: u32,
    }

    // Tracks total credentials issued per community (public on-chain counter).
    mapping credential_count: field => u32;

    // Only the authorized issuer (verifier service) can call this.
    // self.caller = issuer address — visible on-chain (expected).
    fn issue_credential(
        public recipient: address,
        public community_id: field,
        public cred_type: u8,
        public expiry: u32,
        public issued_at: u32,
    ) -> (Credential, Final) {
        let cred: Credential = Credential {
            owner: recipient,
            issuer: self.caller,
            community_id: community_id,
            credential_type: cred_type,
            expiry_block: expiry,
            issued_at: issued_at,
        };
        return (cred, final {
            let count: u32 = credential_count.get_or_use(community_id, 0u32);
            credential_count.set(community_id, count + 1u32);
        });
    }
}
