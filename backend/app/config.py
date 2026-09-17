from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from APP_* environment variables by the launcher."""

    model_config = SettingsConfigDict(env_prefix="APP_", extra="ignore")
    host: str = "127.0.0.1"
    port: int = 8765  # 0 = pick a free port and print it on stdout as a JSON line
    token: str  # required; the launcher generates it per run
    data_dir: Path = Path.home() / "AppData" / "Roaming" / "machinery-app"
    log_level: str = "INFO"
    version: str = "0.1.0"
    # Browser origins allowed to call the API: the packaged WebView2 origin and the Vite dev server.
    cors_origins: list[str] = [
        "http://tauri.localhost",
        "https://tauri.localhost",
        "http://127.0.0.1:1420",
        "http://localhost:1420",
    ]
