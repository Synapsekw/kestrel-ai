# backend/tests/test_asset_models_plant_job.py
"""The asset_model_glb job on plant specs (spec §7, §9; plan A1 task 6)."""

import json

import pytest
from plant_fixture import synthetic_plant
from plant_helpers import Ctx, parse, read_csv, seed_version
from sqlalchemy import func, select

from app.asset_models import store
from app.asset_models.jobs_glb import issue_item_id, run_glb
from app.asset_models.spec import AssetSpec
from app.asset_models.validate import validate
from app.db.models import AssetItem, Drawing
from app.jobs.cancellation import JobCancelled, JobFailure

M1_SPEC = {
    "parts": [
        {
            "id": "s",
            "name": "s",
            "group": "Shell",
            "shape": "cylinder",
            "params": {"id": 1000, "thickness": 10, "height": 2000},
            "source": {"kind": "assumed"},
        }
    ]
}


def index_rows(handle, mid, version=1):
    with handle.session() as s:
        rows = s.scalars(
            select(AssetItem)
            .where(AssetItem.model_id == mid, AssetItem.version == version)
            .order_by(AssetItem.id)
        ).all()
        s.expunge_all()
        return rows


def no_tmp(handle, mid):
    return not list(store.model_dir(handle, mid).glob("*.tmp"))


def test_plant_version_writes_glb_csv_meta_and_index(handle):
    spec = synthetic_plant(5, types=("other",))
    mid = seed_version(handle, spec)
    ctx = Ctx(handle, {"model_id": mid, "version": 1})
    assert run_glb(ctx) == {"model_id": mid, "version": 1}
    doc, _ = parse(store.version_glb_path(handle, mid, 1).read_bytes())
    ids = [i["id"] for i in spec["items"]]
    assert set(ids) <= {n["name"] for n in doc["nodes"]}
    rows = read_csv(store.version_csv_path(handle, mid, 1))
    assert [r["node"] for r in rows] == ids and "utm39_E" in rows[0]
    meta = json.loads(store.version_meta_path(handle, mid, 1).read_text("utf-8"))
    with handle.session() as s:
        v = store.get_version(s, mid, 1)
        assert v.glb_status == "ready" and v.meta == meta
    idx = index_rows(handle, mid)
    assert [r.node for r in idx] == ids
    assert all(r.site_x is not None and r.lat is not None and r.has_geometry for r in idx)
    assert meta["items"] == 5 and meta["environment"] == 3 and meta["validation"]["error_count"] == 0
    assert no_tmp(handle, mid)
    assert ("asset_models.changed", {"asset_model_ids": [mid]}) in ctx.published


def test_rebuild_replaces_the_index_rows(handle):
    mid = seed_version(handle, synthetic_plant(5, types=("other",)))
    run_glb(Ctx(handle, {"model_id": mid, "version": 1}))
    run_glb(Ctx(handle, {"model_id": mid, "version": 1}))
    assert len(index_rows(handle, mid)) == 5


def test_m1_spec_keeps_build_glb_and_writes_a_header_only_csv(handle):
    mid = seed_version(handle, M1_SPEC)
    run_glb(Ctx(handle, {"model_id": mid, "version": 1}))
    lines = store.version_csv_path(handle, mid, 1).read_text("utf-8").splitlines()
    assert len(lines) == 1 and lines[0].startswith("node,tag,name,") and "site_E" in lines[0]
    with handle.session() as s:
        assert store.get_version(s, mid, 1).meta["top_m"] == pytest.approx(2.0)
    assert store.version_meta_path(handle, mid, 1).exists() and index_rows(handle, mid) == []


def test_duplicate_item_ids_fail_the_job(handle):
    spec = synthetic_plant(5, types=("other",))
    spec["items"][1]["id"] = spec["items"][0]["id"]
    mid = seed_version(handle, spec)
    with pytest.raises(JobFailure, match="spec has errors"):
        run_glb(Ctx(handle, {"model_id": mid, "version": 1}))
    with handle.session() as s:
        assert store.get_version(s, mid, 1).glb_status == "failed"
    assert not store.version_glb_path(handle, mid, 1).exists() and no_tmp(handle, mid)
    assert index_rows(handle, mid) == []


def test_cancel_mid_build_marks_failed_and_leaves_no_tmp(handle):
    mid = seed_version(handle, synthetic_plant(60, types=("other",)))
    with pytest.raises(JobCancelled):
        run_glb(Ctx(handle, {"model_id": mid, "version": 1}, cancel_after=1))
    with handle.session() as s:
        assert store.get_version(s, mid, 1).glb_status == "failed"
    assert not store.version_glb_path(handle, mid, 1).exists()
    assert no_tmp(handle, mid) and index_rows(handle, mid) == []


def test_source_sheet_is_the_drawing_name(handle):
    with handle.session() as s:
        d = Drawing(name="P0058LNG-00-40-0-T0006", format="pdf", source_path="C:/x/a.pdf", source_size=1)
        s.add(d)
        s.flush()
        drawing_id = d.id
    spec = synthetic_plant(2, types=("other",))
    spec["items"][0]["source"] = {"kind": "drawing", "id": drawing_id}
    spec["items"][1]["source"] = {"kind": "drawing", "id": "gone"}
    mid = seed_version(handle, spec)
    run_glb(Ctx(handle, {"model_id": mid, "version": 1}))
    rows = read_csv(store.version_csv_path(handle, mid, 1))
    assert [r["source_sheet"] for r in rows] == ["P0058LNG-00-40-0-T0006", "gone"]


def test_validation_errors_are_summarised_not_fatal(handle):
    spec = synthetic_plant(3, types=("other",))
    spec["items"][0]["type"] = "pump"
    spec["items"][0]["footprint"] = {
        "kind": "polygon",
        "pts": [[0, 0], [10, 10], [10, 0], [0, 10]],
    }  # bow-tie
    mid = seed_version(handle, spec)
    run_glb(Ctx(handle, {"model_id": mid, "version": 1}))
    with handle.session() as s:
        meta = store.get_version(s, mid, 1).meta
    assert meta["validation"]["error_count"] >= 1 and meta["fallback_count"] >= 1
    [row] = [r for r in index_rows(handle, mid) if r.node == spec["items"][0]["id"]]
    assert row.type == "pump" and "builder_fallback" in {f["code"] for f in row.flags}


def test_assemble_survives_broken_item(handle):
    """Index Review Focus #4: 2 000 items, one NaN param, one zero-length line, one bow-tie polygon."""
    spec = synthetic_plant(2000, types=("other",))
    ids = [i["id"] for i in spec["items"]]
    spec["items"][10]["type"] = "pipe_rack"
    spec["items"][10]["params"] = {"tiers": float("nan")}
    spec["items"][20]["footprint"] = {"kind": "line", "pts": [[1000.0, 500.0], [1000.0, 500.0]], "width": 2.0}
    spec["items"][30]["footprint"] = {"kind": "polygon", "pts": [[0, 0], [10, 10], [10, 0], [0, 10]]}
    report = validate(AssetSpec.model_validate(spec))
    assert ids[30] in {issue_item_id(i) for i in report.errors}  # the validator reports the bow-tie
    mid = seed_version(handle, spec)
    run_glb(Ctx(handle, {"model_id": mid, "version": 1}))
    with handle.session() as s:
        assert store.get_version(s, mid, 1).glb_status == "ready"
        assert s.scalar(select(func.count()).select_from(AssetItem).where(AssetItem.model_id == mid)) == 2000
    by = {r.node: r for r in index_rows(handle, mid)}
    for broken in (ids[10], ids[30]):
        assert "builder_fallback" in {f["code"] for f in by[broken].flags}
    assert ids[20] in by
    csv_rows = read_csv(store.version_csv_path(handle, mid, 1))
    assert len(csv_rows) == 2000 and {ids[10], ids[20], ids[30]} <= {r["node"] for r in csv_rows}
    doc, _ = parse(store.version_glb_path(handle, mid, 1).read_bytes())
    names = {n["name"] for n in doc["nodes"]}
    assert {ids[10], ids[20], ids[30]} <= names
