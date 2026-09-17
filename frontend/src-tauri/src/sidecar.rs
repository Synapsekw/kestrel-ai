use std::net::TcpListener;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

pub struct Backend {
    pub base_url: String,
    pub token: String,
    pub child: Option<CommandChild>,
}

pub struct BackendState(pub Mutex<Option<Backend>>);

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn random_token() -> String {
    use rand::{distributions::Alphanumeric, Rng};
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect()
}

/// Start the backend: an externally started one when `APP_BACKEND_URL` is set,
/// otherwise the bundled sidecar on a free port with a fresh token.
pub fn start(app: &AppHandle) -> Result<Backend, String> {
    if let Ok(url) = std::env::var("APP_BACKEND_URL") {
        return Ok(Backend {
            base_url: url,
            token: std::env::var("APP_BACKEND_TOKEN").unwrap_or_default(),
            child: None,
        });
    }
    let port = free_port();
    let token = random_token();
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let (mut rx, child) = app
        .shell()
        .sidecar("machinery-backend")
        .map_err(|e| e.to_string())?
        .env("APP_PORT", port.to_string())
        .env("APP_TOKEN", &token)
        .env("APP_DATA_DIR", data_dir.to_string_lossy().to_string())
        .spawn()
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn(async move {
        while let Some(ev) = rx.recv().await {
            match ev {
                CommandEvent::Stdout(l) | CommandEvent::Stderr(l) => {
                    eprintln!("[backend] {}", String::from_utf8_lossy(&l))
                }
                CommandEvent::Terminated(t) => {
                    eprintln!("[backend] terminated {:?}", t);
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(Backend {
        base_url: format!("http://127.0.0.1:{port}"),
        token,
        child: Some(child),
    })
}

/// Kill the sidecar, if this launch owns one.
pub fn stop(state: &BackendState) {
    if let Some(b) = state.0.lock().unwrap().take() {
        if let Some(c) = b.child {
            let _ = c.kill();
        }
    }
}
