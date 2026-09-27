import asyncio
import json
import logging
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


def project_opened(handle, runner) -> None:
    """Runs once when a project becomes live: close out orphan jobs, give interrupted dataset deletes
    their folders back, sweep partial exports a crash left behind, fail agent turns the last process
    left running, and start moving the project's old models into the library. Each step on
    its own, so one failing never skips the others.

    A project below the foundation schema only queues its upgrade here; `migrate_project` calls
    this hook again once the upgrade succeeds, and the sweeps run then.

    The point-cloud, surface, volume and design-inspection sweeps (foundation F0) are imported
    inside their own step: a module that fails to import costs only that step."""
    import importlib
    import logging

    from app.datasets import materialise
    from app.exports import job as exports_job
    from app.jobs import startup
    from app.library import adoption
    from app.maps import startup as maps_startup
    from app.migration import gate as migration_gate
    from app.project_agent import store as agent_store

    log = logging.getLogger(__name__)

    def sweep(module: str):
        return lambda: importlib.import_module(module).sweep_interrupted(handle, runner)

    try:
        # A project below the foundation schema queues its upgrade (foundation spec §11.3).
        migration_gate.ensure_submitted(handle, runner)
    except Exception:
        log.exception("project upgrade failed for project %s", handle.id)
    if migration_gate.needs_upgrade(handle):
        # The sweeps below write the project DB and read pre-upgrade data (adoption rewrites model
        # ids that step 4 moves), so they wait for the upgrade: `migrate_project` runs this hook
        # again once it succeeds. A failed upgrade keeps them waiting until a Retry succeeds.
        return
    for step, run in (
        ("orphan job sweep", lambda: startup.sweep_orphans(handle, runner)),
        (
            "findings counts check",
            lambda: importlib.import_module("app.findings.jobs").check_on_open(handle, runner),
        ),
        ("finding trash purge", lambda: importlib.import_module("app.findings.trash").purge(handle)),
        ("dataset tombstone sweep", lambda: materialise.reconcile_tombstones(handle)),
        ("partial export sweep", lambda: exports_job.sweep_partial_exports(handle)),
        ("agent turn sweep", lambda: agent_store.sweep_interrupted(handle)),
        ("interrupted map import sweep", lambda: maps_startup.sweep_interrupted_imports(handle, runner)),
        ("interrupted point cloud import sweep", sweep("app.pointclouds.startup")),
        ("interrupted surface build sweep", sweep("app.surfaces.startup")),
        ("interrupted volume calculation sweep", sweep("app.volumes.startup")),
        ("stale design inspection sweep", sweep("app.surfaces.design.startup")),
        ("interrupted drawing import sweep", sweep("app.drawings.startup")),
        (
            "project type snapshot refresh",
            lambda: importlib.import_module("app.catalogue.project_types").refresh_handle(handle),
        ),
        # After the orphan sweep, so an adoption job a crash left `running` does not block a new one.
        ("model adoption", lambda: adoption.submit_if_pending(handle, runner)),
    ):
        try:
            run()
        except Exception:
            log.exception("%s failed for project %s", step, handle.id)


def open_model_library(app: FastAPI, settings: Settings) -> None:
    """Open the app-wide library. A failure is logged and the app starts without it: every
    library-dependent endpoint then answers 503 `library_unavailable` (AGENTS.md: the app must start
    even when startup work fails)."""
    from app.library import handle as library_handle

    app.state.library, app.state.library_error = None, None
    try:
        app.state.library = library_handle.open_library(settings.data_dir)
    except Exception as e:
        logging.getLogger(__name__).exception("the model library could not be opened")
        app.state.library_error = f"{type(e).__name__}: {e}"
    app.state.jobs.library = app.state.library


def open_catalogue(app: FastAPI, settings: Settings) -> None:
    """Open the app-wide catalogue. A failure is logged and the app starts without it: catalogue
    endpoints then answer 503 `catalogue_unavailable`, and projects render from their type
    snapshots (spec 2026-09-26-foundation section 7.1 and decision F2)."""
    from app.catalogue import handle as catalogue_handle

    app.state.catalogue, app.state.catalogue_error = None, None
    try:
        app.state.catalogue = catalogue_handle.open_catalogue(settings.data_dir)
    except Exception as e:
        logging.getLogger(__name__).exception("the catalogue could not be opened")
        app.state.catalogue_error = f"{type(e).__name__}: {e}"
    app.state.jobs.catalogue = app.state.catalogue
    app.state.projects.catalogue = app.state.catalogue


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    configure_logging(settings.data_dir, settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        from app.jobs.events import EventBus
        from app.jobs.runner import JobRunner
        from app.migration.job import begin_shutdown, reset_shutdown
        from app.projects.service import ProjectRegistry

        reset_shutdown()  # a fresh app (or the next test's app) starts with no shutdown signalled
        app.state.events = EventBus()
        app.state.events.bind(asyncio.get_running_loop())
        from app.findings import events as findings_events

        findings_events.set_bus(app.state.events)
        app.state.jobs = JobRunner(app.state.events)
        # Projects open lazily, so these sweeps hang off the registry rather than startup.
        app.state.projects = ProjectRegistry(
            settings.data_dir, on_open=lambda handle: project_opened(handle, app.state.jobs)
        )
        # jobs reach the key store and provider settings through the runner: a job's params are
        # persisted in the project DB, so a key must never travel that way.
        app.state.jobs.keys = app.state.keys
        app.state.jobs.provider_config = app.state.provider_config
        # Jobs that reach other projects find the registry on the runner.
        app.state.jobs.projects = app.state.projects
        open_model_library(app, settings)
        open_catalogue(app, settings)
        app.state.jobs.start()
        if app.state.library is not None:
            try:
                from app.jobs.startup import sweep_orphans

                sweep_orphans(app.state.library, app.state.jobs)
            except Exception:
                logging.getLogger(__name__).exception("orphan job sweep failed for the model library")
            try:
                # After the job sweep, so a job a previous run left `running` no longer blocks it.
                from app.library.datasets import export as dataset_export

                dataset_export.sweep_export_folders(app.state.library)
            except Exception:
                logging.getLogger(__name__).exception("dataset export folder sweep failed")
        # Upgrade recent projects that predate the foundation schema in the background (spec §11.3).
        # After the library and the catalogue opened: an upgrade waits for both.
        try:
            from app.migration import startup as migration_startup

            migration_startup.submit_pending_bounded(app)
        except Exception:
            logging.getLogger(__name__).exception("queuing project upgrades failed")
        try:
            # The Overview's migration-warning banner (spec §9.1); registering twice is a no-op.
            from app.migration import banners as migration_banners

            migration_banners.register()
        except Exception:
            logging.getLogger(__name__).exception("registering the migration banner failed")
        # The project agent's turn loops run as tasks on this event loop; the model call is a seam
        # (`agent_llm`) so tests can script the model without reaching a provider.
        from app.project_agent import llm as agent_llm
        from app.project_agent.runner import AgentRunner

        app.state.agent = AgentRunner(app)
        app.state.agent_llm = agent_llm.complete
        yield
        await app.state.agent.stop()
        try:
            # Before the library runner stops, so `migrate_project` sees the signal on the
            # `JobCancelled` `JobRunner.stop` raises for a running upgrade: a quit is left
            # `pending`, not flagged as an operator cancel (app.migration.job.begin_shutdown).
            begin_shutdown()
        except Exception:
            logging.getLogger(__name__).exception("could not signal the migration shutdown")
        app.state.jobs.stop()
        app.state.projects.close_all()
        if app.state.library is not None:
            app.state.library.engine.dispose()
        if app.state.catalogue is not None:
            app.state.catalogue.engine.dispose()

    app = FastAPI(
        title="kestrel-backend",
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
        # Range: the point-cloud octree loader reads byte ranges, and its `Range` header triggers a
        # preflight that must pass here, before routing (spec 2026-09-23-point-clouds section 2).
        allow_headers=["Authorization", "Content-Type", "Range"],
        expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
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
