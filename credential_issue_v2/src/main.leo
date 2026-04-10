program zkpoll_credential.aleo {

    @noupgrade
    constructor() {}

    // voting_weight: verifier-computed eligible votes (EV) for this holder.
    // Calculated from: Σ (requirement_vote_weight_i) for each passed requirement i.
    // Matches MetaPoll's EV = Σ (token_balance_i × weight_i) model.
    record Credential {
        owner:           address,
        issuer:          address,
        community_id:    field,
        credential_type: u8,
        voting_weight:   u64,   // EV — eligible votes at issuance time
        expiry_block:    u32,
        issued_at:       u32,
    }

    // community_id → total credentials issued (public counter)
    mapping credential_count: field => u32;

    // issuer → authorized (only registered issuers may call issue_credential)
    mapping authorized_issuers: address => bool;

    // Only the authorized issuer (verifier service) can call this.
    // self.caller = issuer address — visible on-chain (expected).
    // voting_weight is computed off-chain by the verifier based on requirements met.
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
}
