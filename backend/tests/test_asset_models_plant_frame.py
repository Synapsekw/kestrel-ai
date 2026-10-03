"""A plant version fills P1's asset frame when it is null (spec §9; plan A1 task 7)."""

import pytest
from plant_fixture import synthetic_plant
from plant_helpers import Ctx, seed_version

import app.asset_models.plant_frame as plant_frame_mod
from app.asset_models import store
from app.asset_models.jobs_glb import run_glb

frame_mod = pytest.importorskip("app.asset_review.frame")


def frame_of(handle, mid):
    with handle.session() as s:
        return store.get_model(s, mid).frame


def build(handle, spec):
    mid = seed_version(handle, spec)
    run_glb(Ctx(handle, {"model_id": mid, "version": 1}))
    return mid


def test_plant_version_fills_a_null_frame(handle):
    spec = synthetic_plant(5, types=("other",))
    spec["site"]["cloud_z_to_el"] = {"cloud_id": "c1", "offset_m": 120.45}
    f = frame_mod.Frame.model_validate(frame_of(handle, build(handle, spec)))
    assert f.origin.lat == pytest.approx(28.71769, abs=1e-4)
    assert f.origin.lon == pytest.approx(48.38271, abs=1e-4)
    assert f.north_offset_deg == pytest.approx(17.9991 - 1.25828, abs=0.01)  # plant north, true bearing
    assert f.origin.ground_alt_m == pytest.approx(100.0 - 120.45)
    assert f.datum_label == "HPFS" and f.height_m > 0
    assert f.silhouette == [] and f.levels == [] and f.presets == []


def test_unfitted_altitude_is_zero_and_noted(handle):
    f = frame_mod.Frame.model_validate(frame_of(handle, build(handle, synthetic_plant(3, types=("other",)))))
    assert f.origin.ground_alt_m == 0.0 and "not fitted" in f.datum_note


def test_existing_frame_is_left_alone(handle):
    spec = synthetic_plant(3, types=("other",))
    mid = seed_version(handle, spec)
    preset = frame_mod.Frame(height_m=5.0, datum_label="Operator").model_dump(mode="json")
    with handle.session() as s:
        store.get_model(s, mid).frame = preset
    run_glb(Ctx(handle, {"model_id": mid, "version": 1}))
    assert frame_of(handle, mid) == preset


def test_no_site_leaves_the_frame_null(handle):
    spec = synthetic_plant(3, types=("other",))
    spec["site"] = None
    assert frame_of(handle, build(handle, spec)) is None


def test_no_crs_has_no_origin(handle):
    spec = synthetic_plant(3, types=("other",))
    spec["site"]["crs"] = {"epsg": None, "wkt": None}
    f = frame_mod.Frame.model_validate(frame_of(handle, build(handle, spec)))
    assert f.origin is None and f.north_offset_deg == pytest.approx(17.9991)


def test_frame_failure_never_fails_the_build(handle, monkeypatch):
    def boom(_spec, _meta):
        raise RuntimeError("frame")

    monkeypatch.setattr(plant_frame_mod, "plant_frame", boom)
    mid = build(handle, synthetic_plant(3, types=("other",)))
    with handle.session() as s:
        assert store.get_version(s, mid, 1).glb_status == "ready"
    assert frame_of(handle, mid) is None
