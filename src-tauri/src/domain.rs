use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub enum ClaimState {
    Verified,
    Contradicted,
    Unverifiable,
}

impl ClaimState {
    pub fn as_db(&self) -> &'static str {
        match self {
            Self::Verified => "Verified",
            Self::Contradicted => "Contradicted",
            Self::Unverifiable => "Unverifiable",
        }
    }
}

impl TryFrom<&str> for ClaimState {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "Verified" => Ok(Self::Verified),
            "Contradicted" => Ok(Self::Contradicted),
            "Unverifiable" => Ok(Self::Unverifiable),
            other => Err(format!("unknown claim state: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub enum ObservationState {
    Pending,
    Processing,
    Completed,
    Failed,
}

impl ObservationState {
    pub fn as_db(&self) -> &'static str {
        match self {
            Self::Pending => "Pending",
            Self::Processing => "Processing",
            Self::Completed => "Completed",
            Self::Failed => "Failed",
        }
    }
}

impl TryFrom<&str> for ObservationState {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "Pending" => Ok(Self::Pending),
            "Processing" => Ok(Self::Processing),
            "Completed" => Ok(Self::Completed),
            "Failed" => Ok(Self::Failed),
            other => Err(format!("unknown observation state: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub enum NotificationState {
    Pending,
    Sent,
    Suppressed,
    Failed,
    NotRequired,
}

impl NotificationState {
    pub fn as_db(&self) -> &'static str {
        match self {
            Self::Pending => "Pending",
            Self::Sent => "Sent",
            Self::Suppressed => "Suppressed",
            Self::Failed => "Failed",
            Self::NotRequired => "NotRequired",
        }
    }
}

impl TryFrom<&str> for NotificationState {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "Pending" => Ok(Self::Pending),
            "Sent" => Ok(Self::Sent),
            "Suppressed" => Ok(Self::Suppressed),
            "Failed" => Ok(Self::Failed),
            "NotRequired" => Ok(Self::NotRequired),
            other => Err(format!("unknown notification state: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ObservationVerdictCounts {
    pub verified: usize,
    pub contradicted: usize,
    pub unverifiable: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    pub id: String,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub cwd: Option<String>,
    pub source: String,
    pub message_hash: String,
    pub message_excerpt: String,
    pub state: ObservationState,
    pub attempts: usize,
    pub failure: Option<String>,
    pub primary_claim_id: Option<String>,
    pub verdict_counts: ObservationVerdictCounts,
    pub notification_state: NotificationState,
    pub notification_target: Option<NotificationTarget>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub notified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationTarget {
    pub observation_id: String,
    pub primary_claim_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub enum ActionState {
    Pending,
    Approved,
    Denied,
    Executed,
    Failed,
    Expired,
}

impl ActionState {
    pub fn as_db(&self) -> &'static str {
        match self {
            Self::Pending => "Pending",
            Self::Approved => "Approved",
            Self::Denied => "Denied",
            Self::Executed => "Executed",
            Self::Failed => "Failed",
            Self::Expired => "Expired",
        }
    }
}

impl TryFrom<&str> for ActionState {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "Pending" => Ok(Self::Pending),
            "Approved" => Ok(Self::Approved),
            "Denied" => Ok(Self::Denied),
            "Executed" => Ok(Self::Executed),
            "Failed" => Ok(Self::Failed),
            "Expired" => Ok(Self::Expired),
            other => Err(format!("unknown action state: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimCandidate {
    pub statement: String,
    pub claim_type: String,
    pub subject: Option<String>,
    pub predicate: Option<String>,
    pub object: Option<String>,
    pub asserted_value: Option<String>,
    pub unit: Option<String>,
    pub temporal_context: Option<String>,
    pub location: Option<String>,
    pub source_span: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Claim {
    pub id: String,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub statement: String,
    pub claim_type: String,
    pub subject: Option<String>,
    pub predicate: Option<String>,
    pub object: Option<String>,
    pub asserted_value: Option<String>,
    pub unit: Option<String>,
    pub temporal_context: Option<String>,
    pub location: Option<String>,
    pub source_span: String,
    pub state: ClaimState,
    pub confidence: f64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanyMetricRecord {
    #[serde(alias = "record_id")]
    pub record_id: String,
    #[serde(alias = "company_id")]
    pub company_id: String,
    pub metric: String,
    pub period: String,
    pub value: String,
    pub unit: String,
    #[serde(alias = "as_of")]
    pub as_of: String,
    #[serde(alias = "source_system")]
    pub source_system: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationPlan {
    pub source_type: String,
    pub server: Option<String>,
    pub tool: Option<String>,
    pub arguments: Option<Value>,
    pub query: Option<String>,
    pub rationale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ComparisonMethod {
    DeterministicAdapter,
    ModelAssistedMcp,
    ModelAssistedWeb,
    NoComparison,
}

impl ComparisonMethod {
    pub fn as_db(&self) -> &'static str {
        match self {
            Self::DeterministicAdapter => "deterministic_adapter",
            Self::ModelAssistedMcp => "model_assisted_mcp",
            Self::ModelAssistedWeb => "model_assisted_web",
            Self::NoComparison => "no_comparison",
        }
    }
}

impl TryFrom<&str> for ComparisonMethod {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "deterministic_adapter" => Ok(Self::DeterministicAdapter),
            "model_assisted_mcp" => Ok(Self::ModelAssistedMcp),
            "model_assisted_web" => Ok(Self::ModelAssistedWeb),
            "no_comparison" | "legacy" => Ok(Self::NoComparison),
            other => Err(format!("unknown comparison method: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub id: String,
    pub claim_id: String,
    pub source_kind: String,
    pub source_name: String,
    pub source_reference: String,
    pub content: Option<Value>,
    pub result_hash: String,
    pub explanation: String,
    pub eligible_sources: Vec<EvidenceSource>,
    pub selected_plan: Option<VerificationPlan>,
    pub comparison_method: ComparisonMethod,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct EvidenceInput {
    pub source_kind: String,
    pub source_name: String,
    pub source_reference: String,
    pub content: Option<Value>,
    pub result_hash: String,
    pub explanation: String,
    pub eligible_sources: Vec<EvidenceSource>,
    pub selected_plan: Option<VerificationPlan>,
    pub comparison_method: ComparisonMethod,
    pub failures: Vec<VerificationFailureInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationFailure {
    pub id: String,
    pub claim_id: String,
    pub stage: String,
    pub message: String,
    pub details: Option<Value>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct VerificationFailureInput {
    pub stage: String,
    pub message: String,
    pub details: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingAction {
    pub id: String,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub tool_use_id: Option<String>,
    pub action_type: String,
    pub report_markdown: String,
    pub payload_hash: String,
    pub state: ActionState,
    pub claim_ids: Vec<String>,
    pub requested_at: String,
    pub decided_at: Option<String>,
    pub executed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Decision {
    pub id: String,
    pub action_id: String,
    pub decision: String,
    pub reason: Option<String>,
    pub decided_by: String,
    pub decided_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub id: String,
    pub sequence: i64,
    pub event_type: String,
    pub entity_id: String,
    pub payload: Value,
    pub previous_hash: String,
    pub hash: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexEvent {
    pub id: String,
    pub session_id: Option<String>,
    pub method: String,
    pub summary: String,
    pub payload: Value,
    pub source: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatus {
    pub codex_found: bool,
    pub codex_path: Option<String>,
    pub codex_version: Option<String>,
    pub codex_supported: bool,
    pub app_server_connected: bool,
    pub plugin_installed: bool,
    pub hooks_trusted: bool,
    pub evidence_sources_ready: bool,
    pub evidence_source_count: usize,
    pub global_observation: bool,
    pub observation_worker_healthy: bool,
    pub observation_queue_depth: usize,
    pub receipt_chain_valid: bool,
    pub replay_mode: bool,
    pub diagnostic: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSnapshot {
    pub status: SystemStatus,
    pub claims: Vec<Claim>,
    pub evidence: Vec<Evidence>,
    pub actions: Vec<PendingAction>,
    pub decisions: Vec<Decision>,
    pub receipts: Vec<Receipt>,
    pub events: Vec<CodexEvent>,
    pub evidence_settings: EvidenceSettings,
    pub evidence_sources: Vec<EvidenceSource>,
    pub verification_failures: Vec<VerificationFailure>,
    pub recent_observations: Vec<Observation>,
    pub observation_queue_depth: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceSettings {
    pub use_codex_mcp_config: bool,
    pub web_search_mode: WebSearchMode,
    pub mcp_servers: Vec<ConfiguredMcpServer>,
}

impl Default for EvidenceSettings {
    fn default() -> Self {
        Self {
            use_codex_mcp_config: true,
            web_search_mode: WebSearchMode::Cached,
            mcp_servers: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConfiguredMcpServer {
    pub name: String,
    pub enabled: bool,
    #[serde(flatten)]
    pub transport: McpTransport,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "transport", rename_all = "snake_case")]
pub enum McpTransport {
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        cwd: Option<String>,
        #[serde(default)]
        env_vars: Vec<String>,
    },
    Http {
        url: String,
        bearer_token_env_var: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WebSearchMode {
    Disabled,
    Cached,
    Live,
}

impl WebSearchMode {
    pub fn as_config(&self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::Cached => "cached",
            Self::Live => "live",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceSource {
    pub source_kind: String,
    pub server: Option<String>,
    pub tool: Option<String>,
    pub title: String,
    pub description: String,
    pub input_schema: Value,
    pub read_only: bool,
    pub plugin_backed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEvidenceSettingsInput {
    pub settings: EvidenceSettings,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveActionInput {
    pub action_id: String,
    pub decision: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveActionResult {
    pub action: PendingAction,
    pub approval_token: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartLiveSessionInput {
    pub cwd: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSessionResult {
    pub session_id: String,
    pub turn_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendLivePromptInput {
    pub session_id: String,
    pub prompt: String,
}
