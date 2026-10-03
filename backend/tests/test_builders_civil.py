"""Civil builders (plant model spec 2026-10-03 §6, unit B3): road, paved, laydown, parking, trench,
channel, basin, wall, fence, revetment, and the B3 footprint helpers in `builders/civil.py`."""

from __future__ import annotations

import numpy as np
import pytest
from plant_b3_helpers import CTX, make_item

from app.asset_models.builders.palette import PALETTE
from app.asset_models.siteframe import footprint_polygon, footprint_ref

E0, N0 = 500.0, 300.0
RECT = {"kind": "rect", "center": [E0, N0], "size": [20.0, 10.0], "rot_deg": 0}  # 20 along north
L_POLY = {
    "kind": "polygon",
    "pts": [
        [E0, N0],
        [E0 + 30, N0],
        [E0 + 30, N0 + 10],
        [E0 + 10, N0 + 10],
        [E0 + 10, N0 + 25],
        [E0, N0 + 25],
    ],
}  # concave, area 450
ROAD = {"kind": "line", "pts": [[E0, N0], [E0 + 100, N0], [E0 + 100, N0 + 50]], "width": 8.0}
FENCE_30 = {"kind": "line", "pts": [[E0, N0], [E0 + 30, N0]], "width": 0.1}
FENCE_RING = {
    "kind": "line",
    "pts": [[E0, N0], [E0 + 10, N0], [E0 + 10, N0 + 20], [E0, N0 + 20], [E0, N0]],
    "width": 0.1,
}
CIVIL = ["road", "paved", "laydown", "parking", "trench", "channel", "basin", "wall", "fence", "revetment"]
B3_MATERIALS = {
    "Concrete",
    "Concrete_Dark",
    "Steel_Structure",
    "Steel_Dark",
    "Grating",
    "Building_Wall",
    "Building_Roof",
    "Shelter_Roof",
    "Glass",
    "Ground",
    "Asphalt",
    "Paving",
    "Laydown",
    "Rock_Armour",
    "Slope",
    "Water_Pit",
    "Sea",
    "Fence",
}
SAMPLE = {  # one representative item per civil type, for determinism and goldens
    "road": (ROAD, None, {"markings": True}),
    "paved": (L_POLY, None, {}),
    "laydown": (RECT, None, {}),
    "parking": ({"kind": "rect", "center": [E0, N0], "size": [60.0, 5.5], "rot_deg": 0}, None, {}),
    "trench": (
        {"kind": "line", "pts": [[E0, N0], [E0 + 20, N0], [E0 + 20, N0 + 10]], "width": 1.2},
        101.0,
        {},
    ),
    "channel": (
        {"kind": "line", "pts": [[E0, N0], [E0 + 10, N0], [E0 + 10, N0 - 18]], "width": 1.9},
        102.0,
        {},
    ),
    "basin": (L_POLY, 103.0, {}),
    "wall": ({"kind": "line", "pts": [[E0, N0], [E0 + 40, N0], [E0 + 40, N0 + 30]], "width": 0.7}, 103.0, {}),
    "fence": (FENCE_RING, 102.5, {}),
    "revetment": (
        {
            "kind": "polygon",
            "pts": [
                [E0, N0],
                [E0 + 80, N0],
                [E0 + 120, N0 + 20],
                [E0 + 120, N0 + 26],
                [E0 + 78, N0 + 6],
                [E0, N0 + 6],
            ],
        },
        None,
        {},
    ),
}


def sample(type_: str):
    fp, top, params = SAMPLE[type_]
    return make_item(type_, fp, top_el=top, params=params)


# ------------------------------------------------------------------ F0 interfaces B3 relies on
def test_f0_interfaces_b3_relies_on():
    item = make_item("paved", RECT)
    e, n = footprint_ref(item.footprint)
    assert (e, n) == pytest.approx((E0, N0))
    loc = np.asarray(CTX.local(item, np.array([E0 + 1.0]), np.array([N0 + 2.0]))).reshape(-1, 2)
    assert loc[0] == pytest.approx([2.0, 1.0])  # x = north, z = east
    ring = np.asarray(footprint_polygon(item.footprint))
    assert ring.shape == (4, 2)
    base, top, defaulted = CTX.height(make_item("wall", RECT, top_el=None), 3.0)
    assert (base, top, defaulted) == (100.0, 103.0, True)
    assert B3_MATERIALS <= set(PALETTE)
