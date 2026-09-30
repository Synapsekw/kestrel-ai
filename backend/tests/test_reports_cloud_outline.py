"""R9-C outline hooks (Ruling A5/A6): `warnings(ctx)` lets the builder chip see 3D warnings without
compose() visiting every finding page, and `fingerprint(ctx)` moves the finding_pages section etag
on a capture/re-capture even though that touches no finding row."""

import pytest
from reports_cloud_rows import (
    GENERATED_AT,
    X,
    cloud_finding,
    insert_cloud,
    make_stale,
    png,
    store_finding_view,
)
from reports_rows import config

from app.reports.figures import cloud
from app.reports.outline import build_outline


@pytest.fixture
def cloud_id(handle):
    return insert_cloud(handle)


def _cfg():
    return config(sections=("finding_pages",))


def test_outline_shows_a_stale_and_a_missing_warning_with_their_links(handle, crack, cloud_id):
    stale = cloud_finding(handle, crack["id"], cloud_id, x=X)
    store_finding_view(handle, stale.id)
    make_stale(handle, finding_id=stale.id)
    missing = cloud_finding(handle, crack["id"], cloud_id, x=X + 1)
    outline = build_outline(handle, "r-test", _cfg(), generated_at=GENERATED_AT)
    by_code = {w.code: w for w in outline.warnings if w.code in (cloud.STALE, cloud.MISSING_CODE)}
    assert (by_code[cloud.STALE].message, by_code[cloud.STALE].link) == (
        "1 3D view is out of date",
        f"/p/{handle.id}/clouds/{cloud_id}?finding={stale.id}",
    )
    assert (by_code[cloud.MISSING_CODE].message, by_code[cloud.MISSING_CODE].link) == (
        "1 3D view is missing",
        f"/p/{handle.id}/clouds/{cloud_id}?finding={missing.id}",
    )


def test_warnings_aggregate_to_one_entry_per_code_through_the_outline(handle, crack, cloud_id):
    for i in range(3):
        cloud_finding(handle, crack["id"], cloud_id, x=X + i)
    for i in range(2):
        f = cloud_finding(handle, crack["id"], cloud_id, x=X + 10 + i)
        store_finding_view(handle, f.id)
        make_stale(handle, finding_id=f.id)
    outline = build_outline(handle, "r-test", _cfg(), generated_at=GENERATED_AT)
    codes = [w.code for w in outline.warnings]
    assert codes.count(cloud.MISSING_CODE) == 1
    assert codes.count(cloud.STALE) == 1
    by_code = {w.code: w for w in outline.warnings}
    assert by_code[cloud.MISSING_CODE].message == "3 3D views are missing"
    assert by_code[cloud.STALE].message == "2 3D views are out of date"


def _finding_pages_etag(handle, cfg):
    outline = build_outline(handle, "r-test", cfg, generated_at=GENERATED_AT)
    (sec,) = [s for s in outline.sections if s.key == "finding_pages"]
    return sec.etag


def test_the_finding_pages_etag_moves_on_capture_and_on_recapture(handle, crack, cloud_id):
    f = cloud_finding(handle, crack["id"], cloud_id)
    cfg = _cfg()
    before = _finding_pages_etag(handle, cfg)
    store_finding_view(handle, f.id, data=png(colour=(10, 20, 30)))
    after_capture = _finding_pages_etag(handle, cfg)
    assert after_capture != before
    store_finding_view(handle, f.id, data=png(colour=(200, 150, 90)))
    after_recapture = _finding_pages_etag(handle, cfg)
    assert after_recapture != after_capture
