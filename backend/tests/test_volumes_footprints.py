"""Detection footprints on a surface (spec 2026-09-23-volumes §6.5)."""

import pytest
from pyproj import CRS, Transformer
from shapely.geometry import box
from surfaces import CX, CY, EPSG, WKT
from volume_rows import add_map_run

from app.volumes.footprints import FootprintError, footprints_for, usable_runs

WGS84 = CRS.from_epsg(4326).to_wkt()
TO_LL = Transformer.from_crs(EPSG, 4326, always_xy=True)
BBOX = (CX - 12, CY - 12, CX + 12, CY + 12)


@pytest.fixture
def project_kind() -> str:
    return "detect"  # surfaces and volumes are detection work (F0: require_kind(("detect",), ANY_KIND))


def _ll_map(handle, boxes_utm, **kw):
    """A map in EPSG:4326 around the fixture site (so the reprojection path is taken) with one
    detection per UTM box, converted to that map's pixels."""
    lon0, lat1 = TO_LL.transform(CX - 50, CY + 50)
    lon1, lat0 = TO_LL.transform(CX + 50, CY - 50)
    px, py = (lon1 - lon0) / 4000, (lat1 - lat0) / 4000
    gt = [lon0, px, 0.0, lat1, 0.0, -py]
    boxes = []
    for x0, y0, x1, y1 in boxes_utm:
        lons, lats = TO_LL.transform([x0, x1], [y1, y0])
        boxes.append(
            ((lons[0] - lon0) / px, (lat1 - lats[0]) / py, (lons[1] - lons[0]) / px, (lats[0] - lats[1]) / py)
        )
    return add_map_run(handle, crs_wkt=WGS84, geotransform=gt, boxes=boxes, **kw)


def test_a_4326_detection_lands_on_its_utm_box_with_the_buffer(handle):
    machine = (CX + 3, CY + 1, CX + 6, CY + 3)
    _, run_id, (det_id,) = _ll_map(handle, [machine])
    runs = usable_runs(handle, [run_id])
    fps, truncated = footprints_for(
        handle, runs, class_ids=None, buffer_m=0.5, bbox=BBOX, surface_crs_wkt=WKT
    )
    assert not truncated and [f.detection_id for f in fps] == [det_id]
    want = box(*machine).buffer(0.5)
    assert fps[0].polygon.symmetric_difference(want).area < 0.02 * want.area


def test_same_crs_map_needs_no_transform_and_filters_by_class_conf_and_bbox(handle):
    gt = [CX - 50, 0.05, 0.0, CY + 50, 0.0, -0.05]
    near = (1000, 1000, 40, 30)  # pixels: 50 m / 0.05 = 1000 -> at the centre
    far = (0, 0, 40, 30)  # 50 m away, outside the grown bbox
    low = (1100, 1000, 40, 30)
    _, run_id, (near_id, _, _) = add_map_run(
        handle, crs_wkt=WKT, geotransform=gt, boxes=[near, far, low], confidences=[0.9, 0.9, 0.1], conf=0.25
    )
    runs = usable_runs(handle, [run_id])
    fps, _ = footprints_for(handle, runs, class_ids=None, buffer_m=0.0, bbox=BBOX, surface_crs_wkt=WKT)
    assert [f.detection_id for f in fps] == [near_id]
    assert fps[0].polygon.area == pytest.approx(2.0 * 1.5)
    none, _ = footprints_for(
        handle, runs, class_ids=["c-crane"], buffer_m=0.0, bbox=BBOX, surface_crs_wkt=WKT
    )
    assert none == []


def test_limit_truncates(handle):
    gt = [CX - 50, 0.05, 0.0, CY + 50, 0.0, -0.05]
    boxes = [(900 + 10 * i, 1000, 5, 5) for i in range(12)]
    _, run_id, _ = add_map_run(handle, crs_wkt=WKT, geotransform=gt, boxes=boxes)
    runs = usable_runs(handle, [run_id])
    fps, truncated = footprints_for(
        handle, runs, class_ids=None, buffer_m=1.0, bbox=BBOX, surface_crs_wkt=WKT, limit=5
    )
    assert len(fps) == 5 and truncated


def test_unusable_runs_are_named(handle):
    gt = [CX - 50, 0.05, 0.0, CY + 50, 0.0, -0.05]
    _, running, _ = add_map_run(handle, crs_wkt=WKT, geotransform=gt, boxes=[], state="running")
    with pytest.raises(FootprintError, match="has not finished"):
        usable_runs(handle, [running])
    with pytest.raises(FootprintError, match="no longer exists"):
        usable_runs(handle, ["gone"])
    _, ok, _ = add_map_run(handle, crs_wkt=WKT, geotransform=gt, boxes=[(1000, 1000, 5, 5)])
    with pytest.raises(FootprintError, match="no coordinate system"):
        footprints_for(
            handle, usable_runs(handle, [ok]), class_ids=None, buffer_m=1.0, bbox=BBOX, surface_crs_wkt=None
        )


def test_rejected_detections_are_not_masked(handle):
    from app.db.models import MapDetection

    gt = [CX - 50, 0.05, 0.0, CY + 50, 0.0, -0.05]
    _, run_id, (a, b) = add_map_run(
        handle, crs_wkt=WKT, geotransform=gt, boxes=[(1000, 1000, 40, 30), (1100, 1000, 40, 30)]
    )
    with handle.session() as s:
        s.get(MapDetection, b).review_state = "rejected"
    fps, _ = footprints_for(
        handle, usable_runs(handle, [run_id]), class_ids=None, buffer_m=1.0, bbox=BBOX, surface_crs_wkt=WKT
    )
    assert [f.detection_id for f in fps] == [a]
