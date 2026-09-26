from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, Request, Response

from app.datasets.stats import compute_stats
from app.projects.schemas import (
    ClassDefInput,
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


def _registry(request: Request) -> ProjectRegistry:
    return request.app.state.projects


def _out(handle: ProjectHandle, last_opened_at: datetime | None) -> ProjectOut:
    with handle.session() as s:
        return ProjectOut.from_row(handle.row(s), handle.folder, last_opened_at)


@router.get("", response_model=ProjectPage)
def list_projects(request: Request) -> ProjectPage:
    reg = _registry(request)
    last_opened = reg.last_opened_map()  # one read of the recent list for the whole page
    items: list[ProjectOut] = []
    for r in reg.recent():
        folder = Path(r["folder"])
        if not (folder / "project.db").exists():
            continue
        handle = reg.open(folder, remember=False)
        items.append(_out(handle, last_opened.get(handle.id)))
    return ProjectPage(items=items, next_cursor=None)


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectCreate, request: Request) -> ProjectOut:
    reg = _registry(request)
    handle = reg.create(body.name, Path(body.folder), body.type_ids)
    return _out(handle, reg.last_opened_at(handle.id))


@router.post("/open", response_model=ProjectOut)
def open_project(body: ProjectOpen, request: Request) -> ProjectOut:
    reg = _registry(request)
    handle = reg.open(Path(body.folder))
    return _out(handle, reg.last_opened_at(handle.id))


@router.get("/{projectId}", response_model=ProjectOut)
def get_project_route(request: Request, handle: ProjectHandle = Depends(get_project)) -> ProjectOut:
    return _out(handle, _registry(request).last_opened_at(handle.id))


@router.delete("/{projectId}", status_code=204)
def forget_project(projectId: str, request: Request) -> Response:  # noqa: N803 - path param from the contract
    _registry(request).forget(projectId)
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
