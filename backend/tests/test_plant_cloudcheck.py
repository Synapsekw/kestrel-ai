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
    monkeypatch.setattr(cc, "CHUNK", 99_991)  # not a multiple of the stride: the carry is exercised
    tracemalloc.start()
    try:
        s = cc.sample_plant_cloud(handle, cid, (244000, 3179000, 245000, 3180000), max_points=60_000)
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    assert len(s.xyz) == 60_000
    assert peak < 25_000_000


def test_sample_build_peak_is_not_twice_the_kept_array(tmp_path, handle, make_cloud, monkeypatch):
    rng = np.random.default_rng(2)
    n = 1_200_000
    big = np.column_stack(
        [rng.uniform(244000, 245000, n), rng.uniform(3179000, 3180000, n), rng.uniform(-20, 10, n)]
    )
    cid = make_cloud(make_las(tmp_path / "big.las", 0, points=big, rgb=False))
    del big
    monkeypatch.setattr(cc, "CHUNK", 50_000)
    tracemalloc.start()
    try:
        s = cc.sample_plant_cloud(handle, cid, (244000, 3179000, 245000, 3180000), max_points=n)
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    kept = s.xyz.nbytes
    assert len(s.xyz) == n and kept == n * 12
    assert peak < kept * 1.5  # one buffer filled in place, not a list of parts plus their concatenation


def test_a_damaged_cloud_file_is_a_look_error_without_the_path(tmp_path, handle, make_cloud):
    bad = tmp_path / "damaged.las"
    good = make_las(tmp_path / "good.las", 5_000).read_bytes()
    for body in (b"not a point cloud at all" * 50, good[: len(good) // 2]):
        bad.write_bytes(body)
        cid = make_cloud(bad)
        with pytest.raises(LookError) as err:
            cc.sample_plant_cloud(handle, cid, (0, 0, 1e7, 1e7))
        assert str(tmp_path) not in str(err.value) and "damaged.las" not in str(err.value)
        assert err.value.__cause__ is None


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


# ---------------------------------------------------------------- datum


def test_fit_datum_from_drawing_elevations(scene):
    pts, items = scene
    g = pc.grid()
    datum = cc.fit_datum(pc.to_sample(g, pts), g, items)
    assert datum.cloud_id == "c1" and datum.tilt is None
    assert datum.offset_m == pytest.approx(pc.EL_OFFSET, abs=0.05)


def test_fit_datum_fits_a_tilt_over_a_wide_site():
    g = pc.grid()
    items = [
        pc.item(f"d{k}", "package", pc.rect(e, n, 10, 10), base=pc.GROUND_EL, source="drawing")
        for k, (e, n) in enumerate(
            [(1000, 300), (1150, 300), (1300, 300), (1000, 550), (1150, 550), (1300, 550)]
        )
    ]
    pts = pc.ground(950, 250, 1350, 600, step=2.0)
    x, _ = g.plant_to_site(pts[:, 0], pts[:, 1])
    pts[:, 2] = -20.0 - 0.002 * (x - g.frame.origin_crs[0])  # the cloud sinks 2 mm per metre east
    d = cc.fit_datum(pc.to_sample(g, pts), g, items)
    assert d.tilt is not None
    assert d.tilt[0] == pytest.approx(0.002, abs=2e-4) and abs(d.tilt[1]) < 2e-4
    xs = np.array([x.min(), x.max()])
    el = -20.0 - 0.002 * (xs - g.frame.origin_crs[0]) + [cc._el_offset(d, g.frame, v, 0.0) for v in xs]
    assert np.allclose(el, pc.GROUND_EL, atol=0.05)


def test_fit_datum_fits_no_tilt_along_a_narrow_row():
    g = pc.grid()
    places = [(1000 + 60 * k, 300 + (3 if k % 2 else -3)) for k in range(6)]  # 300 m long, 6 m wide
    items = [
        pc.item(f"d{k}", "package", pc.rect(e, n, 10, 10), base=pc.GROUND_EL, source="drawing")
        for k, (e, n) in enumerate(places)
    ]
    pts = pc.ground(950, 270, 1350, 330, step=2.0)
    x, _ = g.plant_to_site(pts[:, 0], pts[:, 1])
    pts[:, 2] = -20.0 - 0.002 * (x - g.frame.origin_crs[0])
    d = cc.fit_datum(pc.to_sample(g, pts), g, items)
    assert d.tilt is None  # the cross-row tilt would be a guess
    ex, _ = g.plant_to_site(np.array([p[0] for p in places], float), np.array([p[1] for p in places], float))
    expected = np.median(pc.GROUND_EL - (-20.0 - 0.002 * (ex - g.frame.origin_crs[0])))
    assert d.offset_m == pytest.approx(expected, abs=0.1)


def test_fit_datum_falls_back_to_base_elevations(scene):
    pts, items = scene
    g = pc.grid()
    two_drawn = [
        it.model_copy(update={"height_source": "indicative"}) if it.id == "tank-c" else it for it in items
    ]
    with_bases = [
        it.model_copy(update={"base_el": pc.GROUND_EL}) if it.base_el is None else it for it in two_drawn
    ]
    sample = pc.to_sample(g, pts)
    assert cc.fit_datum(sample, g, with_bases).offset_m == pytest.approx(pc.EL_OFFSET, abs=0.05)
    assert cc.fit_datum(sample, g, items[:2]) is None  # one drawn base, one without: under 3 usable


@pytest.fixture(scope="module")
def checked(scene):
    pts, items = scene
    g = pc.grid()
    sample = pc.to_sample(g, pts)
    datum = cc.fit_datum(sample, g, items)
    return items, datum, cc.check_items(sample, g, items, datum)


def test_check_skips_cloud_in_other_crs(scene):
    pts, items = scene
    g = pc.grid()
    for epsg, wording in ((32640, "different coordinate system"), (None, "no coordinate system")):
        sample = pc.to_sample(g, pts, epsg=epsg)
        assert cc.fit_datum(sample, g, items) is None
        result = cc.check_items(sample, g, items, None)
        assert result.items == {} and result.candidates == [] and result.datum is None
        assert wording in result.note


# ---------------------------------------------------------------- per item


def test_known_tanks_get_cloud_heights(checked):
    _, _, r = checked
    a, b = r.items["tank-a"], r.items["tank-b"]
    assert a.ground_el == pytest.approx(pc.GROUND_EL, abs=0.05) and a.top_el == pytest.approx(134.5, abs=0.05)
    assert b.top_el == pytest.approx(129.5, abs=0.05)
    assert a.flags == [] and b.flags == []
    assert a.coverage > 0.9 and a.offset_m == 0.0


def test_drawing_height_that_disagrees_is_flagged(checked):
    _, _, r = checked
    (flag,) = r.items["tank-c"].flags
    assert flag.code == "height_mismatch" and flag.value == pytest.approx(-2.5, abs=0.05)


def test_scanned_but_empty_footprint_is_missing_in_cloud(checked):
    _, _, r = checked
    pad = r.items["pad-missing"]
    assert [f.code for f in pad.flags] == ["missing_in_cloud"]
    assert pad.top_el is None and pad.coverage >= 0.5


def test_offset_item_is_flagged_with_the_shift(checked):
    _, _, r = checked
    chk = r.items["pkg-offset"]
    (flag,) = chk.flags
    assert flag.code == "plan_offset" and flag.value == pytest.approx(3.0, abs=0.5)
    assert "+3.0 m east" in flag.note
    assert chk.top_el == pytest.approx(108.5, abs=0.05)


def test_small_items_on_a_sparse_sample_are_not_missing(scene):
    pts, items = scene
    g = pc.grid()
    places = [(1300, 505), (1340, 505), (1375, 505), (1340, 600), (1375, 600)]
    small = [
        pc.item(f"s{k}", "package", pc.rect(e + 0.75, n + 0.75, 1.5, 1.5)) for k, (e, n) in enumerate(places)
    ]
    bodies = [pc.box(e, n, e + 1.5, n + 1.5, 3) for e, n in places]
    full = np.vstack([pts, *bodies])
    keep = np.random.default_rng(5).random(len(full)) < 1 / 8  # ~0.5 points per square metre of ground
    r = cc.check_items(pc.to_sample(g, full[keep]), g, [*items, *small], None)
    for it in small:
        assert "missing_in_cloud" not in [f.code for f in r.items[it.id].flags], it.id
    assert [f.code for f in r.items["pad-missing"].flags] == ["missing_in_cloud"]


def test_check_without_a_datum_flags_but_gives_no_heights(scene):
    pts, items = scene
    g = pc.grid()
    r = cc.check_items(pc.to_sample(g, pts), g, items, None)
    assert "No cloud datum" in r.note
    assert all(c.top_el is None and c.ground_el is None for c in r.items.values())
    assert [f.code for f in r.items["pad-missing"].flags] == ["missing_in_cloud"]
    assert [f.code for f in r.items["pkg-offset"].flags] == ["plan_offset"]


def test_check_survives_a_degenerate_footprint(scene):
    pts, items = scene
    g = pc.grid()
    bad = pc.item("bad", "trestle", {"kind": "line", "pts": [[1330, 600], [1330, 600]], "width": 4})
    r = cc.check_items(pc.to_sample(g, pts), g, [*items, bad], None)
    assert "bad" not in r.items and len(r.items) == len(items)


def test_flat_types_get_coverage_only(scene):
    pts, _ = scene
    g = pc.grid()
    road = pc.item("rd", "road", {"kind": "line", "pts": [[1300, 600], [1330, 600]], "width": 6})
    r = cc.check_items(pc.to_sample(g, pts), g, [road], None)
    assert r.items["rd"].flags == [] and r.items["rd"].coverage > 0.5


def test_per_item_points_are_capped(scene, monkeypatch):
    pts, items = scene
    g = pc.grid()
    monkeypatch.setattr(cc, "ITEM_CAP", 1_000)
    seen = []
    real = cc._local

    def spy(*a, **k):
        loc = real(*a, **k)
        seen.append(len(loc.z))
        return loc

    monkeypatch.setattr(cc, "_local", spy)
    sample = pc.to_sample(g, pts)
    r = cc.check_items(sample, g, items, cc.fit_datum(sample, g, items))
    assert seen and max(seen) <= 1_000
    assert r.items["tank-b"].top_el == pytest.approx(129.5, abs=0.1)


# ---------------------------------------------------------------- candidates


def test_unregistered_cluster_is_the_one_candidate(checked):
    _, _, r = checked
    (cand,) = r.candidates  # the 2 x 2 m box and the offset item's sliver are not candidates
    assert cand.id == "cand-001"
    e = np.mean([p[0] for p in cand.pts])
    n = np.mean([p[1] for p in cand.pts])
    assert abs(e - 1400) < 1.5 and abs(n - 520) < 1.5
    assert all(4.5 <= s <= 9.0 for s in cand.size_m)
    assert cand.top_el == pytest.approx(109.5, abs=0.1)


def test_a_flat_type_footprint_does_not_hide_a_candidate(scene):
    pts, items = scene
    g = pc.grid()
    paved = pc.item("pv", "paved", pc.rect(1400, 520, 12, 12))  # over the unregistered 6 x 6 m cluster
    r = cc.check_items(pc.to_sample(g, pts), g, [*items, paved], None)
    (cand,) = r.candidates
    assert abs(np.mean([p[0] for p in cand.pts]) - 1400) < 1.5
    assert abs(np.mean([p[1] for p in cand.pts]) - 520) < 1.5


def test_candidates_survive_a_sparse_sample(scene, tmp_path, handle, make_cloud):
    pts, items = scene
    g = pc.grid()
    cid = make_cloud(make_las(tmp_path / "p.las", 0, points=pc.to_site(g, pts)))
    s = cc.sample_plant_cloud(handle, cid, _site_box(g, pts), max_points=30_000)
    r = cc.check_items(s, g, items, cc.fit_datum(s, g, items))
    assert len(r.candidates) == 1
    assert [f.code for f in r.items["tank-c"].flags] == ["height_mismatch"]


# ---------------------------------------------------------------- apply and summarise


def test_apply_check_leaves_a_skipped_cloud_alone(scene):
    pts, items = scene
    g = pc.grid()
    result = cc.check_items(pc.to_sample(g, pts, epsg=32640), g, items, None)
    assert cc.apply_check(items, result) == items  # never projected, never touched


def test_apply_check_fills_indicative_heights_and_never_moves(checked):
    items, _, r = checked
    out = cc.apply_check(items, r)
    by = {it.id: it for it in out}
    assert [it.id for it in out] == [it.id for it in items]
    for before in items:
        after = by[before.id]
        assert after.footprint == before.footprint
    assert by["tank-b"].height_source == "cloud"
    assert by["tank-b"].base_el == pytest.approx(pc.GROUND_EL, abs=0.05)
    assert by["tank-b"].top_el == pytest.approx(129.5, abs=0.05)
    assert by["tank-c"].height_source == "drawing" and by["tank-c"].top_el == 134.5
    assert [f.code for f in by["tank-c"].flags] == ["height_mismatch"]
    assert by["pad-missing"].height_source == "indicative" and by["pad-missing"].top_el is None


def test_apply_check_replaces_stale_cloud_flags(checked):
    items, _, r = checked
    old = [{"code": "plan_offset", "value": 9.0}, {"code": "builder_fallback"}]
    stale = [
        type(it).model_validate({**it.model_dump(), "flags": old}) if it.id == "tank-a" else it
        for it in items
    ]
    out = {it.id: it for it in cc.apply_check(stale, r)}
    assert [f.code for f in out["tank-a"].flags] == ["builder_fallback"]


def test_apply_check_refreshes_cloud_heights_on_a_rerun(checked):
    items, datum, r = checked
    once = cc.apply_check(items, r)
    again = cc.CheckResult(
        datum,
        {
            "tank-b": cc.ItemCheck("tank-b", 105.0, 131.0, 1.0, 0.0, []),
            "tank-a": cc.ItemCheck("tank-a", 100.0, 140.0, 1.0, 0.0, []),
        },
        [],
    )
    by = {it.id: it for it in cc.apply_check(once, again)}
    assert by["tank-b"].height_source == "cloud"
    assert (by["tank-b"].base_el, by["tank-b"].top_el) == (105.0, 131.0)
    a = next(it for it in items if it.id == "tank-a")
    assert by["tank-a"].height_source == "drawing" and (by["tank-a"].base_el, by["tank-a"].top_el) == (
        a.base_el,
        a.top_el,
    )


def test_summarise_is_bounded_and_flagged_first(checked):
    _, _, r = checked
    s = cc.summarise(r, limit=2)
    assert s["checked"] == 5 and s["truncated"] is True and len(s["items"]) == 2
    assert all(row["flags"] for row in s["items"])
    (offset_row,) = [row for row in s["items"] if row["id"] == "pkg-offset"]
    assert "+3.0 m east" in offset_row["flags"][0]["note"]
    assert s["flag_counts"] == {"height_mismatch": 1, "missing_in_cloud": 1, "plan_offset": 1}
    assert s["candidates_total"] == 1 and s["datum"]["offset_m"] == pytest.approx(pc.EL_OFFSET, abs=0.05)
    import json

    json.dumps(s, allow_nan=False)
