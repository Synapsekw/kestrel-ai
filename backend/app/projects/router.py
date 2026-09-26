import logging
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, Request, Response

from app.datasets.stats import compute_stats
from app.errors import AppError
from app.migration.gate import migration_state, unavailable_state
from app.migration.job import live_job_id, states_for
from app.migration.state import MigrationStates
from app.projects.schemas import (
    ClassDefInput,
    MigrationStateOut,
    ProjectCreate,
    ProjectOpen,
    ProjectOut,
    ProjectPage,
    ProjectUpdate,
    Stats,
)
from app.projects.service import (
    ProjectHandle,
    ProjectRegistry,
    check_removed_classes_unused,
    get_project,
    normalise_classes,
)

router = APIRouter(prefix="/projects", tags=["projects"])
log = logging.getLogger(__name__)


def _registry(request: Request) -> ProjectRegistry:
    return request.app.state.projects


def _out(handle: ProjectHandle, last_opened_at: datetime | None, runner=None) -> ProjectOut:
    """With `runner`, the project's migration state is filled in; without it (a gated route, so
    the project is `ok`) it keeps the default."""
    with handle.session() as s:
        out = ProjectOut.from_row(handle.row(s), handle.folder, last_opened_at)
    if runner is not None:
        out.migration = MigrationStateOut(**migration_state(handle, runner))
    return out


def _list_item(reg, runner, r: dict, opened: datetime | None, states: dict) -> ProjectOut:
    folder = Path(r["folder"])
    if not (folder / "project.db").exists():
        # Listed, not hidden (operator decision 2026-09-26): the card offers Remove and Locate.
        return ProjectOut.unavailable(r, MigrationStateOut(), opened, availability="missing")
    live = live_job_id(runner, states.get(MigrationStates.key(folder)))
    if live is not None:
        return ProjectOut.unavailable(r, MigrationStateOut(state="running", job_id=live), opened)
    handle = reg.cached(folder) or reg.open(folder, remember=False)
    return _out(handle, opened, runner)


def _failed_item(reg, r: dict, opened: datetime | None, error: Exception) -> ProjectOut:
    """A recent project that could not be listed: an open that failed, or a folder that cannot
    even be checked (a `PermissionError` from `exists()`), is `failed` with `open_failed` (or the
    failure `migrations.json` records). Never raises: one project never fails the list."""
    try:
        state = MigrationStateOut(**unavailable_state(reg, Path(r["folder"]), error))
    except Exception:
        log.exception("the migration state of %s could not be read", r.get("folder"))
        state = MigrationStateOut(
            state="failed", code="open_failed", error=f"{type(error).__name__}: {error}"
        )
    return ProjectOut.unavailable(r, state, opened)


@router.get("", response_model=ProjectPage)
def list_projects(request: Request) -> ProjectPage:
    """Every recent project, each on its own: one that fails to open or upgrade, or whose folder
    cannot be read, is listed as `failed`, never failing the list, and one whose upgrade job is
    live is listed as `running` without opening it. An open project is read from the registry
    cache without its lock, so the list never waits on a job's backup (foundation spec §9.2, F12)."""
    reg, runner = _registry(request), request.app.state.jobs
    entries = reg.recent()  # one read of the recent list for the whole page
    last_opened = reg.last_opened_map(entries)
    # One read of migrations.json for the live-job check; `_out` and `unavailable_state` still read
    # it per row (at most MAX_RECENT rows).
    states = states_for(reg).all()
    items: list[ProjectOut] = []
    for r in entries:
        opened = last_opened.get(r["id"])
        try:
            items.append(_list_item(reg, runner, r, opened, states))
        except Exception as e:
            log.warning("project at %s could not be listed: %s", r["folder"], e)
            items.append(_failed_item(reg, r, opened, e))
    return ProjectPage(items=items, next_cursor=None)


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectCreate, request: Request) -> ProjectOut:
    reg = _registry(request)
    handle = reg.create(body.name, Path(body.folder), body.type_ids)
    return _out(handle, reg.last_opened_at(handle.id), request.app.state.jobs)


@router.post("/open", response_model=ProjectOut)
def open_project(body: ProjectOpen, request: Request) -> ProjectOut:
    reg = _registry(request)
    handle = reg.open(Path(body.folder))
    return _out(handle, reg.last_opened_at(handle.id), request.app.state.jobs)


@router.get("/{projectId}", response_model=ProjectOut)
def get_project_route(request: Request, handle: ProjectHandle = Depends(get_project)) -> ProjectOut:
    return _out(handle, _registry(request).last_opened_at(handle.id))


@router.delete("/{projectId}", status_code=204)
def forget_project(projectId: str, request: Request) -> Response:  # noqa: N803 - path param from the contract
    reg = _registry(request)
    # A live `project_migrate` job holds the project (and, during its backup, the registry lock):
    # refuse before `forget` would open the project and wait on it. It is a library job, so the
    # project's own job table, which `forget` checks, never sees it.
    entry = next((r for r in reg.recent() if r["id"] == projectId), None)
    if entry is not None:
        live = live_job_id(request.app.state.jobs, states_for(reg).get(Path(entry["folder"])))
        if live is not None:
            raise AppError(
                "job_running",
                "This project is being upgraded; wait for the upgrade to finish.",
                409,
                {"job_id": live},
            )
    reg.forget(projectId)
    return Response(status_code=204)


@router.patch("/{projectId}", response_model=ProjectOut)
def update_project(
    body: ProjectUpdate, request: Request, handle: ProjectHandle = Depends(get_project)
) -> ProjectOut:
    with handle.session() as s:
        row = handle.row(s)
        if body.name is not None:
            row.name = body.name
        if "preannotation_model_id" in body.model_fields_set:
            row.preannotation_model_id = body.preannotation_model_id
        if body.import_defaults is not None:
            merged = dict(row.import_defaults or {})
            merged.update(body.import_defaults.model_dump(exclude_none=True))
            row.import_defaults = merged
        out = ProjectOut.from_row(row, handle.folder, _registry(request).last_opened_at(handle.id))
    return out


@router.put("/{projectId}/classes", response_model=ProjectOut)
def update_classes(
    body: list[ClassDefInput], request: Request, handle: ProjectHandle = Depends(get_project)
) -> ProjectOut:
    new = normalise_classes([c.model_dump() for c in body])
    with handle.session() as s:
        row = handle.row(s)
        check_removed_classes_unused(s, row.classes or [], new)
        row.classes = new
        out = ProjectOut.from_row(row, handle.folder, _registry(request).last_opened_at(handle.id))
    return out


@router.get("/{projectId}/stats", response_model=Stats)
def project_stats(handle: ProjectHandle = Depends(get_project)) -> Stats:
    return compute_stats(handle, source_id=None)
