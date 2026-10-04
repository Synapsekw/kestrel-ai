# backend/tests/test_plant_packages.py
"""Plant run state files and package rows (spec §8.2.2, §8.4, §9)."""

import json

import pytest

from app.asset_models.agent.plant import packages as pk
from app.asset_models.agent.plant.state import (
    PlantState,
    env_of,
    load_merged,
    load_package_items,
    load_state,
    save_merged,
    save_package_items,
    save_state,
    site_of,
)
from app.asset_models.spec import Item
from app.db.models import AssetModel, AssetModelRun


def _item(i, tag=None):
    return Item.model_validate(
        {
            "id": i,
            "tag": tag,
            "name": i,
            "type": "other",
            "footprint": {"kind": "rect", "center": [0, 0], "size": [4, 2], "rot_deg": 0},
            "source": {"kind": "assumed"},
        }
    )


@pytest.fixture
def run_ids(handle):
    with handle.session() as s:
        m = AssetModel(name="Plant")
        s.add(m)
        s.flush()
        r = AssetModelRun(
            model_id=m.id, job_id="j", provider="anthropic", model_name="x", mode="plant", sources=[]
        )
        s.add(r)
        s.flush()
        return m.id, r.id


def test_state_round_trips_and_ignores_unknown_keys(tmp_path):
    st = PlantState(stage="trace", interrupts={"p": 1}, notes=["n"], limits={"parallel": 2})
    save_state(tmp_path, st)
    raw = json.loads((tmp_path / "plant" / "state.json").read_text("utf-8"))
    raw["from_the_future"] = 1
    (tmp_path / "plant" / "state.json").write_text(json.dumps(raw), "utf-8")
    again = load_state(tmp_path)
    assert again.stage == "trace" and again.interrupts == {"p": 1} and again.limits == {"parallel": 2}
    assert load_state(tmp_path / "nothing") == PlantState()


def test_package_items_and_merged_files(tmp_path):
    assert load_package_items(tmp_path, 3) is None and load_merged(tmp_path) is None
    save_package_items(tmp_path, 3, [_item("a"), _item("b", "T-1")])
    save_merged(tmp_path, [_item("a")])
    assert [i.id for i in load_package_items(tmp_path, 3)] == ["a", "b"]
    assert [i.id for i in load_merged(tmp_path)] == ["a"]
    assert not list((tmp_path / "plant").rglob("*.tmp"))


def test_site_and_env_of_an_empty_state():
    assert site_of(PlantState()) is None and env_of(PlantState()) == []


def test_replace_queued_keeps_started_packages(handle, run_ids):
    _, run_id = run_ids
    with handle.session() as s:
        first = pk.replace_queued(
            s, run_id, [{"label": "A", "drawing_id": "d", "region": [0, 0, 0.5, 1]}, {"label": "B"}]
        )
        pk.set_state(s, first[0].id, "running")
        again = pk.replace_queued(s, run_id, [{"label": "C", "area": "20"}])
        rows = pk.rows(s, run_id)
        assert [(r.n, r.label, r.state) for r in rows] == [(1, "A", "running"), (2, "C", "queued")]
        assert again[0].area == "20" and rows[0].started_at is not None


def test_states_summary_and_mark_unfinished(handle, run_ids):
    _, run_id = run_ids
    with handle.session() as s:
        a, b, c = pk.replace_queued(s, run_id, [{"label": "A"}, {"label": "B"}, {"label": "C"}])
        pk.set_state(s, a.id, "done", usage={"input_tokens": 5}, item_count=7, summary="ok")
        pk.set_state(s, b.id, "running")
        assert pk.summary(s, run_id) == {"total": 3, "done": 1, "failed": 0, "running": 1}
        assert pk.mark_unfinished(s, run_id, "skipped", "Not started.") == ["B", "C"]
        assert [r.state for r in pk.rows(s, run_id)] == ["done", "skipped", "skipped"]
        assert a.item_count == 7 and a.usage == {"input_tokens": 5} and a.ended_at is not None


def test_work_of_and_rerun_copies(handle, run_ids):
    model_id, run_id = run_ids
    with handle.session() as s:
        (a,) = pk.replace_queued(
            s, run_id, [{"label": "A", "drawing_id": "d1", "region": [0, 0, 1, 1], "area": "20"}]
        )
        w = pk.work_of(a, {"brief": "Tanks", "expected_tags": ["20-T-0001"]})
        assert (w.n, w.label, w.region, w.brief, w.expected_tags) == (
            1,
            "A",
            (0, 0, 1, 1),
            "Tanks",
            ("20-T-0001",),
        )
        assert pk.work_of(a, {}).brief == "A"
        run2 = AssetModelRun(
            model_id=model_id,
            job_id="j2",
            provider="anthropic",
            model_name="x",
            mode="plant_package",
            sources=[],
        )
        s.add(run2)
        s.flush()
        found = pk.find_for_model(s, model_id, [a.id, "nope"])
        copies = pk.copy_for_rerun(s, run2.id, found)
        assert [(c.label, c.drawing_id, c.area, c.state, c.run_id) for c in copies] == [
            ("A", "d1", "20", "queued", run2.id)
        ]


def test_expected_attempts_and_default_usage(handle, run_ids):
    model_id, run_id = run_ids
    with handle.session() as s:
        (a,) = pk.replace_queued(s, run_id, [{"label": "A", "expected_tags": ["T-1", 2]}])
        assert a.expected == ["T-1", "2"] and a.usage == {"input_tokens": 0, "output_tokens": 0}
        (long,) = pk.replace_queued(
            s, run_id, [{"label": "L", "expected_tags": [str(k) for k in range(400)]}]
        )
        assert len(long.expected) == 300
        assert (a.attempts or 0) == 0
        (c,) = pk.replace_queued(s, run_id, [{"label": "C", "expected_tags": ["X"]}])
        pk.set_state(s, c.id, "running")
        pk.set_state(s, c.id, "queued")
        pk.set_state(s, c.id, "running")
        assert c.attempts == 2
        assert pk.work_of(c, {}).expected_tags == ("X",)
        assert pk.work_of(c, {"expected_tags": ["Y"]}).expected_tags == ("Y",)
        run2 = AssetModelRun(
            model_id=model_id,
            job_id="j3",
            provider="anthropic",
            model_name="x",
            mode="plant_package",
            sources=[],
        )
        s.add(run2)
        s.flush()
        (copy,) = pk.copy_for_rerun(s, run2.id, [c])
        assert copy.expected == ["X"] and copy.attempts == 0
