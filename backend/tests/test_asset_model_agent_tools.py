# backend/tests/test_asset_model_agent_tools.py
"""Agent tools over a RunContext (spec §7.3; Review Focus 3)."""

import json
import uuid

import numpy as np
import pytest

from app.asset_models.agent.tools import MAX_IMAGES, RunContext, run_tool, tool_specs
from app.asset_models.look.cloud import CloudSample
from app.asset_models.spec import AssetSpec

SHELL = {
    "id": "shell",
    "name": "Shell",
    "group": "Shell",
    "shape": "cylinder",
    "params": {"id": 4000, "thickness": 8, "height": 8000},
    "source": {"kind": "assumed"},
}


@pytest.fixture
def ctx(handle, tmp_path):
    c = RunContext(
        handle=handle,
        model_id=str(uuid.uuid4()),
        run_id=str(uuid.uuid4()),
        sources=[],
        spec=AssetSpec(),
        samples={},
    )
    c.run_dir = tmp_path  # tests write thumbs/overlays here
    return c


def test_specs_are_complete_and_strict():
    names = {s.name for s in tool_specs()}
    assert names == {
        "list_sources",
        "drawing_view",
        "drawing_text",
        "cloud_slice",
        "cloud_fit",
        "photo_view",
        "get_spec",
        "set_asset",
        "upsert_parts",
        "remove_parts",
        "render",
        "compare_to_cloud",
        "validate",
        "finish",
    }


def test_upsert_then_get_spec(ctx):
    out = run_tool(ctx, "upsert_parts", {"parts": [SHELL]})
    assert out.ok and "1 part" in out.text and out.phase == "building"
    assert [p.id for p in ctx.spec.parts] == ["shell"]
    spec = json.loads(run_tool(ctx, "get_spec", {}).text)
    assert spec["parts"][0]["id"] == "shell"
    assert (ctx.run_dir / "working.json").exists()


def test_upsert_replaces_by_id(ctx):
    run_tool(ctx, "upsert_parts", {"parts": [SHELL]})
    taller = {**SHELL, "params": {"id": 4000, "thickness": 8, "height": 9000}}
    run_tool(ctx, "upsert_parts", {"parts": [taller]})
    assert len(ctx.spec.parts) == 1 and ctx.spec.parts[0].params["height"] == 9000


def test_invalid_upsert_is_a_tool_error_and_loop_continues(ctx):
    run_tool(ctx, "upsert_parts", {"parts": [SHELL]})
    orphan = {
        "id": "N1",
        "name": "N1",
        "group": "Nozzle",
        "shape": "nozzle",
        "params": {"dn": 50, "od": 60, "projection": 100, "flange_od": 150, "flange_t": 18},
        "placement": {"host": "ghost", "bearing_deg": 0, "elevation_mm": 100},
        "source": {"kind": "assumed"},
    }
    out = run_tool(ctx, "upsert_parts", {"parts": [orphan]})
    assert not out.ok and "host_missing" in out.text and "N1" in out.text
    assert [p.id for p in ctx.spec.parts] == ["shell"]  # unchanged
    bad = run_tool(ctx, "upsert_parts", {"parts": [{"id": "x", "shape": "torus"}]})
    assert not bad.ok and "torus" in bad.text
    junk = run_tool(ctx, "upsert_parts", {"partz": []})
    assert not junk.ok
    unknown = run_tool(ctx, "make_coffee", {})
    assert not unknown.ok and "unknown tool" in unknown.text.lower()


def test_remove_parts(ctx):
    run_tool(ctx, "upsert_parts", {"parts": [SHELL]})
    out = run_tool(ctx, "remove_parts", {"ids": ["shell", "nope"]})
    assert out.ok and ctx.spec.parts == [] and "nope" in out.text


def test_render_returns_one_image_and_counts_it(ctx):
    run_tool(ctx, "upsert_parts", {"parts": [SHELL]})
    out = run_tool(ctx, "render", {"views": ["iso", "front"]})
    assert out.ok and out.image[:2] == b"\xff\xd8" and out.phase == "checking"
    assert ctx.images_sent == 1


def test_image_budget_drops_images_not_the_call(ctx):
    run_tool(ctx, "upsert_parts", {"parts": [SHELL]})
    ctx.images_sent = MAX_IMAGES
    out = run_tool(ctx, "render", {"views": ["iso"]})
    assert out.ok and out.image is None and "image budget" in out.text


def test_compare_writes_overlay_and_comparison(ctx):
    run_tool(ctx, "upsert_parts", {"parts": [SHELL]})
    rng = np.random.default_rng(0)
    a = rng.uniform(0, 2 * np.pi, 20000)
    xyz = np.column_stack(
        [100 + 2.004 * np.cos(a), 200 + 2.004 * np.sin(a), 5 + rng.uniform(0.5, 7.5, 20000)]
    )
    ctx.samples["c1"] = CloudSample(np.zeros(3), xyz.astype(np.float32), 20000)
    out = run_tool(ctx, "compare_to_cloud", {"cloud_id": "c1", "origin": [100, 200, 5], "yaw_deg": 0})
    assert out.ok, out.text
    assert ctx.comparison["cloud_id"] == "c1"
    assert ctx.comparison["parts"][0]["median_mm"] == pytest.approx(4, abs=1.5)
    assert (ctx.run_dir / "overlay_c1.bin").stat().st_size % 12 == 0


def test_finish_records_summary(ctx):
    out = run_tool(ctx, "finish", {"summary": "Built the shell.", "open_questions": ["N7 bearing?"]})
    assert out.ok and ctx.finished == {"summary": "Built the shell.", "open_questions": ["N7 bearing?"]}


def test_cloud_tools_need_a_listed_cloud(ctx):
    out = run_tool(ctx, "cloud_slice", {"cloud_id": "zzz", "axis": "z", "at_m": 1, "thickness_m": 0.1})
    assert not out.ok and "not one of this run's sources" in out.text


def test_value_error_in_render_or_compare_is_a_tool_error(ctx, monkeypatch):
    from app.asset_models.agent import tools as T

    run_tool(ctx, "upsert_parts", {"parts": [SHELL]})

    def boom(*a, **k):
        raise ValueError("secret C:/path/key")

    monkeypatch.setattr(T, "render", boom)
    out = run_tool(ctx, "render", {"views": ["iso"]})
    assert not out.ok and "iso" in out.text and "secret" not in out.text
    monkeypatch.setattr(T, "compare", boom)
    ctx.samples["c1"] = CloudSample(np.zeros(3), np.zeros((4, 3), np.float32), 4)
    out = run_tool(ctx, "compare_to_cloud", {"cloud_id": "c1", "origin": [0, 0, 0], "yaw_deg": 0})
    assert not out.ok and "secret" not in out.text


def test_render_view_schema_is_flat():
    spec = next(s for s in tool_specs() if s.name == "render")
    text = json.dumps(spec.input_schema)
    assert "anyOf" not in text and "section@" in text
