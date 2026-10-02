"""Placement in the asset frame (spec §6.2): bearing 0 = +X (plant north), 90 = +Z (plant east)."""

import numpy as np
import pytest

from app.asset_models.placement import PlacementError, bearing_dir, part_transform
from app.asset_models.spec import Part


def P(**kw):
    base = {"name": kw.get("id", "p"), "group": "Other", "material": "steel", "source": {"kind": "assumed"}}
    base.update(kw)
    return Part.model_validate(base)


SHELL = P(id="shell", group="Shell", shape="cylinder", params={"id": 4000, "thickness": 8, "height": 3000})
HEAD = P(
    id="roof",
    group="Head",
    shape="head_torispherical",
    params={"id": 4000, "thickness": 8, "crown_r": 4000, "knuckle_r": 400},
    placement={"origin_mm": [0, 8000, 0]},
)


def apply(T, p):
    return (T @ np.r_[p, 1.0])[:3]


def test_bearings():
    assert bearing_dir(0) == pytest.approx([1, 0, 0])
    assert bearing_dir(90) == pytest.approx([0, 0, 1], abs=1e-12)


def test_free_part_is_translated_and_aimed_along_its_axis():
    p = P(
        id="b",
        shape="box",
        params={"w": 10, "l": 10, "h": 100},
        placement={"origin_mm": [5, 6, 7], "axis": [1, 0, 0]},
    )
    T = part_transform(p, {})
    assert apply(T, [0, 0, 0]) == pytest.approx([5, 6, 7])
    assert apply(T, [0, 100, 0]) == pytest.approx([105, 6, 7])


def test_shell_nozzle_sits_on_the_outer_wall_pointing_out():
    n = P(
        id="N7",
        group="Nozzle",
        shape="nozzle",
        params={"dn": 80, "od": 88.9, "projection": 200, "flange_od": 200, "flange_t": 20},
        placement={"host": "shell", "bearing_deg": 90, "elevation_mm": 1500},
    )
    T = part_transform(n, {"shell": SHELL})
    assert apply(T, [0, 0, 0]) == pytest.approx([0, 1500, 2008], abs=1e-6)
    assert apply(T, [0, 200, 0]) == pytest.approx([0, 1500, 2208], abs=1e-6)


def test_head_nozzle_sits_on_the_head_surface_pointing_up():
    n = P(
        id="N9",
        group="Nozzle",
        shape="nozzle",
        params={"dn": 100, "od": 114.3, "projection": 150, "flange_od": 230, "flange_t": 22},
        placement={"host": "roof", "e_mm": 0, "n_mm": 0},
    )
    T = part_transform(n, {"roof": HEAD})
    base = apply(T, [0, 0, 0])
    assert base == pytest.approx([0, 8000 + 775.1 + 8, 0], abs=1.5)
    assert apply(T, [0, 150, 0])[1] == pytest.approx(base[1] + 150)


def test_unknown_host_and_wrong_host_kind_raise():
    n = P(
        id="N1",
        shape="nozzle",
        params={"dn": 50, "od": 60, "projection": 100, "flange_od": 150, "flange_t": 18},
        placement={"host": "nope", "bearing_deg": 0, "elevation_mm": 100},
    )
    with pytest.raises(PlacementError, match="nope"):
        part_transform(n, {})
    box = P(id="bx", shape="box", params={"w": 1, "l": 1, "h": 1})
    with pytest.raises(PlacementError, match="not a shell"):
        part_transform(
            n.model_copy(update={"placement": n.placement.model_copy(update={"host": "bx"})}), {"bx": box}
        )
