"""The findings endpoints (spec 2026-09-26-foundation section 8.3), with their comment threads,
photo attachments and thumbnails."""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import FileResponse

from app.asset_review import group
from app.catalogue import service as catalogue_service
from app.data_items import search
from app.errors import AppError
from app.findings import activity, attachments, comments, jobs, query, service, sightings, thumbnails
from app.findings.anchors import AnchorIn
from app.findings.schemas import (
    ActivityOut,
    ActivityPage,
    FindingAttachmentIn,
    FindingAttachmentList,
    FindingAttachmentOut,
    FindingBulk,
    FindingBulkResult,
    FindingCommentIn,
    FindingCommentOut,
    FindingCommentPage,
    FindingCreate,
    FindingDetail,
    FindingMergeIn,
    FindingOut,
    FindingPage,
    FindingPatch,
    FindingSightingList,
    FindingSightingOut,
    FindingSplitIn,
    FindingSummary,
)
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project
from app.training.schemas import JobRef

router = APIRouter(prefix="/projects/{projectId}", tags=["findings"])
SEVERITY_VALUES = {str(n) for n in range(1, 10)} | {"none"}

# BK's search (spec section 10.3) gets its findings group from here (plan BK hand-off).
search.register_finding_search(
    lambda s, q, limit: [
        FindingOut.from_row(r).model_dump(mode="json") for r in query.search_findings(s, q, limit)
    ]
)


def _detail(handle: ProjectHandle, finding_id: str) -> FindingDetail:
    row, n_att, n_com = service.get_finding(handle, finding_id)
    rep = None
    if row.anchor_kind == "asset":
        with handle.session() as s:
            rep = sightings.representatives(s, [finding_id]).get(finding_id)
    out = FindingOut.from_row(row, representative=rep)
    return FindingDetail(**out.model_dump(), attachment_count=n_att, comment_count=n_com)


@router.get("/findings", response_model=FindingPage)
def list_findings(
    handle: ProjectHandle = Depends(get_project),
    status: list[Literal["open", "reviewed", "closed"]] | None = Query(None),
    severity: list[str] | None = Query(None),
    type_id: list[str] | None = Query(None),
    anchor_kind: list[Literal["image", "map", "cloud"]] | None = Query(None),
    data_id: str | None = None,
    image_id: str | None = None,
    created_by: Literal["human", "model"] | None = None,
    q: str | None = Query(None, max_length=200),
    updated_from: datetime | None = None,
    updated_to: datetime | None = None,
    has_location: bool | None = None,
    sort: Literal["-severity", "number", "-updated_at", "type"] = "-severity",
    cursor: str | None = None,
    limit: int | None = Query(None, ge=1),
) -> FindingPage:
    if severity and not set(severity) <= SEVERITY_VALUES:
        raise AppError("validation_error", "severity takes 1-9 or none", 422)
    filters = query.FindingFilters(
        status=status,
        severity=severity,
        type_id=type_id,
        anchor_kind=anchor_kind,
        data_id=data_id,
        image_id=image_id,
        created_by=created_by,
        q=q,
        updated_from=updated_from,
        updated_to=updated_to,
        has_location=has_location,
    )
    with handle.session() as s:
        rows, nxt = query.list_findings(s, filters, sort=sort, cursor=cursor, limit=limit)
        reps = sightings.representatives(s, [r.id for r in rows if r.anchor_kind == "asset"])
        items = [FindingOut.from_row(r, representative=reps.get(r.id)) for r in rows]
    return FindingPage(items=items, next_cursor=nxt)


@router.post("/findings", response_model=FindingDetail, status_code=201)
def create_finding(body: FindingCreate, handle: ProjectHandle = Depends(get_project)) -> FindingDetail:
    kw = {
        "type_id": body.type_id,
        "anchor": AnchorIn(**body.anchor.model_dump()),
        "note": body.note,
        "status": body.status,
        "lon": body.lon,
        "lat": body.lat,
    }
    if "severity" in body.model_fields_set:
        kw["severity"] = body.severity
    row = service.create_finding(handle, **kw)
    return _detail(handle, row.id)


@router.get("/findings/summary", response_model=FindingSummary)
def findings_summary(handle: ProjectHandle = Depends(get_project)) -> FindingSummary:
    levels = catalogue_service.scale_levels(handle.catalogue)
    with handle.session() as s:
        return FindingSummary(**query.summary(s, levels=levels))


@router.post("/findings/bulk", response_model=FindingBulkResult)
def bulk_update_findings(
    body: FindingBulk, handle: ProjectHandle = Depends(get_project)
) -> FindingBulkResult:
    with handle.session() as s:
        result = query.bulk(
            s,
            project_id=handle.id,
            catalogue=handle.catalogue,
            ids=body.ids,
            set_fields=body.set.model_dump(exclude_unset=True),
        )
    return FindingBulkResult(**result)


@router.post("/findings/recount", response_model=JobRef, status_code=202)
def recount_findings(request: Request, handle: ProjectHandle = Depends(get_project)) -> JobRef:
    job = jobs.submit_recount(handle, request.app.state.jobs)
    return JobRef(job=JobOut.from_row(job, handle.id))


@router.get("/findings/{findingId}", response_model=FindingDetail)
def get_finding(findingId: str, handle: ProjectHandle = Depends(get_project)) -> FindingDetail:  # noqa: N803
    return _detail(handle, findingId)


@router.patch("/findings/{findingId}", response_model=FindingDetail)
def patch_finding(
    findingId: str,  # noqa: N803
    body: FindingPatch,
    handle: ProjectHandle = Depends(get_project),
) -> FindingDetail:
    fields = body.model_dump(exclude_unset=True)
    if "anchor" in fields:
        fields["anchor"] = body.anchor.model_dump(exclude_unset=True)
    service.patch_finding(handle, findingId, fields)
    return _detail(handle, findingId)


@router.delete("/findings/{findingId}", status_code=204)
def delete_finding(findingId: str, handle: ProjectHandle = Depends(get_project)) -> Response:  # noqa: N803
    service.delete_finding(handle, findingId)
    return Response(status_code=204)


@router.post("/findings/{findingId}/merge", response_model=FindingOut)
def merge_finding(
    findingId: str,  # noqa: N803
    body: FindingMergeIn,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> FindingOut:
    """Merge this asset finding into `into`; the source is closed with a comment, never deleted."""
    author = comments.author_name(request.app.state.settings.data_dir)
    with handle.session() as s:
        row = group.merge(s, handle, findingId, body.into, author=author)
        rep = sightings.representatives(s, [row.id]).get(row.id)
        return FindingOut.from_row(row, representative=rep)


@router.post("/findings/{findingId}/split", response_model=FindingOut, status_code=201)
def split_finding(
    findingId: str,  # noqa: N803
    body: FindingSplitIn,
    handle: ProjectHandle = Depends(get_project),
) -> FindingOut:
    """A new finding from some of this asset finding's sightings."""
    with handle.session() as s:
        row = group.split(s, handle, findingId, body.sighting_ids)
        rep = sightings.representatives(s, [row.id]).get(row.id)
        return FindingOut.from_row(row, representative=rep)


@router.get("/activity", response_model=ActivityPage)
def list_activity(
    handle: ProjectHandle = Depends(get_project),
    subject_id: str | None = None,
    cursor: str | None = None,
    limit: int | None = Query(None, ge=1),
) -> ActivityPage:
    with handle.session() as s:
        rows, nxt = activity.page(s, subject_id=subject_id, cursor=cursor, limit=limit)
        items = [ActivityOut.from_row(a) for a in rows]
    return ActivityPage(items=items, next_cursor=nxt)


def _comment_out(c) -> FindingCommentOut:
    return FindingCommentOut(
        id=c.id,
        finding_id=c.finding_id,
        author=c.author,
        text=c.text,
        created_at=c.created_at,
        edited_at=c.edited_at,
    )


def _attachment_out(a) -> FindingAttachmentOut:
    return FindingAttachmentOut(
        id=a.id,
        finding_id=a.finding_id,
        path=a.path,
        original_name=a.original_name,
        width=a.width,
        height=a.height,
        bytes=a.bytes,
        created_at=a.created_at,
    )


@router.get("/findings/{findingId}/thumbnail", response_class=FileResponse)
def get_finding_thumbnail(findingId: str, handle: ProjectHandle = Depends(get_project)) -> FileResponse:  # noqa: N803
    return FileResponse(thumbnails.finding_thumbnail(handle, findingId), media_type="image/jpeg")


@router.get("/findings/{findingId}/sightings", response_model=FindingSightingList)
def list_finding_sightings(
    findingId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
) -> FindingSightingList:
    """An asset finding's sightings, representative first. An image finding is its one implicit
    sighting; a map or cloud finding has none (decision A2)."""
    with handle.session() as s:
        f = service.get_or_404(s, findingId)
        items = [FindingSightingOut(**d) for d in sightings.listing(s, f)]
    return FindingSightingList(items=items)


@router.get("/findings/{findingId}/comments", response_model=FindingCommentPage)
def list_finding_comments(
    findingId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
    cursor: str | None = None,
    limit: int | None = Query(None, ge=1),
) -> FindingCommentPage:
    with handle.session() as s:
        rows, nxt = comments.page(s, findingId, cursor=cursor, limit=limit)
        items = [_comment_out(c) for c in rows]
    return FindingCommentPage(items=items, next_cursor=nxt)


@router.post("/findings/{findingId}/comments", response_model=FindingCommentOut, status_code=201)
def create_finding_comment(
    findingId: str,  # noqa: N803
    body: FindingCommentIn,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> FindingCommentOut:
    author = comments.author_name(request.app.state.settings.data_dir)
    with handle.session() as s:
        row = comments.add(s, project_id=handle.id, finding_id=findingId, text=body.text, author=author)
        s.flush()
        return _comment_out(row)


@router.patch("/findings/{findingId}/comments/{commentId}", response_model=FindingCommentOut)
def patch_finding_comment(
    findingId: str,  # noqa: N803
    commentId: str,  # noqa: N803
    body: FindingCommentIn,
    handle: ProjectHandle = Depends(get_project),
) -> FindingCommentOut:
    with handle.session() as s:
        row = comments.edit(
            s, project_id=handle.id, finding_id=findingId, comment_id=commentId, text=body.text
        )
        s.flush()
        return _comment_out(row)


@router.delete("/findings/{findingId}/comments/{commentId}", status_code=204)
def delete_finding_comment(
    findingId: str,  # noqa: N803
    commentId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    with handle.session() as s:
        comments.delete(s, project_id=handle.id, finding_id=findingId, comment_id=commentId)
    return Response(status_code=204)


@router.get("/findings/{findingId}/attachments", response_model=FindingAttachmentList)
def list_finding_attachments(
    findingId: str, handle: ProjectHandle = Depends(get_project)
) -> FindingAttachmentList:  # noqa: N803
    return FindingAttachmentList(items=[_attachment_out(a) for a in attachments.list_for(handle, findingId)])


@router.post("/findings/{findingId}/attachments", response_model=FindingAttachmentOut, status_code=201)
def add_finding_attachment(
    findingId: str,  # noqa: N803
    body: FindingAttachmentIn,
    handle: ProjectHandle = Depends(get_project),
) -> FindingAttachmentOut:
    return _attachment_out(attachments.add(handle, findingId, body.path))


@router.delete("/findings/{findingId}/attachments/{attachmentId}", status_code=204)
def delete_finding_attachment(
    findingId: str,  # noqa: N803
    attachmentId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    attachments.delete(handle, findingId, attachmentId)
    return Response(status_code=204)


@router.get("/findings/{findingId}/attachments/{attachmentId}/file", response_class=FileResponse)
def get_finding_attachment_file(
    findingId: str,  # noqa: N803
    attachmentId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
) -> FileResponse:
    path, media = attachments.file(handle, findingId, attachmentId)
    return FileResponse(path, media_type=media)


@router.get("/findings/{findingId}/attachments/{attachmentId}/thumbnail", response_class=FileResponse)
def get_finding_attachment_thumbnail(
    findingId: str,  # noqa: N803
    attachmentId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
) -> FileResponse:
    return FileResponse(attachments.thumbnail(handle, findingId, attachmentId), media_type="image/jpeg")
