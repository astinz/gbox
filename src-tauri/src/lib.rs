mod codex;
mod commands;
mod control;
mod domain;
mod gate;
mod replay;
mod state;
mod store;
mod verifier;

use std::sync::Arc;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let application = tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle().clone();
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;

            let store = Arc::new(store::Store::open(&app_data_dir.join("gbox.sqlite3"))?);
            let codex = codex::CodexSupervisor::new(app_handle.clone(), store.clone());
            let gate = gate::ActionGate::new(app_handle.clone(), store.clone());
            let state = state::ApplicationState::new(store, codex, gate);

            tauri::async_runtime::block_on(control::start_control_server(
                app_handle,
                state.clone(),
                app_data_dir,
            ))?;
            app.manage(state);
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
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    application.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let state = app.state::<Arc<state::ApplicationState>>().inner().clone();
            tauri::async_runtime::block_on(state.codex.shutdown());
        }
    });
}
