use super::*;

fn sample_candidate(value: &str) -> ClaimCandidate {
    ClaimCandidate {
        statement: format!("Acme has {value} production database users."),
        claim_type: "company_metric".to_owned(),
        company_id: Some("acme".to_owned()),
        metric: Some("production_database_users".to_owned()),
        period: Some("2026-Q2".to_owned()),
        asserted_value: Some(value.to_owned()),
        unit: Some("count".to_owned()),
        source_span: format!("{value} production database users"),
    }
}

fn approved_action(store: &Store) -> (PendingAction, String) {
    store
        .create_session("session", "test", None)
        .expect("session");
    let claim = store
        .upsert_claim(
            "session",
            Some("turn"),
            &sample_candidate("17"),
            ClaimState::Verified,
            1.0,
        )
        .expect("claim");
    store
        .insert_evidence(
            &claim.id,
            "test:mcp",
            None,
            "evidence-hash",
            "verified in test",
        )
        .expect("evidence");
    let action = store
        .insert_action(
            "session",
            Some("turn"),
            Some("tool"),
            "test_webhook",
            "report",
            &[claim.id],
        )
        .expect("action");
    let (_, _, token) = store
        .resolve_action(&action.id, "approve", None)
        .expect("approval");
    (action, token.expect("token"))
}

#[test]
fn permit_is_bound_and_single_use() {
    let store = Store::open_memory().expect("store");
    let (action, token) = approved_action(&store);
    assert!(store
        .consume_permit(&token, "different-action", "test_webhook", "report")
        .is_err());
    assert!(store
        .consume_permit(&token, &action.id, "test_webhook", "different")
        .is_err());
    store
        .consume_permit(&token, &action.id, "test_webhook", "report")
        .expect("delivery");
    assert!(store
        .consume_permit(&token, &action.id, "test_webhook", "report")
        .is_err());
    let deliveries: i64 = store
        .lock()
        .expect("connection")
        .query_row("SELECT COUNT(*) FROM webhook_deliveries", [], |row| {
            row.get(0)
        })
        .expect("delivery count");
    assert_eq!(deliveries, 1);
    assert!(store.verify_receipt_chain().expect("chain"));
    let receipt = store.list_receipts().expect("receipts")[0].clone();
    assert!(receipt.payload.get("claimVerdicts").is_some());
    assert!(receipt.payload.get("evidenceHashes").is_some());
    assert!(receipt.payload.get("humanDecision").is_some());
}

#[test]
fn expired_permit_fails_closed() {
    let store = Store::open_memory().expect("store");
    let (action, token) = approved_action(&store);
    store
        .lock()
        .expect("connection")
        .execute("UPDATE permits SET expires_at=0", [])
        .expect("expire permit");
    let error = store
        .consume_permit(&token, &action.id, "test_webhook", "report")
        .expect_err("expired permit should fail");
    assert!(error.to_string().contains("expired"));
}

#[test]
fn detects_receipt_tampering() {
    let store = Store::open_memory().expect("store");
    let _ = approved_action(&store);
    assert!(store.verify_receipt_chain().expect("valid chain"));
    store
        .lock()
        .expect("connection")
        .execute("UPDATE receipts SET payload_json='{}' WHERE sequence=1", [])
        .expect("tamper receipt");
    assert!(!store.verify_receipt_chain().expect("invalid chain"));
}

#[test]
fn persists_across_restart() {
    let path = std::env::temp_dir().join(format!("gbox-store-{}.sqlite3", Uuid::new_v4()));
    {
        let store = Store::open(&path).expect("first open");
        store
            .set_setting("global_observation", "true")
            .expect("setting");
        let _ = approved_action(&store);
    }
    {
        let store = Store::open(&path).expect("second open");
        assert_eq!(
            store.get_setting("global_observation").expect("setting"),
            Some("true".to_owned())
        );
        assert!(!store.list_receipts().expect("receipts").is_empty());
        assert!(store.verify_receipt_chain().expect("chain"));
    }
    let _ = std::fs::remove_file(path);
}

#[test]
fn claim_deduplicates_within_session() {
    let store = Store::open_memory().expect("store");
    let first_candidate = sample_candidate("42.0");
    let mut second_candidate = sample_candidate("42.00");
    second_candidate.statement = "A differently worded Acme metric claim.".to_owned();
    let first = store
        .upsert_claim(
            "session",
            None,
            &first_candidate,
            ClaimState::Contradicted,
            0.9,
        )
        .expect("first");
    let second = store
        .upsert_claim(
            "session",
            None,
            &second_candidate,
            ClaimState::Contradicted,
            0.8,
        )
        .expect("second");
    assert_eq!(first.id, second.id);
    assert_eq!(store.list_claims().expect("claims").len(), 1);
}
