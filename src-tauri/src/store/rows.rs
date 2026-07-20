use rusqlite::Row;

use crate::domain::{
    ActionState, Claim, ClaimState, CodexEvent, ComparisonMethod, Decision, Evidence,
    PendingAction, Receipt, VerificationFailure,
};

pub(super) fn claim_from_row(row: &Row<'_>) -> rusqlite::Result<Claim> {
    let state: String = row.get(12)?;
    let legacy_subject: Option<String> = row.get(6)?;
    let legacy_predicate: Option<String> = row.get(7)?;
    let legacy_temporal_context: Option<String> = row.get(8)?;
    Ok(Claim {
        id: row.get(0)?,
        session_id: row.get(2)?,
        turn_id: row.get(3)?,
        statement: row.get(4)?,
        claim_type: row.get(5)?,
        subject: row.get::<_, Option<String>>(15)?.or(legacy_subject),
        predicate: row.get::<_, Option<String>>(16)?.or(legacy_predicate),
        object: row.get(17)?,
        asserted_value: row.get(9)?,
        unit: row.get(10)?,
        temporal_context: row
            .get::<_, Option<String>>(18)?
            .or(legacy_temporal_context),
        location: row.get(19)?,
        source_span: row.get(11)?,
        state: ClaimState::try_from(state.as_str()).map_err(conversion_error)?,
        confidence: row.get(13)?,
        created_at: row.get(14)?,
    })
}

pub(super) fn evidence_from_row(row: &Row<'_>) -> rusqlite::Result<Evidence> {
    let record_json: Option<String> = row.get(4)?;
    let source_kind: String = row.get(2)?;
    let eligible_sources_json: Option<String> = row.get(9)?;
    let selected_plan_json: Option<String> = row.get(10)?;
    let comparison_method: Option<String> = row.get(11)?;
    Ok(Evidence {
        id: row.get(0)?,
        claim_id: row.get(1)?,
        source_kind: source_kind.clone(),
        source_name: row.get::<_, Option<String>>(8)?.unwrap_or(source_kind),
        source_reference: row.get(3)?,
        content: record_json
            .map(|value| serde_json::from_str(&value).map_err(json_error))
            .transpose()?,
        result_hash: row.get(5)?,
        explanation: row.get(6)?,
        eligible_sources: eligible_sources_json
            .map(|value| serde_json::from_str(&value).map_err(json_error))
            .transpose()?
            .unwrap_or_default(),
        selected_plan: selected_plan_json
            .map(|value| serde_json::from_str(&value).map_err(json_error))
            .transpose()?,
        comparison_method: ComparisonMethod::try_from(
            comparison_method.as_deref().unwrap_or("legacy"),
        )
        .map_err(conversion_error)?,
        created_at: row.get(7)?,
    })
}

pub(super) fn verification_failure_from_row(
    row: &Row<'_>,
) -> rusqlite::Result<VerificationFailure> {
    let details_json: Option<String> = row.get(4)?;
    Ok(VerificationFailure {
        id: row.get(0)?,
        claim_id: row.get(1)?,
        stage: row.get(2)?,
        message: row.get(3)?,
        details: details_json
            .map(|value| serde_json::from_str(&value).map_err(json_error))
            .transpose()?,
        created_at: row.get(5)?,
    })
}

pub(super) fn action_from_row(row: &Row<'_>) -> rusqlite::Result<PendingAction> {
    let state: String = row.get(7)?;
    let claim_ids_json: String = row.get(8)?;
    Ok(PendingAction {
        id: row.get(0)?,
        session_id: row.get(1)?,
        turn_id: row.get(2)?,
        tool_use_id: row.get(3)?,
        action_type: row.get(4)?,
        report_markdown: row.get(5)?,
        payload_hash: row.get(6)?,
        state: ActionState::try_from(state.as_str()).map_err(conversion_error)?,
        claim_ids: serde_json::from_str(&claim_ids_json).map_err(json_error)?,
        requested_at: row.get(9)?,
        decided_at: row.get(10)?,
        executed_at: row.get(11)?,
    })
}

pub(super) fn decision_from_row(row: &Row<'_>) -> rusqlite::Result<Decision> {
    Ok(Decision {
        id: row.get(0)?,
        action_id: row.get(1)?,
        decision: row.get(2)?,
        reason: row.get(3)?,
        decided_by: row.get(4)?,
        decided_at: row.get(5)?,
    })
}

pub(super) fn receipt_from_row(row: &Row<'_>) -> rusqlite::Result<Receipt> {
    let payload_json: String = row.get(4)?;
    Ok(Receipt {
        sequence: row.get(0)?,
        id: row.get(1)?,
        event_type: row.get(2)?,
        entity_id: row.get(3)?,
        payload: serde_json::from_str(&payload_json).map_err(json_error)?,
        previous_hash: row.get(5)?,
        hash: row.get(6)?,
        created_at: row.get(7)?,
    })
}

pub(super) fn event_from_row(row: &Row<'_>) -> rusqlite::Result<CodexEvent> {
    let payload_json: String = row.get(4)?;
    Ok(CodexEvent {
        id: row.get(0)?,
        session_id: row.get(1)?,
        method: row.get(2)?,
        summary: row.get(3)?,
        payload: serde_json::from_str(&payload_json).map_err(json_error)?,
        source: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn conversion_error(message: String) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            message,
        )),
    )
}

fn json_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}
