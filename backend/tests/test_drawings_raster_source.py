"""The drawing_raster source (spec §6 renderer kind `drawing_raster`; plan Task 8, Ruling 5). M-B1's
renderer warps plan.tif by its own geotransform, so the checks here are: the fields are right, and
plan.tif's bounds equal the placement's bounds (then the WarpedVRT lands where the placement says)."""

import math

import pytest
import rasterio
from drawings_helpers import BASE, build_drawing, inspect_ready, seed_frame, write_png

from app.db.models import Drawing
from app.drawings import raster_source, site, store
from app.errors import AppError

PAIRS = [
    {"src": [0, 0], "dst": [500032.0, 4983040.0]},
    {"src": [256, 0], "dst": [500096.0, 4983040.0]},
    {"src": [256, -256], "dst": [500096.0, 4982976.0]},
]


@pytest.fixture
def placed(client, project_id, wait_job, handle, tmp_path):
    seed_frame(handle, 32633)
    insp = inspect_ready(client, project_id, wait_job, write_png(tmp_path / "c.png", 256, 256))
    d = build_drawing(client, project_id, wait_job, insp["id"])
    r = client.put(
        f"{BASE}/{project_id}/drawings/{d['id']}/georef",
        json={"model": "similarity", "points": PAIRS, "dst_frame": "site"},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_the_fields_match_plan_tif(handle, placed):
    frame = site.current_frame(handle)
    f = raster_source.drawing_raster_fields(handle, placed["id"], frame)
    assert (
        f["layer_id"] == placed["id"]
        and f["version"] == "1"
        and f["path"] == store.plan_path(handle, placed["id"])
    )
    assert f["crs_wkt"] == placed["georef"]["dst_crs_wkt"]
    assert f["bounds_native"] == pytest.approx((500032.0, 4982976.0, 500096.0, 4983040.0))
    assert math.isclose(f["native_res_m"], 0.25)
    with rasterio.open(f["path"]) as p:
        assert tuple(p.bounds) == pytest.approx(f["bounds_native"]) and p.crs.to_epsg() == 32633


def test_refusals(client, project_id, wait_job, handle, tmp_path, placed):
    frame = site.current_frame(handle)
    with pytest.raises(AppError) as e:
        raster_source.drawing_raster_fields(handle, placed["id"], site.Frame("local", None, None))
    assert (e.value.status, e.value.code) == (422, "no_coordinates")
    insp = inspect_ready(client, project_id, wait_job, write_png(tmp_path / "u.png", 8, 8))
    unplaced = build_drawing(client, project_id, wait_job, insp["id"])
    with pytest.raises(AppError) as e:
        raster_source.drawing_raster_fields(handle, unplaced["id"], frame)
    assert (e.value.status, e.value.code) == (422, "no_coordinates")
    with handle.session() as s:
        s.get(Drawing, unplaced["id"]).status = "importing"
    with pytest.raises(AppError) as e:
        raster_source.drawing_raster_fields(handle, unplaced["id"], frame)
    assert (e.value.status, e.value.code) == (409, "not_ready")
    with handle.session() as s:
        row = s.get(Drawing, unplaced["id"])
        row.status, row.format = "ready", "dxf"
    for layer in (unplaced["id"], "00000000-0000-4000-8000-000000000000"):
        with pytest.raises(AppError) as e:
            raster_source.drawing_raster_fields(handle, layer, frame)
        assert e.value.status == 404


def test_a_preview_places_an_unplaced_drawing(client, project_id, wait_job, handle, tmp_path):
    seed_frame(handle, 32633)
    insp = inspect_ready(client, project_id, wait_job, write_png(tmp_path / "u.png", 256, 256))
    d = build_drawing(client, project_id, wait_job, insp["id"])
    preview = (0.25, 0.0, 500032.0, 0.0, 0.25, 4983040.0)
    f = raster_source.drawing_raster_fields(handle, d["id"], site.current_frame(handle), preview=preview)
    assert f["bounds_native"] == pytest.approx((500032.0, 4982976.0, 500096.0, 4983040.0))
    assert f["preview_transform"] == (0.25, -0.0, 500032.0, 0.0, -0.25, 4983040.0)
    assert f["version"].startswith("preview")
