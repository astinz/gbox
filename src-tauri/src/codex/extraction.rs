use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::time::{sleep, timeout, Duration};

use super::{is_final_agent_message, CodexSupervisor};
use crate::{domain::ClaimCandidate, evidence::thread_config};

impl CodexSupervisor {
    pub(super) async fn extract_candidates(&self, text: &str) -> Result<Vec<ClaimCandidate>> {
        let config = thread_config(
            &self.evidence_settings(),
            &self.inherited_server_disable_configs(),
            true,
        );
        let final_text = self
            .run_structured_turn(
                config,
                extractor_instructions(),
                &format!(
                    "Extract the material world-state claims from the following text. Do not verify them.\n\n{text}"
                ),
                extraction_schema(),
                false,
            )
            .await?;
        let envelope: ExtractionEnvelope =
            serde_json::from_str(&final_text).context("extractor returned invalid JSON")?;
        Ok(envelope.claims)
    }

    pub(super) async fn run_structured_turn(
        &self,
        config: Value,
        developer_instructions: &str,
        prompt: &str,
        schema: Value,
        allow_web_search: bool,
    ) -> Result<String> {
        let _structured_guard = self.structured_turn_lock.lock().await;
        let mut effective_config = config;
        if !allow_web_search {
            effective_config["web_search"] = Value::String("disabled".to_owned());
        }
        let thread = self
            .request(
                "thread/start",
                json!({
                    "ephemeral": true,
                    "sandbox": "read-only",
                    "approvalPolicy": "never",
                    "config": effective_config,
                    "developerInstructions": developer_instructions,
                }),
            )
            .await?;
        let thread_id = thread
            .pointer("/thread/id")
            .and_then(Value::as_str)
            .context("internal thread has no id")?
            .to_owned();
        self.internal_threads.lock().await.insert(thread_id.clone());
        let started = self
            .begin_request(
                "turn/start",
                json!({
                    "threadId": thread_id,
                    "input": [{"type": "text", "text": prompt}],
                    "approvalPolicy": "never",
                    "outputSchema": schema,
                }),
            )
            .await;
        let (request_id, _start_response) = match started {
            Ok(started) => started,
            Err(error) => return Err(error),
        };
        let result = timeout(Duration::from_secs(120), async {
            loop {
                let events = self.store.structured_turn_events(&thread_id)?;
                if let Some(text) = events
                    .iter()
                    .filter(|event| event.method == "item/completed")
                    .find_map(|event| final_agent_text(&event.payload))
                {
                    return Ok(text.to_owned());
                }
                if let Some(completed) =
                    events.iter().find(|event| event.method == "turn/completed")
                {
                    let error = completed
                        .payload
                        .pointer("/turn/error/message")
                        .and_then(Value::as_str)
                        .unwrap_or("internal turn returned no agent message");
                    return Err(anyhow!(error.to_owned()));
                }
                sleep(Duration::from_millis(100)).await;
            }
            #[allow(unreachable_code)]
            Ok::<String, anyhow::Error>(String::new())
        })
        .await;
        self.abandon_request(request_id).await;
        result.context("internal structured turn timed out")?
    }
}

pub(super) fn final_agent_text(params: &Value) -> Option<&str> {
    params
        .get("item")
        .filter(|item| is_final_agent_message(item))
        .and_then(|item| item.get("text"))
        .and_then(Value::as_str)
}

#[derive(Deserialize)]
struct ExtractionEnvelope {
    claims: Vec<ClaimCandidate>,
}

pub(super) fn fallback_candidate(text: &str) -> ClaimCandidate {
    ClaimCandidate {
        statement: text.chars().take(500).collect(),
        claim_type: "other_factual".to_owned(),
        subject: None,
        predicate: None,
        object: None,
        asserted_value: None,
        unit: None,
        temporal_context: None,
        location: None,
        source_span: text.chars().take(240).collect(),
    }
}

fn extractor_instructions() -> &'static str {
    "You are gBox's isolated claim extractor. Do not verify claims and do not use tools. Extract only material, externally checkable claims about the world that the text presents as true or uses as the factual basis for an action. Exclude opinions, requests, predictions, plans, verification verdicts, arithmetic restatements, standalone source or record metadata, delivery or approval status, and system behavior. Do not extract a claim that the text explicitly labels false, contradicted, merely quoted, or presents only to refute. For a correction such as '17, not 42', emit only the affirmed value 17. Deduplicate repeated facts. When a report repeats one metric with a reporting period and an evidence 'as of' timestamp, emit only the reporting-period claim; the timestamp is evidence metadata, not a second claim. The predicate must name the canonical property or event being checked, preferably snake_case, such as production_database_users, revenue, or announced_policy; never use generic grammar verbs such as is, has, had, was, or said. Location means a geographic or jurisdictional place, not a system or database name. Normalize each assertion into subject, predicate, object, asserted value, unit, temporal context, and location when present. Leave unknown fields null and preserve an exact source span. Return only JSON matching the supplied schema."
}

pub(super) fn extraction_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["claims"],
        "properties": {
            "claims": {
                "type": "array",
                "maxItems": 6,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["statement", "claimType", "subject", "predicate", "object", "assertedValue", "unit", "temporalContext", "location", "sourceSpan"],
                    "properties": {
                        "statement": {"type": "string"},
                        "claimType": {"type": "string", "enum": ["quantity", "event", "attribution", "status", "relationship", "other_factual"]},
                        "subject": {"type": ["string", "null"]},
                        "predicate": {
                            "type": ["string", "null"],
                            "description": "Canonical checkable property or event, preferably snake_case; never a generic grammar verb."
                        },
                        "object": {"type": ["string", "null"]},
                        "assertedValue": {"type": ["string", "null"]},
                        "unit": {"type": ["string", "null"]},
                        "temporalContext": {"type": ["string", "null"]},
                        "location": {
                            "type": ["string", "null"],
                            "description": "Geographic or jurisdictional location only."
                        },
                        "sourceSpan": {"type": "string"}
                    }
                }
            }
        }
    })
}
