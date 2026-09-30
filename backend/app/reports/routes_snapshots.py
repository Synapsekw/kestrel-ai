"""GET /projects/{projectId}/report-snapshots/{snapshotKey}?spec= (spec §9.5, §14), owned by R3.

The cached JPEG, rendered on a miss under the process-wide render slots. The spec travels as
unpadded base64url canonical JSON; the server re-parses and re-canonicalises it, recomputes the key
from the sources' current versions and refuses a mismatch. The renderers (rasterio, GDAL) load
inside the handler, so a broken raster stack costs snapshots, never the reports router."""

from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Response

from app.errors import AppError
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}")
IMMUTABLE = {"Cache-Control": "private, max-age=31536000, immutable"}


@router.get("/report-snapshots/{snapshotKey}", response_class=Response)
def get_report_snapshot(
    snapshotKey: str,  # noqa: N803 - path param from the contract
    spec: str = Query(...),
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    from app.reports.snapshots import render
    from app.reports.snapshots.keys import decode_spec

    try:
        parsed = render.parse_spec(decode_spec(spec))
        render.check_limits(parsed)
        expected, _ = render.compute_key(handle, parsed)
    except (ValueError, TypeError):
        raise AppError("invalid_snapshot_spec", "The snapshot spec is not valid.", 400) from None
    if expected != snapshotKey:
        raise AppError(
            "snapshot_key_mismatch",
            "The snapshot's source changed since this preview was built; reload the section.",
            400,
            {"key": expected},
        )
    result = render.render_result(handle, parsed)
    body = result.path.read_bytes()
    if result.missing_reason is not None:
        headers = {"Cache-Control": "no-store", "X-Snapshot-Missing": quote(result.missing_reason)}
    else:
        headers = IMMUTABLE
    return Response(body, media_type="image/jpeg", headers=headers)
