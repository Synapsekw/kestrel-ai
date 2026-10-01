"""The catalogue endpoints (spec 2026-09-26-foundation sections 7 and 13)."""

from fastapi import APIRouter, Depends, Query, Request, Response

from app.catalogue import project_types, service, template_types
from app.catalogue.handle import CatalogueHandle, get_catalogue
from app.catalogue.schemas import (
    CatalogueTypeCreate,
    CatalogueTypeOut,
    CatalogueTypePage,
    CatalogueTypePatch,
    CatalogueTypePatchOut,
    EnsureTypesRequest,
    EnsureTypesResult,
    SeverityLevelOut,
    SeverityScale,
    TypeKind,
    TypeOrigin,
)
from app.catalogue.usage import projects_using_level
from app.errors import AppError
from app.findings.backfill import submit_backfill
from app.jobs.schemas import JobOut
from app.library.handle import LibraryHandle, get_library
from app.training.schemas import JobRef

router = APIRouter(prefix="/catalogue", tags=["catalogue"])


def publish_catalogue_changed(request: Request, payload: dict) -> None:
    """`catalogue.changed`; `project_id` is "library" because the contract's Event.project_id is a
    non-null string and the catalogue is app-wide, like library jobs."""
    request.app.state.events.publish(
        {
            "type": "catalogue.changed",
            "project_id": "library",
            "job_id": None,
            "progress": None,
            "message": "",
            "payload": payload,
        }
    )


@router.get("/types", response_model=CatalogueTypePage)
def list_catalogue_types(
    q: str | None = Query(None, max_length=64),
    kind: TypeKind | None = None,
    origin: TypeOrigin | None = None,
    include_archived: bool = False,
    limit: int | None = Query(None, ge=1),
    cursor: str | None = None,
    cat: CatalogueHandle = Depends(get_catalogue),
) -> CatalogueTypePage:
    refs, nxt = service.list_types(
        cat, q=q, kind=kind, origin=origin, include_archived=include_archived, cursor=cursor, limit=limit
    )
    flag = bool(service.get_meta(cat, service.NEEDS_CLASSIFICATION))
    return CatalogueTypePage(
        items=[CatalogueTypeOut.from_ref(r) for r in refs], next_cursor=nxt, needs_classification=flag
    )


@router.post("/classification/done", status_code=204)
def complete_catalogue_classification(
    request: Request, cat: CatalogueHandle = Depends(get_catalogue)
) -> Response:
    """The operator reviewed the types the migration merged in (C0 `completeCatalogueClassification`)."""
    service.set_meta(cat, service.NEEDS_CLASSIFICATION, None)
    publish_catalogue_changed(request, {"classification": "done"})
    return Response(status_code=204)


@router.post("/types", response_model=CatalogueTypeOut, status_code=201)
def create_catalogue_type(
    body: CatalogueTypeCreate, request: Request, cat: CatalogueHandle = Depends(get_catalogue)
) -> CatalogueTypeOut:
    ref = service.create_type(cat, **body.model_dump())
    publish_catalogue_changed(request, {"type_ids": [ref.id]})
    return CatalogueTypeOut.from_ref(ref)


@router.post("/types/ensure", response_model=EnsureTypesResult)
def ensure_catalogue_types(
    body: EnsureTypesRequest, request: Request, cat: CatalogueHandle = Depends(get_catalogue)
) -> EnsureTypesResult:
    """Resolve a template's types (spec 2026-09-30-project-setup section 6): reuse by name, bring an
    archived match back, create a miss with `origin = "template"`; all or nothing. A dry run (the
    setup page's preview) writes and publishes nothing."""
    dry_run = bool(body.dry_run)
    items = template_types.ensure_template_types(cat, body.types, dry_run=dry_run)
    if not dry_run:
        ids = list(dict.fromkeys(i.id for i in items if i.id))
        # An unarchived type may have lost its hotkey: open projects' snapshots follow.
        project_types.refresh_open_projects(request.app.state.projects, cat, ids)
        publish_catalogue_changed(request, {"type_ids": ids})
    return EnsureTypesResult(items=items)


@router.get("/types/{typeId}", response_model=CatalogueTypeOut)
def get_catalogue_type(typeId: str, cat: CatalogueHandle = Depends(get_catalogue)) -> CatalogueTypeOut:  # noqa: N803
    return CatalogueTypeOut.from_ref(service.get_type(cat, typeId))


@router.patch("/types/{typeId}", response_model=CatalogueTypePatchOut)
def patch_catalogue_type(
    typeId: str,  # noqa: N803
    body: CatalogueTypePatch,
    request: Request,
    cat: CatalogueHandle = Depends(get_catalogue),
) -> CatalogueTypePatchOut:
    ref, offer = service.patch_type(cat, typeId, body.model_dump(exclude_unset=True))
    project_types.refresh_open_projects(request.app.state.projects, cat, [ref.id])
    publish_catalogue_changed(request, {"type_ids": [ref.id]})
    return CatalogueTypePatchOut(**CatalogueTypeOut.from_ref(ref).model_dump(), backfill_candidates=offer)


@router.get("/severity", response_model=SeverityScale)
def get_severity_scale(cat: CatalogueHandle = Depends(get_catalogue)) -> SeverityScale:
    return SeverityScale(levels=[SeverityLevelOut.from_ref(lv) for lv in service.get_scale(cat)])


@router.put("/severity", response_model=SeverityScale)
def put_severity_scale(
    body: SeverityScale, request: Request, cat: CatalogueHandle = Depends(get_catalogue)
) -> SeverityScale:
    registry = request.app.state.projects
    levels = service.put_scale(
        cat,
        [lv.model_dump() for lv in body.levels],
        level_in_use=lambda level: projects_using_level(registry, level),
    )
    # A shrink clears catalogue defaults above the new top; open projects' snapshots follow.
    project_types.refresh_open_projects(registry, cat, None)
    publish_catalogue_changed(request, {"severity": True})
    return SeverityScale(levels=[SeverityLevelOut.from_ref(lv) for lv in levels])


@router.post("/types/{typeId}/backfill", response_model=JobRef, status_code=202)
def backfill_catalogue_type(
    typeId: str,  # noqa: N803
    request: Request,
    cat: CatalogueHandle = Depends(get_catalogue),
    lib: LibraryHandle = Depends(get_library),
) -> JobRef:
    """`findings_backfill` on the library runner (spec section 7.2). The backfill is idempotent, but
    a second one of the same type while one is queued or running answers 409 `job_running`."""
    ref = service.get_type(cat, typeId)
    if ref.kind != "defect":
        raise AppError(
            "not_a_defect", f"{ref.name} is an object type; mark it a defect first.", 422, {"type_id": typeId}
        )
    job = submit_backfill(lib, request.app.state.jobs, typeId)
    return JobRef(job=JobOut.from_row(job, lib.id))
