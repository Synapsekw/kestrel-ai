import asyncio
import json
import os
import socket
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.appdata import AppData
from app.config import Settings
from app.errors import install_error_handlers
from app.health import GpuProbe
from app.logging_setup import configure_logging
from app.providers.config import ProviderConfigStore
from app.providers.keys import KeyringKeyStore


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    configure_logging(settings.data_dir, settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        from app.jobs.events import EventBus
        from app.jobs.runner import JobRunner
        from app.projects.service import ProjectRegistry

        app.state.events = EventBus()
        app.state.events.bind(asyncio.get_running_loop())
        app.state.projects = ProjectRegistry(settings.data_dir)
        app.state.jobs = JobRunner(app.state.events)
        # jobs reach the key store and provider settings through the runner: a job's params are
        # persisted in the project DB, so a key must never travel that way.
        app.state.jobs.keys = app.state.keys
        app.state.jobs.provider_config = app.state.provider_config
        app.state.jobs.start()
        yield
        app.state.jobs.stop()
        app.state.projects.close_all()

    app = FastAPI(
        title="machinery-backend",
        version=settings.version,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.settings = settings
    app.state.started_at = datetime.now(UTC).isoformat()
    app.state.keys = KeyringKeyStore()
    app.state.gpu_probe = GpuProbe()
    app.state.provider_config = ProviderConfigStore(AppData(settings.data_dir))
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["Authorization", "Content-Type"],
        allow_credentials=False,
        max_age=600,
    )
    install_error_handlers(app)
    from app.api import api_router
    from app.jobs.events import events_websocket

    app.include_router(api_router)
    app.add_api_websocket_route("/api/v1/events", events_websocket)
    return app


def _free_port(host: str) -> int:
    with socket.socket() as s:
        s.bind((host, 0))
        return s.getsockname()[1]


def main() -> None:
    import uvicorn

    settings = Settings()
    port = settings.port or _free_port(settings.host)
    print(json.dumps({"event": "starting", "port": port, "pid": os.getpid()}), flush=True)
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=port,
        log_level=settings.log_level.lower(),
        ws="auto",
    )


if __name__ == "__main__":
    main()
