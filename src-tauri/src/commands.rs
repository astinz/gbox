use std::{path::PathBuf, sync::Arc};

use tauri::{AppHandle, Emitter, Manager, State};

use crate::{
    domain::{
        DashboardSnapshot, LiveSessionResult, NotificationState, Observation, ResolveActionInput,
        ResolveActionResult, SendLivePromptInput, StartLiveSessionInput, SystemStatus,
        UpdateEvidenceSettingsInput,
    },
    replay,
    state::ApplicationState,
};

type CommandResult<T> = Result<T, String>;

#[tauri::command]
pub fn get_system_status(state: State<'_, Arc<ApplicationState>>) -> SystemStatus {
    state.status()
}

#[tauri::command]
pub fn get_dashboard_snapshot(
    state: State<'_, Arc<ApplicationState>>,
) -> CommandResult<DashboardSnapshot> {
    state.snapshot().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn verify_receipt_chain(state: State<'_, Arc<ApplicationState>>) -> CommandResult<bool> {
    state
        .store
        .verify_receipt_chain()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_global_observation(
    app: AppHandle,
    state: State<'_, Arc<ApplicationState>>,
    enabled: bool,
) -> CommandResult<SystemStatus> {
    let status = state
        .set_global_observation(enabled)
        .map_err(|error| error.to_string())?;
    let _ = app.emit("gbox://system-status", &status);
    Ok(status)
}

#[tauri::command]
pub fn retry_observation(
    state: State<'_, Arc<ApplicationState>>,
    observation_id: String,
) -> CommandResult<Observation> {
    state
        .observations
        .retry(&observation_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn mark_observation_notified(
    state: State<'_, Arc<ApplicationState>>,
    observation_id: String,
    notification_state: NotificationState,
) -> CommandResult<Observation> {
    state
        .store
        .mark_observation_notified(&observation_id, notification_state)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn update_evidence_settings(
    app: AppHandle,
    state: State<'_, Arc<ApplicationState>>,
    input: UpdateEvidenceSettingsInput,
) -> CommandResult<DashboardSnapshot> {
    state
        .codex
        .update_evidence_settings(input.settings)
        .map_err(|error| error.to_string())?;
    state
        .codex
        .refresh_evidence_sources()
        .await
        .map_err(|error| error.to_string())?;
    let snapshot = state.snapshot().map_err(|error| error.to_string())?;
    let _ = app.emit("gbox://system-status", &snapshot.status);
    Ok(snapshot)
}

#[tauri::command]
pub async fn start_live_session(
    state: State<'_, Arc<ApplicationState>>,
    input: StartLiveSessionInput,
) -> CommandResult<LiveSessionResult> {
    state.set_replay_mode(false);
    state
        .codex
        .start_live_session(&input.cwd, &input.prompt)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn send_live_prompt(
    state: State<'_, Arc<ApplicationState>>,
    input: SendLivePromptInput,
) -> CommandResult<String> {
    state
        .codex
        .send_prompt(&input.session_id, &input.prompt)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn start_replay(
    app: AppHandle,
    state: State<'_, Arc<ApplicationState>>,
) -> CommandResult<DashboardSnapshot> {
    let app_data_dir = app_data_dir(&app)?;
    replay::start_replay(app, state.inner().clone(), &app_data_dir)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn resolve_action(
    state: State<'_, Arc<ApplicationState>>,
    input: ResolveActionInput,
) -> CommandResult<ResolveActionResult> {
    state
        .gate
        .resolve(input)
        .await
        .map_err(|error| error.to_string())
}

fn app_data_dir(app: &AppHandle) -> CommandResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("could not resolve the gBox app-data directory: {error}"))
}
