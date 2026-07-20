use anyhow::Result;
use rusqlite::{params, Connection};

use super::now;

pub(super) fn migrate(connection: &Connection) -> Result<()> {
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
          created_at TEXT NOT NULL,
          subject TEXT,
          predicate TEXT,
          object_value TEXT,
          temporal_context TEXT,
          location TEXT
        );
        CREATE TABLE IF NOT EXISTS evidence (
          id TEXT PRIMARY KEY,
          claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
          source_kind TEXT NOT NULL,
          source_reference TEXT NOT NULL,
          record_json TEXT,
          result_hash TEXT NOT NULL,
          explanation TEXT NOT NULL,
          created_at TEXT NOT NULL,
          source_name TEXT
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
    add_column(connection, "claims", "subject", "TEXT")?;
    add_column(connection, "claims", "predicate", "TEXT")?;
    add_column(connection, "claims", "object_value", "TEXT")?;
    add_column(connection, "claims", "temporal_context", "TEXT")?;
    add_column(connection, "claims", "location", "TEXT")?;
    add_column(connection, "evidence", "source_name", "TEXT")?;
    connection.execute(
        "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, ?1)",
        params![now()],
    )?;
    connection.execute(
        "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (2, ?1)",
        params![now()],
    )?;
    Ok(())
}

fn add_column(connection: &Connection, table: &str, column: &str, kind: &str) -> Result<()> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if !columns.iter().any(|existing| existing == column) {
        connection.execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {kind}"),
            [],
        )?;
    }
    Ok(())
}
