"""A finding photo at print size (index: SnapshotSpec kind `attachment{finding_id, attachment_id,
out}`). R3 stub; R9-I replaces the bodies and keeps these names and signatures:

    source_version(handle, spec) -> str        # "missing:<reason>" when the source is missing
    render(handle, spec) -> PIL.Image.Image    # RGB, exactly out_of(spec); SnapshotUnavailable(reason)
"""

from __future__ import annotations

from app.reports.snapshots import MISSING, SnapshotUnavailable

REASON = "Photo figures are not available yet"


def source_version(handle, spec) -> str:
    return MISSING + REASON


def render(handle, spec):
    raise SnapshotUnavailable(REASON)
