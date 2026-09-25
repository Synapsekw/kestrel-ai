"""Surface tiles, the ortho underlay and the height sample through the API (spec §8)."""

import io

import numpy as np
import pytest
import rasterio
from PIL import Image as PILImage
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.windows import Window
from surfaces import CX, CY, X0, Y1, cone, fixture_spec, plane
from volume_rows import add_map_run, add_surface

from app.db.models import GeoMap
from app.maps.startup import map_raster_path
from app.surfaces import grid
from app.surfaces.grid import hillshade, open_surface
from app.surfaces.paths import surface_path
from app.surfaces.tiles import render_hillshade_tile

BASE = "/api/v1/projects"


@pytest.fixture
def project_kind() -> str:
    return "detect"  # surfaces and volumes are detection work (F0: require_kind(("detect",), ANY_KIND))


@pytest.fixture
def surface(handle):
    return add_surface(handle, fixture_spec(0.1), lambda x, y: plane(x, y) + cone(x, y))


def test_hillshade_tile_parity_cache_and_204(client, project_id, handle, surface):
    url = f"{BASE}/{project_id}/surfaces/{surface}/tiles"
    r = client.get(f"{url}/2/1/1")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert "immutable" in r.headers["cache-control"]
    got = np.asarray(PILImage.open(io.BytesIO(r.content)).convert("RGBA"))
    with open_surface(surface_path(handle, surface)) as s:
        want = hillshade(s.read(Window(255, 255, 258, 258)), 0.1, 0.1)[1:-1, 1:-1]
    assert (got[..., 0] == want).all()
    assert client.get(f"{url}/2/9/9").status_code == 204
    assert client.get(f"{url}/0/0/0?tint=true").status_code == 200


def test_tinted_tile_of_a_design_surface_uses_z_min_max(client, project_id, handle):
    sid = add_surface(handle, fixture_spec(0.5), plane, kind="design", method="tin")
    r = client.get(f"{BASE}/{project_id}/surfaces/{sid}/tiles/0/0/0?tint=true")
    assert r.status_code == 200
    with handle.session() as s:
        from app.db.models import Surface

        row = s.get(Surface, sid)
        z_min, z_max = row.z_min, row.z_max
    with open_surface(surface_path(handle, sid)) as reader:
        want = render_hillshade_tile(reader, 0, 0, 0, tint_range=(z_min, z_max))
    assert r.content == want


def test_tile_reads_stay_within_258(client, project_id, handle, surface, monkeypatch):
    seen = []
    real = grid._raw_read
    monkeypatch.setattr(grid, "_raw_read", lambda ds, w, o, rs: seen.append(o) or real(ds, w, o, rs))
    client.get(f"{BASE}/{project_id}/surfaces/{surface}/tiles/0/0/0")
    assert seen and all(max(s) <= 258 for s in seen)


def test_sample_returns_the_height_or_null(client, project_id, surface):
    url = f"{BASE}/{project_id}/surfaces/{surface}/sample"
    got = client.get(url, params={"x": CX, "y": CY}).json()
    assert got["z"] == pytest.approx(plane(np.array([CX]), np.array([CY]))[0] + 5.0, abs=0.06)
    assert client.get(url, params={"x": X0 - 100, "y": Y1}).json()["z"] is None


def test_building_surface_tiles_are_409(client, project_id, handle):
    from app.db.models import Surface

    with handle.session() as s:
        row = Surface(name="b", kind="cloud_dsm", status="building")
        s.add(row)
        s.flush()
        sid = row.id
    assert client.get(f"{BASE}/{project_id}/surfaces/{sid}/tiles/0/0/0").status_code == 409


def test_ortho_tile_warps_the_linked_map(client, project_id, handle, surface):
    gt = [X0 - 5, 0.1, 0.0, Y1 + 5, 0.0, -0.1]
    map_id, _, _ = add_map_run(
        handle, crs_wkt=fixture_spec(0.1).crs_wkt, geotransform=gt, boxes=[], width=700, height=700
    )
    with handle.session() as s:
        s.get(GeoMap, map_id).gsd_cm = 10.0
    path = map_raster_path(handle, map_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=700,
        height=700,
        count=3,
        dtype="uint8",
        crs=fixture_spec(0.1).crs_wkt,
        transform=from_origin(X0 - 5, Y1 + 5, 0.1, 0.1),
        tiled=True,
        blockxsize=256,
        blockysize=256,
    ) as ds:
        ds.write(np.full((3, 700, 700), 200, np.uint8))
        ds.write_mask(np.full((700, 700), 255, np.uint8))
        ds.build_overviews([2, 4], Resampling.average)
    r = client.get(f"{BASE}/{project_id}/surfaces/{surface}/ortho-tiles/2/0/0", params={"map_id": map_id})
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert (
        client.get(
            f"{BASE}/{project_id}/surfaces/{surface}/ortho-tiles/2/0/0", params={"map_id": "nope"}
        ).status_code
        == 404
    )
