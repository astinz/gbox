mod codex;
mod commands;
mod control;
mod domain;
mod evidence;
mod gate;
mod observation;
mod replay;
mod state;
mod store;
mod verifier;

use std::sync::Arc;

use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let application = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--background"])
                .macos_launcher(MacosLauncher::LaunchAgent)
                .build(),
        )
        .setup(|app| {
            let app_handle = app.handle().clone();
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;

            let store = Arc::new(store::Store::open(&app_data_dir.join("gbox.sqlite3"))?);
            let codex = codex::CodexSupervisor::new(app_handle.clone(), store.clone());
            let gate = gate::ActionGate::new(app_handle.clone(), store.clone());
            let launch_at_login = app.autolaunch().is_enabled().unwrap_or(false);
            let observations = observation::ObservationService::new(
                app_handle.clone(),
                store.clone(),
                codex.clone(),
            );
            let state = state::ApplicationState::new(
                store,
                codex,
                gate,
                observations.clone(),
                launch_at_login,
            );
            observations.start()?;

            tauri::async_runtime::block_on(control::start_control_server(
                app_handle,
                state.clone(),
                app_data_dir,
            ))?;
            app.manage(state);
            if std::env::args_os().any(|argument| argument == "--background") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_system_status,
            commands::start_live_session,
            commands::send_live_prompt,
            commands::start_replay,
            commands::resolve_action,
            commands::get_dashboard_snapshot,
            commands::verify_receipt_chain,
            commands::set_global_observation,
            commands::set_launch_at_login,
            commands::set_notifications_available,
            commands::retry_observation,
            commands::mark_observation_notified,
            commands::update_evidence_settings,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    application.run(|app, event| match event {
        tauri::RunEvent::Exit => {
            let state = app.state::<Arc<state::ApplicationState>>().inner().clone();
            tauri::async_runtime::block_on(state.codex.shutdown());
        }
        tauri::RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main"
            && app
                .state::<Arc<state::ApplicationState>>()
                .global_observation() =>
        {
            api.prevent_close();
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => show_main_window(app),
        _ => {}
    });
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
