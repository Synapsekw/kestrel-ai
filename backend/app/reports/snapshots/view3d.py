"""view3d: C's stored report view passed through (reports spec §9.1, §9.4; unit R9-C).

R does not render point clouds. The one stored PNG/JPEG (at most 6 MiB, 1600 x 1000, checked by C
at upload) is read through `app.pointclouds.views.stored_view`, never the `cloud_view` table, and
returned as RGB; R3's `render_result` re-encodes it once as JPEG (q88, `JPEG_QUALITY`) into the
cache, and turns a `SnapshotUnavailable`/`LookupError` into its placeholder with the reason."""

from __future__ import annotations

from PIL import Image as PILImage

from app.db.models import CloudMeasurement, Finding
from app.pointclouds import views
from app.reports.snapshots import MISSING, SnapshotUnavailable

OUT = (views.WIDTH, views.HEIGHT)
JPEG_QUALITY = 88  # spec §9.4: C's stored view is re-encoded once as JPEG q88

# Reason printed when the subject exists but has never had a view captured.
NO_VIEW = {
    "finding": "No 3D view saved. Open this finding in Point clouds to capture one",
    "cloud_measurement": "No 3D view saved. Open this measurement in Point clouds to capture one",
}

_SUBJECT_MODEL = {"finding": (Finding, "finding"), "cloud_measurement": (CloudMeasurement, "measurement")}


def _gone_reason(handle, spec) -> str | None:
    """None when the subject row still exists; otherwise the operator's reason it is gone. Only
    called on the no-view path (Ruling A1): one primary-key get."""
    model, label = _SUBJECT_MODEL[spec.subject_kind]
    with handle.session() as s:
        if s.get(model, spec.subject_id) is None:
            return f"The {label} no longer exists"
    return None


def source_version(handle, spec) -> str:
    """The stored view's sha256 (the ETag of C's GET …/view3d), or `MISSING + reason` when there is
    no stored view: a re-capture changes the snapshot key, so a cached old view is never served
    (spec §9.1). When the subject row itself is gone, the reason says so."""
    view = views.stored_view(handle, spec.subject_kind, spec.subject_id)
    if view is not None:
        return view.meta.sha256
    reason = _gone_reason(handle, spec) or NO_VIEW[spec.subject_kind]
    return MISSING + reason


def render(handle, spec) -> PILImage.Image:
    """The stored view as RGB, exactly OUT: alpha flattened on white; another size fitted inside,
    never enlarged, centred on white. `SnapshotUnavailable(reason)` when the view or its file is
    gone."""
    view = views.stored_view(handle, spec.subject_kind, spec.subject_id)
    if view is None:
        raise SnapshotUnavailable(NO_VIEW[spec.subject_kind])
    try:
        with PILImage.open(view.path) as im:
            if im.format == "JPEG":
                im.draft("RGB", OUT)
            im.load()
            picture = _flatten(im)
    except FileNotFoundError as e:
        raise SnapshotUnavailable(NO_VIEW[spec.subject_kind]) from e
    if picture.size == OUT:
        return picture
    picture.thumbnail(OUT, PILImage.Resampling.LANCZOS)
    page = PILImage.new("RGB", OUT, (255, 255, 255))
    page.paste(picture, ((OUT[0] - picture.width) // 2, (OUT[1] - picture.height) // 2))
    return page


def _flatten(im: PILImage.Image) -> PILImage.Image:
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        rgba = im.convert("RGBA")
        page = PILImage.new("RGB", rgba.size, (255, 255, 255))
        page.paste(rgba, mask=rgba.getchannel("A"))
        return page
    return im.convert("RGB")
