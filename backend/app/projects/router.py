from pathlib import Path

from fastapi import APIRouter, Depends, Request, Response

from app.datasets.stats import compute_stats
from app.projects.kinds import ANY_KIND, require_kind
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
# The project itself (settings, classes, stats) belongs to both kinds.
BOTH_KINDS = [Depends(require_kind(ANY_KIND))]


def _registry(request: Request) -> ProjectRegistry:
    return request.app.state.projects


def _out(handle: ProjectHandle) -> ProjectOut:
    with handle.session() as s:
        return ProjectOut.from_row(handle.row(s), handle.folder)


@router.get("", response_model=ProjectPage)
def list_projects(request: Request) -> ProjectPage:
    reg = _registry(request)
    items: list[ProjectOut] = []
    for r in reg.recent():
        folder = Path(r["folder"])
        if not (folder / "project.db").exists():
            continue
        items.append(_out(reg.open(folder, remember=False)))
    return ProjectPage(items=items, next_cursor=None)


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectCreate, request: Request) -> ProjectOut:
    handle = _registry(request).create(
        body.name, Path(body.folder), [c.model_dump() for c in body.classes], body.kind
    )
    return _out(handle)


@router.post("/open", response_model=ProjectOut)
def open_project(body: ProjectOpen, request: Request) -> ProjectOut:
    return _out(_registry(request).open(Path(body.folder)))


@router.get("/{projectId}", response_model=ProjectOut, dependencies=BOTH_KINDS)
def get_project_route(handle: ProjectHandle = Depends(get_project)) -> ProjectOut:
    return _out(handle)


@router.delete("/{projectId}", status_code=204, dependencies=BOTH_KINDS)
def forget_project(projectId: str, request: Request) -> Response:  # noqa: N803 - path param from the contract
    _registry(request).forget(projectId)
    return Response(status_code=204)


@router.patch("/{projectId}", response_model=ProjectOut, dependencies=BOTH_KINDS)
def update_project(body: ProjectUpdate, handle: ProjectHandle = Depends(get_project)) -> ProjectOut:
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
        out = ProjectOut.from_row(row, handle.folder)
    return out


@router.put("/{projectId}/classes", response_model=ProjectOut, dependencies=BOTH_KINDS)
def update_classes(body: list[ClassDefInput], handle: ProjectHandle = Depends(get_project)) -> ProjectOut:
    new = normalise_classes([c.model_dump() for c in body])
    with handle.session() as s:
        row = handle.row(s)
        check_removed_classes_unused(s, row.classes or [], new)
        row.classes = new
        out = ProjectOut.from_row(row, handle.folder)
    return out


@router.get("/{projectId}/stats", response_model=Stats, dependencies=BOTH_KINDS)
def project_stats(handle: ProjectHandle = Depends(get_project)) -> Stats:
    return compute_stats(handle, source_id=None)
