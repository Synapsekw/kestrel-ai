"""GET /site-tiles (spec 2026-09-26-map-workspace sections 6 and 15)."""

import numpy as np
import pytest
from affine import Affine
from pyproj import CRS, Transformer
from surfaces import CX, CY, X0, Y1, circle, cone, fixture_spec, plane, write_surface
from volume_rows import add_surface
from workspace_rows import BASE, add_map, rgba, set_frame, write_plan_tif

from app.db.models import Surface, VolumeMeasurement
from app.errors import not_found
from app.surfaces.grid import aligned_grid
from app.surfaces.paths import surface_path
from app.workspace import grid, tiles

UTM38 = CRS.from_epsg(32638).to_wkt()
UTM39 = CRS.from_epsg(32639).to_wkt()
GT39 = [500000.0, 0.1, 0.0, 3300000.0, 0.0, -0.1]
pytestmark = pytest.mark.usefixtures("fresh_site_tiles")


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
    for t in ("1,2,3", "a,b,c,d,e,f", "0.1,0,0,0,0.1,0"):
        r = client.get(url, params={"t": t})
        assert (r.status_code, r.json()["error"]["code"]) == (422, "invalid_preview"), t
        assert r.headers["cache-control"] == "no-store", t  # contract tilePreview: any response to `t`
    assert "cache-control" not in client.get(f"{BASE}/{project_id}/site-tiles/map/nope/13/{x}/{y}").headers
    assert client.get(url, params={"frame_key": "k" * 201}).status_code == 422


def _pixel(t):
    a, b, c, d, e, f = t
    return (a, -b, c, d, -e, f)


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
            # t maps drawing coordinates (col, -row) to the site: the pixel geotransform flips b and e
            src_transform=Affine(*_pixel(s.preview)) if s.preview else None,
        )
    )
    set_frame(client, project_id, 32639)
    x, y = grid.tile_of(500001.0, 3299999.0, 13)
    url = f"{BASE}/{project_id}/site-tiles/drawing_raster/D/13/{x}/{y}"
    r = client.get(url, params={"t": "0.125,0,500000,0,0.125,3300000"})
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    r = client.get(url, params={"t": "0.125,0,500000,0,-0.125,3300000"})
    assert (r.status_code, r.json()["error"]["code"]) == (422, "invalid_preview")  # mirrored (det < 0)
    assert r.headers["cache-control"] == "no-store"
    r = client.get(f"{BASE}/{project_id}/site-tiles/drawing_raster/D/13/0/0", params={"t": "1,0,0,0,1,0"})
    assert r.status_code == 204 and r.headers["cache-control"] == "no-store"  # also on its 204
    r = client.get(f"{BASE}/{project_id}/site-tiles/drawing_raster/D/13/{x}/{y}", params={"t": "1,0,0,0,0,0"})
    assert (r.status_code, r.headers["cache-control"]) == (422, "no-store")  # singular: invalid_preview
    assert "immutable" in client.get(url).headers["cache-control"]
    drawing_resolver(lambda h, i, s: (_ for _ in ()).throw(not_found("drawing", i)))
    r = client.get(url, params={"t": "0.125,0,500000,0,0.125,3300000"})
    assert (r.status_code, r.headers["cache-control"]) == (404, "no-store")  # the resolver's error too


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


def test_surface_styles_through_the_route(client, project_id, handle):
    sid = add_surface(handle, fixture_spec(0.1), lambda xs, ys: 0.1 * (xs - X0))  # 1 m per 10 m east
    set_frame(client, project_id, 32639)
    x, y = grid.tile_of(X0 + 30, Y1 - 30, 13)
    url = f"{BASE}/{project_id}/site-tiles/surface/{sid}/13/{x}/{y}"
    hs = client.get(url)
    assert hs.status_code == 200
    assert client.get(url, params={"style": "tint"}).content != hs.content
    img = rgba(client.get(url, params={"style": "contours", "interval": 1.0}).content)
    on = np.nonzero(img[128, :, 3])[0]
    assert len(on) >= 2 and set(np.diff(on)) <= {79, 80, 81}  # a line every 10 m = 80 px at 0.125 m
    assert client.get(url, params={"style": "contours", "interval": 0}).status_code == 422
    assert client.get(url, params={"knockout": True}).content == hs.content  # ignored for surfaces


def test_one_read_per_surface_tile_within_258(client, project_id, handle, monkeypatch):
    sid = add_surface(handle, fixture_spec(0.1), plane)
    set_frame(client, project_id, 32639)
    shapes = []
    real = tiles._read_vrt
    monkeypatch.setattr(
        tiles, "_read_vrt", lambda vrt, s: shapes.append((vrt.height, vrt.width)) or real(vrt, s)
    )
    x, y = grid.tile_of(X0 + 30, Y1 - 30, 12)
    assert client.get(f"{BASE}/{project_id}/site-tiles/surface/{sid}/12/{x}/{y}").status_code == 200
    assert shapes == [(258, 258)]


def test_a_building_surface_is_409(client, project_id, handle):
    with handle.session() as s:
        row = Surface(name="b", kind="cloud_dsm", status="building")
        s.add(row)
        s.flush()
        sid = row.id
    r = client.get(f"{BASE}/{project_id}/site-tiles/surface/{sid}/13/0/0")
    assert (r.status_code, r.json()["error"]["code"]) == (409, "not_ready")


def test_frame_change_never_serves_the_old_frames_tile(client, project_id, handle):
    """Review Focus 3."""
    sid = add_surface(handle, fixture_spec(0.1), plane)
    set_frame(client, project_id, 32639)
    x, y = grid.tile_of(X0 + 30, Y1 - 30, 13)
    url = f"{BASE}/{project_id}/site-tiles/surface/{sid}/13/{x}/{y}"
    first = client.get(url)
    assert first.status_code == 200
    set_frame(client, project_id, 32638)
    second = client.get(url)
    assert second.status_code in (200, 204)
    assert second.status_code == 204 or second.content != first.content


def test_local_frame_surface_at_negative_coordinates(client, project_id, handle):
    """Review Focus 4: a local-metres surface south-west of the origin."""
    spec = aligned_grid((-40.0, -40.0, -10.0, -10.0), 0.1, None, None)
    with handle.session() as s:
        row = Surface(name="local", kind="design", status="building")
        s.add(row)
        s.flush()
        sid = row.id
    stats = write_surface(surface_path(handle, sid), spec, lambda xs, ys: 10.0 + 0.01 * xs)
    with handle.session() as s:
        row = s.get(Surface, sid)
        row.status, row.cell_size_m, row.width, row.height = "ready", 0.1, spec.width, spec.height
        row.geotransform, row.bounds_native = list(spec.geotransform), list(spec.bounds)
        row.z_min, row.z_max = stats.z_min, stats.z_max
    assert client.put(f"{BASE}/{project_id}/map-workspace/frame", json={"kind": "local"}).status_code == 200
    x, y = grid.tile_of(-25.0, -25.0, 13)
    assert (x, y) == (-1, 0)
    img = rgba(client.get(f"{BASE}/{project_id}/site-tiles/surface/{sid}/13/{x}/{y}").content)
    minx, _, _, maxy = grid.tile_bounds(13, x, y)  # E -32..0, N -32..0
    assert img[int((maxy + 25.0) / 0.125), int((-25.0 - minx) / 0.125), 3] == 255
    assert img[5, 250, 3] == 0  # E, N ~ -0.7: outside the surface (E and N -40..-10)


def test_volume_diff_tile(client, project_id, handle, wait_job):
    """A calculated measurement (the volume_calc job through the API, as test_volumes_api.py does)
    serves its cut/fill diff; a missing or failed one is 404 (R-B1-10), an uncalculated one 409."""
    top = add_surface(handle, fixture_spec(0.1), lambda xs, ys: plane(xs, ys) + cone(xs, ys))
    body = {
        "name": "Pile",
        "polygon_native": circle(CX, CY, 12.0, 128),
        "top_surface_id": top,
        "base": {"kind": "toe_plane"},
    }
    r = client.post(f"{BASE}/{project_id}/volumes", json=body)
    assert r.status_code == 202, r.text
    assert wait_job(project_id, r.json()["job"]["id"])["state"] == "succeeded"
    mid = r.json()["measurement"]["id"]
    set_frame(client, project_id, 32639)
    x, y = grid.tile_of(CX, CY, 13)
    r = client.get(f"{BASE}/{project_id}/site-tiles/volume_diff/{mid}/13/{x}/{y}")
    assert r.status_code == 200, r.text
    assert (rgba(r.content)[..., 3] > 0).any()
    assert client.get(f"{BASE}/{project_id}/site-tiles/volume_diff/nope/13/0/0").status_code == 404
    ids = {}
    for status in ("calculating", "failed"):
        with handle.session() as s:
            row = VolumeMeasurement(
                name=status,
                polygon_native=circle(CX, CY, 5.0, 16),
                top_surface_id=top,
                base={"kind": "toe_plane"},
                masks={},
                alignment={},
                status=status,
            )
            s.add(row)
            s.flush()
            ids[status] = row.id
    r = client.get(f"{BASE}/{project_id}/site-tiles/volume_diff/{ids['calculating']}/13/{x}/{y}")
    assert (r.status_code, r.json()["error"]["code"]) == (409, "not_ready")
    r = client.get(f"{BASE}/{project_id}/site-tiles/volume_diff/{ids['failed']}/13/{x}/{y}")
    assert r.status_code == 404
    with handle.session() as s:  # a recalculation keeps the old results and diff.tif until it swaps
        s.get(VolumeMeasurement, mid).status = "calculating"
    r = client.get(f"{BASE}/{project_id}/site-tiles/volume_diff/{mid}/13/{x}/{y}")
    assert (r.status_code, r.json()["error"]["code"]) == (409, "not_ready")  # R-B1-10, never the old diff
