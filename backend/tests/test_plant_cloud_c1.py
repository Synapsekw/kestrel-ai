# backend/tests/test_plant_cloud_c1.py
"""The cloud check stage and tool (spec §8.2.4, §8.3; D5) wired to C1's module."""

from types import SimpleNamespace as NS

from plant_fakes import KIPIC, FakePlantLlm, item, make_rc, reply, seed_plant
from test_plant_run import finish_pkg, run_job

from app.asset_models import cloudcheck as cc
from app.asset_models import store
from app.asset_models.agent.plant import tools_plant as T
from app.asset_models.agent.plant.budget import PlantLimits
from app.asset_models.agent.plant.context import Scope
from app.asset_models.spec import CloudDatum
from app.pointclouds import rows

BBOX = (244000.0, 3179000.0, 245000.0, 3180000.0)


def fake_c1(monkeypatch, *, in_frame=True, note=None):
    seen = {"sampled": 0, "saved": [], "checked": []}

    def sample(handle, cloud_id, bbox_site, *, max_points=20_000_000, cancel=None, progress=None):
        assert cancel() is False  # the recipe: cancel=lambda: rc.check_cancelled() or False
        seen["sampled"] += 1
        seen["bbox"] = bbox_site
        return NS(cloud_id=cloud_id, bbox=bbox_site, save=lambda path: seen["saved"].append(path))

    def check(sample_, grid, items, datum):
        seen["checked"].append(sorted(i.id for i in items))
        return NS(
            datum=datum,
            note=note,
            items={
                i.id: NS(item_id=i.id, ground_el=100.0, top_el=112.0, coverage=0.9, offset_m=0.2, flags=[])
                for i in items
            },
            candidates=[
                NS(
                    id="cand-1",
                    pts=[(200.0, 0.0), (210.0, 0.0), (210.0, 8.0), (200.0, 8.0)],
                    top_el=112.0,
                    size_m=(10.0, 8.0),
                )
            ],
        )

    def summarise(result, *, limit=300):
        return {
            "datum": None if result.datum is None else result.datum.model_dump(),
            "note": result.note,
            "checked": len(result.items),
            "flag_counts": {},
            "items": [{"id": k} for k in result.items][:limit],
            "truncated": False,
            "candidates": [],
            "candidates_total": len(result.candidates),
        }

    monkeypatch.setattr(cc, "cloud_in_frame", lambda handle, cloud_id, frame: in_frame)
    monkeypatch.setattr(cc, "plant_bbox_site", lambda grid, items, margin_m=50.0: BBOX)
    monkeypatch.setattr(cc, "sample_plant_cloud", sample)
    monkeypatch.setattr(
        cc, "fit_datum", lambda sample_, grid, items: CloudDatum(cloud_id="cloud-1", offset_m=120.45)
    )
    monkeypatch.setattr(cc, "check_items", check)
    monkeypatch.setattr(
        cc, "apply_check", lambda items, result: [i.model_copy(update={"top_el": 112.0}) for i in items]
    )
    monkeypatch.setattr(cc, "summarise", summarise)
    # the seeded cloud source has no row: the skip sentence reads the row's CRS (both known here)
    monkeypatch.setattr(
        rows, "get_cloud", lambda handle, cloud_id: NS(name="c", status="importing", epsg=32640, crs_wkt=None)
    )
    return seen


def script(ids, review):
    d0 = ids["drawings"][0]
    orchestrator = [
        reply(("set_site", KIPIC)),
        reply(("plan_packages", {"packages": [{"label": "A", "drawing_id": d0}]})),
        reply(("next_stage", {"summary": "1"})),
        *review,
        reply(("next_stage", {"summary": "env"})),
        reply(("finish", {"summary": "done"})),
    ]
    p1 = [
        reply(("upsert_items", {"items": [item("t1", tag="T1", did=d0, height_source="indicative")]})),
        finish_pkg(),
    ]
    return FakePlantLlm(orchestrator, {"P1": p1})


def test_the_cloud_check_feeds_the_review(handle, app, monkeypatch):
    seen = fake_c1(monkeypatch)
    ids = seed_plant(handle, app, clouds=["cloud-1"], limits=PlantLimits(parallel=1))
    review = [
        reply(("cloud_check", {"item_ids": ["t1"]})),
        reply(
            (
                "upsert_items",
                {"items": [item("cand-1-tank", e=205, n=4, source={"kind": "cloud", "id": "cloud-1"})]},
            )
        ),
        reply(("next_stage", {"summary": "named cand-1"})),
    ]
    fake = script(ids, review)
    _, result, run, _ = run_job(handle, app, ids, fake)
    assert run.state == "finished"
    review_text = fake.of("orchestrator")[3]["user_texts"][-1]
    assert "Stage: review" in review_text and "cand-1" in review_text
    assert "Cloud check: 1 item checked; cloud flags: none; 1 unregistered candidate;" in review_text
    assert seen["sampled"] == 1 and len(seen["saved"]) == 1  # sampled once, cached in the run folder
    assert seen["checked"] == [["t1"], ["t1"]]  # the stage, then the tool: all items each time
    with handle.session() as s:
        spec = store.get_version(s, ids["model"], result["version"]).spec
    got = {i["id"]: i for i in spec["items"]}
    assert [f["code"] for f in got["cand-1-tank"]["flags"]] == ["unregistered"]
    assert got["t1"]["top_el"] == 112.0
    assert spec["site"]["cloud_z_to_el"]["offset_m"] == 120.45
    assert not any("No cloud check" in q for q in run.open_questions)


def test_a_cloud_outside_the_frame_is_skipped_with_its_note(handle, app, monkeypatch):
    seen = fake_c1(monkeypatch, in_frame=False)
    ids = seed_plant(handle, app, clouds=["cloud-1"], limits=PlantLimits(parallel=1))
    _, _, run, _ = run_job(handle, app, ids, script(ids, []))
    assert run.state == "finished" and seen["sampled"] == 0
    assert f"No cloud check: {cc.SKIP_OTHER_CRS}" in run.open_questions


def test_a_check_result_note_becomes_a_run_note(handle, app, monkeypatch):
    fake_c1(monkeypatch, note="No datum could be fitted: fewer than 3 items with drawing elevations.")
    ids = seed_plant(handle, app, clouds=["cloud-1"], limits=PlantLimits(parallel=1))
    review = [reply(("next_stage", {"summary": "ok"}))]
    _, _, run, _ = run_job(handle, app, ids, script(ids, review))
    assert any("No datum could be fitted" in q for q in run.open_questions)


def test_an_unreadable_cloud_is_a_run_note_and_the_run_continues(handle, app, monkeypatch):
    from app.asset_models.look import LookError

    fake_c1(monkeypatch)

    def broken(*a, **k):
        raise LookError(cc.UNREADABLE)

    monkeypatch.setattr(cc, "sample_plant_cloud", broken)
    ids = seed_plant(handle, app, clouds=["cloud-1"], limits=PlantLimits(parallel=1))
    _, _, run, _ = run_job(handle, app, ids, script(ids, []))
    assert run.state == "finished"
    assert f"No cloud check: {cc.UNREADABLE}" in run.open_questions


def test_cloud_check_tool_without_a_check(handle, app):
    rc = make_rc(handle, app, seed_plant(handle, app))
    out = T.run_plant_tool(rc, Scope(name="orchestrator", stage="review", items=rc.store), "cloud_check", {})
    assert not out.ok and "No cloud check ran" in out.text
    assert "cloud_check" in T.ORCH_NAMES and "cloud_check" not in T.SUB_NAMES


def test_a_cached_sample_is_reused_until_the_plant_box_grows_past_it(handle, app, monkeypatch):
    import numpy as np

    from app.asset_models.agent.plant import cloud as C

    seen = fake_c1(monkeypatch)
    rc = make_rc(handle, app, seed_plant(handle, app, clouds=["cloud-1"]))
    rc.run_dir.mkdir(parents=True, exist_ok=True)
    xyz = np.zeros((3, 3), np.float32)
    cached = cc.PlantSample(xyz=xyz, cloud_id="cloud-1", crs_epsg=32640, bbox=BBOX, origin=BBOX[:2], total=3)
    cached.save(rc.run_dir / "plant_sample_cloud-1.npz")
    inside = (BBOX[0] + 10, BBOX[1] + 10, BBOX[2] - 10, BBOX[3] - 10)
    got = C._sample(rc, cc, "cloud-1", inside)
    assert seen["sampled"] == 0 and got.bbox == BBOX and len(got.xyz) == 3  # the resume reads no cloud
    grown = (BBOX[0] - 10, BBOX[1], BBOX[2], BBOX[3])
    C._sample(rc, cc, "cloud-1", grown)
    assert seen["sampled"] == 1 and seen["bbox"] == grown  # the box outgrew the cache: read again


def test_a_damaged_plant_sample_cache_is_sampled_again(handle, app, monkeypatch, caplog):
    from app.asset_models.agent.plant import cloud as C

    seen = fake_c1(monkeypatch)
    rc = make_rc(handle, app, seed_plant(handle, app, clouds=["cloud-1"]))
    rc.run_dir.mkdir(parents=True, exist_ok=True)
    (rc.run_dir / "plant_sample_cloud-1.npz").write_bytes(b"PK\x03\x04 a crash cut this short")
    got = C._sample(rc, cc, "cloud-1", BBOX)
    assert seen["sampled"] == 1 and got.cloud_id == "cloud-1"
    assert "BadZipFile" in caplog.text and "plant_sample_cloud-1" not in caplog.text


def test_a_damaged_m1_cloud_sample_cache_is_sampled_again(handle, app, monkeypatch, caplog):
    from app.asset_models.agent.plant import orchestrator as O

    rc = make_rc(handle, app, seed_plant(handle, app, clouds=["cloud-1"]))
    rc.run_dir.mkdir(parents=True, exist_ok=True)
    (rc.run_dir / "cloud_cloud-1.npz").write_bytes(b"PK\x03\x04 a crash cut this short")
    fresh = NS(save=lambda path: None)
    monkeypatch.setattr(O, "source_of", lambda handle, cid: "unused")
    monkeypatch.setattr(O, "sample_cloud", lambda src, check_cancelled: fresh)
    O._sample_m1_clouds(rc)
    assert rc.m1.samples["cloud-1"] is fresh
    assert "BadZipFile" in caplog.text and "cloud_cloud-1" not in caplog.text
