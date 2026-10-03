"""The builder registry, build_item's fallback and the fallback family (plan pm-f0 Task 6)."""

import json
import math

import numpy as np
import pytest

from app.asset_models.builders import base
from app.asset_models.builders.base import (
    PLANNED_TYPES,
    BuildCtx,
    Instanced,
    MeshNode,
    Params,
    build_item,
    builder,
    catalogue,
    defaulted_params,
    load_all,
)
from app.asset_models.builders.geom import box, cyl, instanced_cyl, place
from app.asset_models.siteframe import PlantGrid
from app.asset_models.spec import Item, SiteFrame

CTX = BuildCtx(grid=None)
PART = {
    "id": "shell",
    "name": "Shell",
    "group": "Shell",
    "shape": "cylinder",
    "params": {"id": 1000, "thickness": 10, "height": 2000},
    "source": {"kind": "assumed"},
}


def item(**over) -> Item:
    raw = {
        "id": "a",
        "name": "A",
        "type": "other",
        "footprint": {"kind": "rect", "center": [10, 20], "size": [8, 4], "rot_deg": 30},
        "source": {"kind": "assumed"},
    }
    raw.update(over)
    return Item.model_validate(raw)


@pytest.fixture
def registry(monkeypatch):
    """A scratch copy of the registry: test builders never leak into other tests."""
    load_all()
    scratch = dict(base.REGISTRY)
    monkeypatch.setattr(base, "REGISTRY", scratch)
    return scratch


class BoxParams(Params):
    h: float = 2.0


def test_the_catalogue_plan_has_every_g1_type():
    families = {}
    for t, f in PLANNED_TYPES.items():
        families.setdefault(f, set()).add(t)
    sizes = {f: len(ts) for f, ts in families.items()}
    assert sizes == {"structure": 11, "equipment": 19, "building": 5, "civil": 10, "fallback": 2}


def test_registered_builders_sit_in_their_planned_family():
    load_all()
    assert {"other", "composite"} <= set(base.REGISTRY)
    for t, d in base.REGISTRY.items():
        assert PLANNED_TYPES.get(t, d.family) == d.family, t


def test_builder_refuses_bad_registrations(registry):
    with pytest.raises(ValueError, match="twice"):
        builder("other", family="fallback", params=BoxParams, doc="x", default_height_m=1)(lambda i, c: [])
    registry.pop("tank_lng", None)  # B2 registers the real one; the scratch copy must not hold it here
    with pytest.raises(ValueError, match="equipment family"):
        builder("tank_lng", family="civil", params=BoxParams, doc="x", default_height_m=1)(lambda i, c: [])
    with pytest.raises(ValueError, match="not a builder family"):
        builder("t_new", family="misc", params=BoxParams, doc="x", default_height_m=1)(lambda i, c: [])

    class NoDefault(Params):
        h: float

    with pytest.raises(TypeError, match="needs a default"):
        builder("t_new", family="equipment", params=NoDefault, doc="x", default_height_m=1)(lambda i, c: [])
    from pydantic import BaseModel

    class Loose(BaseModel):
        h: float = 1.0

    with pytest.raises(TypeError, match="subclass"):
        builder("t_new", family="equipment", params=Loose, doc="x", default_height_m=1)(lambda i, c: [])


def test_a_registered_builder_builds_its_items(registry):
    @builder("t_box", family="equipment", params=BoxParams, doc="A  test\n box.", default_height_m=2.0)
    def build(it, ctx):
        p = BoxParams.model_validate(it.params)
        return [MeshNode("body", "Steel_Structure", box(1, 1, p.h))]

    nodes, flags = build_item(item(type="t_box", params={"h": 4.0}), CTX)
    assert flags == [] and nodes[0].geometry.bounds[1][1] == pytest.approx(4.0)
    assert registry["t_box"].doc == "A test box."
    assert (
        defaulted_params(item(type="t_box")) == ["h"]
        and defaulted_params(item(type="t_box", params={"h": 1})) == []
    )


@pytest.mark.parametrize(
    "result",
    [
        "raise",
        [],
        [MeshNode("body", "Chrome", box(1, 1, 1))],
        [MeshNode("a", "Grating", box(1, 1, 1)), MeshNode("a", "Grating", box(1, 1, 1))],
        [MeshNode("piles", "Grating", Instanced(cyl(0.3, 2), np.stack([np.diag([-1.0, 1, 1, 1])])))],
    ],
)
def test_a_failing_builder_falls_back_to_other_with_a_flag(registry, result):
    @builder("t_bad", family="equipment", params=BoxParams, doc="x", default_height_m=6.0)
    def build(it, ctx):
        if result == "raise":
            raise ZeroDivisionError("boom")
        return result

    nodes, flags = build_item(item(type="t_bad"), CTX)
    assert [f.code for f in flags] == ["builder_fallback"]
    assert "t_bad" in flags[0].note and "boom" not in flags[0].note
    assert nodes[0].name == "body" and nodes[0].material == "Equipment_Grey"
    assert nodes[0].geometry.bounds[1][1] == pytest.approx(6.0)  # the type's default height


def test_params_that_fail_the_schema_fall_back(registry):
    builder("t_box2", family="equipment", params=BoxParams, doc="x", default_height_m=2)(
        lambda it, ctx: [MeshNode("body", "Grating", box(1, 1, 1))]
    )
    for params in ({"h": math.nan}, {"h": "tall"}, {"width": 3}):
        _, flags = build_item(item(type="t_box2", params=params), CTX)
        assert [f.code for f in flags] == ["builder_fallback"], params


def test_unbuilt_and_unknown_types_build_as_other(registry):
    registry.pop("tank_lng", None)  # as before B2 lands
    nodes, flags = build_item(item(type="tank_lng", base_el=104.5, top_el=150.0), CTX)
    assert flags[0].note == "no builder for 'tank_lng' yet"
    assert nodes[0].geometry.bounds[1][1] == pytest.approx(45.5)
    _, flags = build_item(item(type="made_up"), CTX)
    assert flags[0].note == "'made_up' is not a builder type"


@pytest.mark.parametrize(
    "footprint",
    [
        {"kind": "polygon", "pts": [[0, 0], [1, 1], [1, 0], [0, 1]]},
        {"kind": "polygon", "pts": [[0, 0], [5, 0], [10, 0]]},
        {"kind": "line", "pts": [[3, 3], [3, 3]], "width": 1},
    ],
)
def test_other_builds_something_for_any_footprint(footprint):
    """Review Focus 3: a crossing, flat or zero-length footprint never crashes the fallback."""
    nodes, _ = build_item(item(footprint=footprint), CTX)
    mesh = nodes[0].geometry
    assert len(mesh.faces) > 0 and np.isfinite(mesh.vertices).all()


def test_other_extrudes_the_footprint_around_its_reference_point():
    nodes, flags = build_item(item(base_el=100.0, top_el=103.0, params={"material": "Concrete"}), CTX)
    lo, hi = nodes[0].geometry.bounds
    # 8 x 4 m turned 30 degrees: half-extents 4.464 north and 3.732 east, 3 m tall
    assert flags == [] and nodes[0].material == "Concrete"
    assert np.allclose([lo, hi], [[-4.464, 0, -3.732], [4.464, 3, 3.732]], atol=1e-3)


def test_composite_builds_the_items_parts():
    nodes, flags = build_item(item(type="composite", parts=[PART]), CTX)
    assert flags == [] and [n.name for n in nodes] == ["shell"]
    assert nodes[0].material == "Steel_Structure" and nodes[0].extras == {
        "group": "Shell",
        "shape": "cylinder",
    }
    assert np.allclose(nodes[0].geometry.bounds, [[-0.51, 0, -0.51], [0.51, 2, 0.51]], atol=1e-3)
    _, flags = build_item(item(type="composite"), CTX)
    assert [f.code for f in flags] == ["builder_fallback"]


def test_build_item_is_deterministic():
    a, _ = build_item(item(type="composite", parts=[PART]), CTX)
    b, _ = build_item(item(type="composite", parts=[PART]), CTX)
    assert np.array_equal(a[0].geometry.vertices, b[0].geometry.vertices)


def test_ctx_maps_plant_points_and_fills_heights():
    frame = SiteFrame.model_validate(
        {
            "crs": {"epsg": 32639},
            "origin_crs": [0, 0],
            "plant_north_deg": 0,
            "datum": {"label": "HPFS", "el_m": 100.0},
            "source": {"kind": "assumed"},
        }
    )
    ctx = BuildCtx(grid=PlantGrid(frame))
    it = item(footprint={"kind": "circle", "center": [1000, 500], "d": 10})
    assert ctx.local(it, [1003, 1000], [500, 504]).tolist() == [[0, 3], [4, 0]]  # [x north, z east]
    assert ctx.height(it, 5.0) == (100.0, 105.0, True)
    assert ctx.height(item(base_el=104.5, top_el=110.0), 5.0) == (104.5, 110.0, False)
    assert ctx.height(item(base_el=104.5, top_el=104.0), 5.0) == (104.5, 109.5, True)
    assert CTX.height(item(top_el=7.0), 5.0) == (0.0, 7.0, True)


def test_load_all_skips_missing_and_broken_family_modules(monkeypatch, caplog):
    real = base.importlib.import_module

    def fake(name):
        if name.endswith(".structure"):
            raise RuntimeError("broken builder module")
        return real(name)

    monkeypatch.setattr(base, "_loaded", False)
    monkeypatch.setattr(base, "FAMILY_MODULES", ("structure", "not_built_yet"))
    monkeypatch.setattr(base.importlib, "import_module", fake)
    load_all()  # must not raise
    assert base._loaded and "structure failed to import" in caplog.text
    assert "not_built_yet" not in caplog.text


def test_the_catalogue_is_sorted_and_serialisable():
    types = catalogue()
    order = {f: i for i, f in enumerate(base.FAMILY_ORDER)}
    assert types == sorted(types, key=lambda t: (order[t["family"]], t["type"]))
    other = next(t for t in types if t["type"] == "other")
    assert other["params_schema"]["properties"]["material"]["default"] == "Equipment_Grey"
    json.dumps(types)


def test_placing_instances_keeps_them_proper_rotations():
    t = np.stack([place(i, 0, 0, yaw_deg=15 * i) for i in range(5)])
    assert (np.linalg.det(t[:, :3, :3]) > 0).all()


def test_instanced_cylinders_carry_their_transforms():
    inst = instanced_cyl(0.3, 2.0, [place(i * 5.0, 0, 0) for i in range(4)])
    assert isinstance(inst, Instanced) and inst.transforms.shape == (4, 4, 4) and inst.mesh.is_watertight
