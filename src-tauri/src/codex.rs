use std::{
    collections::{HashMap, HashSet},
    env,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
};

use anyhow::{anyhow, Context, Result};
use semver::Version;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{broadcast, oneshot, Mutex},
    time::{timeout, Duration},
};

use crate::{
    domain::{Claim, ClaimCandidate, CompanyMetricRecord, LiveSessionResult, SystemStatus},
    store::Store,
    verifier::verify_candidate,
};

const MIN_CODEX_VERSION: &str = "0.144.4";
const COMPANY_SERVER_FALLBACK: &str = "company_data";

#[derive(Clone)]
struct RuntimeHandle {
    writer: Arc<Mutex<ChildStdin>>,
    child: Arc<Mutex<Child>>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    events: broadcast::Sender<Value>,
}

pub struct CodexSupervisor {
    app: AppHandle,
    store: Arc<Store>,
    runtime: Mutex<Option<RuntimeHandle>>,
    next_id: AtomicU64,
    connected: Arc<AtomicBool>,
    internal_threads: Arc<Mutex<HashSet<String>>>,
    active_turns: Arc<Mutex<HashMap<String, String>>>,
    plugin_installed: Arc<AtomicBool>,
    hooks_trusted: Arc<AtomicBool>,
    company_mcp_ready: Arc<AtomicBool>,
}

impl CodexSupervisor {
    pub fn new(app: AppHandle, store: Arc<Store>) -> Arc<Self> {
        Arc::new(Self {
            app,
            store,
            runtime: Mutex::new(None),
            next_id: AtomicU64::new(1),
            connected: Arc::new(AtomicBool::new(false)),
            internal_threads: Arc::new(Mutex::new(HashSet::new())),
            active_turns: Arc::new(Mutex::new(HashMap::new())),
            plugin_installed: Arc::new(AtomicBool::new(plugin_is_installed())),
            hooks_trusted: Arc::new(AtomicBool::new(false)),
            company_mcp_ready: Arc::new(AtomicBool::new(false)),
        })
    }

    pub async fn start_live_session(
        self: &Arc<Self>,
        cwd: &str,
        prompt: &str,
    ) -> Result<LiveSessionResult> {
        self.ensure_started().await?;
        let thread = self
            .request(
                "thread/start",
                json!({
                    "cwd": cwd,
                    "sandbox": "read-only",
                    "approvalPolicy": "never",
                    "approvalsReviewer": "user",
                    "developerInstructions": hosted_instructions(),
                }),
            )
            .await?;
        let session_id = thread
            .pointer("/thread/id")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("thread/start did not return a thread id"))?
            .to_owned();
        self.store
            .create_session(&session_id, "codex-app-server", Some(cwd))?;
        let turn = self.start_turn(&session_id, prompt, None).await?;
        self.refresh_integration_status().await;
        Ok(LiveSessionResult {
            session_id,
            turn_id: turn,
        })
    }

    pub async fn send_prompt(self: &Arc<Self>, session_id: &str, prompt: &str) -> Result<String> {
        self.ensure_started().await?;
        if let Some(turn_id) = self.active_turns.lock().await.get(session_id).cloned() {
            let response = self
                .request(
                    "turn/steer",
                    json!({
                        "threadId": session_id,
                        "expectedTurnId": turn_id,
                        "input": [{"type": "text", "text": prompt}],
                    }),
                )
                .await?;
            return response
                .get("turnId")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or_else(|| anyhow!("turn/steer did not return a turn id"));
        }
        self.start_turn(session_id, prompt, None).await
    }

    pub async fn ingest_text(
        self: &Arc<Self>,
        session_id: &str,
        turn_id: Option<&str>,
        text: &str,
    ) -> Result<Vec<Claim>> {
        if text.trim().is_empty() {
            return Ok(Vec::new());
        }
        let extraction = self.extract_candidates(text).await;
        let (candidates, extraction_succeeded, extraction_error) = match extraction {
            Ok(result) => (result, true, None),
            Err(error) => (
                vec![fallback_candidate(text)],
                false,
                Some(error.to_string()),
            ),
        };
        let verifier_thread = if extraction_succeeded {
            self.create_verifier_thread().await.ok()
        } else {
            None
        };
        let mut claims = Vec::new();
        for candidate in candidates {
            let (record, lookup_error, source_reference) = if let Some(thread) = &verifier_thread {
                match self.lookup_company_record(thread, &candidate).await {
                    Ok(result) => result,
                    Err(error) => (
                        None,
                        Some(error.to_string()),
                        "mcpServer/toolCall:company_get_metric".to_owned(),
                    ),
                }
            } else {
                (
                    None,
                    extraction_error.clone(),
                    "claim-extraction".to_owned(),
                )
            };
            let outcome = verify_candidate(&candidate, record, lookup_error.as_deref());
            let claim = self.store.upsert_claim(
                session_id,
                turn_id,
                &candidate,
                outcome.state,
                outcome.confidence,
            )?;
            let evidence_content = outcome
                .record
                .as_ref()
                .map(serde_json::to_value)
                .transpose()?;
            self.store.insert_evidence(
                &claim.id,
                "mcp",
                "company_get_metric",
                &source_reference,
                evidence_content.as_ref(),
                &outcome.result_hash,
                &outcome.explanation,
            )?;
            let _ = self.app.emit("gbox://claim-updated", &claim);
            claims.push(claim);
        }
        Ok(claims)
    }

    pub fn status(&self) -> SystemStatus {
        let resolved = resolve_codex_binary();
        let (codex_path, codex_version, codex_supported, diagnostic) = match resolved {
            Ok(path) => match codex_version(&path) {
                Ok(version) => {
                    let supported = version >= Version::parse(MIN_CODEX_VERSION).expect("version");
                    let diagnostic = (!supported).then(|| {
                        format!("Codex {version} is older than required {MIN_CODEX_VERSION}.")
                    });
                    (
                        Some(path.display().to_string()),
                        Some(version.to_string()),
                        supported,
                        diagnostic,
                    )
                }
                Err(error) => (
                    Some(path.display().to_string()),
                    None,
                    false,
                    Some(error.to_string()),
                ),
            },
            Err(error) => (None, None, false, Some(error.to_string())),
        };
        SystemStatus {
            codex_found: codex_path.is_some(),
            codex_path,
            codex_version,
            codex_supported,
            app_server_connected: self.connected.load(Ordering::Relaxed),
            plugin_installed: self.plugin_installed.load(Ordering::Relaxed),
            hooks_trusted: self.hooks_trusted.load(Ordering::Relaxed),
            evidence_sources_ready: self.company_mcp_ready.load(Ordering::Relaxed),
            evidence_source_count: usize::from(self.company_mcp_ready.load(Ordering::Relaxed)),
            diagnostic,
            ..SystemStatus::default()
        }
    }

    pub async fn shutdown(&self) {
        if let Some(runtime) = self.runtime.lock().await.take() {
            let _ = runtime.child.lock().await.kill().await;
        }
        self.connected.store(false, Ordering::Relaxed);
    }

    async fn ensure_started(self: &Arc<Self>) -> Result<RuntimeHandle> {
        if let Some(runtime) = self.runtime.lock().await.clone() {
            return Ok(runtime);
        }
        let binary = resolve_codex_binary()?;
        let version = codex_version(&binary)?;
        let minimum = Version::parse(MIN_CODEX_VERSION)?;
        if version < minimum {
            return Err(anyhow!(
                "Codex {version} is unsupported; install {MIN_CODEX_VERSION} or newer"
            ));
        }
        let mut child = Command::new(&binary)
            .args(["app-server", "--stdio"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!("failed to start {} app-server", binary.display()))?;
        let stdin = child.stdin.take().context("app-server stdin unavailable")?;
        let stdout = child
            .stdout
            .take()
            .context("app-server stdout unavailable")?;
        let stderr = child
            .stderr
            .take()
            .context("app-server stderr unavailable")?;
        let (events, _) = broadcast::channel(512);
        let runtime = RuntimeHandle {
            writer: Arc::new(Mutex::new(stdin)),
            child: Arc::new(Mutex::new(child)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            events,
        };
        *self.runtime.lock().await = Some(runtime.clone());
        self.connected.store(true, Ordering::Relaxed);

        self.spawn_stdout_reader(stdout, runtime.clone());
        self.spawn_stderr_reader(stderr);

        let initialize = self
            .request_on(
                &runtime,
                "initialize",
                json!({
                    "clientInfo": {
                        "name": "gbox",
                        "title": "gBox",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                }),
            )
            .await;
        if let Err(error) = initialize {
            *self.runtime.lock().await = None;
            self.connected.store(false, Ordering::Relaxed);
            return Err(error.context("app-server initialize failed"));
        }
        self.notify_on(&runtime, "initialized", json!({})).await?;
        self.refresh_integration_status().await;
        let _ = self.app.emit("gbox://system-status", self.status());
        Ok(runtime)
    }

    fn spawn_stdout_reader(
        self: &Arc<Self>,
        stdout: tokio::process::ChildStdout,
        runtime: RuntimeHandle,
    ) {
        let weak = Arc::downgrade(self);
        let connected = self.connected.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(message) = parse_app_server_line(&line) else {
                    if let Some(supervisor) = weak.upgrade() {
                        supervisor.record_diagnostic("app-server/invalid-json", &line);
                    }
                    continue;
                };
                if message.get("id").is_some() && message.get("method").is_none() {
                    if let Some(id) = response_id(&message) {
                        if let Some(sender) = runtime.pending.lock().await.remove(&id) {
                            let _ = sender.send(message);
                        }
                    }
                    continue;
                }
                if message.get("id").is_some() && message.get("method").is_some() {
                    if let Some(id) = message.get("id").and_then(Value::as_u64) {
                        let response = json!({
                            "id": id,
                            "error": {"code": -32601, "message": "gBox does not support this server request in read-only hosted sessions"}
                        });
                        let _ = write_json(&runtime.writer, &response).await;
                    }
                }
                let _ = runtime.events.send(message.clone());
                if let Some(supervisor) = weak.upgrade() {
                    supervisor.handle_notification(message);
                }
            }
            connected.store(false, Ordering::Relaxed);
        });
    }

    fn spawn_stderr_reader(&self, stderr: tokio::process::ChildStderr) {
        let app = self.app.clone();
        let store = self.store.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }
                if let Ok(event) = store.insert_event(
                    None,
                    "app-server/stderr",
                    &line,
                    &json!({ "message": line }),
                    "codex",
                ) {
                    let _ = app.emit("gbox://codex-event", event);
                }
            }
        });
    }

    fn handle_notification(self: Arc<Self>, message: Value) {
        tokio::spawn(async move {
            let method = message
                .get("method")
                .and_then(Value::as_str)
                .unwrap_or("app-server/unknown");
            let params = message.get("params").cloned().unwrap_or(Value::Null);
            let session_id = params
                .get("threadId")
                .and_then(Value::as_str)
                .map(str::to_owned);
            let internal = if let Some(session) = &session_id {
                self.internal_threads.lock().await.contains(session)
            } else {
                false
            };
            let source = if internal { "codex-internal" } else { "codex" };
            if method == "turn/started" {
                if let (Some(session), Some(turn_id)) = (
                    session_id.as_deref(),
                    params.pointer("/turn/id").and_then(Value::as_str),
                ) {
                    self.active_turns
                        .lock()
                        .await
                        .insert(session.to_owned(), turn_id.to_owned());
                }
            } else if method == "turn/completed" {
                if let Some(session) = session_id.as_deref() {
                    self.active_turns.lock().await.remove(session);
                }
            }
            if let Ok(event) = self.store.insert_event(
                session_id.as_deref(),
                method,
                &event_summary(method, &params),
                &params,
                source,
            ) {
                if !internal {
                    let _ = self.app.emit("gbox://codex-event", event);
                }
            }
            if method == "item/completed" && !internal {
                let item = params.get("item").unwrap_or(&Value::Null);
                if item.get("type").and_then(Value::as_str) == Some("agentMessage") {
                    if let (Some(session), Some(text)) =
                        (session_id, item.get("text").and_then(Value::as_str))
                    {
                        let turn_id = params
                            .get("turnId")
                            .and_then(Value::as_str)
                            .map(str::to_owned);
                        let supervisor = self.clone();
                        let text = text.to_owned();
                        tokio::spawn(async move {
                            if let Err(error) = supervisor
                                .ingest_text(&session, turn_id.as_deref(), &text)
                                .await
                            {
                                supervisor.record_diagnostic(
                                    "claim/extraction-failed",
                                    &error.to_string(),
                                );
                            }
                        });
                    }
                }
            }
        });
    }

    async fn start_turn(
        &self,
        session_id: &str,
        prompt: &str,
        output_schema: Option<Value>,
    ) -> Result<String> {
        let mut params = json!({
            "threadId": session_id,
            "input": [{"type": "text", "text": prompt}],
            "approvalPolicy": "never",
        });
        if let Some(schema) = output_schema {
            params["outputSchema"] = schema;
        }
        let response = self.request("turn/start", params).await?;
        response
            .pointer("/turn/id")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| anyhow!("turn/start did not return a turn id"))
    }

    async fn extract_candidates(&self, text: &str) -> Result<Vec<ClaimCandidate>> {
        let runtime = self
            .runtime
            .lock()
            .await
            .clone()
            .ok_or_else(|| anyhow!("app-server is not connected"))?;
        let mut receiver = runtime.events.subscribe();
        let thread = self
            .request(
                "thread/start",
                json!({
                    "ephemeral": true,
                    "sandbox": "read-only",
                    "approvalPolicy": "never",
                    "config": {
                        "web_search": "disabled",
                        "features": {"shell_tool": false},
                        "mcp_servers": {"company_data": {"enabled": false}},
                    },
                    "developerInstructions": extractor_instructions(),
                }),
            )
            .await?;
        let thread_id = thread
            .pointer("/thread/id")
            .and_then(Value::as_str)
            .context("extractor thread has no id")?
            .to_owned();
        self.internal_threads.lock().await.insert(thread_id.clone());
        let prompt = format!(
            "Extract independently checkable factual claims from the following text. Do not verify them.\n\n{text}"
        );
        let turn_id = self
            .start_turn(&thread_id, &prompt, Some(extraction_schema()))
            .await?;
        let final_text = timeout(Duration::from_secs(120), async {
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
                    return captured.ok_or_else(|| anyhow!("extractor returned no agent message"));
                }
            }
            #[allow(unreachable_code)]
            Ok::<String, anyhow::Error>(String::new())
        })
        .await
        .context("claim extraction timed out")??;
        let envelope: ExtractionEnvelope =
            serde_json::from_str(&final_text).context("extractor returned invalid JSON")?;
        Ok(envelope.claims)
    }

    async fn create_verifier_thread(&self) -> Result<String> {
        let thread = self
            .request(
                "thread/start",
                json!({
                    "ephemeral": true,
                    "sandbox": "read-only",
                    "approvalPolicy": "never",
                    "config": {
                        "web_search": "disabled",
                        "features": {"shell_tool": false},
                    },
                    "developerInstructions": "This internal thread is reserved for deterministic read-only company MCP calls.",
                }),
            )
            .await?;
        let thread_id = thread
            .pointer("/thread/id")
            .and_then(Value::as_str)
            .context("verifier thread has no id")?
            .to_owned();
        self.internal_threads.lock().await.insert(thread_id.clone());
        Ok(thread_id)
    }

    async fn lookup_company_record(
        &self,
        thread_id: &str,
        candidate: &ClaimCandidate,
    ) -> Result<(Option<CompanyMetricRecord>, Option<String>, String)> {
        let (Some(company_id), Some(metric), Some(period)) = (
            candidate.subject.as_deref(),
            candidate.predicate.as_deref(),
            candidate.temporal_context.as_deref(),
        ) else {
            return Ok((None, None, "mcpServer/toolCall:incomplete-claim".to_owned()));
        };
        let server = self.resolve_company_server().await;
        let (request_id, response) = self
            .request_with_id(
                "mcpServer/tool/call",
                json!({
                    "threadId": thread_id,
                    "server": server,
                    "tool": "company_get_metric",
                    "arguments": {
                        "company_id": company_id,
                        "metric": metric,
                        "period": period,
                    }
                }),
            )
            .await?;
        let source_reference = format!("mcpServer/toolCall:{request_id}");
        if response.get("isError").and_then(Value::as_bool) == Some(true) {
            return Ok((
                None,
                Some("company MCP returned an error".to_owned()),
                source_reference,
            ));
        }
        let structured = response
            .get("structuredContent")
            .cloned()
            .unwrap_or(Value::Null);
        if structured.get("found").and_then(Value::as_bool) == Some(false) {
            return Ok((None, None, source_reference));
        }
        let record_value = structured.get("record").cloned().unwrap_or(structured);
        let record = serde_json::from_value::<CompanyMetricRecord>(record_value)
            .context("company MCP returned an invalid metric record")?;
        Ok((Some(record), None, source_reference))
    }

    async fn resolve_company_server(&self) -> String {
        let Ok(response) = self.request("mcpServerStatus/list", json!({})).await else {
            return COMPANY_SERVER_FALLBACK.to_owned();
        };
        find_server_name(&response).unwrap_or_else(|| COMPANY_SERVER_FALLBACK.to_owned())
    }

    async fn refresh_integration_status(&self) {
        if let Ok(response) = self.request("mcpServerStatus/list", json!({})).await {
            let text = response.to_string().to_ascii_lowercase();
            let ready = text.contains("company_data") || text.contains("company-data");
            self.company_mcp_ready.store(ready, Ordering::Relaxed);
            self.plugin_installed.store(ready, Ordering::Relaxed);
        }
        if let Ok(response) = self.request("hooks/list", json!({})).await {
            self.hooks_trusted
                .store(gbox_hooks_are_trusted(&response), Ordering::Relaxed);
        }
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value> {
        let runtime = self
            .runtime
            .lock()
            .await
            .clone()
            .ok_or_else(|| anyhow!("app-server is not connected"))?;
        self.request_on(&runtime, method, params).await
    }

    async fn request_with_id(&self, method: &str, params: Value) -> Result<(u64, Value)> {
        let runtime = self
            .runtime
            .lock()
            .await
            .clone()
            .ok_or_else(|| anyhow!("app-server is not connected"))?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let result = self.request_id_on(&runtime, id, method, params).await?;
        Ok((id, result))
    }

    async fn request_on(
        &self,
        runtime: &RuntimeHandle,
        method: &str,
        params: Value,
    ) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.request_id_on(runtime, id, method, params).await
    }

    async fn request_id_on(
        &self,
        runtime: &RuntimeHandle,
        id: u64,
        method: &str,
        params: Value,
    ) -> Result<Value> {
        let (sender, receiver) = oneshot::channel();
        runtime.pending.lock().await.insert(id, sender);
        if let Err(error) = write_json(
            &runtime.writer,
            &json!({ "id": id, "method": method, "params": params }),
        )
        .await
        {
            runtime.pending.lock().await.remove(&id);
            return Err(error);
        }
        let response = timeout(Duration::from_secs(120), receiver)
            .await
            .with_context(|| format!("{method} timed out"))?
            .with_context(|| format!("{method} response channel closed"))?;
        if let Some(error) = response.get("error") {
            return Err(anyhow!("{method} failed: {error}"));
        }
        Ok(response.get("result").cloned().unwrap_or(Value::Null))
    }

    async fn notify_on(&self, runtime: &RuntimeHandle, method: &str, params: Value) -> Result<()> {
        write_json(
            &runtime.writer,
            &json!({ "method": method, "params": params }),
        )
        .await
    }

    fn record_diagnostic(&self, method: &str, message: &str) {
        if let Ok(event) = self.store.insert_event(
            None,
            method,
            message,
            &json!({ "message": message }),
            "gbox",
        ) {
            let _ = self.app.emit("gbox://codex-event", event);
        }
    }
}

#[derive(Deserialize)]
struct ExtractionEnvelope {
    claims: Vec<ClaimCandidate>,
}

async fn write_json(writer: &Arc<Mutex<ChildStdin>>, message: &Value) -> Result<()> {
    let mut writer = writer.lock().await;
    writer.write_all(message.to_string().as_bytes()).await?;
    writer.write_all(b"\n").await?;
    writer.flush().await?;
    Ok(())
}

fn parse_app_server_line(line: &str) -> Result<Value> {
    let value: Value = serde_json::from_str(line).context("invalid App Server JSONL frame")?;
    if !value.is_object() {
        return Err(anyhow!("App Server JSONL frame must be an object"));
    }
    Ok(value)
}

fn response_id(message: &Value) -> Option<u64> {
    (message.get("method").is_none())
        .then(|| message.get("id").and_then(Value::as_u64))
        .flatten()
}

fn resolve_codex_binary() -> Result<PathBuf> {
    if let Ok(configured) = env::var("GBOX_CODEX_BIN") {
        let path = PathBuf::from(configured);
        if path.is_file() {
            return Ok(path);
        }
        return Err(anyhow!("GBOX_CODEX_BIN does not point to a file"));
    }
    if let Some(paths) = env::var_os("PATH") {
        for directory in env::split_paths(&paths) {
            let candidate = directory.join("codex");
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    for candidate in ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"] {
        let path = Path::new(candidate);
        if path.is_file() {
            return Ok(path.to_path_buf());
        }
    }
    Err(anyhow!(
        "Codex CLI was not found. Set GBOX_CODEX_BIN or add codex to PATH."
    ))
}

fn codex_version(binary: &Path) -> Result<Version> {
    let output = std::process::Command::new(binary)
        .arg("--version")
        .output()
        .context("failed to run codex --version")?;
    if !output.status.success() {
        return Err(anyhow!("codex --version exited with {}", output.status));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let version = stdout
        .split_whitespace()
        .find_map(|part| Version::parse(part).ok())
        .ok_or_else(|| anyhow!("unable to parse Codex version from {stdout}"))?;
    Ok(version)
}

fn hosted_instructions() -> &'static str {
    "You are operating inside gBox. Check factual conclusions with the most relevant available read-only evidence tool. Preserve the subject, predicate, value, unit, time, and location when applicable. The workspace is read-only. Use gbox_send_test_webhook only when the user explicitly asks to deliver a report."
}

fn extractor_instructions() -> &'static str {
    "You are gBox's isolated claim extractor. Do not verify claims and do not use tools. Extract arbitrary independently checkable factual assertions, not opinions, requests, predictions, or instructions. Normalize each assertion into subject, predicate, object, asserted value, unit, temporal context, and location when present. Leave unknown fields null and preserve an exact source span. Return only JSON matching the supplied schema."
}

fn extraction_schema() -> Value {
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

fn fallback_candidate(text: &str) -> ClaimCandidate {
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

fn event_summary(method: &str, params: &Value) -> String {
    match method {
        "thread/started" => "Codex thread started".to_owned(),
        "turn/started" => "Codex turn started".to_owned(),
        "turn/completed" => "Codex turn completed".to_owned(),
        "item/started" => format!(
            "Started {}",
            params
                .pointer("/item/type")
                .and_then(Value::as_str)
                .unwrap_or("item")
        ),
        "item/completed" => format!(
            "Completed {}",
            params
                .pointer("/item/type")
                .and_then(Value::as_str)
                .unwrap_or("item")
        ),
        "item/agentMessage/delta" => "Agent message streaming".to_owned(),
        other => other.replace('/', " · "),
    }
}

fn find_server_name(value: &Value) -> Option<String> {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                if (key == "name" || key == "server")
                    && child.as_str().is_some_and(|name| {
                        name.contains("company_data") || name.contains("company-data")
                    })
                {
                    return child.as_str().map(str::to_owned);
                }
                if let Some(found) = find_server_name(child) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(values) => values.iter().find_map(find_server_name),
        _ => None,
    }
}

fn plugin_is_installed() -> bool {
    let Some(home) = env::var_os("HOME") else {
        return false;
    };
    let cache = PathBuf::from(home).join(".codex/plugins/cache");
    let Ok(marketplaces) = std::fs::read_dir(cache) else {
        return false;
    };
    marketplaces
        .flatten()
        .any(|marketplace| marketplace.path().join("gbox-control").is_dir())
}

fn gbox_hooks_are_trusted(response: &Value) -> bool {
    let hooks = response
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.get("hooks").and_then(Value::as_array))
        .flatten()
        .filter(|hook| {
            hook.get("pluginId")
                .and_then(Value::as_str)
                .is_some_and(|id| id.starts_with("gbox-control@"))
        })
        .collect::<Vec<_>>();
    hooks.len() >= 3
        && hooks.iter().all(|hook| {
            hook.get("enabled").and_then(Value::as_bool) == Some(true)
                && hook
                    .get("trustStatus")
                    .and_then(Value::as_str)
                    .is_some_and(|status| status == "trusted" || status == "managed")
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_company_server_in_nested_status() {
        let status = json!({"data": [{"name": "company_data", "status": "ready"}]});
        assert_eq!(find_server_name(&status).as_deref(), Some("company_data"));
    }

    #[test]
    fn extraction_schema_is_strict() {
        let schema = extraction_schema();
        assert_eq!(schema["additionalProperties"], Value::Bool(false));
        assert_eq!(
            schema["properties"]["claims"]["items"]["additionalProperties"],
            Value::Bool(false)
        );
    }

    #[test]
    fn version_parser_accepts_installed_shape() {
        let version = Version::parse("0.144.4").expect("version");
        assert!(version >= Version::parse(MIN_CODEX_VERSION).expect("minimum"));
    }

    #[test]
    fn parses_jsonl_and_correlates_only_responses() {
        let response =
            parse_app_server_line(r#"{"id":7,"result":{"ok":true}}"#).expect("response frame");
        let notification =
            parse_app_server_line(r#"{"method":"future/unknown","params":{"extra":true}}"#)
                .expect("notification frame");
        assert_eq!(response_id(&response), Some(7));
        assert_eq!(response_id(&notification), None);
        assert_eq!(
            event_summary("future/unknown", &notification["params"]),
            "future · unknown"
        );
        assert!(parse_app_server_line("[]").is_err());
    }

    #[test]
    fn requires_every_gbox_hook_to_be_enabled_and_trusted() {
        let trusted = json!({"data": [{"hooks": [
            {"pluginId": "gbox-control@gbox-local", "enabled": true, "trustStatus": "trusted"},
            {"pluginId": "gbox-control@gbox-local", "enabled": true, "trustStatus": "trusted"},
            {"pluginId": "gbox-control@gbox-local", "enabled": true, "trustStatus": "trusted"}
        ]}]});
        assert!(gbox_hooks_are_trusted(&trusted));
        let modified = json!({"data": [{"hooks": [
            {"pluginId": "gbox-control@gbox-local", "enabled": true, "trustStatus": "trusted"},
            {"pluginId": "gbox-control@gbox-local", "enabled": true, "trustStatus": "modified"},
            {"pluginId": "gbox-control@gbox-local", "enabled": true, "trustStatus": "trusted"}
        ]}]});
        assert!(!gbox_hooks_are_trusted(&modified));
    }
}
