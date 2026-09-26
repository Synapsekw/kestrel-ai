"""GET /pointclouds/{cloudId}/octree/{octreeFile} (spec §4.1 op 7, §7).

`octreeFile` is an enum, so any other name is a 422 before any filesystem access; the folder comes
from the database row's id, never from request text. Preflight OPTIONS requests are answered by
CORSMiddleware before routing (spec §2 "CORS").
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Header
from fastapi.responses import JSONResponse, Response, StreamingResponse

from app.errors import AppError, envelope
from app.pointclouds import octree, rows
from app.projects.service import ProjectHandle, get_project

sub = APIRouter()
IMMUTABLE = "private, max-age=31536000, immutable"
MISSING = "the 3D view copy is missing; import the file again"


@sub.get("/pointclouds/{cloudId}/octree/{octreeFile}", response_class=Response)
def get_point_cloud_octree_file(
    cloudId: str,  # noqa: N803 - path parameter names come from the contract
    octreeFile: Literal["metadata.json", "hierarchy.bin", "octree.bin"],  # noqa: N803
    range_header: str | None = Header(default=None, alias="Range"),
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    row = rows.require_ready(handle, cloudId)
    folder = rows.octree_dir(handle, row.id)
    path = folder / octreeFile
    if path.parent != folder or not path.is_file():
        raise AppError("octree_missing", MISSING, 404)
    size = path.stat().st_size
    try:
        span = octree.parse_range(range_header, size)
    except octree.RangeNotSatisfiable:
        return JSONResponse(
            envelope(
                "range_not_satisfiable",
                f"range {range_header!r} cannot be served for {octreeFile} ({size} bytes)",
            ),
            status_code=416,
            headers={"Content-Range": f"bytes */{size}", "Accept-Ranges": "bytes"},
        )
    media = "application/json" if octreeFile == "metadata.json" else "application/octet-stream"
    headers = {"Cache-Control": IMMUTABLE, "Accept-Ranges": "bytes"}
    if span is None:
        return StreamingResponse(
            octree.stream(path, 0, size), media_type=media, headers={**headers, "Content-Length": str(size)}
        )
    start, end = span
    length = end - start + 1
    return StreamingResponse(
        octree.stream(path, start, length),
        status_code=206,
        media_type=media,
        headers={**headers, "Content-Length": str(length), "Content-Range": f"bytes {start}-{end}/{size}"},
    )
