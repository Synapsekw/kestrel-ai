# backend/tests/test_plant_cloudcheck.py
"""The plant cloud check (spec 2026-10-03 §8.2.4, §13 C1; index Review Focus 2)."""

import tracemalloc

import numpy as np
import plant_cloud as pc
import pytest
from pointclouds import insert_cloud, make_las

from app.asset_models import cloudcheck as cc
from app.asset_models.look import LookError
from app.asset_models.siteframe import footprint_polygon
from app.asset_models.spec import SiteFrame
from app.jobs.cancellation import JobCancelled


@pytest.fixture
def make_cloud(handle):
    """A ready point_cloud row for a LAS on disk; `epsg=None` stores no CRS."""

    def _make(path, epsg=32639):
        from pyproj import CRS

        st = path.stat()
        return insert_cloud(
            handle,
            source_path=str(path),
            source_size=st.st_size,
            source_mtime=st.st_mtime,
            epsg=epsg,
            crs_wkt=CRS.from_epsg(epsg).to_wkt() if epsg else None,
        )

    return _make


@pytest.fixture(scope="module")
def scene():
    return pc.standard_scene()


def _site_box(g, pts, pad=1.0):
    site = pc.to_site(g, pts)
    return (
        float(site[:, 0].min() - pad),
        float(site[:, 1].min() - pad),
        float(site[:, 0].max() + pad),
        float(site[:, 1].max() + pad),
    )


# ---------------------------------------------------------------- F0 alignment


def test_f0_grid_matches_the_kipic_register():
    g = pc.grid()
    assert g.frame.crs.epsg == 32639
    x, y = g.plant_to_site(np.array([1301.1]), np.array([555.4]))  # 20-T-0001 in Cowork's register
    assert (float(x[0]), float(y[0])) == pytest.approx((245747.13, 3179641.87), abs=0.05)
    e, n = g.site_to_plant(x, y)
    assert (float(e[0]), float(n[0])) == pytest.approx((1301.1, 555.4), abs=1e-6)


def test_f0_footprints_match_the_scene_assumptions():
    _, items = pc.standard_scene()
    by = {it.id: it for it in items}
    ring = footprint_polygon(by["pkg-offset"].footprint)  # rect: along = plant north at rot 0
    assert ring.min(axis=0) == pytest.approx([1356, 574], abs=1e-6)
    assert ring.max(axis=0) == pytest.approx([1364, 586], abs=1e-6)
    ring = footprint_polygon(by["tank-a"].footprint)
    assert ring.min(axis=0) == pytest.approx([1310, 530], abs=0.1)
    assert ring.max(axis=0) == pytest.approx([1330, 550], abs=0.1)


# ---------------------------------------------------------------- sample


def test_chunk_and_cap_are_the_index_bounds():
    assert cc.CHUNK <= 2_000_000
    assert cc.MAX_POINTS == 20_000_000
    assert cc.ITEM_CAP == 200_000


def test_sample_is_bounded_float32_single_pass(scene, tmp_path, handle, make_cloud, monkeypatch):
    import laspy

    pts, _ = scene
    g = pc.grid()
    las = make_las(tmp_path / "p.las", 0, points=pc.to_site(g, pts))
    cid = make_cloud(las)
    opened = []
    real_open = laspy.open
    monkeypatch.setattr(laspy, "open", lambda *a, **k: opened.append(1) or real_open(*a, **k))
    calls = []
    s = cc.sample_plant_cloud(
        handle, cid, _site_box(g, pts), max_points=30_000, progress=lambda d, t: calls.append((d, t))
    )
    assert len(opened) == 1
    assert s.xyz.dtype == np.float32 and s.xyz.shape[1] == 3
    assert 25_000 <= len(s.xyz) <= 30_000  # every 3rd of 77 k points
    assert s.total == len(pts) and s.crs_epsg == 32639 and s.cloud_id == cid
    assert calls[-1] == (len(pts), len(pts))
    xy = s.site_xy()
    assert np.allclose(np.sort(xy[:, 0])[[0, -1]], np.sort(pc.to_site(g, pts)[:, 0])[[0, -1]], atol=2.0)


def test_sample_keeps_only_the_box(scene, tmp_path, handle, make_cloud):
    pts, items = scene
    g = pc.grid()
    cid = make_cloud(make_las(tmp_path / "p.las", 0, points=pc.to_site(g, pts)))
    box = cc.plant_bbox_site(g, items[:1], margin_m=0.0)  # tank-a only
    s = cc.sample_plant_cloud(handle, cid, box)
    xy = s.site_xy()
    assert len(xy) and (xy[:, 0] >= box[0]).all() and (xy[:, 0] <= box[2]).all()
    assert (xy[:, 1] >= box[1]).all() and (xy[:, 1] <= box[3]).all()
    assert len(xy) < len(pts) / 3


def test_sample_honours_cancel(scene, tmp_path, handle, make_cloud):
    pts, _ = scene
    g = pc.grid()
    cid = make_cloud(make_las(tmp_path / "p.las", 0, points=pc.to_site(g, pts)))
    with pytest.raises(JobCancelled):
        cc.sample_plant_cloud(handle, cid, _site_box(g, pts), cancel=lambda: True)


def test_sample_memory_is_bounded_by_the_chunk_not_the_file(tmp_path, handle, make_cloud, monkeypatch):
    rng = np.random.default_rng(0)
    n = 1_200_000  # a 41 MB LAS: reading it whole would trace far over the bound below
    big = np.column_stack(
        [rng.uniform(244000, 245000, n), rng.uniform(3179000, 3180000, n), rng.uniform(-20, 10, n)]
    )
    cid = make_cloud(make_las(tmp_path / "big.las", 0, points=big, rgb=False))
    del big
    monkeypatch.setattr(cc, "CHUNK", 100_000)
    tracemalloc.start()
    try:
        s = cc.sample_plant_cloud(handle, cid, (244000, 3179000, 245000, 3180000), max_points=60_000)
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    assert len(s.xyz) == 60_000
    assert peak < 25_000_000


def test_sample_round_trips_through_npz(scene, tmp_path):
    pts, _ = scene
    for epsg in (32639, None):
        s = pc.to_sample(pc.grid(), pts, epsg=epsg)
        s.save(tmp_path / "s.npz")
        t = cc.PlantSample.load(tmp_path / "s.npz")
        assert np.array_equal(s.xyz, t.xyz) and t.xyz.dtype == np.float32
        assert (t.bbox, t.origin) == (s.bbox, s.origin)
        assert (t.cloud_id, t.crs_epsg, t.crs_wkt, t.total) == (s.cloud_id, s.crs_epsg, s.crs_wkt, s.total)


def test_sample_of_an_unknown_cloud_is_a_look_error(handle):
    with pytest.raises(LookError):
        cc.sample_plant_cloud(handle, "no-such-cloud", (0, 0, 1, 1))


def test_plant_bbox_covers_every_footprint(scene):
    _, items = scene
    g = pc.grid()
    x0, y0, x1, y1 = cc.plant_bbox_site(g, items, margin_m=10.0)
    for it in items:
        ring = footprint_polygon(it.footprint)
        x, y = g.plant_to_site(ring[:, 0], ring[:, 1])
        assert x.min() >= x0 + 10 - 1e-6 and x.max() <= x1 - 10 + 1e-6
        assert y.min() >= y0 + 10 - 1e-6 and y.max() <= y1 - 10 + 1e-6
    assert cc.plant_bbox_site(g, []) is None


# ---------------------------------------------------------------- CRS


def test_same_crs_never_guesses():
    site = SiteFrame.model_validate(
        {"crs": {"epsg": 32639}, "origin_crs": [0, 0], "plant_north_deg": 0, "source": {"kind": "assumed"}}
    ).crs
    assert cc.same_crs(32639, None, site)
    assert not cc.same_crs(32640, None, site)
    assert not cc.same_crs(None, None, site)
    from pyproj import CRS

    assert cc.same_crs(None, CRS.from_epsg(32639).to_wkt(), site)


def test_cloud_in_frame_reads_the_cloud_row(tmp_path, handle, make_cloud):
    las = make_las(tmp_path / "a.las", 100)
    frame = pc.grid().frame
    assert cc.cloud_in_frame(handle, make_cloud(las, epsg=32639), frame)
    assert not cc.cloud_in_frame(handle, make_cloud(las, epsg=32640), frame)
    assert not cc.cloud_in_frame(handle, make_cloud(las, epsg=None), frame)
