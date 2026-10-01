"""Preview staleness hooks (R10 Task X): the live preview's section etag and outline warnings follow
a map's georeference and a cloud measurement's stored 3D view. Rendered PDFs are unaffected."""

from datetime import date

import pytest
from reports_cloud_rows import (
    GENERATED_AT,
    cloud_measurement,
    insert_cloud,
    make_stale,
    png,
    store_measurement_view,
)
from reports_m_rows import add_geomap
from reports_rows import config
from sqlalchemy import update

from app.db.models import GeoMap
from app.reports.figures import cloud
from app.reports.outline import build_outline


def _outline(handle, cfg):
    return build_outline(handle, "r-test", cfg, generated_at=GENERATED_AT)


def _etag(handle, cfg, key):
    (sec,) = [s for s in _outline(handle, cfg).sections if s.key == key]
    return sec.etag


def test_a_map_georeference_change_moves_the_finding_pages_etag(handle):
    gid = add_geomap(handle, name="Aug", captured_on=date(2026, 8, 1))
    cfg = config(sections=("finding_pages",))
    before = _etag(handle, cfg, "finding_pages")
    with handle.session() as s:
        s.execute(update(GeoMap).where(GeoMap.id == gid).values(crs_wkt='LOCAL_CS["moved"]'))
    after_crs = _etag(handle, cfg, "finding_pages")
    assert after_crs != before
    with handle.session() as s:
        s.execute(update(GeoMap).where(GeoMap.id == gid).values(bounds_wgs84=[1.0, 2.0, 3.0, 4.0]))
    assert _etag(handle, cfg, "finding_pages") != after_crs


@pytest.fixture
def cloud_id(handle):
    return insert_cloud(handle)


def _m_cfg():
    return config(sections=("measurements",))


def test_capturing_a_cloud_measurement_view_moves_the_measurements_etag(handle, cloud_id):
    mid = cloud_measurement(handle, cloud_id)
    cfg = _m_cfg()
    before = _etag(handle, cfg, "measurements")
    store_measurement_view(handle, cloud_id, mid, png(colour=(10, 20, 30)))
    captured = _etag(handle, cfg, "measurements")
    assert captured != before
    store_measurement_view(handle, cloud_id, mid, png(colour=(200, 150, 90)))
    assert _etag(handle, cfg, "measurements") != captured


def test_a_cloud_measurement_view_turning_stale_moves_the_measurements_etag(handle, cloud_id):
    mid = cloud_measurement(handle, cloud_id)
    store_measurement_view(handle, cloud_id, mid)
    cfg = _m_cfg()
    before = _etag(handle, cfg, "measurements")
    make_stale(handle, measurement_id=mid)
    assert _etag(handle, cfg, "measurements") != before


def test_the_outline_warns_once_for_missing_and_for_stale_measurement_views(handle, cloud_id):
    missing = cloud_measurement(handle, cloud_id, name="Missing")
    codes = [w.code for w in _outline(handle, _m_cfg()).warnings]
    assert codes.count(cloud.MISSING_CODE) == 1
    store_measurement_view(handle, cloud_id, missing)
    make_stale(handle, measurement_id=missing)
    codes = [w.code for w in _outline(handle, _m_cfg()).warnings]
    assert codes.count(cloud.STALE) == 1
    assert cloud.MISSING_CODE not in codes
