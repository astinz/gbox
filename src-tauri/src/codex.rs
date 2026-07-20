use std::{
    collections::{HashMap, HashSet},
    env,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        Arc, RwLock as StdRwLock,
    },
};

use anyhow::{anyhow, Context, Result};
use semver::Version;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{oneshot, Mutex},
    time::{timeout, Duration},
};

use crate::{
    domain::{Claim, EvidenceSettings, EvidenceSource, LiveSessionResult, SystemStatus},
    evidence::{sources_from_status, thread_config, validate_settings, EvidenceOutcome},
    store::Store,
};

mod extraction;
mod verification;
use extraction::fallback_candidate;

const MIN_CODEX_VERSION: &str = "0.144.4";

#[derive(Clone)]
struct RuntimeHandle {
    writer: Arc<Mutex<ChildStdin>>,
    child: Arc<Mutex<Child>>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
}

pub struct CodexSupervisor {
    app: AppHandle,
    store: Arc<Store>,
    runtime: Mutex<Option<RuntimeHandle>>,
    next_id: AtomicU64,
    connected: Arc<AtomicBool>,
    internal_threads: Arc<Mutex<HashSet<String>>>,
    structured_turn_lock: Mutex<()>,
    active_turns: Arc<Mutex<HashMap<String, String>>>,
    plugin_installed: Arc<AtomicBool>,
    hooks_trusted: Arc<AtomicBool>,
    evidence_source_count: Arc<AtomicUsize>,
    evidence_settings: StdRwLock<EvidenceSettings>,
    evidence_sources: StdRwLock<Vec<EvidenceSource>>,
    inherited_server_disable_configs: StdRwLock<Map<String, Value>>,
}

impl CodexSupervisor {
    pub fn new(app: AppHandle, store: Arc<Store>) -> Arc<Self> {
        let evidence_settings = store
            .get_setting("evidence_settings")
            .ok()
            .flatten()
            .and_then(|value| serde_json::from_str(&value).ok())
            .unwrap_or_default();
        Arc::new(Self {
            app,
            store,
            runtime: Mutex::new(None),
            next_id: AtomicU64::new(1),
            connected: Arc::new(AtomicBool::new(false)),
            internal_threads: Arc::new(Mutex::new(HashSet::new())),
            structured_turn_lock: Mutex::new(()),
            active_turns: Arc::new(Mutex::new(HashMap::new())),
            plugin_installed: Arc::new(AtomicBool::new(plugin_is_installed())),
            hooks_trusted: Arc::new(AtomicBool::new(false)),
            evidence_source_count: Arc::new(AtomicUsize::new(0)),
            evidence_settings: StdRwLock::new(evidence_settings),
            evidence_sources: StdRwLock::new(Vec::new()),
            inherited_server_disable_configs: StdRwLock::new(Map::new()),
        })
    }

    pub async fn start_live_session(
        self: &Arc<Self>,
        cwd: &str,
        prompt: &str,
    ) -> Result<LiveSessionResult> {
        self.ensure_started().await?;
        let config = thread_config(
            &self.evidence_settings(),
            &self.inherited_server_disable_configs(),
            false,
        );
        let thread = self
            .request(
                "thread/start",
                json!({
                    "cwd": cwd,
                    "sandbox": "read-only",
                    "approvalPolicy": "never",
                    "approvalsReviewer": "user",
                    "config": config,
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
        self.refresh_integration_status(Some(&session_id)).await;
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
                    .unwrap_or_else(|| "Claim extraction failed".to_owned());
                let mut outcome = EvidenceOutcome::unverifiable("claim-extraction", &message);
                outcome.record_failure("extraction", message, None);
                outcome
            };
            let claim = self.store.upsert_claim(
                session_id,
                turn_id,
                &candidate,
                outcome.state.clone(),
                outcome.confidence,
            )?;
            self.store.insert_evidence(&claim.id, &outcome.to_input())?;
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
            evidence_sources_ready: self.evidence_source_count.load(Ordering::Relaxed) > 0,
            evidence_source_count: self.evidence_source_count.load(Ordering::Relaxed),
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

    pub fn evidence_settings(&self) -> EvidenceSettings {
        self.evidence_settings
            .read()
            .map(|settings| settings.clone())
            .unwrap_or_default()
    }

    pub fn evidence_sources(&self) -> Vec<EvidenceSource> {
        self.evidence_sources
            .read()
            .map(|sources| sources.clone())
            .unwrap_or_default()
    }

    pub fn update_evidence_settings(&self, settings: EvidenceSettings) -> Result<EvidenceSettings> {
        validate_settings(&settings)?;
        self.store
            .set_setting("evidence_settings", &serde_json::to_string(&settings)?)?;
        *self
            .evidence_settings
            .write()
            .map_err(|_| anyhow!("evidence settings lock is poisoned"))? = settings.clone();
        Ok(settings)
    }

    pub async fn refresh_evidence_sources(self: &Arc<Self>) -> Result<Vec<EvidenceSource>> {
        self.ensure_started().await?;
        let thread_id = self.create_verifier_thread().await?;
        self.refresh_integration_status(Some(&thread_id)).await;
        let sources = self.evidence_sources();
        let _ = self.app.emit("gbox://system-status", self.status());
        Ok(sources)
    }

    fn inherited_server_disable_configs(&self) -> Map<String, Value> {
        self.inherited_server_disable_configs
            .read()
            .map(|configs| configs.clone())
            .unwrap_or_default()
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
        let runtime = RuntimeHandle {
            writer: Arc::new(Mutex::new(stdin)),
            child: Arc::new(Mutex::new(child)),
            pending: Arc::new(Mutex::new(HashMap::new())),
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
        self.refresh_integration_status(None).await;
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
            let session_id = notification_thread_id(&params).map(str::to_owned);
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
                if is_final_agent_message(item) {
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

    async fn create_verifier_thread(&self) -> Result<String> {
        let config = thread_config(
            &self.evidence_settings(),
            &self.inherited_server_disable_configs(),
            false,
        );
        let thread = self
            .request(
                "thread/start",
                json!({
                    "ephemeral": true,
                    "sandbox": "read-only",
                    "approvalPolicy": "never",
                    "config": config,
                    "developerInstructions": "This internal thread is reserved for gBox read-only evidence calls. Never use a write-capable tool.",
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

    async fn refresh_integration_status(&self, thread_id: Option<&str>) {
        if let Ok(configs) = configured_mcp_server_disable_configs().await {
            if let Ok(mut current) = self.inherited_server_disable_configs.write() {
                *current = configs;
            }
        }
        if let Ok(response) = self.list_mcp_server_status(thread_id).await {
            let text = response.to_string().to_ascii_lowercase();
            let gbox_plugin_ready = text.contains("company_data") || text.contains("company-data");
            let mut sources = sources_from_status(&response, &self.evidence_settings());
            if gbox_plugin_ready {
                for source in &mut sources {
                    if source.server.as_deref().is_some_and(|name| {
                        name.contains("company_data") || name.contains("company-data")
                    }) {
                        source.plugin_backed = true;
                        source.source_kind = "plugin_mcp".to_owned();
                    }
                }
            }
            self.evidence_source_count
                .store(sources.len(), Ordering::Relaxed);
            if let Ok(mut current) = self.evidence_sources.write() {
                *current = sources;
            }
            self.plugin_installed
                .store(gbox_plugin_ready, Ordering::Relaxed);
        }
        if let Ok(response) = self.request("hooks/list", json!({})).await {
            self.hooks_trusted
                .store(gbox_hooks_are_trusted(&response), Ordering::Relaxed);
        }
    }

    async fn list_mcp_server_status(&self, thread_id: Option<&str>) -> Result<Value> {
        let mut data = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..32 {
            let mut params = json!({"detail": "full", "limit": 100});
            if let Some(thread_id) = thread_id {
                params["threadId"] = Value::String(thread_id.to_owned());
            }
            if let Some(current) = &cursor {
                params["cursor"] = Value::String(current.clone());
            }
            let page = self.request("mcpServerStatus/list", params).await?;
            data.extend(
                page.get("data")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default(),
            );
            cursor = page
                .get("nextCursor")
                .and_then(Value::as_str)
                .map(str::to_owned);
            if cursor.is_none() {
                break;
            }
        }
        Ok(json!({"data": data, "nextCursor": cursor}))
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

    async fn begin_request(
        &self,
        method: &str,
        params: Value,
    ) -> Result<(u64, oneshot::Receiver<Value>)> {
        let runtime = self
            .runtime
            .lock()
            .await
            .clone()
            .ok_or_else(|| anyhow!("app-server is not connected"))?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        runtime.pending.lock().await.insert(id, sender);
        let writer = runtime.writer.clone();
        let pending = runtime.pending.clone();
        let message = json!({ "id": id, "method": method, "params": params });
        tokio::spawn(async move {
            if write_json(&writer, &message).await.is_err() {
                pending.lock().await.remove(&id);
            }
        });
        Ok((id, receiver))
    }

    async fn abandon_request(&self, id: u64) {
        if let Some(runtime) = self.runtime.lock().await.clone() {
            runtime.pending.lock().await.remove(&id);
        }
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

async fn write_json(writer: &Arc<Mutex<ChildStdin>>, message: &Value) -> Result<()> {
    let mut writer = writer.lock().await;
    writer.write_all(message.to_string().as_bytes()).await?;
    writer.write_all(b"\n").await?;
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

fn notification_thread_id(params: &Value) -> Option<&str> {
    params
        .get("threadId")
        .and_then(Value::as_str)
        .or_else(|| params.pointer("/thread/id").and_then(Value::as_str))
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

async fn configured_mcp_server_disable_configs() -> Result<Map<String, Value>> {
    let binary = resolve_codex_binary()?;
    let output = Command::new(binary)
        .args(["mcp", "list", "--json"])
        .output()
        .await
        .context("failed to run codex mcp list --json")?;
    if !output.status.success() {
        return Err(anyhow!(
            "codex mcp list --json exited with {}",
            output.status
        ));
    }
    parse_configured_mcp_server_disable_configs(&output.stdout)
}

fn parse_configured_mcp_server_disable_configs(output: &[u8]) -> Result<Map<String, Value>> {
    let servers: Value = serde_json::from_slice(output).context("invalid Codex MCP list JSON")?;
    servers
        .as_array()
        .context("Codex MCP list must be an array")?
        .iter()
        .map(disabled_mcp_server_config)
        .collect()
}

fn disabled_mcp_server_config(server: &Value) -> Result<(String, Value)> {
    let name = server
        .get("name")
        .and_then(Value::as_str)
        .context("Codex MCP server has no name")?
        .to_owned();
    let transport = server
        .get("transport")
        .and_then(Value::as_object)
        .context("Codex MCP server has no transport")?;
    let mut config = Map::from_iter([("enabled".to_owned(), Value::Bool(false))]);
    match transport.get("type").and_then(Value::as_str) {
        Some("stdio") => {
            copy_config_field(transport, &mut config, "command");
            copy_config_field(transport, &mut config, "args");
            copy_config_field(transport, &mut config, "cwd");
            copy_config_field(transport, &mut config, "env_vars");
        }
        Some("streamable_http") => {
            copy_config_field(transport, &mut config, "url");
            copy_config_field(transport, &mut config, "bearer_token_env_var");
        }
        Some(other) => return Err(anyhow!("unsupported Codex MCP transport: {other}")),
        None => return Err(anyhow!("Codex MCP transport has no type")),
    }
    Ok((name, Value::Object(config)))
}

fn copy_config_field(source: &Map<String, Value>, target: &mut Map<String, Value>, key: &str) {
    if let Some(value) = source.get(key).filter(|value| !value.is_null()) {
        target.insert(key.to_owned(), value.clone());
    }
}

fn is_final_agent_message(item: &Value) -> bool {
    item.get("type").and_then(Value::as_str) == Some("agentMessage")
        && item.get("phase").and_then(Value::as_str) == Some("final_answer")
}

fn hosted_instructions() -> &'static str {
    "You are operating inside gBox. Check factual conclusions with the most relevant available read-only evidence tool. Preserve the subject, predicate, value, unit, time, and location when applicable. The workspace is read-only. Use gbox_send_test_webhook only when the user explicitly asks to deliver a report."
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
mod tests;
