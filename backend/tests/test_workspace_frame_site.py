"""`frame=site` on existing vector endpoints (spec 2026-09-26-map-workspace section 3 M4, section 12)."""

import pytest
from pyproj import CRS, Transformer
from surfaces import fixture_spec, plane
from volume_rows import add_map_run, add_surface
from workspace_rows import BASE, set_frame

from app.db.models import VolumeMeasurement
from app.maps.georef import box_corners
from app.volumes.schemas import VolumeFootprint
from app.workspace import views

UTM38 = CRS.from_epsg(32638).to_wkt()
O38 = Transformer.from_crs("EPSG:4326", "EPSG:32638", always_xy=True).transform(47.99, 29.5)
GT38 = [round(O38[0], 1), 0.1, 0.0, round(O38[1], 1), 0.0, -0.1]
T = Transformer.from_crs("EPSG:32638", "EPSG:32639", always_xy=True)


def _site(px, py):
    return list(T.transform(GT38[0] + px * 0.1, GT38[3] - py * 0.1))


def _flat(points):
    """pytest.approx does not recurse into nested lists (a list of [x, y] points), so points-lists
    are compared flattened."""
    return [v for p in points for v in p]


def test_detections_in_a_site_bbox_come_with_site_corners(client, project_id, handle):
    _, run_id, ids = add_map_run(
        handle, crs_wkt=UTM38, geotransform=GT38, boxes=[(100, 100, 40, 20), (3000, 3000, 10, 10)]
    )
    set_frame(client, project_id, 32639)
    (x0, y0), (x1, y1) = _site(90, 130), _site(150, 90)
    url = f"{BASE}/{project_id}/map-runs/{run_id}/detections"
    r = client.get(
        url, params={"frame": "site", "bbox": f"{min(x0, x1)},{min(y0, y1)},{max(x0, x1)},{max(y0, y1)}"}
    )
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert [i["id"] for i in items] == [ids[0]]
    want = [_site(px, py) for px, py in box_corners(100, 100, 40, 20)]
    assert _flat(items[0]["corners_site"]) == pytest.approx(_flat(want), abs=1e-6)
    assert (items[0]["x"], items[0]["w"]) == (100, 40)  # the pixel fields are unchanged (deviation 1)
    assert all(i.get("corners_site") is None for i in client.get(url).json()["items"])
    assert client.get(url, params={"frame": "wgs"}).status_code == 422


def test_next_unreviewed_in_site(client, project_id, handle):
    """R-B1-12: nextUnreviewedMapDetection with frame=site fills corners_site like the list."""
    _, run_id, ids = add_map_run(handle, crs_wkt=UTM38, geotransform=GT38, boxes=[(100, 100, 40, 20)])
    set_frame(client, project_id, 32639)
    url = f"{BASE}/{project_id}/map-runs/{run_id}/next-unreviewed"
    body = client.get(url, params={"frame": "site"}).json()
    assert body["detection"]["id"] == ids[0]
    want = [_site(px, py) for px, py in box_corners(100, 100, 40, 20)]
    assert _flat(body["detection"]["corners_site"]) == pytest.approx(_flat(want), abs=1e-6)
    assert client.get(url).json()["detection"].get("corners_site") is None
    done = client.get(url, params={"frame": "site", "after_id": ids[0]}).json()
    assert done["detection"] is None or done["detection"]["id"] != ids[0]


def test_density_cells_carry_site_centres(client, project_id, handle):
    _, run_id, _ = add_map_run(handle, crs_wkt=UTM38, geotransform=GT38, boxes=[(100, 100, 40, 20)])
    set_frame(client, project_id, 32639)
    body = client.get(
        f"{BASE}/{project_id}/map-runs/{run_id}/density", params={"frame": "site", "cells": 100}
    ).json()
    cell, size = body["cells"][0], body["cell_size"]
    assert cell["center_site"] == pytest.approx(
        _site((cell["gx"] + 0.5) * size, (cell["gy"] + 0.5) * size), abs=1e-6
    )


def test_site_areas_in_site(client, project_id):
    """No georeferenced map in this project: the explicit `local` frame below stays local instead of
    the workspace re-choosing the CRS of a georeferenced item on the next read (`_stale_local`)."""
    set_frame(client, project_id, 32639)
    ring = [[47.99, 29.5], [47.991, 29.5], [47.991, 29.499]]
    assert (
        client.post(
            f"{BASE}/{project_id}/site-areas", json={"name": "Yard", "polygon_wgs84": ring}
        ).status_code
        == 201
    )
    item = client.get(f"{BASE}/{project_id}/site-areas", params={"frame": "site"}).json()["items"][0]
    want = Transformer.from_crs("EPSG:4326", "EPSG:32639", always_xy=True).transform(47.99, 29.5)
    assert item["polygon_site"][0] == pytest.approx(list(want), abs=1e-6)
    client.put(f"{BASE}/{project_id}/map-workspace/frame", json={"kind": "local"})
    local = client.get(f"{BASE}/{project_id}/site-areas", params={"frame": "site"}).json()["items"][0]
    assert local.get("polygon_site") is None


def test_volume_measurement_polygon_site(client, project_id, handle):
    top = add_surface(handle, fixture_spec(0.5), plane)
    with handle.session() as s:
        row = VolumeMeasurement(
            name="Pile",
            polygon_native=[[500010.0, 3299990.0], [500020.0, 3299990.0], [500020.0, 3299980.0]],
            top_surface_id=top,
            base={"kind": "toe_plane"},
            masks={},
            alignment={},
            status="failed",
            error="x",
        )
        s.add(row)
        s.flush()
        mid = row.id
    set_frame(client, project_id, 32638)
    body = client.get(f"{BASE}/{project_id}/volumes/{mid}", params={"frame": "site"}).json()
    want = Transformer.from_crs("EPSG:32639", "EPSG:32638", always_xy=True).transform(500010.0, 3299990.0)
    assert body["polygon_site"][0] == pytest.approx(list(want), abs=1e-6)
    assert body["polygon_native"][0] == [500010.0, 3299990.0]
    assert client.get(f"{BASE}/{project_id}/volumes/{mid}").json().get("polygon_site") is None


def test_footprints_in_site(handle, client, project_id):
    add_surface(handle, fixture_spec(0.5), plane)
    set_frame(client, project_id, 32638)
    ring = [[500010.0, 3299990.0], [500011.0, 3299990.0], [500011.0, 3299989.0]]
    wkt = CRS.from_epsg(32639).to_wkt()
    got = views.footprints_in_site(
        handle, wkt, [VolumeFootprint(run_id="r", detection_id="d", class_id="c", ring=ring)]
    )
    want = Transformer.from_crs("EPSG:32639", "EPSG:32638", always_xy=True).transform(500010.0, 3299990.0)
    assert got[0].ring_site[0] == pytest.approx(list(want), abs=1e-6) and got[0].ring == ring
