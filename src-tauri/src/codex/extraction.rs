use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::time::{timeout, Duration};

use super::CodexSupervisor;
use crate::{domain::ClaimCandidate, evidence::thread_config};

impl CodexSupervisor {
    pub(super) async fn extract_candidates(&self, text: &str) -> Result<Vec<ClaimCandidate>> {
        let config = thread_config(
            &self.evidence_settings(),
            &self.inherited_server_names(),
            true,
        );
        let final_text = self
            .run_structured_turn(
                config,
                extractor_instructions(),
                &format!(
                    "Extract independently checkable factual claims from the following text. Do not verify them.\n\n{text}"
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
        let runtime = self
            .runtime
            .lock()
            .await
            .clone()
            .ok_or_else(|| anyhow!("app-server is not connected"))?;
        let mut receiver = runtime.events.subscribe();
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
        let turn_id = self.start_turn(&thread_id, prompt, Some(schema)).await?;
        timeout(Duration::from_secs(120), async {
            let mut captured = None;
            loop {
                let message = receiver.recv().await?;
                let method = message.get("method").and_then(Value::as_str);
                let params = message.get("params").unwrap_or(&Value::Null);
                if params.get("threadId").and_then(Value::as_str) != Some(thread_id.as_str()) {
                    continue;
                }
                if method == Some("item/completed")
                    && params.get("turnId").and_then(Value::as_str) == Some(turn_id.as_str())
                {
                    let item = params.get("item").unwrap_or(&Value::Null);
                    if item.get("type").and_then(Value::as_str) == Some("agentMessage") {
                        captured = item.get("text").and_then(Value::as_str).map(str::to_owned);
                    }
                }
                if method == Some("turn/completed")
                    && params.get("turnId").and_then(Value::as_str) == Some(turn_id.as_str())
                {
                    return captured
                        .ok_or_else(|| anyhow!("internal turn returned no agent message"));
                }
            }
            #[allow(unreachable_code)]
            Ok::<String, anyhow::Error>(String::new())
        })
        .await
        .context("internal structured turn timed out")?
    }
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
    "You are gBox's isolated claim extractor. Do not verify claims and do not use tools. Extract arbitrary independently checkable factual assertions, not opinions, requests, predictions, or instructions. Normalize each assertion into subject, predicate, object, asserted value, unit, temporal context, and location when present. Leave unknown fields null and preserve an exact source span. Return only JSON matching the supplied schema."
}

pub(super) fn extraction_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["claims"],
        "properties": {
            "claims": {
                "type": "array",
                "maxItems": 12,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["statement", "claimType", "subject", "predicate", "object", "assertedValue", "unit", "temporalContext", "location", "sourceSpan"],
                    "properties": {
                        "statement": {"type": "string"},
                        "claimType": {"type": "string", "enum": ["quantity", "event", "attribution", "status", "relationship", "other_factual"]},
                        "subject": {"type": ["string", "null"]},
                        "predicate": {"type": ["string", "null"]},
                        "object": {"type": ["string", "null"]},
                        "assertedValue": {"type": ["string", "null"]},
                        "unit": {"type": ["string", "null"]},
                        "temporalContext": {"type": ["string", "null"]},
                        "location": {"type": ["string", "null"]},
                        "sourceSpan": {"type": "string"}
                    }
                }
            }
        }
    })
}
