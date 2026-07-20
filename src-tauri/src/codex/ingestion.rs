use std::sync::Arc;

use anyhow::{anyhow, Result};
use tauri::Emitter;

use super::{extraction::fallback_candidate, CodexSupervisor};
use crate::{domain::Claim, evidence::EvidenceOutcome, store::ClaimWrite};

impl CodexSupervisor {
    pub async fn ingest_text(
        self: &Arc<Self>,
        session_id: &str,
        turn_id: Option<&str>,
        text: &str,
    ) -> Result<Vec<Claim>> {
        Ok(self
            .ingest_with_status(session_id, turn_id, text, true)
            .await?
            .into_iter()
            .map(|write| write.claim)
            .collect())
    }

    pub async fn ingest_observation_text(
        self: &Arc<Self>,
        session_id: &str,
        turn_id: Option<&str>,
        text: &str,
    ) -> Result<Vec<ClaimWrite>> {
        self.ensure_started().await?;
        self.ingest_with_status(session_id, turn_id, text, false)
            .await
    }

    async fn ingest_with_status(
        self: &Arc<Self>,
        session_id: &str,
        turn_id: Option<&str>,
        text: &str,
        allow_extraction_fallback: bool,
    ) -> Result<Vec<ClaimWrite>> {
        if text.trim().is_empty() {
            return Ok(Vec::new());
        }
        let extraction = self.extract_candidates(text).await;
        let (candidates, extraction_succeeded, extraction_error) = match extraction {
            Ok(result) => (result, true, None),
            Err(error) if !allow_extraction_fallback => return Err(error),
            Err(error) => (
                vec![fallback_candidate(text)],
                false,
                Some(error.to_string()),
            ),
        };
        let mut claims = Vec::new();
        for candidate in candidates {
            let outcome = if extraction_succeeded {
                self.verify_claim(&candidate).await.unwrap_or_else(|error| {
                    let mut outcome = EvidenceOutcome::unverifiable(
                        "verification-router",
                        format!("Verification failed: {error}"),
                    );
                    outcome.record_failure("verification", error.to_string(), None);
                    outcome
                })
            } else {
                let message = extraction_error
                    .clone()
                    .ok_or_else(|| anyhow!("claim extraction failed without a diagnostic"))?;
                let mut outcome = EvidenceOutcome::unverifiable("claim-extraction", &message);
                outcome.record_failure("extraction", message, None);
                outcome
            };
            let write = self.store.upsert_claim_with_status(
                session_id,
                turn_id,
                &candidate,
                outcome.state.clone(),
                outcome.confidence,
            )?;
            self.store
                .insert_evidence(&write.claim.id, &outcome.to_input())?;
            let _ = self.app.emit("gbox://claim-updated", &write.claim);
            claims.push(write);
        }
        Ok(claims)
    }
}
