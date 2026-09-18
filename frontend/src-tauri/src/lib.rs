mod logfile;
mod sidecar;

use tauri::Manager;

#[tauri::command]
fn backend_info(state: tauri::State<sidecar::BackendState>) -> Result<serde_json::Value, String> {
    let guard = state.0.lock().unwrap();
    let backend = guard.as_ref().ok_or("backend not started")?;
    Ok(serde_json::json!({
        "base_url": backend.base_url,
        "token": backend.token,
        // Spec section 11: the failure dialog points the operator at the sidecar log.
        "log_path": backend.log_path.as_ref().map(|p| p.to_string_lossy()),
    }))
}

#[tauri::command]
fn restart_backend(
    app: tauri::AppHandle,
    state: tauri::State<sidecar::BackendState>,
) -> Result<(), String> {
    sidecar::stop(&state);
    let backend = sidecar::start(&app)?;
    *state.0.lock().unwrap() = Some(backend);
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(sidecar::BackendState(std::sync::Mutex::new(None)))
        .setup(|app| {
            let backend = sidecar::start(app.handle())?;
            *app.state::<sidecar::BackendState>().0.lock().unwrap() = Some(backend);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                sidecar::stop(&window.state::<sidecar::BackendState>());
            }
        })
        .invoke_handler(tauri::generate_handler![backend_info, restart_backend])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Windows closing is the usual path; Exit also covers quit without a window event.
            if let tauri::RunEvent::Exit = event {
                sidecar::stop(&app.state::<sidecar::BackendState>());
            }
        });
}
