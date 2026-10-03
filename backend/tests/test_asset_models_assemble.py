# backend/tests/test_asset_models_assemble.py
"""The plant assembler (spec §7, plan A1 task 4): hierarchy, extras = register rows, palette,
instancing, fallbacks, environment and M1 parts."""

import json

import numpy as np
import pytest
import trimesh
from plant_helpers import COWORK_MATERIALS, KIPIC_SITE, by_name, parse

import app.asset_models.assemble as assemble_mod
from app.asset_models.assemble import AssembleError, assemble, assemble_glb, env_ref
from app.asset_models.builders.base import Instanced, MeshNode
from app.asset_models.glbwriter import INSTANCING
from app.asset_models.siteframe import PlantGrid
from app.asset_models.spec import AssetSpec, EnvFeature

SEA = {
    "id": "sea",
    "kind": "sea",
    "pts": [[2000.0, 200.0], [2600.0, 200.0], [2600.0, 900.0], [2000.0, 900.0]],
    "el": 93.56,
    "source": {"kind": "assumed"},
}
PART = {
    "id": "shell",
    "name": "Shell",
    "group": "Shell",
    "shape": "cylinder",
    "params": {"id": 4000, "thickness": 10, "height": 8000},
    "source": {"kind": "assumed"},
}


def item(id_, area=None, e=1300.0, n=555.4, **kw):
    return {
        "id": id_,
        "name": id_.upper(),
        "type": "other",
        "area": area,
        "footprint": {"kind": "rect", "center": [e, n], "size": [10.0, 6.0]},
        "base_el": 100.0,
        "top_el": 104.0,
        "height_source": "drawing",
        "source": {"kind": "drawing", "id": "d1"},
        **kw,
    }


def spec_of(items, environment=(), parts=(), site=KIPIC_SITE):
    return AssetSpec.model_validate(
        {
            "asset": {"name": "Test plant"},
            "site": site,
            "items": list(items),
            "environment": list(environment),
            "parts": list(parts),
        }
    )


def box_node(name="body", material="Concrete", **kw):
    return MeshNode(name=name, material=material, geometry=trimesh.creation.box((1.0, 1.0, 1.0)), **kw)


def test_root_areas_items_environment_parts():
    spec = spec_of(
        [item("a", "10"), item("b", "20", e=1400.0), item("c", "10", e=1500.0), item("d", e=1600.0)],
        [SEA],
        [PART],
    )
    doc, _ = parse(assemble_glb(spec)[0])
    nodes = doc["nodes"]
    [root_i] = doc["scenes"][0]["nodes"]
    root = nodes[root_i]
    assert root["name"] == "Test plant"
    assert [nodes[i]["name"] for i in root["children"]] == [
        "Area_10", "Area_20", "Area_unassigned", "environment", "shell",
    ]  # fmt: skip
    area10 = nodes[root["children"][0]]
    assert [nodes[i]["name"] for i in area10["children"]] == ["a", "c"]
    a = nodes[area10["children"][0]]
    assert a["children"] and all(nodes[i]["name"].startswith("a/") for i in a["children"])
    env = nodes[root["children"][3]]
    [sea] = [nodes[i] for i in env["children"]]
    assert sea["name"] == "sea" and sea["extras"]["kind"] == "sea"
    x = root["extras"]
    assert x["crs"]["epsg"] == 32639 and x["origin_crs"] == [244338.089, 3179515.69]
    assert x["plant_north_deg"] == 17.9991 and x["datum"] == {"label": "HPFS", "el_m": 100.0}
    assert x["site_from_plant"].startswith("X = 244338.089 + E cos(17.9991)")
    assert x["frame"] == "glTF Y-up, metres. x = plant N, y = EL - 100, z = plant E"


def test_item_translation_is_the_plant_ref_in_the_scene_frame():
    spec = spec_of([item("a", "20", e=1301.1, n=555.4, base_el=102.0)])
    doc, _ = parse(assemble_glb(spec)[0])
    t = by_name(doc, "a")["translation"]
    assert t == pytest.approx([555.4, 2.0, 1301.1])
    expected = PlantGrid(spec.site).plant_to_scene(1301.1, 555.4, 102.0)
    np.testing.assert_allclose(t, np.asarray(expected).reshape(3), atol=1e-6)


def test_item_extras_are_the_register_rows():
    spec = spec_of([item("a", "10", tag="10-A-1"), item("b", "20", e=1400.0)])
    a = assemble(spec, sheet_names={"d1": "SHEET-1"})
    doc, _ = parse(a.glb)
    for row in a.rows:
        assert by_name(doc, row["node"])["extras"] == json.loads(json.dumps(row))
    assert a.rows[0]["source_sheet"] == "SHEET-1"


def test_materials_are_the_cowork_palette():
    doc, _ = parse(assemble_glb(spec_of([item("a")]))[0])
    mats = {m["name"]: m for m in doc["materials"]}
    assert len(doc["materials"]) == 34 and sorted(mats) == sorted(COWORK_MATERIALS)
    assert mats["Concrete_Tank"]["pbrMetallicRoughness"]["baseColorFactor"] == pytest.approx(
        [0.8, 0.79, 0.76, 1]
    )
    assert mats["Steel_Structure"]["pbrMetallicRoughness"]["metallicFactor"] == pytest.approx(0.5)
    assert mats["Fence"]["alphaMode"] == "BLEND" and "alphaMode" not in mats["Concrete"]


def test_instanced_builder_output(monkeypatch):
    xf = np.repeat(np.eye(4)[None], 5, axis=0)
    xf[:, 0, 3] = np.arange(5) * 6.0
    piles = MeshNode(
        name="piles", material="Concrete", geometry=Instanced(trimesh.creation.box((1, 1, 1)), xf)
    )
    monkeypatch.setattr(assemble_mod, "build_item", lambda item, ctx: ([piles], []))
    a = assemble(spec_of([item("a")]))
    doc, _ = parse(a.glb)
    assert INSTANCING in by_name(doc, "a/piles")["extensions"] and doc["extensionsUsed"] == [INSTANCING]
    assert a.meta["instanced"] == {"nodes": 1, "instances": 5} and a.meta["triangles"] == 60
    assert a.meta["bounds_m"][1][0] == pytest.approx(555.4 + 24.5, abs=1e-3)


def test_builder_exception_becomes_a_marker(monkeypatch):
    def boom(item, ctx):
        raise RuntimeError("bad")

    monkeypatch.setattr(assemble_mod, "build_item", boom)
    a = assemble(spec_of([item("a")]))
    doc, _ = parse(a.glb)
    assert "mesh" in by_name(doc, "a/marker")
    [row] = a.rows
    assert row["has_geometry"] is False and "builder_fallback" in [f["code"] for f in row["flags"]]
    assert a.meta["markers"] == ["a"] and a.meta["fallbacks"] == ["a"] and a.meta["fallback_count"] == 1


def test_non_finite_builder_output_becomes_marker(monkeypatch):
    box = trimesh.creation.box((1, 1, 1))
    bad = trimesh.Trimesh(vertices=np.full((8, 3), np.nan), faces=box.faces, process=False)
    node = MeshNode(name="body", material="Concrete", geometry=bad)
    monkeypatch.setattr(assemble_mod, "build_item", lambda item, ctx: ([node], []))
    a = assemble(spec_of([item("a")]))
    doc, _ = parse(a.glb)
    assert "mesh" in by_name(doc, "a/marker") and not [n for n in doc["nodes"] if n["name"] == "a/body"]
    assert a.rows[0]["has_geometry"] is False


def test_numpy_extras_are_cleaned(monkeypatch):
    good = box_node(extras={"n": np.int64(3), "v": np.float32(1.5)})
    nan = box_node(name="nan", extras={"v": np.float64("nan")})
    monkeypatch.setattr(assemble_mod, "build_item", lambda item, ctx: ([good, nan], []))
    doc, _ = parse(assemble(spec_of([item("a")])).glb)
    assert by_name(doc, "a/body")["extras"] == {"n": 3, "v": 1.5}
    assert "extras" not in by_name(doc, "a/nan")


def test_invalid_item_is_built_as_other_with_a_flag(monkeypatch):
    seen = []

    def spy(item, ctx):
        seen.append(item.type)
        return [box_node()], []

    monkeypatch.setattr(assemble_mod, "build_item", spy)
    a = assemble(
        spec_of([item("a", type="pipe_rack", params={"tiers": 3})]), invalid={"a": "footprint crosses itself"}
    )
    assert seen == ["other"]
    [row] = a.rows
    assert row["type"] == "pipe_rack"
    [flag] = [f for f in row["flags"] if f["code"] == "builder_fallback"]
    assert flag["note"] == "Built as other: footprint crosses itself"


def test_duplicate_item_ids_raise():
    with pytest.raises(AssembleError, match="more than once"):
        assemble(spec_of([item("a"), item("a", e=1400.0)]))


def test_item_parts_are_children_and_composite_is_not_doubled():
    doc, _ = parse(assemble_glb(spec_of([item("a", parts=[PART])]))[0])
    assert "mesh" in by_name(doc, "a/shell")
    doc2, _ = parse(assemble_glb(spec_of([item("t", type="composite", parts=[PART])]))[0])
    assert sum(n["name"].startswith("t/") for n in doc2["nodes"]) == 1


def test_environment_falls_back_to_a_flat_slab(monkeypatch):
    monkeypatch.setattr(assemble_mod, "_env_builder", lambda: None)
    a = assemble(spec_of([], [SEA]))
    doc, binary = parse(a.glb)
    sea = by_name(doc, "sea")
    assert "translation" not in sea and sea["extras"]["kind"] == "sea" and sea["extras"]["el"] == 93.56
    prim = doc["meshes"][sea["mesh"]]["primitives"][0]
    assert doc["materials"][prim["material"]]["name"] == "Sea"
    pos = doc["accessors"][prim["attributes"]["POSITION"]]
    assert pos["max"][1] == pytest.approx(93.56 - 100.0, abs=1e-5)
    assert pos["min"][1] == pytest.approx(93.56 - 100.0 - 0.2, abs=1e-5)
    assert all(np.isfinite(env_ref(EnvFeature.model_validate(SEA))))
    assert a.meta["environment"] == 1 and a.rows == []


def test_env_builder_failure_falls_back(monkeypatch):
    def broken(features, ctx):
        raise ValueError("no")

    monkeypatch.setattr(assemble_mod, "_env_builder", lambda: broken)
    a = assemble(spec_of([], [SEA]))
    assert a.meta["environment"] == 1 and a.meta["env_skipped"] == []


def test_env_module_non_import_error_falls_back(monkeypatch, caplog):
    import sys
    import types

    class Broken(types.ModuleType):
        def __getattr__(self, name):
            raise NameError("secret-detail")

    monkeypatch.setitem(sys.modules, "app.asset_models.builders.environment", Broken("environment"))
    with caplog.at_level("WARNING"):
        a = assemble(spec_of([], [SEA]))
    assert a.meta["environment"] == 1 and a.meta["env_skipped"] == []
    assert "NameError" in caplog.text and "secret-detail" not in caplog.text


def test_env_builder_nodes_sit_under_environment_untranslated(monkeypatch):
    calls = []

    def fake(features, ctx):
        calls.append([f.id for f in features])
        return [box_node(name="sea", material="Sea", extras={"env": "sea", "id": "sea"})]

    monkeypatch.setattr(assemble_mod, "_env_builder", lambda: fake)
    a = assemble(spec_of([], [SEA]))
    doc, _ = parse(a.glb)
    env = by_name(doc, "environment")
    sea = by_name(doc, "sea")
    assert [doc["nodes"][i]["name"] for i in env["children"]] == ["sea"]
    assert "translation" not in sea and "mesh" in sea
    assert sea["extras"]["env"] == "sea" and sea["extras"]["kind"] == "sea" and sea["extras"]["el"] == 93.56
    assert calls == [["sea"]] and a.meta["environment"] == 1 and a.meta["env_skipped"] == []


def test_builder_defaults_reach_the_register_notes(monkeypatch):
    node = box_node(extras={"defaults": ["post", "height"]})
    monkeypatch.setattr(assemble_mod, "build_item", lambda item, ctx: ([node], []))
    a = assemble(spec_of([item("a")]))
    assert "Defaults: post." in a.rows[0]["notes"]
    doc, _ = parse(a.glb)
    assert by_name(doc, "a/body")["extras"]["defaults"] == ["post", "height"]


def test_progress_runs_from_zero_to_one():
    seen = []
    assemble(spec_of([item(f"i{k}", e=1300.0 + 20 * k) for k in range(60)]), progress=seen.append)
    assert seen[0] == 0.0 and seen[-1] == 1.0 and seen == sorted(seen)


def test_lod_reaches_the_builders(monkeypatch):
    lods = []

    def spy(item, ctx):
        lods.append(ctx.lod)
        return [box_node()], []

    monkeypatch.setattr(assemble_mod, "build_item", spy)
    assemble(spec_of([item("a")]), lod=0.5)
    assert lods == [0.5]


def test_no_site_uses_datum_zero():
    a = assemble(spec_of([item("a", base_el=5.0, top_el=9.0)], site=None))
    doc, _ = parse(a.glb)
    assert by_name(doc, "a")["translation"] == pytest.approx([555.4, 5.0, 1300.0])
    root = doc["nodes"][doc["scenes"][0]["nodes"][0]]
    assert root["extras"]["crs"] is None and a.rows[0]["utm39_E"] is None


def test_meta_shape():
    a = assemble(spec_of([item("a")], [SEA], [PART]))
    assert set(a.meta) >= {
        "bounds_m", "top_m", "triangles", "node_count", "items", "environment", "env_skipped",
        "fallback_count", "fallbacks", "markers", "instanced", "parts",
    }  # fmt: skip
    assert a.meta["items"] == 1 and a.meta["parts"][0]["id"] == "shell" and a.meta["triangles"] > 0
    assert a.meta["top_m"] == a.meta["bounds_m"][1][1]
