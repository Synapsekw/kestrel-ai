"""Layers and surveys in the site frame (spec 2026-09-26-map-workspace sections 5.2, 6, 12)."""

from datetime import UTC, date, datetime

import pytest
from pyproj import CRS, Transformer
from surfaces import fixture_spec, plane
from volume_rows import add_map_run, add_surface
from workspace_rows import BASE, add_local_surface, add_map, set_frame

from app.db.models import Drawing, Job, MapRun, Surface

UTM38 = CRS.from_epsg(32638).to_wkt()
UTM39 = CRS.from_epsg(32639).to_wkt()
GT39 = [500000.0, 0.03, 0.0, 3300000.0, 0.0, -0.03]


def _layers(client, project_id):
    r = client.get(f"{BASE}/{project_id}/map-workspace/layers")
    assert r.status_code == 200, r.text
    body = r.json()
    return body["frame"], {i["id"]: i for i in body["items"]}


def test_maps_and_surfaces_with_footprint_zoom_and_meta(client, project_id, handle):
    m = add_map(
        handle,
        crs_wkt=UTM39,
        geotransform=GT39,
        width=4000,
        height=2000,
        gsd_cm=3.0,
        captured_on=date(2026, 9, 14),
    )
    sid = add_surface(handle, fixture_spec(0.1), plane)
    set_frame(client, project_id, 32639)
    frame, got = _layers(client, project_id)
    assert frame["epsg"] == 32639
    lm = got[m]
    assert (lm["kind"], lm["group"], lm["tile_kind"], lm["vector"], lm["status"]) == (
        "map",
        "base",
        "map",
        False,
        "ready",
    )
    assert lm["in_frame"] and lm["version"] == m and lm["placed"] is None and lm["drawing_format"] is None
    assert lm["footprint_site"] == pytest.approx([500000.0, 3299940.0, 500120.0, 3300000.0])
    assert lm["max_zoom"] == 17  # 0.03 m: res(17) = 0.0078 <= 0.015
    assert lm["date"] == "2026-09-14" and lm["date_is_import_date"] is False
    assert lm["meta"] == "3.0 cm GSD · 1.4 GB"
    ls = got[sid]
    assert (ls["kind"], ls["group"], ls["tile_kind"], ls["surface_kind"]) == (
        "surface",
        "elevation",
        "surface",
        "cloud_dsm",
    )
    assert ls["max_zoom"] == 15 and ls["meta"].endswith(" m")
    assert ls["date_is_import_date"] is True  # no captured_on and no cloud


def test_a_map_in_another_crs_has_its_footprint_converted(client, project_id, handle):
    o = Transformer.from_crs("EPSG:4326", "EPSG:32638", always_xy=True).transform(47.99, 29.5)
    gt = [o[0], 0.05, 0.0, o[1], 0.0, -0.05]
    m = add_map(handle, crs_wkt=UTM38, geotransform=gt, width=400, height=400, gsd_cm=5.0)
    set_frame(client, project_id, 32639)
    fp = _layers(client, project_id)[1][m]["footprint_site"]
    nw = Transformer.from_crs("EPSG:32638", "EPSG:32639", always_xy=True).transform(o[0], o[1])
    assert fp[0] <= nw[0] <= fp[2] and fp[1] <= nw[1] <= fp[3]
    # 400 px x 0.05 m = 20 m, rotated ~3 deg by grid convergence between the two UTM zones this close
    # to their shared boundary (lon 47.99, 0.01 deg from it): the rotated box's AABB is wider than 20 m.
    assert fp[2] - fp[0] == pytest.approx(21.0, abs=0.1)


def test_items_outside_the_frame_are_listed_greyed(client, project_id, handle):
    add_map(handle, crs_wkt=UTM39, geotransform=GT39, width=400, height=400, gsd_cm=3.0)
    bare = add_map(handle, crs_wkt=None, geotransform=None, width=400, height=400)
    local = add_local_surface(handle, fixture_spec(0.5, crs_wkt=None, epsg=None), plane)
    set_frame(client, project_id, 32639)
    got = _layers(client, project_id)[1]
    assert (got[bare]["in_frame"], got[bare]["footprint_site"], got[bare]["max_zoom"]) == (False, None, None)
    assert (got[local]["in_frame"], got[local]["footprint_site"]) == (False, None)


def test_not_ready_items_are_not_listed(client, project_id, handle):
    m = add_map(handle, crs_wkt=UTM39, geotransform=GT39, width=400, height=400, status="importing")
    assert m not in _layers(client, project_id)[1]


def test_drawings_placed_and_not_placed(client, project_id, handle):
    set_frame(client, project_id, 32639)
    with handle.session() as s:
        placed = Drawing(
            name="Site plan",
            format="pdf",
            status="ready",
            source_path="D:/p.pdf",
            source_size=1,
            width=1000,
            height=500,
            extent_src=[0, -500, 1000, 0],
            georef_version=3,
            georef={
                "method": "control_points",
                "crs_wkt": None,
                "epsg": None,
                "model": "similarity",
                "points": [{}, {}, {}, {}],
                "dst_crs_wkt": UTM39,
                "transform": [0.02, 0.0, 500000.0, 0.0, 0.02, 3300000.0],
                "rmse_m": 0.06,
                "residuals_m": [],
                "warnings": [],
            },
        )
        dxf = Drawing(
            name="Setting out",
            format="dxf",
            status="ready",
            source_path="D:/s.dxf",
            source_size=1,
            extent_src=[0, 0, 50, 20],
            georef_version=1,
            georef={
                "method": "crs",
                "crs_wkt": UTM39,
                "epsg": 32639,
                "model": None,
                "points": [],
                "dst_crs_wkt": UTM39,
                "transform": [1, 0, 500000.0, 0, 1, 3299900.0],
                "rmse_m": None,
                "residuals_m": [],
                "warnings": [],
            },
        )
        loose = Drawing(
            name="Scan",
            format="png",
            status="ready",
            source_path="D:/s.png",
            source_size=1,
            width=10,
            height=10,
            extent_src=[0, -10, 10, 0],
            georef_version=0,
            georef=None,
        )
        s.add_all([placed, dxf, loose])
        s.flush()
        pid, did, lid = placed.id, dxf.id, loose.id
    got = _layers(client, project_id)[1]
    p = got[pid]
    assert (p["kind"], p["group"], p["tile_kind"], p["vector"], p["version"]) == (
        "drawing",
        "drawing",
        "drawing_raster",
        False,
        "3",
    )
    assert p["footprint_site"] == pytest.approx([500000.0, 3299990.0, 500020.0, 3300000.0])
    assert p["meta"] == "4 control pts · RMSE 6 cm" and p["in_frame"] and p["placed"] is True
    assert p["drawing_format"] == "pdf" and p["max_zoom"] == 17  # 0.02 m per plan pixel
    d = got[did]
    assert (d["tile_kind"], d["vector"], d["max_zoom"], d["meta"]) == (
        None,
        True,
        20,
        "placed by coordinates",
    )
    lo = got[lid]
    assert (lo["in_frame"], lo["placed"], lo["meta"], lo["footprint_site"]) == (
        False,
        False,
        "not placed",
        None,
    )


def test_surveys_group_by_date_with_planned_ticks(client, project_id, handle):
    a = add_map(
        handle, crs_wkt=UTM39, geotransform=GT39, width=400, height=400, captured_on=date(2026, 8, 14)
    )
    b = add_map(
        handle,
        crs_wkt=UTM39,
        geotransform=GT39,
        width=400,
        height=400,
        captured_on=date(2026, 9, 14),
        gsd_cm=2.0,
        name="September ortho",
    )
    sid = add_surface(handle, fixture_spec(0.5), plane)
    with handle.session() as s:
        s.get(Surface, sid).captured_on = date(2026, 9, 14)
    undated = add_map(handle, crs_wkt=UTM39, geotransform=GT39, width=400, height=400)
    set_frame(client, project_id, 32639)
    client.put(
        f"{BASE}/{project_id}/map-workspace",
        json={
            "state": {},
            "planned_surveys": [{"date": "2026-10-14", "note": "Oct"}, {"date": "2026-09-14", "note": "dup"}],
        },
    )
    r = client.get(f"{BASE}/{project_id}/map-workspace/surveys")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    by = {(i["date"], i["date_is_import_date"]): i for i in items}
    assert [m["id"] for m in by[("2026-08-14", False)]["maps"]] == [a]
    sep = by[("2026-09-14", False)]
    assert sep["maps"] == [{"id": b, "name": "September ortho", "gsd_cm": 2.0, "basis_run_id": None}]
    assert [srf["id"] for srf in sep["surfaces"]] == [sid] and sep["surfaces"][0]["kind"] == "cloud_dsm"
    assert sep["planned"] is False and sep["note"] is None
    oct_ = by[("2026-10-14", False)]
    assert (oct_["planned"], oct_["note"], oct_["maps"], oct_["surfaces"]) == (True, "Oct", [], [])
    imported = [i for i in items if i["date_is_import_date"]]
    assert imported and any(undated in [m["id"] for m in i["maps"]] for i in imported)
    assert [i["date"] for i in items] == sorted(i["date"] for i in items)
    assert sum(1 for i in items if i["date"] == "2026-09-14" and not i["date_is_import_date"]) == 1


def test_survey_basis_run_is_pinned_else_newest_finished_never_a_region_run(client, project_id, handle):
    map_id, run_id, _ = add_map_run(handle, crs_wkt=UTM39, geotransform=GT39, boxes=[])
    with handle.session() as s:
        job = Job(type="map_detect", state="succeeded", finished_at=datetime.now(UTC))
        s.add(job)
        s.flush()
        region = MapRun(
            map_id=map_id, kind="local_model", model_name="m", conf=0.25, job_id=job.id, scope="region"
        )
        s.add(region)
    set_frame(client, project_id, 32639)
    maps = [
        m for i in client.get(f"{BASE}/{project_id}/map-workspace/surveys").json()["items"] for m in i["maps"]
    ]
    assert [m["basis_run_id"] for m in maps if m["id"] == map_id] == [run_id]


def test_design_surfaces_are_undated(client, project_id, handle):
    sid = add_surface(handle, fixture_spec(0.5), plane, kind="design", method="tin")
    set_frame(client, project_id, 32639)
    layer = _layers(client, project_id)[1][sid]
    assert (
        layer["date"] is None and layer["date_is_import_date"] is False and layer["surface_kind"] == "design"
    )
    surveys = client.get(f"{BASE}/{project_id}/map-workspace/surveys").json()["items"]
    assert all(sid not in [srf["id"] for srf in i["surfaces"]] for i in surveys)
