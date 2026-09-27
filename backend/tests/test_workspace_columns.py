"""M-C0: the new response fields on existing schemas are passed through from migration 0012's
columns, so every response conforms before the units that fill them (M-B2, M-B5) land."""

from datetime import UTC, datetime

from app.db.models import MapRun, SiteArea, Surface, VolumeMeasurement
from app.detect.analytics_router import SiteAreaOut
from app.maps.schemas import MapRunOut
from app.surfaces import service as surfaces
from app.volumes import service as volumes

NOW = datetime(2026, 9, 27, tzinfo=UTC)
RING = [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0]]


def test_a_dem_surface_reports_its_elevation_role(handle):
    with handle.session() as s:
        row = Surface(name="Sep DSM", kind="dem", status="failed", elevation_role="dsm")
        s.add(row)
        s.flush()
        out = surfaces.to_out(s, row)
    assert (out.kind, out.elevation_role) == ("dem", "dsm")


def test_a_cloud_dsm_has_no_elevation_role(handle):
    with handle.session() as s:
        row = Surface(name="May DSM", kind="cloud_dsm", status="failed")
        s.add(row)
        s.flush()
        assert surfaces.to_out(s, row).elevation_role is None


def test_a_volume_reports_its_material():
    row = VolumeMeasurement(
        id="v1",
        name="Pile",
        polygon_native=RING,
        top_surface_id="s1",
        base={"kind": "toe_plane"},
        masks={},
        alignment={},
        status="ready",
        material={"name": "Gravel", "density_t_m3": 1.8},
        created_at=NOW,
        updated_at=NOW,
    )
    out = volumes.to_out(row, [])
    assert (out.material.name, out.material.density_t_m3) == ("Gravel", 1.8)
    row.material = None
    assert volumes.to_out(row, []).material is None


def test_a_map_run_reports_its_scope():
    row = MapRun(
        id="r1",
        map_id="m1",
        kind="local_model",
        query="",
        tile_size=1280,
        overlap=0.2,
        nms_iou=0.5,
        conf=0.25,
        counts={},
        created_at=NOW,
    )
    out = MapRunOut.from_row(row, state=None, detection_count=0)
    assert (out.scope, out.region_px) == ("map", None)  # an unflushed row has no default yet
    row.scope, row.region_px = "region", RING
    out = MapRunOut.from_row(row, state=None, detection_count=0)
    assert (out.scope, out.region_px) == ("region", RING)


def test_a_site_area_reports_its_category():
    row = SiteArea(id="a1", name="Yard", polygon_wgs84=RING, created_at=NOW)
    assert SiteAreaOut.from_row(row).category == "general"
    row.category = "exclusion"
    assert SiteAreaOut.from_row(row).category == "exclusion"
