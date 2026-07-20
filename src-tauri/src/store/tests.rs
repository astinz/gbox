use super::*;
use crate::domain::{ComparisonMethod, EvidenceSource, VerificationFailureInput, VerificationPlan};

fn sample_candidate(value: &str) -> ClaimCandidate {
    ClaimCandidate {
        statement: format!("Acme has {value} production database users."),
        claim_type: "quantity".to_owned(),
        subject: Some("acme".to_owned()),
        predicate: Some("production_database_users".to_owned()),
        object: Some("production database users".to_owned()),
        asserted_value: Some(value.to_owned()),
        unit: Some("count".to_owned()),
        temporal_context: Some("2026-Q2".to_owned()),
        location: None,
        source_span: format!("{value} production database users"),
    }
}

#[test]
fn reads_only_structured_events_for_the_requested_thread() {
    let store = Store::open_memory().expect("store");
    store
        .insert_event(
            Some("internal-thread"),
            "item/completed",
            "complete",
            &json!({"item": {"type": "agentMessage", "phase": "final_answer"}}),
            "codex-internal",
        )
        .expect("internal event");
    store
        .insert_event(
            Some("other-thread"),
            "item/completed",
            "other",
            &json!({}),
            "codex-internal",
        )
        .expect("other event");
    let events = store
        .structured_turn_events("internal-thread")
        .expect("structured events");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].session_id.as_deref(), Some("internal-thread"));
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
            &EvidenceInput {
                source_kind: "mcp".to_owned(),
                source_name: "test_metric".to_owned(),
                source_reference: "test:mcp".to_owned(),
                content: None,
                result_hash: "evidence-hash".to_owned(),
                explanation: "verified in test".to_owned(),
                eligible_sources: vec![],
                selected_plan: None,
                comparison_method: ComparisonMethod::DeterministicAdapter,
                failures: vec![],
            },
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
fn persists_verification_trace_and_failure_history() {
    let store = Store::open_memory().expect("store");
    store
        .create_session("trace-session", "test", None)
        .expect("session");
    let claim = store
        .upsert_claim(
            "trace-session",
            Some("trace-turn"),
            &sample_candidate("42"),
            ClaimState::Unverifiable,
            0.8,
        )
        .expect("claim");
    let source = EvidenceSource {
        source_kind: "plugin_mcp".to_owned(),
        server: Some("company_data".to_owned()),
        tool: Some("company_get_metric".to_owned()),
        title: "Company metric".to_owned(),
        description: "Read a company metric".to_owned(),
        input_schema: serde_json::json!({"type": "object"}),
        read_only: true,
        plugin_backed: true,
    };
    let plan = VerificationPlan {
        source_type: "mcp".to_owned(),
        server: source.server.clone(),
        tool: source.tool.clone(),
        arguments: Some(serde_json::json!({"company_id": "acme"})),
        query: None,
        rationale: "Use the narrow authoritative source.".to_owned(),
    };
    store
        .insert_evidence(
            &claim.id,
            &EvidenceInput {
                source_kind: "plugin_mcp".to_owned(),
                source_name: "company_data/company_get_metric".to_owned(),
                source_reference: "mcpServer/tool/call:trace".to_owned(),
                content: Some(serde_json::json!({"toolResult": {"error": "timeout"}})),
                result_hash: "trace-hash".to_owned(),
                explanation: "The source did not return a usable record.".to_owned(),
                eligible_sources: vec![source],
                selected_plan: Some(plan),
                comparison_method: ComparisonMethod::NoComparison,
                failures: vec![VerificationFailureInput {
                    stage: "source_call".to_owned(),
                    message: "The selected source timed out.".to_owned(),
                    details: Some(serde_json::json!({"timeoutMs": 30_000})),
                }],
            },
        )
        .expect("evidence");

    let evidence = store.list_evidence().expect("evidence");
    assert_eq!(evidence.len(), 1);
    assert_eq!(evidence[0].eligible_sources.len(), 1);
    assert_eq!(
        evidence[0]
            .selected_plan
            .as_ref()
            .expect("selected plan")
            .rationale,
        "Use the narrow authoritative source."
    );
    assert_eq!(
        evidence[0].comparison_method,
        ComparisonMethod::NoComparison
    );
    let failures = store.list_verification_failures().expect("failure history");
    assert_eq!(failures.len(), 1);
    assert_eq!(failures[0].claim_id, claim.id);
    assert_eq!(failures[0].stage, "source_call");
    assert_eq!(
        failures[0]
            .details
            .as_ref()
            .and_then(|details| details.get("timeoutMs"))
            .and_then(serde_json::Value::as_i64),
        Some(30_000)
    );
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
