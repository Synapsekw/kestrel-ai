"""The drawing_raster source (spec §6 renderer kind `drawing_raster`; plan Task 8, Ruling 5). M-B1's
renderer warps plan.tif by its own geotransform, so the checks here are: the fields are right, and
plan.tif's bounds equal the placement's bounds (then the WarpedVRT lands where the placement says)."""

import io
import math

import numpy as np
import pytest
import rasterio
from drawings_helpers import BASE, build_drawing, inspect_ready, seed_frame, write_png
from PIL import Image

from app.db.models import Drawing
from app.drawings import raster_source, site, store
from app.errors import AppError
from app.workspace import tiles

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


def _tile(client, project_id, did, z, x, y, **q):
    return client.get(f"{BASE}/{project_id}/site-tiles/drawing_raster/{did}/{z}/{x}/{y}", params=q)


def test_the_site_tile_route_renders_the_placed_plan(client, project_id, handle, placed):
    """z 12 = 0.25 m/px: tile (7813, -77860) is exactly the placed 256 x 256 plan."""
    plan = np.moveaxis(rasterio.open(store.plan_path(handle, placed["id"])).read(), 0, -1)
    r = _tile(client, project_id, placed["id"], 12, 7813, -77860, v="1")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    tile = np.asarray(Image.open(io.BytesIO(r.content)).convert("RGBA"))
    assert np.abs(tile[..., :3].astype(int) - plan[..., :3].astype(int)).max() <= 1
    assert _tile(client, project_id, placed["id"], 12, 7818, -77860, v="1").status_code == 204


def test_knockout_and_refusals_through_the_route(client, project_id, wait_job, handle, tmp_path):
    seed_frame(handle, 32633)
    img = np.full((256, 256, 3), 255, np.uint8)
    img[:, 100:110] = 0
    Image.fromarray(img).save(tmp_path / "w.png")
    d = build_drawing(
        client, project_id, wait_job, inspect_ready(client, project_id, wait_job, tmp_path / "w.png")["id"]
    )
    url = f"{BASE}/{project_id}/drawings/{d['id']}/georef"
    client.put(url, json={"model": "similarity", "points": PAIRS, "dst_frame": "site"})
    knocked = np.asarray(
        Image.open(
            io.BytesIO(_tile(client, project_id, d["id"], 12, 7813, -77860, v="1", knockout="true").content)
        ).convert("RGBA")
    )
    assert (knocked[:, :90, 3] == 0).all() and (knocked[:, 102:108, 3] == 255).all()
    client.delete(url)
    r = _tile(client, project_id, d["id"], 12, 7813, -77860, v="2")
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_coordinates"
    assert (
        _tile(client, project_id, "00000000-0000-4000-8000-000000000000", 12, 7813, -77860).status_code == 404
    )
    shown = _tile(
        client, project_id, d["id"], 12, 7813, -77860, t="0.25,0,500032,0,0.25,4983040"
    )  # unplaced now
    assert shown.status_code == 200


def _cached(handle, did) -> list:
    return [k for k in tiles.SITE_TILES._items if k[:2] == (handle.id, did)]


def test_a_local_placement_leaves_plan_tif_without_a_crs(client, project_id, handle, placed):
    """Addition (a): B1 warps a CRS frame by plan.tif's own CRS, so a local placement (and a clear)
    must not leave the previous CRS placement's CRS in the file."""
    path, url = store.plan_path(handle, placed["id"]), f"{BASE}/{project_id}/drawings/{placed['id']}/georef"
    seed_frame(handle, None)
    r = client.put(url, json={"model": "similarity", "points": PAIRS, "dst_frame": "site"})
    assert r.status_code == 200, r.text
    with rasterio.open(path) as p:
        assert p.crs is None and p.transform.a == 0.25
    seed_frame(handle, 32633)
    client.put(url, json={"model": "similarity", "points": PAIRS, "dst_frame": "site"})
    with rasterio.open(path) as p:
        assert p.crs.to_epsg() == 32633
    assert client.delete(url).status_code == 200
    with rasterio.open(path) as p:
        assert p.crs is None


def test_previews_are_never_cached_and_follow_t(client, project_id, handle, placed):
    """Addition (b): two different `t` on the same drawing give different tiles, both no-store, and
    neither leaves an entry in B1's tile cache; a mirrored `t` is 422 invalid_preview (addition d)."""
    did = placed["id"]
    tiles.SITE_TILES.drop_map(did)
    here = _tile(client, project_id, did, 12, 7813, -77860, t="0.25,0,500032,0,0.25,4983040")
    moved = _tile(client, project_id, did, 12, 7813, -77860, t="0.25,0,500064,0,0.25,4983040")
    assert (here.status_code, moved.status_code) == (200, 200)
    assert here.headers["cache-control"] == moved.headers["cache-control"] == "no-store"
    a = np.asarray(Image.open(io.BytesIO(here.content)).convert("RGBA"))
    b = np.asarray(Image.open(io.BytesIO(moved.content)).convert("RGBA"))
    assert (a[..., 3] == 255).all() and (b[:, :120, 3] == 0).all() and (b[:, 136:, 3] == 255).all()
    assert not _cached(handle, did)
    mirrored = _tile(client, project_id, did, 12, 7813, -77860, t="0.25,0,500032,0,-0.25,4983040")
    assert (mirrored.status_code, mirrored.json()["error"]["code"]) == (422, "invalid_preview")
    assert mirrored.headers["cache-control"] == "no-store"


def test_a_served_drawing_can_be_replaced_and_deleted(client, project_id, handle, placed):
    """Addition (c): after B1 served plan.tif, a georef save rewrites it in place, the old tiles are
    evicted, and a DELETE removes the whole folder (Windows keeps open files' folders)."""
    did, url = placed["id"], f"{BASE}/{project_id}/drawings/{placed['id']}/georef"
    assert _tile(client, project_id, did, 12, 7813, -77860, v="1").status_code == 200
    assert _cached(handle, did)
    shifted = [{"src": p["src"], "dst": [p["dst"][0] + 32.0, p["dst"][1]]} for p in PAIRS]
    r = client.put(url, json={"model": "similarity", "points": shifted, "dst_frame": "site"})
    assert r.status_code == 200, r.text
    assert not _cached(handle, did)
    img = np.asarray(Image.open(io.BytesIO(_tile(client, project_id, did, 12, 7813, -77860, v="2").content)))
    assert (img[:, :120, 3] == 0).all() and (img[:, 136:, 3] == 255).all()
    assert _cached(handle, did)
    folder = store.drawing_dir(handle, did)
    assert client.delete(f"{BASE}/{project_id}/drawings/{did}").status_code == 204
    assert not folder.exists() and not _cached(handle, did)
