use std::{collections::BTreeMap, path::Path, sync::Mutex};

use anyhow::{anyhow, Context, Result};
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use rust_decimal::Decimal;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::domain::{
    ActionState, Claim, ClaimCandidate, ClaimState, CodexEvent, CompanyMetricRecord, Decision,
    Evidence, PendingAction, Receipt,
};

const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

pub struct Store {
    connection: Mutex<Connection>,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("failed to create {}", parent.display()))?;
        }
        let connection = Connection::open(path)
            .with_context(|| format!("failed to open database at {}", path.display()))?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        let store = Self {
            connection: Mutex::new(connection),
        };
        store.migrate()?;
        Ok(store)
    }

    #[cfg(test)]
    pub fn open_memory() -> Result<Self> {
        let connection = Connection::open_in_memory()?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        let store = Self {
            connection: Mutex::new(connection),
        };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<()> {
        let connection = self.lock()?;
        connection.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
              id TEXT PRIMARY KEY,
              source TEXT NOT NULL,
              cwd TEXT,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS events (
              id TEXT PRIMARY KEY,
              session_id TEXT,
              method TEXT NOT NULL,
              summary TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              source TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS claims (
              id TEXT PRIMARY KEY,
              dedupe_key TEXT NOT NULL UNIQUE,
              session_id TEXT NOT NULL,
              turn_id TEXT,
              statement TEXT NOT NULL,
              claim_type TEXT NOT NULL,
              company_id TEXT,
              metric TEXT,
              period TEXT,
              asserted_value TEXT,
              unit TEXT,
              source_span TEXT NOT NULL,
              state TEXT NOT NULL,
              confidence REAL NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS evidence (
              id TEXT PRIMARY KEY,
              claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
              source_kind TEXT NOT NULL,
              source_reference TEXT NOT NULL,
              record_json TEXT,
              result_hash TEXT NOT NULL,
              explanation TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS actions (
              id TEXT PRIMARY KEY,
              session_id TEXT NOT NULL,
              turn_id TEXT,
              tool_use_id TEXT,
              action_type TEXT NOT NULL,
              report_markdown TEXT NOT NULL,
              payload_hash TEXT NOT NULL,
              state TEXT NOT NULL,
              claim_ids_json TEXT NOT NULL,
              requested_at TEXT NOT NULL,
              decided_at TEXT,
              executed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS decisions (
              id TEXT PRIMARY KEY,
              action_id TEXT NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
              decision TEXT NOT NULL,
              reason TEXT,
              decided_by TEXT NOT NULL,
              decided_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS permits (
              token_hash TEXT PRIMARY KEY,
              action_id TEXT NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
              payload_hash TEXT NOT NULL,
              expires_at INTEGER NOT NULL,
              consumed_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS webhook_deliveries (
              id TEXT PRIMARY KEY,
              action_id TEXT NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
              payload_hash TEXT NOT NULL,
              delivered_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS receipts (
              sequence INTEGER PRIMARY KEY AUTOINCREMENT,
              id TEXT NOT NULL UNIQUE,
              event_type TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              previous_hash TEXT NOT NULL,
              hash TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS schema_migrations (
              version INTEGER PRIMARY KEY,
              applied_at TEXT NOT NULL
            );
            "#,
        )?;
        connection.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, ?1)",
            params![now()],
        )?;
        Ok(())
    }

    pub fn create_session(&self, id: &str, source: &str, cwd: Option<&str>) -> Result<()> {
        let connection = self.lock()?;
        connection.execute(
            "INSERT OR IGNORE INTO sessions (id, source, cwd, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, source, cwd, now()],
        )?;
        Ok(())
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let connection = self.lock()?;
        connection.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let connection = self.lock()?;
        Ok(connection
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn insert_event(
        &self,
        session_id: Option<&str>,
        method: &str,
        summary: &str,
        payload: &Value,
        source: &str,
    ) -> Result<CodexEvent> {
        let event = CodexEvent {
            id: Uuid::new_v4().to_string(),
            session_id: session_id.map(str::to_owned),
            method: method.to_owned(),
            summary: summary.to_owned(),
            payload: payload.clone(),
            source: source.to_owned(),
            created_at: now(),
        };
        let connection = self.lock()?;
        connection.execute(
            "INSERT INTO events VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                event.id,
                event.session_id,
                event.method,
                event.summary,
                serde_json::to_string(&event.payload)?,
                event.source,
                event.created_at,
            ],
        )?;
        Ok(event)
    }

    pub fn upsert_claim(
        &self,
        session_id: &str,
        turn_id: Option<&str>,
        candidate: &ClaimCandidate,
        state: ClaimState,
        confidence: f64,
    ) -> Result<Claim> {
        let dedupe_key = claim_dedupe_key(session_id, candidate);
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        let existing = transaction
            .query_row(
                "SELECT id FROM claims WHERE dedupe_key = ?1",
                params![dedupe_key],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let id = existing.unwrap_or_else(|| Uuid::new_v4().to_string());
        let created_at = now();
        transaction.execute(
            r#"INSERT INTO claims (
              id, dedupe_key, session_id, turn_id, statement, claim_type, company_id,
              metric, period, asserted_value, unit, source_span, state, confidence, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
            ON CONFLICT(dedupe_key) DO UPDATE SET
              state=excluded.state, confidence=excluded.confidence, source_span=excluded.source_span"#,
            params![
                id,
                dedupe_key,
                session_id,
                turn_id,
                candidate.statement,
                candidate.claim_type,
                candidate.company_id,
                candidate.metric,
                candidate.period,
                candidate.asserted_value,
                candidate.unit,
                candidate.source_span,
                state.as_db(),
                confidence,
                created_at,
            ],
        )?;
        let claim = transaction.query_row(
            "SELECT * FROM claims WHERE dedupe_key = ?1",
            params![dedupe_key],
            claim_from_row,
        )?;
        append_receipt_tx(
            &transaction,
            "claim.verdict",
            &claim.id,
            &serde_json::to_value(&claim)?,
        )?;
        transaction.commit()?;
        Ok(claim)
    }

    pub fn insert_evidence(
        &self,
        claim_id: &str,
        source_reference: &str,
        record: Option<&CompanyMetricRecord>,
        result_hash: &str,
        explanation: &str,
    ) -> Result<Evidence> {
        let evidence = Evidence {
            id: Uuid::new_v4().to_string(),
            claim_id: claim_id.to_owned(),
            source_kind: "mcp.company_data".to_owned(),
            source_reference: source_reference.to_owned(),
            record: record.cloned(),
            result_hash: result_hash.to_owned(),
            explanation: explanation.to_owned(),
            created_at: now(),
        };
        let connection = self.lock()?;
        connection.execute(
            "INSERT INTO evidence VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                evidence.id,
                evidence.claim_id,
                evidence.source_kind,
                evidence.source_reference,
                evidence
                    .record
                    .as_ref()
                    .map(serde_json::to_string)
                    .transpose()?,
                evidence.result_hash,
                evidence.explanation,
                evidence.created_at,
            ],
        )?;
        Ok(evidence)
    }

    pub fn insert_action(
        &self,
        session_id: &str,
        turn_id: Option<&str>,
        tool_use_id: Option<&str>,
        action_type: &str,
        report_markdown: &str,
        claim_ids: &[String],
    ) -> Result<PendingAction> {
        let action = PendingAction {
            id: Uuid::new_v4().to_string(),
            session_id: session_id.to_owned(),
            turn_id: turn_id.map(str::to_owned),
            tool_use_id: tool_use_id.map(str::to_owned),
            action_type: action_type.to_owned(),
            report_markdown: report_markdown.to_owned(),
            payload_hash: action_payload_hash(action_type, report_markdown),
            state: ActionState::Pending,
            claim_ids: claim_ids.to_vec(),
            requested_at: now(),
            decided_at: None,
            executed_at: None,
        };
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO actions VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, NULL)",
            params![
                action.id,
                action.session_id,
                action.turn_id,
                action.tool_use_id,
                action.action_type,
                action.report_markdown,
                action.payload_hash,
                action.state.as_db(),
                serde_json::to_string(&action.claim_ids)?,
                action.requested_at,
            ],
        )?;
        append_receipt_tx(
            &transaction,
            "action.requested",
            &action.id,
            &serde_json::to_value(&action)?,
        )?;
        transaction.commit()?;
        Ok(action)
    }

    pub fn resolve_action(
        &self,
        action_id: &str,
        decision: &str,
        reason: Option<&str>,
    ) -> Result<(PendingAction, Decision, Option<String>)> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        let current = get_action_tx(&transaction, action_id)?;
        if current.state != ActionState::Pending {
            return Err(anyhow!("action {} is no longer pending", action_id));
        }
        let (state, normalized) = match decision.to_ascii_lowercase().as_str() {
            "approve" | "approved" => (ActionState::Approved, "approve"),
            "deny" | "denied" => (ActionState::Denied, "deny"),
            _ => return Err(anyhow!("decision must be approve or deny")),
        };
        let decided_at = now();
        transaction.execute(
            "UPDATE actions SET state=?1, decided_at=?2 WHERE id=?3 AND state='Pending'",
            params![state.as_db(), decided_at, action_id],
        )?;
        let decision_record = Decision {
            id: Uuid::new_v4().to_string(),
            action_id: action_id.to_owned(),
            decision: normalized.to_owned(),
            reason: reason.map(str::to_owned),
            decided_by: "human".to_owned(),
            decided_at,
        };
        transaction.execute(
            "INSERT INTO decisions VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                decision_record.id,
                decision_record.action_id,
                decision_record.decision,
                decision_record.reason,
                decision_record.decided_by,
                decision_record.decided_at,
            ],
        )?;
        let approval_token = if state == ActionState::Approved {
            let token = random_token();
            transaction.execute(
                "INSERT INTO permits (token_hash, action_id, payload_hash, expires_at, consumed_at) VALUES (?1, ?2, ?3, ?4, NULL)",
                params![sha256_hex(token.as_bytes()), action_id, current.payload_hash, Utc::now().timestamp() + 300],
            )?;
            Some(token)
        } else {
            None
        };
        let updated = get_action_tx(&transaction, action_id)?;
        let receipt_payload = governance_receipt_payload(
            &transaction,
            &updated,
            Some(&decision_record),
            json!({"status": "not_executed"}),
        )?;
        append_receipt_tx(&transaction, "action.decision", action_id, &receipt_payload)?;
        transaction.commit()?;
        Ok((updated, decision_record, approval_token))
    }

    pub fn expire_action(&self, action_id: &str, reason: &str) -> Result<PendingAction> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE actions SET state='Expired', decided_at=?1 WHERE id=?2 AND state='Pending'",
            params![now(), action_id],
        )?;
        let action = get_action_tx(&transaction, action_id)?;
        append_receipt_tx(
            &transaction,
            "action.expired",
            action_id,
            &json!({ "reason": reason, "action": action }),
        )?;
        transaction.commit()?;
        Ok(action)
    }

    pub fn consume_permit(
        &self,
        token: &str,
        expected_action_id: &str,
        action_type: &str,
        report_markdown: &str,
    ) -> Result<PendingAction> {
        let token_hash = sha256_hex(token.as_bytes());
        let payload_hash = action_payload_hash(action_type, report_markdown);
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        let permit = transaction
            .query_row(
                "SELECT action_id, payload_hash, expires_at, consumed_at FROM permits WHERE token_hash=?1",
                params![token_hash],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| anyhow!("approval token is invalid"))?;
        if permit.0 != expected_action_id {
            return Err(anyhow!("approval token belongs to a different action"));
        }
        if permit.1 != payload_hash {
            return Err(anyhow!("approval token does not match this payload"));
        }
        if permit.2 <= Utc::now().timestamp() {
            return Err(anyhow!("approval token has expired"));
        }
        if permit.3.is_some() {
            return Err(anyhow!("approval token has already been used"));
        }
        let consumed_at = Utc::now().timestamp();
        transaction.execute(
            "UPDATE permits SET consumed_at=?1 WHERE token_hash=?2 AND consumed_at IS NULL",
            params![consumed_at, token_hash],
        )?;
        let delivered_at = now();
        transaction.execute(
            "INSERT INTO webhook_deliveries VALUES (?1, ?2, ?3, ?4)",
            params![
                Uuid::new_v4().to_string(),
                permit.0,
                payload_hash,
                delivered_at
            ],
        )?;
        transaction.execute(
            "UPDATE actions SET state='Executed', executed_at=?1 WHERE id=?2",
            params![delivered_at, permit.0],
        )?;
        let action = get_action_tx(&transaction, &permit.0)?;
        let decision = decision_for_action(&transaction, &action.id)?;
        let receipt_payload = governance_receipt_payload(
            &transaction,
            &action,
            decision.as_ref(),
            json!({
                "status": "delivered",
                "sink": "loopback-webhook",
                "deliveredAt": action.executed_at,
            }),
        )?;
        append_receipt_tx(
            &transaction,
            "action.executed",
            &action.id,
            &receipt_payload,
        )?;
        transaction.commit()?;
        Ok(action)
    }

    pub fn mark_action_failed(&self, action_id: &str, error: &str) -> Result<PendingAction> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "UPDATE actions SET state='Failed', executed_at=?1 WHERE id=?2",
            params![now(), action_id],
        )?;
        let action = get_action_tx(&transaction, action_id)?;
        let decision = decision_for_action(&transaction, action_id)?;
        let receipt_payload = governance_receipt_payload(
            &transaction,
            &action,
            decision.as_ref(),
            json!({"status": "failed", "error": error}),
        )?;
        append_receipt_tx(&transaction, "action.failed", action_id, &receipt_payload)?;
        transaction.commit()?;
        Ok(action)
    }

    pub fn list_claims(&self) -> Result<Vec<Claim>> {
        self.query_list(
            "SELECT * FROM claims ORDER BY created_at DESC",
            claim_from_row,
        )
    }

    pub fn list_evidence(&self) -> Result<Vec<Evidence>> {
        self.query_list(
            "SELECT * FROM evidence ORDER BY created_at DESC",
            evidence_from_row,
        )
    }

    pub fn list_actions(&self) -> Result<Vec<PendingAction>> {
        self.query_list(
            "SELECT * FROM actions ORDER BY requested_at DESC",
            action_from_row,
        )
    }

    pub fn list_decisions(&self) -> Result<Vec<Decision>> {
        self.query_list(
            "SELECT * FROM decisions ORDER BY decided_at DESC",
            decision_from_row,
        )
    }

    pub fn list_receipts(&self) -> Result<Vec<Receipt>> {
        self.query_list(
            "SELECT sequence, id, event_type, entity_id, payload_json, previous_hash, hash, created_at FROM receipts ORDER BY sequence DESC LIMIT 200",
            receipt_from_row,
        )
    }

    pub fn list_events(&self) -> Result<Vec<CodexEvent>> {
        self.query_list(
            "SELECT id, session_id, method, summary, payload_json, source, created_at FROM events ORDER BY created_at DESC LIMIT 300",
            event_from_row,
        )
    }

    pub fn verify_receipt_chain(&self) -> Result<bool> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT sequence, event_type, entity_id, payload_json, previous_hash, hash, created_at FROM receipts ORDER BY sequence",
        )?;
        let mut rows = statement.query([])?;
        let mut expected_previous = GENESIS_HASH.to_owned();
        while let Some(row) = rows.next()? {
            let sequence: i64 = row.get(0)?;
            let event_type: String = row.get(1)?;
            let entity_id: String = row.get(2)?;
            let payload_json: String = row.get(3)?;
            let previous_hash: String = row.get(4)?;
            let stored_hash: String = row.get(5)?;
            let created_at: String = row.get(6)?;
            if previous_hash != expected_previous {
                return Ok(false);
            }
            let calculated = receipt_hash(
                sequence,
                &event_type,
                &entity_id,
                &payload_json,
                &previous_hash,
                &created_at,
            );
            if calculated != stored_hash {
                return Ok(false);
            }
            expected_previous = stored_hash;
        }
        Ok(true)
    }

    pub fn reset_demo_data(&self) -> Result<()> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        transaction.execute_batch(
            "DELETE FROM permits; DELETE FROM webhook_deliveries; DELETE FROM decisions; DELETE FROM actions; DELETE FROM evidence; DELETE FROM claims; DELETE FROM events; DELETE FROM receipts; DELETE FROM sessions;",
        )?;
        transaction.commit()?;
        Ok(())
    }

    fn query_list<T>(
        &self,
        sql: &str,
        mapper: fn(&Row<'_>) -> rusqlite::Result<T>,
    ) -> Result<Vec<T>> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(sql)?;
        let rows = statement.query_map([], mapper)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>> {
        self.connection
            .lock()
            .map_err(|_| anyhow!("database lock is poisoned"))
    }
}

pub fn action_payload_hash(action_type: &str, report_markdown: &str) -> String {
    let mut payload = BTreeMap::new();
    payload.insert("actionType", action_type);
    payload.insert("reportMarkdown", report_markdown);
    sha256_hex(
        serde_json::to_string(&payload)
            .unwrap_or_default()
            .as_bytes(),
    )
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn claim_dedupe_key(session_id: &str, candidate: &ClaimCandidate) -> String {
    let value = json!({
        "sessionId": session_id,
        "companyId": candidate.company_id.as_deref().map(normalize_key_part),
        "metric": candidate.metric.as_deref().map(normalize_key_part),
        "period": candidate.period.as_deref().map(normalize_key_part),
        "assertedValue": candidate.asserted_value.as_deref().map(normalize_claim_value),
    });
    sha256_hex(value.to_string().as_bytes())
}

fn normalize_key_part(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace([' ', '-'], "_")
}

fn normalize_claim_value(value: &str) -> String {
    value
        .trim()
        .parse::<Decimal>()
        .map(|decimal| decimal.normalize().to_string())
        .unwrap_or_else(|_| normalize_key_part(value))
}

fn append_receipt_tx(
    transaction: &Transaction<'_>,
    event_type: &str,
    entity_id: &str,
    payload: &Value,
) -> Result<Receipt> {
    let previous: Option<(i64, String)> = transaction
        .query_row(
            "SELECT sequence, hash FROM receipts ORDER BY sequence DESC LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let sequence = previous.as_ref().map(|item| item.0 + 1).unwrap_or(1);
    let previous_hash = previous
        .map(|item| item.1)
        .unwrap_or_else(|| GENESIS_HASH.to_owned());
    let payload_json = serde_json::to_string(payload)?;
    let created_at = now();
    let hash = receipt_hash(
        sequence,
        event_type,
        entity_id,
        &payload_json,
        &previous_hash,
        &created_at,
    );
    let receipt = Receipt {
        id: Uuid::new_v4().to_string(),
        sequence,
        event_type: event_type.to_owned(),
        entity_id: entity_id.to_owned(),
        payload: payload.clone(),
        previous_hash,
        hash,
        created_at,
    };
    transaction.execute(
        "INSERT INTO receipts (sequence, id, event_type, entity_id, payload_json, previous_hash, hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            receipt.sequence,
            receipt.id,
            receipt.event_type,
            receipt.entity_id,
            payload_json,
            receipt.previous_hash,
            receipt.hash,
            receipt.created_at,
        ],
    )?;
    Ok(receipt)
}

fn receipt_hash(
    sequence: i64,
    event_type: &str,
    entity_id: &str,
    payload_json: &str,
    previous_hash: &str,
    created_at: &str,
) -> String {
    let canonical = format!(
        "{sequence}\n{event_type}\n{entity_id}\n{payload_json}\n{previous_hash}\n{created_at}"
    );
    sha256_hex(canonical.as_bytes())
}

fn get_action_tx(transaction: &Transaction<'_>, action_id: &str) -> Result<PendingAction> {
    Ok(transaction.query_row(
        "SELECT * FROM actions WHERE id=?1",
        params![action_id],
        action_from_row,
    )?)
}

fn decision_for_action(transaction: &Transaction<'_>, action_id: &str) -> Result<Option<Decision>> {
    Ok(transaction
        .query_row(
            "SELECT * FROM decisions WHERE action_id=?1 ORDER BY decided_at DESC LIMIT 1",
            params![action_id],
            decision_from_row,
        )
        .optional()?)
}

fn governance_receipt_payload(
    transaction: &Transaction<'_>,
    action: &PendingAction,
    decision: Option<&Decision>,
    execution_result: Value,
) -> Result<Value> {
    let mut claim_verdicts = Vec::new();
    let mut evidence_hashes = Vec::new();
    for claim_id in &action.claim_ids {
        if let Some(state) = transaction
            .query_row(
                "SELECT state FROM claims WHERE id=?1",
                params![claim_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        {
            claim_verdicts.push(json!({"claimId": claim_id, "state": state}));
        }
        let mut statement = transaction.prepare(
            "SELECT result_hash FROM evidence WHERE claim_id=?1 ORDER BY created_at ASC",
        )?;
        let hashes = statement
            .query_map(params![claim_id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        evidence_hashes.extend(
            hashes
                .into_iter()
                .map(|hash| json!({"claimId": claim_id, "hash": hash})),
        );
    }
    Ok(json!({
        "actionId": action.id,
        "claimVerdicts": claim_verdicts,
        "evidenceHashes": evidence_hashes,
        "actionPayloadHash": action.payload_hash,
        "humanDecision": decision,
        "timestamps": {
            "requestedAt": action.requested_at,
            "decidedAt": action.decided_at,
            "executedAt": action.executed_at,
        },
        "executionResult": execution_result,
    }))
}

fn claim_from_row(row: &Row<'_>) -> rusqlite::Result<Claim> {
    let state: String = row.get(12)?;
    Ok(Claim {
        id: row.get(0)?,
        session_id: row.get(2)?,
        turn_id: row.get(3)?,
        statement: row.get(4)?,
        claim_type: row.get(5)?,
        company_id: row.get(6)?,
        metric: row.get(7)?,
        period: row.get(8)?,
        asserted_value: row.get(9)?,
        unit: row.get(10)?,
        source_span: row.get(11)?,
        state: ClaimState::try_from(state.as_str()).map_err(conversion_error)?,
        confidence: row.get(13)?,
        created_at: row.get(14)?,
    })
}

fn evidence_from_row(row: &Row<'_>) -> rusqlite::Result<Evidence> {
    let record_json: Option<String> = row.get(4)?;
    Ok(Evidence {
        id: row.get(0)?,
        claim_id: row.get(1)?,
        source_kind: row.get(2)?,
        source_reference: row.get(3)?,
        record: record_json
            .map(|value| serde_json::from_str(&value).map_err(json_error))
            .transpose()?,
        result_hash: row.get(5)?,
        explanation: row.get(6)?,
        created_at: row.get(7)?,
    })
}

fn action_from_row(row: &Row<'_>) -> rusqlite::Result<PendingAction> {
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

fn decision_from_row(row: &Row<'_>) -> rusqlite::Result<Decision> {
    Ok(Decision {
        id: row.get(0)?,
        action_id: row.get(1)?,
        decision: row.get(2)?,
        reason: row.get(3)?,
        decided_by: row.get(4)?,
        decided_at: row.get(5)?,
    })
}

fn receipt_from_row(row: &Row<'_>) -> rusqlite::Result<Receipt> {
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

fn event_from_row(row: &Row<'_>) -> rusqlite::Result<CodexEvent> {
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

fn random_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
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

#[cfg(test)]
mod tests;
