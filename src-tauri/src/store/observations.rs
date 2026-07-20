use anyhow::{anyhow, Result};
use rusqlite::{params, OptionalExtension, Row};
use uuid::Uuid;

use crate::domain::{
    ClaimState, NotificationState, NotificationTarget, Observation, ObservationState,
    ObservationVerdictCounts,
};

use super::{now, sha256_hex, ClaimWrite, Store};

#[derive(Debug, Clone)]
pub struct ObservationWork {
    pub observation: Observation,
    pub message_body: String,
}

#[derive(Debug, Clone)]
pub struct EnqueuedObservation {
    pub observation: Observation,
    pub inserted: bool,
}

impl Store {
    pub fn enqueue_observation(
        &self,
        session_id: &str,
        turn_id: Option<&str>,
        cwd: Option<&str>,
        source: &str,
        message: &str,
    ) -> Result<EnqueuedObservation> {
        let message_hash = sha256_hex(message.as_bytes());
        let dedupe_key = observation_dedupe_key(session_id, turn_id, &message_hash);
        let connection = self.lock()?;
        if let Some(observation) = observation_by_dedupe(&connection, &dedupe_key)? {
            return Ok(EnqueuedObservation {
                observation,
                inserted: false,
            });
        }
        let observation = Observation {
            id: Uuid::new_v4().to_string(),
            session_id: session_id.to_owned(),
            turn_id: turn_id.map(str::to_owned),
            cwd: cwd.map(str::to_owned),
            source: source.to_owned(),
            message_hash,
            message_excerpt: bounded_excerpt(message, 240),
            state: ObservationState::Pending,
            attempts: 0,
            failure: None,
            primary_claim_id: None,
            verdict_counts: ObservationVerdictCounts::default(),
            notification_state: NotificationState::NotRequired,
            notification_target: None,
            created_at: now(),
            started_at: None,
            completed_at: None,
            notified_at: None,
        };
        connection.execute(
            r#"INSERT INTO observations (
              id, dedupe_key, session_id, turn_id, cwd, source, message_hash, message_body,
              message_excerpt, state, attempts, failure, primary_claim_id, verified_count,
              contradicted_count, unverifiable_count, notification_state, created_at,
              started_at, completed_at, notified_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, NULL, NULL, 0, 0, 0, ?11, ?12, NULL, NULL, NULL)"#,
            params![
                observation.id,
                dedupe_key,
                observation.session_id,
                observation.turn_id,
                observation.cwd,
                observation.source,
                observation.message_hash,
                message,
                observation.message_excerpt,
                observation.state.as_db(),
                observation.notification_state.as_db(),
                observation.created_at,
            ],
        )?;
        Ok(EnqueuedObservation {
            observation,
            inserted: true,
        })
    }

    pub fn recover_observations(&self) -> Result<usize> {
        let connection = self.lock()?;
        Ok(connection.execute(
            "UPDATE observations SET state='Pending', started_at=NULL WHERE state='Processing'",
            [],
        )?)
    }

    pub fn claim_next_observation(&self) -> Result<Option<ObservationWork>> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        let id = transaction
            .query_row(
                "SELECT id FROM observations WHERE state='Pending' ORDER BY created_at, id LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let Some(id) = id else {
            return Ok(None);
        };
        transaction.execute(
            "UPDATE observations SET state='Processing', attempts=attempts+1, started_at=?1 WHERE id=?2 AND state='Pending'",
            params![now(), id],
        )?;
        let work = transaction.query_row(
            &format!("{} WHERE id=?1", observation_work_select()),
            params![id],
            observation_work_from_row,
        )?;
        transaction.commit()?;
        Ok(Some(work))
    }

    pub fn complete_observation(
        &self,
        observation_id: &str,
        claims: &[ClaimWrite],
    ) -> Result<Observation> {
        let counts = verdict_counts(claims);
        let primary_claim_id = primary_claim(claims).map(|write| write.claim.id.as_str());
        let notification_state = if claims.is_empty() {
            NotificationState::NotRequired
        } else if claims
            .iter()
            .any(|write| write.was_created || write.verdict_changed)
        {
            NotificationState::Pending
        } else {
            NotificationState::Suppressed
        };
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        for (ordinal, write) in claims.iter().enumerate() {
            let relationship = if write.was_created {
                "new"
            } else if write.verdict_changed {
                "changed"
            } else {
                "repeated"
            };
            transaction.execute(
                "INSERT OR REPLACE INTO observation_claims (observation_id, claim_id, ordinal, relationship) VALUES (?1, ?2, ?3, ?4)",
                params![observation_id, write.claim.id, ordinal as i64, relationship],
            )?;
        }
        transaction.execute(
            r#"UPDATE observations SET
              state='Completed', failure=NULL, primary_claim_id=?1, verified_count=?2,
              contradicted_count=?3, unverifiable_count=?4, notification_state=?5,
              completed_at=?6
            WHERE id=?7"#,
            params![
                primary_claim_id,
                counts.verified as i64,
                counts.contradicted as i64,
                counts.unverifiable as i64,
                notification_state.as_db(),
                now(),
                observation_id,
            ],
        )?;
        let observation = transaction.query_row(
            &format!("{} WHERE id=?1", observation_select()),
            params![observation_id],
            observation_from_row,
        )?;
        transaction.commit()?;
        Ok(observation)
    }

    pub fn defer_observation(&self, observation_id: &str, failure: &str) -> Result<()> {
        let connection = self.lock()?;
        connection.execute(
            "UPDATE observations SET state='Pending', failure=?1, started_at=NULL WHERE id=?2 AND state='Processing'",
            params![failure, observation_id],
        )?;
        Ok(())
    }

    pub fn fail_observation(&self, observation_id: &str, failure: &str) -> Result<Observation> {
        let connection = self.lock()?;
        connection.execute(
            "UPDATE observations SET state='Failed', failure=?1, notification_state='NotRequired', completed_at=?2 WHERE id=?3",
            params![failure, now(), observation_id],
        )?;
        drop(connection);
        self.observation(observation_id)
    }

    pub fn retry_observation(&self, observation_id: &str) -> Result<Observation> {
        let connection = self.lock()?;
        let changed = connection.execute(
            "UPDATE observations SET state='Pending', failure=NULL, started_at=NULL, completed_at=NULL WHERE id=?1 AND state='Failed'",
            params![observation_id],
        )?;
        if changed == 0 {
            return Err(anyhow!("only failed observations can be retried"));
        }
        drop(connection);
        self.observation(observation_id)
    }

    pub fn mark_observation_notified(
        &self,
        observation_id: &str,
        state: NotificationState,
    ) -> Result<Observation> {
        if !matches!(state, NotificationState::Sent | NotificationState::Failed) {
            return Err(anyhow!("notification result must be Sent or Failed"));
        }
        let connection = self.lock()?;
        connection.execute(
            "UPDATE observations SET notification_state=?1, notified_at=?2 WHERE id=?3 AND notification_state='Pending'",
            params![state.as_db(), now(), observation_id],
        )?;
        drop(connection);
        self.observation(observation_id)
    }

    pub fn observation(&self, observation_id: &str) -> Result<Observation> {
        let connection = self.lock()?;
        Ok(connection.query_row(
            &format!("{} WHERE id=?1", observation_select()),
            params![observation_id],
            observation_from_row,
        )?)
    }

    pub fn list_recent_observations(&self) -> Result<Vec<Observation>> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(&format!(
            "{} ORDER BY created_at DESC LIMIT 40",
            observation_select()
        ))?;
        let observations = statement
            .query_map([], observation_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(observations)
    }

    pub fn observation_queue_depth(&self) -> Result<usize> {
        let connection = self.lock()?;
        let count = connection.query_row(
            "SELECT COUNT(*) FROM observations WHERE state IN ('Pending', 'Processing')",
            [],
            |row| row.get::<_, i64>(0),
        )?;
        Ok(count.max(0) as usize)
    }
}

fn observation_by_dedupe(
    connection: &rusqlite::Connection,
    dedupe_key: &str,
) -> Result<Option<Observation>> {
    Ok(connection
        .query_row(
            &format!("{} WHERE dedupe_key=?1", observation_select()),
            params![dedupe_key],
            observation_from_row,
        )
        .optional()?)
}

fn observation_select() -> &'static str {
    "SELECT id, session_id, turn_id, cwd, source, message_hash, message_excerpt, state, attempts, failure, primary_claim_id, verified_count, contradicted_count, unverifiable_count, notification_state, created_at, started_at, completed_at, notified_at FROM observations"
}

fn observation_work_select() -> &'static str {
    "SELECT id, session_id, turn_id, cwd, source, message_hash, message_excerpt, state, attempts, failure, primary_claim_id, verified_count, contradicted_count, unverifiable_count, notification_state, created_at, started_at, completed_at, notified_at, message_body FROM observations"
}

fn observation_from_row(row: &Row<'_>) -> rusqlite::Result<Observation> {
    let id: String = row.get(0)?;
    let primary_claim_id: Option<String> = row.get(10)?;
    let state: String = row.get(7)?;
    let notification_state: String = row.get(14)?;
    Ok(Observation {
        id: id.clone(),
        session_id: row.get(1)?,
        turn_id: row.get(2)?,
        cwd: row.get(3)?,
        source: row.get(4)?,
        message_hash: row.get(5)?,
        message_excerpt: row.get(6)?,
        state: ObservationState::try_from(state.as_str()).map_err(conversion_error)?,
        attempts: row.get::<_, i64>(8)?.max(0) as usize,
        failure: row.get(9)?,
        primary_claim_id: primary_claim_id.clone(),
        verdict_counts: ObservationVerdictCounts {
            verified: row.get::<_, i64>(11)?.max(0) as usize,
            contradicted: row.get::<_, i64>(12)?.max(0) as usize,
            unverifiable: row.get::<_, i64>(13)?.max(0) as usize,
        },
        notification_state: NotificationState::try_from(notification_state.as_str())
            .map_err(conversion_error)?,
        notification_target: primary_claim_id.map(|primary_claim_id| NotificationTarget {
            observation_id: id,
            primary_claim_id,
        }),
        created_at: row.get(15)?,
        started_at: row.get(16)?,
        completed_at: row.get(17)?,
        notified_at: row.get(18)?,
    })
}

fn observation_work_from_row(row: &Row<'_>) -> rusqlite::Result<ObservationWork> {
    Ok(ObservationWork {
        observation: observation_from_row(row)?,
        message_body: row.get(19)?,
    })
}

fn verdict_counts(claims: &[ClaimWrite]) -> ObservationVerdictCounts {
    let mut counts = ObservationVerdictCounts::default();
    for write in claims {
        match write.claim.state {
            ClaimState::Verified => counts.verified += 1,
            ClaimState::Contradicted => counts.contradicted += 1,
            ClaimState::Unverifiable => counts.unverifiable += 1,
        }
    }
    counts
}

fn primary_claim(claims: &[ClaimWrite]) -> Option<&ClaimWrite> {
    claims.iter().min_by_key(|write| match write.claim.state {
        ClaimState::Contradicted => 0,
        ClaimState::Unverifiable => 1,
        ClaimState::Verified => 2,
    })
}

fn observation_dedupe_key(session_id: &str, turn_id: Option<&str>, message_hash: &str) -> String {
    sha256_hex(format!("{session_id}\n{}\n{message_hash}", turn_id.unwrap_or("")).as_bytes())
}

fn bounded_excerpt(message: &str, limit: usize) -> String {
    let sanitized = message.split_whitespace().collect::<Vec<_>>().join(" ");
    if sanitized.chars().count() <= limit {
        return sanitized;
    }
    format!(
        "{}…",
        sanitized
            .chars()
            .take(limit.saturating_sub(1))
            .collect::<String>()
    )
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
