"""C's stored 3D view, passed through (spec §9.4). R3 stub; R9-C replaces the bodies and keeps these
names and signatures (source_version = the stored view's sha256, via
app.pointclouds.views.stored_view(handle, subject_kind, subject_id)):

    OUT = (1600, 1000)                          # C's capture size; the snapshot's output size
    JPEG_QUALITY = 88                           # read by render_result instead of the cache's q85
    source_version(handle, spec) -> str        # "missing:<reason>" when there is no stored view
    render(handle, spec) -> PIL.Image.Image    # RGB, exactly OUT; SnapshotUnavailable(reason)
"""

from __future__ import annotations

from app.reports.snapshots import MISSING, SnapshotUnavailable

OUT = (1600, 1000)
JPEG_QUALITY = 88  # spec §9.4: C's stored view is re-encoded once as JPEG q88
REASON = "3D views are not available yet"


def source_version(handle, spec) -> str:
    return MISSING + REASON


def render(handle, spec):
    raise SnapshotUnavailable(REASON)
