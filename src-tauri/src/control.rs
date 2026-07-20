use std::{path::PathBuf, sync::Arc};

use anyhow::{Context, Result};
use axum::{
    extract::{DefaultBodyLimit, State},
    http::{header::AUTHORIZATION, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use uuid::Uuid;

use crate::{domain::ActionState, state::ApplicationState};

#[derive(Clone)]
struct ControlContext {
    app: AppHandle,
    state: Arc<ApplicationState>,
    bearer_token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveryDocument {
    endpoint: String,
    bearer_token: String,
    pid: u32,
    version: String,
}

#[derive(Debug, Deserialize)]
struct HookPayload {
    session_id: Option<String>,
    turn_id: Option<String>,
    tool_name: Option<String>,
    tool_use_id: Option<String>,
    tool_input: Option<Value>,
    tool_response: Option<Value>,
    last_assistant_message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WebhookPayload {
    report_markdown: String,
    #[serde(default = "default_event_type")]
    event_type: String,
    approval_token: String,
    gbox_action_id: String,
}

pub async fn start_control_server(
    app: AppHandle,
    state: Arc<ApplicationState>,
    app_data_dir: PathBuf,
) -> Result<()> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .context("failed to bind gBox loopback control service")?;
    let address = listener.local_addr()?;
    let bearer_token = random_token();
    let context = ControlContext {
        app,
        state,
        bearer_token: bearer_token.clone(),
    };
    let router = Router::new()
        .route("/status", get(status))
        .route("/hooks/pre-tool-use", post(pre_tool_use))
        .route("/hooks/post-tool-use", post(post_tool_use))
        .route("/hooks/stop", post(stop_hook))
        .route("/webhook-sink", post(webhook_sink))
        .layer(DefaultBodyLimit::max(64 * 1024))
        .with_state(context);
    let document = DiscoveryDocument {
        endpoint: format!("http://{address}"),
        bearer_token,
        pid: std::process::id(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
    };
    write_discovery_file(app_data_dir, &document)?;
    tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, router).await {
            eprintln!("gBox loopback service stopped: {error}");
        }
    });
    Ok(())
}

async fn status(State(context): State<ControlContext>, headers: HeaderMap) -> Response {
    if !authorized(&headers, &context) {
        return error_response(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    Json(json!({
        "ok": true,
        "globalObservation": context.state.global_observation(),
        "pendingApproval": context.state.gate.has_pending().await,
    }))
    .into_response()
}

async fn pre_tool_use(
    State(context): State<ControlContext>,
    headers: HeaderMap,
    Json(payload): Json<HookPayload>,
) -> Response {
    if !authorized(&headers, &context) {
        return error_response(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let tool_input = payload.tool_input.unwrap_or_else(|| json!({}));
    let report = tool_input
        .get("report_markdown")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if report.is_empty() || report.len() > 50_000 {
        return error_response(
            StatusCode::BAD_REQUEST,
            "report_markdown is required and must be at most 50,000 characters",
        );
    }
    let session_id = payload
        .session_id
        .unwrap_or_else(|| format!("global-{}", Uuid::new_v4()));
    if let Err(error) = context
        .state
        .store
        .create_session(&session_id, "codex-global-hook", None)
    {
        return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string());
    }
    let claims = context
        .state
        .codex
        .ingest_text(&session_id, payload.turn_id.as_deref(), report)
        .await
        .unwrap_or_default();
    let claim_ids = claims.into_iter().map(|claim| claim.id).collect::<Vec<_>>();
    let action_type = tool_input
        .get("event_type")
        .and_then(Value::as_str)
        .unwrap_or("test_webhook");
    let action = match context.state.store.insert_action(
        &session_id,
        payload.turn_id.as_deref(),
        payload.tool_use_id.as_deref(),
        action_type,
        report,
        &claim_ids,
    ) {
        Ok(action) => action,
        Err(error) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
    };
    let response = context.state.gate.request(action, tool_input).await;
    Json(serde_json::to_value(response).unwrap_or_else(|_| {
        json!({
            "decision": "deny",
            "reason": "gBox could not encode the approval result"
        })
    }))
    .into_response()
}

async fn post_tool_use(
    State(context): State<ControlContext>,
    headers: HeaderMap,
    Json(payload): Json<HookPayload>,
) -> Response {
    if !authorized(&headers, &context) {
        return error_response(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let action_id = payload
        .tool_input
        .as_ref()
        .and_then(|input| input.get("gbox_action_id"))
        .and_then(Value::as_str);
    let failed = payload
        .tool_response
        .as_ref()
        .is_some_and(|response| response.get("isError").and_then(Value::as_bool) == Some(true));
    if let Some(action_id) = action_id {
        if failed {
            let _ = context
                .state
                .store
                .mark_action_failed(action_id, "MCP webhook tool reported an error");
        }
    }
    let event_payload = json!({
        "toolName": payload.tool_name,
        "toolUseId": payload.tool_use_id,
        "toolResponse": payload.tool_response,
    });
    if let Ok(event) = context.state.store.insert_event(
        payload.session_id.as_deref(),
        "hook/post-tool-use",
        "Global Codex tool completed",
        &event_payload,
        "codex-hook",
    ) {
        let _ = context.app.emit("gbox://codex-event", event);
    }
    Json(json!({"ok": true})).into_response()
}

async fn stop_hook(
    State(context): State<ControlContext>,
    headers: HeaderMap,
    Json(payload): Json<HookPayload>,
) -> Response {
    if !authorized(&headers, &context) {
        return error_response(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    if !context.state.global_observation() {
        return Json(json!({"ok": true, "observed": false})).into_response();
    }
    let Some(message) = payload.last_assistant_message else {
        return Json(json!({"ok": true, "observed": false})).into_response();
    };
    let session_id = payload
        .session_id
        .unwrap_or_else(|| format!("global-{}", Uuid::new_v4()));
    let _ = context
        .state
        .store
        .create_session(&session_id, "codex-global-hook", None);
    let codex = context.state.codex.clone();
    let turn_id = payload.turn_id;
    tokio::spawn(async move {
        let _ = codex
            .ingest_text(&session_id, turn_id.as_deref(), &message)
            .await;
    });
    Json(json!({"ok": true, "observed": true})).into_response()
}

async fn webhook_sink(
    State(context): State<ControlContext>,
    headers: HeaderMap,
    Json(payload): Json<WebhookPayload>,
) -> Response {
    if !authorized(&headers, &context) {
        return error_response(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    match context.state.store.consume_permit(
        &payload.approval_token,
        &payload.gbox_action_id,
        &payload.event_type,
        &payload.report_markdown,
    ) {
        Ok(action) => {
            let _ = context.app.emit(
                "gbox://receipt-created",
                json!({
                    "actionId": action.id,
                    "state": ActionState::Executed,
                }),
            );
            Json(json!({
                "ok": true,
                "actionId": action.id,
                "delivery": "loopback-webhook",
                "deliveredAt": action.executed_at,
            }))
            .into_response()
        }
        Err(error) => error_response(StatusCode::FORBIDDEN, &error.to_string()),
    }
}

fn authorized(headers: &HeaderMap, context: &ControlContext) -> bool {
    let expected = format!("Bearer {}", context.bearer_token);
    let authorized = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value == expected);
    authorized
}

fn error_response(status: StatusCode, message: &str) -> Response {
    (
        status,
        Json(json!({
            "ok": false,
            "error": message,
        })),
    )
        .into_response()
}

fn write_discovery_file(app_data_dir: PathBuf, document: &DiscoveryDocument) -> Result<()> {
    std::fs::create_dir_all(&app_data_dir)?;
    let path = app_data_dir.join("hook-endpoint.json");
    std::fs::write(&path, serde_json::to_vec_pretty(document)?)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn random_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn default_event_type() -> String {
    "test_webhook".to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_document_does_not_expose_non_loopback_address() {
        let document = DiscoveryDocument {
            endpoint: "http://127.0.0.1:43123".to_owned(),
            bearer_token: "token".to_owned(),
            pid: 1,
            version: "0.1.0".to_owned(),
        };
        assert!(document.endpoint.starts_with("http://127.0.0.1:"));
    }
}
