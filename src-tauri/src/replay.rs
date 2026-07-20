use std::{path::Path, sync::Arc};

use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::{
    domain::{ClaimCandidate, DashboardSnapshot},
    state::ApplicationState,
    verifier::{find_seed_record, verify_candidate},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveryDocument {
    endpoint: String,
    bearer_token: String,
}

pub async fn start_replay(
    app: AppHandle,
    state: Arc<ApplicationState>,
    app_data_dir: &Path,
) -> Result<DashboardSnapshot> {
    if state.gate.has_pending().await {
        return Err(anyhow::anyhow!(
            "Resolve the current approval before starting another replay"
        ));
    }
    state.store.reset_demo_data()?;
    state.set_replay_mode(true);
    let session_id = "replay-acme-2026-q2";
    let turn_id = "replay-turn-1";
    state
        .store
        .create_session(session_id, "replay", Some("synthetic-company-workspace"))?;
    let opening = state.store.insert_event(
        Some(session_id),
        "thread/started",
        "Replay thread started",
        &json!({"threadId": session_id, "replay": true}),
        "replay",
    )?;
    let _ = app.emit("gbox://codex-event", opening);

    let candidates = replay_candidates();
    let mut claim_ids = Vec::new();
    for candidate in candidates {
        let record = find_seed_record(&candidate)?;
        let outcome = verify_candidate(&candidate, record, None);
        let claim = state.store.upsert_claim(
            session_id,
            Some(turn_id),
            &candidate,
            outcome.state,
            outcome.confidence,
        )?;
        state.store.insert_evidence(
            &claim.id,
            "replay:mcpServer/toolCall:company_get_metric",
            outcome.record.as_ref(),
            &outcome.result_hash,
            &outcome.explanation,
        )?;
        let _ = app.emit("gbox://claim-updated", &claim);
        claim_ids.push(claim.id);
    }

    let report = replay_report();
    let action = state.store.insert_action(
        session_id,
        Some(turn_id),
        Some("replay-tool-call-1"),
        "test_webhook",
        report,
        &claim_ids,
    )?;
    let gate = state.gate.clone();
    let store = state.store.clone();
    let action_id = action.id.clone();
    let app_data_dir = app_data_dir.to_path_buf();
    tokio::spawn(async move {
        let response = gate
            .request(
                action,
                json!({
                    "report_markdown": report,
                    "event_type": "test_webhook",
                }),
            )
            .await;
        if response.decision == "allow" {
            if let Some(input) = response.updated_input {
                if let Err(error) = deliver_replay_webhook(&app_data_dir, input).await {
                    let _ = store.mark_action_failed(&action_id, &error.to_string());
                }
            }
        }
    });
    let event = state.store.insert_event(
        Some(session_id),
        "item/completed",
        "Replay agent prepared a governed report",
        &json!({
            "threadId": session_id,
            "turnId": turn_id,
            "item": {"type": "agentMessage", "text": report},
            "replay": true,
        }),
        "replay",
    )?;
    let _ = app.emit("gbox://codex-event", event);
    state.snapshot()
}

async fn deliver_replay_webhook(app_data_dir: &Path, input: serde_json::Value) -> Result<()> {
    let document: DiscoveryDocument = serde_json::from_slice(
        &std::fs::read(app_data_dir.join("hook-endpoint.json"))
            .context("gBox discovery file is unavailable")?,
    )?;
    let response = reqwest::Client::new()
        .post(format!("{}/webhook-sink", document.endpoint))
        .bearer_auth(document.bearer_token)
        .json(&input)
        .send()
        .await
        .context("replay webhook delivery failed")?;
    if !response.status().is_success() {
        return Err(anyhow::anyhow!(
            "replay webhook returned {}",
            response.status()
        ));
    }
    Ok(())
}

fn replay_candidates() -> Vec<ClaimCandidate> {
    vec![
        ClaimCandidate {
            statement: "Acme had 17 production database users in 2026-Q2.".to_owned(),
            claim_type: "company_metric".to_owned(),
            company_id: Some("acme".to_owned()),
            metric: Some("production_database_users".to_owned()),
            period: Some("2026-Q2".to_owned()),
            asserted_value: Some("17".to_owned()),
            unit: Some("count".to_owned()),
            source_span: "17 production database users in 2026-Q2".to_owned(),
        },
        ClaimCandidate {
            statement: "Acme reported 42 production database users in 2026-Q2.".to_owned(),
            claim_type: "company_metric".to_owned(),
            company_id: Some("acme".to_owned()),
            metric: Some("production_database_users".to_owned()),
            period: Some("2026-Q2".to_owned()),
            asserted_value: Some("42".to_owned()),
            unit: Some("count".to_owned()),
            source_span: "42 production database users in 2026-Q2".to_owned(),
        },
        ClaimCandidate {
            statement: "Acme recorded 3 privileged-access incidents in 2026-Q2.".to_owned(),
            claim_type: "company_metric".to_owned(),
            company_id: Some("acme".to_owned()),
            metric: Some("privileged_access_incidents".to_owned()),
            period: Some("2026-Q2".to_owned()),
            asserted_value: Some("3".to_owned()),
            unit: Some("count".to_owned()),
            source_span: "3 privileged-access incidents in 2026-Q2".to_owned(),
        },
    ]
}

fn replay_report() -> &'static str {
    "# Acme access review\n\nThe agent reports that Acme had 42 production database users in 2026-Q2. The identity-governance record contains 17. A separate claim of 3 privileged-access incidents could not be matched to an authoritative company metric.\n\nThis report is queued for the local test webhook."
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replay_contains_every_verdict_case() {
        let candidates = replay_candidates();
        let outcomes = candidates
            .iter()
            .map(|candidate| {
                verify_candidate(
                    candidate,
                    find_seed_record(candidate).expect("seed lookup"),
                    None,
                )
                .state
            })
            .collect::<Vec<_>>();
        assert_eq!(outcomes.len(), 3);
        assert!(outcomes.contains(&crate::domain::ClaimState::Verified));
        assert!(outcomes.contains(&crate::domain::ClaimState::Contradicted));
        assert!(outcomes.contains(&crate::domain::ClaimState::Unverifiable));
    }
}
