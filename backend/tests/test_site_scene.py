"""The Site 3D scene manifest (spec 2026-10-03-plant-model-generator §10-§11, plan S1 T2)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pyproj import CRS
from workspace_rows import BASE, add_map, set_frame

from app.asset_models import site_scene
from app.db.models import AssetModel, AssetModelVersion, Drawing, Finding, Image, PointCloud, Source

UTM38 = CRS.from_epsg(32638).to_wkt()
UTM39 = CRS.from_epsg(32639).to_wkt()
GT39 = [500000.0, 0.03, 0.0, 3300000.0, 0.0, -0.03]
SITE = {
    "crs": {"epsg": 32639, "wkt": None},
    "origin_crs": [244338.089, 3179515.69],
    "plant_north_deg": 17.9991,
    "datum": {"label": "HPFS", "el_m": 100.0},
    "cloud_z_to_el": None,
    "source": {"kind": "drawing"},
}


def _scene(client, project_id, **query):
    r = client.get(f"{BASE}/{project_id}/site-scene", params=query)
    assert r.status_code == 200, r.text
    return r.json()


def add_model(handle, *, kind="plant", site=SITE, glb="ready", created=None, versions=1) -> str:
    with handle.session() as s:
        m = AssetModel(name="Al-Zour", status="ready", current_version=versions, kind=kind)
        if created is not None:
            m.created_at = created
        s.add(m)
        s.flush()
        for v in range(1, versions + 1):
            spec = {"parts": [], "items": [], "environment": []}
            if site is not None:
                spec["site"] = site
            s.add(AssetModelVersion(model_id=m.id, version=v, spec=spec, kind="agent", glb_status=glb))
        return m.id


def add_cloud(handle, *, name="Scan", crs_wkt=UTM39, epsg=32639, bounds=None, status="ready") -> str:
    with handle.session() as s:
        row = PointCloud(
            name=name,
            status=status,
            source_path="D:/scan.laz",
            source_size=1,
            crs_wkt=crs_wkt,
            epsg=epsg,
            bounds_native=bounds or [500000.0, 3299900.0, -5.0, 500200.0, 3300000.0, 30.0],
        )
        s.add(row)
        s.flush()
        return row.id


def add_raster_drawing(handle, *, name="Plot plan", placed=True) -> str:
    with handle.session() as s:
        row = Drawing(
            name=name,
            format="pdf",
            status="ready",
            source_path="D:/p.pdf",
            source_size=1,
            width=1000,
            height=500,
            extent_src=[0, -500, 1000, 0],
            georef_version=3 if placed else 0,
            georef=(
                {
                    "method": "control_points",
                    "crs_wkt": None,
                    "epsg": None,
                    "model": "similarity",
                    "points": [{}, {}, {}],
                    "dst_crs_wkt": UTM39,
                    "transform": [0.02, 0.0, 500000.0, 0.0, 0.02, 3300000.0],
                    "rmse_m": 0.05,
                    "residuals_m": [],
                    "warnings": [],
                }
                if placed
                else None
            ),
        )
        s.add(row)
        s.flush()
        return row.id


def test_empty_project_has_no_frame_and_no_model(client, project_id):
    got = _scene(client, project_id)
    assert got["frame"] is None and got["model"] is None
    assert got["orthos"] == [] and got["clouds"] == [] and got["drawings"] == []
    assert got["photos"] == {"count": 0, "url": ""}
    assert got["findings"] == {"count": 0, "url": f"/api/v1/projects/{project_id}/map-workspace/findings"}


def test_a_map_gives_a_workspace_frame_and_an_ortho(client, project_id, handle):
    m = add_map(handle, crs_wkt=UTM39, geotransform=GT39, width=4000, height=2000, gsd_cm=3.0)
    set_frame(client, project_id, 32639)
    got = _scene(client, project_id)
    f = got["frame"]
    assert f["crs"]["epsg"] == 32639 and f["crs"]["wkt"]
    assert f["plant_north_deg"] == 0.0 and f["datum"] == {"label": "EL", "el_m": 0.0}
    # footprint 500000..500120 x 3299940..3300000: centre (500060, 3299970), rounded to 100 m
    assert f["origin_crs"] == [500100.0, 3300000.0]
    assert got["model"] is None
    (o,) = got["orthos"]
    assert o["id"] == m and o["name"] == "ortho"
    assert o["tile_url_template"] == (
        f"/api/v1/projects/{project_id}/site-tiles/map/{m}/{{z}}/{{x}}/{{y}}?v={m}&frame_key=epsg%3A32639"
    )
    assert o["bounds_site"] == pytest.approx([500000.0, 3299940.0, 500120.0, 3300000.0])
    assert o["max_z"] == 17 and o["min_z"] == 11  # 262144 / 120 m = 2184.5 -> log2 = 11.09
    assert "token" not in o["tile_url_template"]


def test_plant_model_frame_comes_from_its_site(client, project_id, handle):
    add_model(handle, kind="asset", site=None)  # an M1 model is never the default
    mid = add_model(handle)
    got = _scene(client, project_id)
    assert got["model"] == {
        "id": mid,
        "version": 1,
        "glb_url": f"/api/v1/projects/{project_id}/asset-models/{mid}/versions/1/glb",
        "csv_url": f"/api/v1/projects/{project_id}/asset-models/{mid}/versions/1/csv",
        "kind": "plant",
    }
    f = got["frame"]
    assert f["crs"] == {"epsg": 32639, "wkt": None}
    assert f["origin_crs"] == [244338.089, 3179515.69]
    assert f["plant_north_deg"] == 17.9991 and f["datum"] == {"label": "HPFS", "el_m": 100.0}


def test_the_newest_plant_with_a_ready_glb_is_the_default(client, project_id, handle):
    old = add_model(handle, created=datetime(2026, 10, 1, tzinfo=UTC))
    add_model(handle, glb="pending", created=datetime(2026, 10, 2, tzinfo=UTC))
    assert _scene(client, project_id)["model"]["id"] == old


def test_model_id_picks_that_model_and_unknown_is_404(client, project_id, handle):
    asset = add_model(handle, kind="asset", site=None)
    got = _scene(client, project_id, modelId=asset)
    assert got["model"]["id"] == asset and got["model"]["kind"] == "asset"
    assert got["frame"] is not None and got["frame"]["origin_crs"] == [
        0.0,
        0.0,
    ]  # R3: no site, nothing placed
    r = client.get(f"{BASE}/{project_id}/site-scene", params={"modelId": "nope"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_current_version_wins_else_newest_ready(client, project_id, handle):
    mid = add_model(handle, versions=3)
    with handle.session() as s:
        m = s.get(AssetModel, mid)
        m.current_version = 2
    assert _scene(client, project_id, modelId=mid)["model"]["version"] == 2
    with handle.session() as s:
        row = s.query(AssetModelVersion).filter_by(model_id=mid, version=2).one()
        row.glb_status = "failed"
    assert _scene(client, project_id, modelId=mid)["model"]["version"] == 3


def test_a_model_without_a_ready_glb_is_not_shown(client, project_id, handle):
    mid = add_model(handle, glb="pending")
    got = _scene(client, project_id, modelId=mid)
    assert got["model"] is None


def test_clouds_same_crs_and_z_offset(client, project_id, handle):
    same = add_cloud(handle, name="Same")
    other = add_cloud(handle, name="Other", crs_wkt=UTM38, epsg=32638)
    local = add_cloud(handle, name="Local", crs_wkt=None, epsg=None)
    add_cloud(handle, name="Importing", status="importing")
    add_model(handle, site={**SITE, "cloud_z_to_el": {"cloud_id": same, "offset_m": 120.45, "tilt": None}})
    got = {c["id"]: c for c in _scene(client, project_id)["clouds"]}
    assert set(got) == {same, other, local}
    assert got[same]["same_crs"] is True and got[same]["z_offset_m"] == 120.45
    assert got[same]["crs_epsg"] == 32639
    assert got[same]["octree_url"] == f"/api/v1/projects/{project_id}/pointclouds/{same}/octree/metadata.json"
    assert got[other]["same_crs"] is False and got[other]["z_offset_m"] == 0.0
    assert got[local]["same_crs"] is False and got[local]["crs_epsg"] is None


def test_tiles_in_another_crs_are_left_out(client, project_id, handle):
    add_map(handle, crs_wkt=UTM39, geotransform=GT39, width=400, height=400)
    add_raster_drawing(handle)
    set_frame(client, project_id, 32639)
    add_model(handle, site={**SITE, "crs": {"epsg": 32638, "wkt": None}})
    got = _scene(client, project_id)
    assert got["frame"]["crs"]["epsg"] == 32638
    assert got["orthos"] == [] and got["drawings"] == []  # Review Focus 2: never misplaced


def test_placed_raster_drawings_only(client, project_id, handle):
    set_frame(client, project_id, 32639)
    placed = add_raster_drawing(handle)
    add_raster_drawing(handle, name="Loose", placed=False)
    with handle.session() as s:
        s.add(
            Drawing(
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
        )
    got = _scene(client, project_id)
    (d,) = got["drawings"]
    assert d["id"] == placed and d["name"] == "Plot plan"
    assert d["tile_url_template"] == (
        f"/api/v1/projects/{project_id}/site-tiles/drawing_raster/{placed}/{{z}}/{{x}}/{{y}}"
        "?v=3&frame_key=epsg%3A32639"
    )
    assert d["bounds_site"] == pytest.approx([500000.0, 3299990.0, 500020.0, 3300000.0])
    assert got["frame"]["origin_crs"] == [500000.0, 3300000.0]  # centre (500010, 3299995) rounded


def test_photo_and_finding_counts(client, project_id, handle):
    m = add_map(handle, crs_wkt=UTM39, geotransform=GT39, width=400, height=400)
    set_frame(client, project_id, 32639)
    cid = add_cloud(handle)
    with handle.session() as s:
        src = Source(folder="D:/photos", site="north")
        s.add(src)
        s.flush()
        s.add_all(
            [
                Image(path="a.jpg", width=10, height=10, source_id=src.id, lat=29.1, lon=48.1),
                Image(path="b.jpg", width=10, height=10, source_id=src.id, lat=29.2, lon=48.2),
                Image(path="c.jpg", width=10, height=10, source_id=src.id),
                Finding(
                    number=1,
                    type_id="t1",
                    anchor_kind="map",
                    map_id=m,
                    geometry={"type": "Point", "coordinates": [500010.0, 3299990.0]},
                    data_type="map",
                    data_id=m,
                ),
                Finding(
                    number=2,
                    type_id="t1",
                    anchor_kind="cloud",
                    cloud_id=cid,
                    x=1.0,
                    y=2.0,
                    z=3.0,
                    data_type="point_cloud",
                    data_id=cid,
                ),
            ]
        )
    got = _scene(client, project_id)
    assert got["photos"] == {"count": 2, "url": f"/api/v1/projects/{project_id}/pointclouds/{cid}/cameras"}
    assert got["findings"]["count"] == 2


def test_lists_are_capped(client, project_id, handle, monkeypatch):
    monkeypatch.setattr(site_scene, "MAX_LIST", 2)
    for i in range(3):
        add_cloud(handle, name=f"c{i}")
    assert len(_scene(client, project_id)["clouds"]) == 2


@pytest.mark.parametrize(
    ("bounds", "max_z", "want"),
    [
        ((0, 0, 120, 60), 17, 11),
        ((0, 0, 3000, 1000), 18, 6),
        ((0, 0, 1e7, 1), 20, 0),
        ((0, 0, 0.01, 0.01), 12, 12),
    ],
)
def test_min_zoom_for(bounds, max_z, want):
    assert site_scene.min_zoom_for(bounds, max_z) == want


def test_frame_from_site_tolerates_a_malformed_site():
    assert site_scene.frame_from_site(None) is None
    assert site_scene.frame_from_site({"crs": {}}) is None
    f = site_scene.frame_from_site(SITE)
    assert f is not None and f.origin_crs == (244338.089, 3179515.69)
