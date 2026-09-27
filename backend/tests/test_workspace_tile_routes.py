"""GET /site-tiles (spec 2026-09-26-map-workspace sections 6 and 15)."""

import numpy as np
from affine import Affine
from pyproj import CRS, Transformer
from workspace_rows import BASE, add_map, rgba, set_frame, write_plan_tif

from app.workspace import grid, tiles

UTM38 = CRS.from_epsg(32638).to_wkt()
UTM39 = CRS.from_epsg(32639).to_wkt()
GT39 = [500000.0, 0.1, 0.0, 3300000.0, 0.0, -0.1]


def test_a_map_in_another_crs_lands_where_pyproj_says(client, project_id, handle):
    ox, oy = Transformer.from_crs("EPSG:4326", "EPSG:32638", always_xy=True).transform(47.99, 29.5)
    gt = [round(ox, 1), 0.1, 0.0, round(oy, 1), 0.0, -0.1]
    raster = np.full((3, 400, 400), 30, np.uint8)
    raster[:, 190:210, 190:210] = 250  # a 2 m bright square centred on pixel corner (200, 200)
    map_id = add_map(
        handle, crs_wkt=UTM38, geotransform=gt, width=400, height=400, gsd_cm=10.0, raster=raster
    )
    set_frame(client, project_id, 32639)
    cx, cy = Affine.from_gdal(*gt) @ (200.0, 200.0)
    ex, ey = Transformer.from_crs("EPSG:32638", "EPSG:32639", always_xy=True).transform(cx, cy)
    z = 14  # res 0.0625 m: the square is ~32 px wide
    x, y = grid.tile_of(ex, ey, z)
    r = client.get(f"{BASE}/{project_id}/site-tiles/map/{map_id}/{z}/{x}/{y}")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "image/png" and "immutable" in r.headers["cache-control"]
    img = rgba(r.content)
    rows, cols = np.nonzero(img[..., 0] > 140)
    assert rows.size > 900, f"the square straddles a tile edge ({rows.size} px)"
    minx, _, _, maxy = grid.tile_bounds(z, x, y)
    want_col = (ex - minx) / grid.res(z) - 0.5
    want_row = (maxy - ey) / grid.res(z) - 0.5
    assert abs(cols.mean() - want_col) <= 0.5 and abs(rows.mean() - want_row) <= 0.5


def test_tile_status_codes(client, project_id, handle):
    map_id = add_map(
        handle,
        crs_wkt=UTM39,
        geotransform=GT39,
        width=400,
        height=400,
        gsd_cm=10.0,
        raster=np.full((3, 400, 400), 99, np.uint8),
    )
    set_frame(client, project_id, 32639)
    url = f"{BASE}/{project_id}/site-tiles/map"
    r = client.get(f"{url}/{map_id}/14/0/0")
    assert r.status_code == 204 and "immutable" in r.headers["cache-control"]
    assert client.get(f"{url}/nope/14/0/0").status_code == 404
    failed = add_map(handle, crs_wkt=UTM39, geotransform=GT39, width=400, height=400, status="failed")
    assert client.get(f"{url}/{failed}/14/0/0").status_code == 404
    importing = add_map(handle, crs_wkt=UTM39, geotransform=GT39, width=400, height=400, status="importing")
    r = client.get(f"{url}/{importing}/14/0/0")
    assert (r.status_code, r.json()["error"]["code"]) == (409, "not_ready")
    bare = add_map(handle, crs_wkt=None, geotransform=None, width=400, height=400)
    r = client.get(f"{url}/{bare}/14/0/0")
    assert (r.status_code, r.json()["error"]["code"]) == (422, "no_coordinates")
    assert client.get(f"{url}/{map_id}/21/0/0").status_code == 422
    assert client.get(f"{url}/nope/3/-1/-1").status_code == 404  # negative indices are routed


def test_preview_query_rules(client, project_id, handle):
    """Contract getSiteTile 422 (controller ruling F1, over R-B1-11): a malformed `t` is 422 on any
    kind, and so is a well-formed one on a kind other than drawing_raster; `frame_key` is ignored.
    The no-store answer of a drawing preview is tested with a registered resolver below."""
    map_id = add_map(
        handle,
        crs_wkt=UTM39,
        geotransform=GT39,
        width=400,
        height=400,
        gsd_cm=10.0,
        raster=np.full((3, 400, 400), 99, np.uint8),
    )
    set_frame(client, project_id, 32639)
    x, y = grid.tile_of(500001.0, 3299999.0, 13)
    url = f"{BASE}/{project_id}/site-tiles/map/{map_id}/13/{x}/{y}"
    plain = client.get(url)
    assert plain.status_code == 200
    r = client.get(url, params={"frame_key": "epsg:32639"})
    assert r.status_code == 200 and r.content == plain.content and "immutable" in r.headers["cache-control"]
    for t in ("1,2,3", "a,b,c,d,e,f", "0.1,0,0,0,-0.1,0"):
        r = client.get(url, params={"t": t})
        assert (r.status_code, r.json()["error"]["code"]) == (422, "invalid_preview"), t
    assert client.get(url, params={"frame_key": "k" * 201}).status_code == 422


def test_a_drawing_preview_is_no_store(client, project_id, handle, tmp_path, drawing_resolver):
    data = np.full((4, 256, 256), 60, np.uint8)
    data[3] = 255
    path = write_plan_tif(
        tmp_path / "plan.tif", data, crs_wkt=UTM39, transform=Affine(0.125, 0, 500000.0, 0, -0.125, 3300000.0)
    )
    drawing_resolver(
        lambda h, i, s: tiles.SiteTileSource(
            layer_id=i,
            version="preview" if s.preview else "1",
            path=path,
            crs_wkt=UTM39,
            bounds_native=(500000.0, 3299968.0, 500032.0, 3300000.0),
            native_res_m=0.125,
            paint=tiles.rgba_paint(False),
            bands=(1, 2, 3, 4),
            alpha_band=4,
            src_transform=Affine(*s.preview) if s.preview else None,
        )
    )
    set_frame(client, project_id, 32639)
    x, y = grid.tile_of(500001.0, 3299999.0, 13)
    url = f"{BASE}/{project_id}/site-tiles/drawing_raster/D/13/{x}/{y}"
    r = client.get(url, params={"t": "0.125,0,500000,0,-0.125,3300000"})
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    r = client.get(f"{BASE}/{project_id}/site-tiles/drawing_raster/D/13/0/0", params={"t": "1,0,0,0,-1,0"})
    assert r.status_code == 204 and r.headers["cache-control"] == "no-store"  # also on its 204
    assert "immutable" in client.get(url).headers["cache-control"]


def test_far_away_layer_is_204_not_500(client, project_id, handle, monkeypatch):
    """Review Focus 1: a map in UTM zone 1 shown in a zone-39 frame. Near the site pyproj still
    returns finite values; a far tile (z 0, x = y = -400) projects to nothing finite at all."""
    far = CRS.from_epsg(32601).to_wkt()
    add_map(handle, crs_wkt=UTM39, geotransform=GT39, width=400, height=400, gsd_cm=10.0)
    map_id = add_map(
        handle,
        crs_wkt=far,
        geotransform=GT39,
        width=400,
        height=400,
        gsd_cm=10.0,
        raster=np.full((3, 400, 400), 99, np.uint8),
    )
    set_frame(client, project_id, 32639)
    boxes = []
    real = tiles.bbox_from_site
    monkeypatch.setattr(tiles, "bbox_from_site", lambda *a, **kw: boxes.append(real(*a, **kw)) or boxes[-1])
    x, y = grid.tile_of(500001.0, 3299999.0, 14)
    assert client.get(f"{BASE}/{project_id}/site-tiles/map/{map_id}/14/{x}/{y}").status_code == 204
    assert boxes[-1] is not None  # finite, just elsewhere
    assert client.get(f"{BASE}/{project_id}/site-tiles/map/{map_id}/0/-400/-400").status_code == 204
    assert boxes[-1] is None  # the inf path: no finite point, a 204 and never a 500
