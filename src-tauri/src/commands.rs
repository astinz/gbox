use std::{path::PathBuf, sync::Arc};

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;

use crate::{
    domain::{
        DashboardSnapshot, LiveSessionResult, NotificationState, Observation, ResolveActionInput,
        ResolveActionResult, SendLivePromptInput, StartLiveSessionInput, SystemStatus,
        UpdateEvidenceSettingsInput,
    },
    notch, replay,
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
    if enabled && !state.launch_at_login_configured() && app.autolaunch().enable().is_ok() {
        let _ = state.set_launch_at_login(true);
    }
    let status = state
        .set_global_observation(enabled)
        .map_err(|error| error.to_string())?;
    notch::set_visible(&app, enabled && status.notch_enabled).map_err(|error| error.to_string())?;
    let _ = app.emit("gbox://system-status", &status);
    Ok(status)
}

#[tauri::command]
pub fn set_notch_enabled(
    app: AppHandle,
    state: State<'_, Arc<ApplicationState>>,
    enabled: bool,
) -> CommandResult<SystemStatus> {
    let status = state
        .set_notch_enabled(enabled)
        .map_err(|error| error.to_string())?;
    notch::set_visible(&app, enabled && status.global_observation)
        .map_err(|error| error.to_string())?;
    let _ = app.emit("gbox://system-status", &status);
    Ok(status)
}

#[tauri::command]
pub fn set_notch_presentation(app: AppHandle, expanded: bool) -> CommandResult<()> {
    notch::set_presentation(&app, expanded).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_main_window(
    app: AppHandle,
    observation_id: Option<String>,
    primary_claim_id: Option<String>,
) -> CommandResult<()> {
    crate::show_main_window(&app);
    if let (Some(observation_id), Some(primary_claim_id)) = (observation_id, primary_claim_id) {
        app.emit_to(
            "main",
            "gbox://open-claim",
            crate::domain::NotificationTarget {
                observation_id,
                primary_claim_id,
            },
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_launch_at_login(
    app: AppHandle,
    state: State<'_, Arc<ApplicationState>>,
    enabled: bool,
) -> CommandResult<SystemStatus> {
    if enabled {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    }
    .map_err(|error| error.to_string())?;
    let status = state
        .set_launch_at_login(enabled)
        .map_err(|error| error.to_string())?;
    let _ = app.emit("gbox://system-status", &status);
    Ok(status)
}

#[tauri::command]
pub fn set_notifications_available(
    app: AppHandle,
    state: State<'_, Arc<ApplicationState>>,
    available: bool,
) -> SystemStatus {
    let status = state.set_notifications_available(available);
    let _ = app.emit("gbox://system-status", &status);
    status
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
