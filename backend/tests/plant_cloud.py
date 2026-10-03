# backend/tests/plant_cloud.py
"""Synthetic plant clouds for the cloud check (C1): flat ground, tanks and boxes, built in plant
metres and handed over in site CRS. Ground is cloud z -20; plant EL = cloud z + 124.5."""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from app.asset_models.siteframe import PlantGrid
from app.asset_models.spec import Item, SiteFrame

if TYPE_CHECKING:
    from app.asset_models.cloudcheck import PlantSample

GROUND_Z = -20.0
EL_OFFSET = 124.5
GROUND_EL = GROUND_Z + EL_OFFSET  # 104.5
FRAME = {
    "crs": {"epsg": 32639},
    "origin_crs": [244338.089, 3179515.690],
    "plant_north_deg": 17.9991,
    "datum": {"label": "HPFS", "el_m": 100.0},
    "source": {"kind": "assumed"},
}
EXTENT = (1290.0, 500.0, 1420.0, 610.0)  # plant E0, N0, E1, N1 of the synthetic ground


def grid(frame: dict = FRAME) -> PlantGrid:
    return PlantGrid(SiteFrame.model_validate(frame))


def ground(e0, n0, e1, n1, *, step=0.5, z=GROUND_Z, holes=()) -> np.ndarray:
    """A flat ground grid (1 cm noise). `holes`: circles (e, n, r) and boxes (e0, n0, e1, n1) left
    empty, because a scanner never sees the ground under a tank."""
    e, n = np.meshgrid(np.arange(e0, e1, step) + step / 4, np.arange(n0, n1, step) + step / 4)
    e, n = e.ravel(), n.ravel()
    keep = np.ones(len(e), bool)
    for hole in holes:
        if len(hole) == 3:
            keep &= np.hypot(e - hole[0], n - hole[1]) > hole[2]
        else:
            keep &= ~((e >= hole[0]) & (e <= hole[2]) & (n >= hole[1]) & (n <= hole[3]))
    rng = np.random.default_rng(1)
    return np.column_stack([e[keep], n[keep], z + rng.normal(0, 0.01, int(keep.sum()))])


def tank(ce, cn, d, height, *, step=0.5, z0=GROUND_Z) -> np.ndarray:
    """A flat-roofed vertical cylinder: roof disc plus wall rings."""
    r = d / 2
    e, n = np.meshgrid(np.arange(ce - r, ce + r, step), np.arange(cn - r, cn + r, step))
    e, n = e.ravel(), n.ravel()
    inside = np.hypot(e - ce, n - cn) <= r - 0.1
    roof = np.column_stack([e[inside], n[inside], np.full(int(inside.sum()), z0 + height)])
    k = int(2 * np.pi * r / step)
    a, zz = np.meshgrid(np.arange(k) * 2 * np.pi / k, np.arange(z0 + step, z0 + height, step))
    wall = np.column_stack(
        [ce + (r - 0.05) * np.cos(a).ravel(), cn + (r - 0.05) * np.sin(a).ravel(), zz.ravel()]
    )
    return np.vstack([roof, wall])


def box(e0, n0, e1, n1, height, *, step=0.5, z0=GROUND_Z) -> np.ndarray:
    """The top surface of a box (what an aerial scan mostly sees)."""
    e, n = np.meshgrid(np.arange(e0, e1, step) + step / 4, np.arange(n0, n1, step) + step / 4)
    return np.column_stack([e.ravel(), n.ravel(), np.full(e.size, z0 + height)])


def item(id_, type_, footprint, *, base=None, top=None, source="indicative", tag=None) -> Item:
    return Item.model_validate(
        {
            "id": id_,
            "tag": tag,
            "name": id_,
            "type": type_,
            "footprint": footprint,
            "base_el": base,
            "top_el": top,
            "height_source": source,
            "source": {"kind": "assumed"},
        }
    )


def circle(e, n, d) -> dict:
    return {"kind": "circle", "center": [e, n], "d": d}


def rect(e, n, along, across, rot=0.0) -> dict:
    return {"kind": "rect", "center": [e, n], "size": [along, across], "rot_deg": rot}


def standard_scene() -> tuple[np.ndarray, list[Item]]:
    """Known tanks, a missing item, an offset item and one unregistered cluster (spec §13, C1)."""
    holes = [
        (1320.0, 540.0, 10.0),
        (1360.0, 540.0, 10.0),
        (1400.0, 580.0, 10.0),
        (1359.0, 574.0, 1367.0, 586.0),
        (1397.0, 517.0, 1403.0, 523.0),
        (1404.0, 599.0, 1406.0, 601.0),
    ]
    pts = np.vstack(
        [
            ground(*EXTENT, holes=holes),
            tank(1320, 540, 20, 30),  # tank-a: drawing heights that match (top EL 134.5)
            tank(1360, 540, 20, 25),  # tank-b: indicative; the cloud gives top EL 129.5
            tank(1400, 580, 20, 27.5),  # tank-c: drawing top EL 134.5, cloud 132.0
            box(1359, 574, 1367, 586, 4),  # pkg-offset: built 3 m east of where it is drawn
            box(1397, 517, 1403, 523, 5),  # an unregistered 6 x 6 m cluster, top EL 109.5
            box(1404, 599, 1406, 601, 3),  # 2 x 2 m: too small to be a candidate
        ]
    )
    items = [
        item(
            "tank-a",
            "tank_lng",
            circle(1320, 540, 20),
            base=GROUND_EL,
            top=134.5,
            source="drawing",
            tag="T-1",
        ),
        item("tank-b", "tank_lng", circle(1360, 540, 20), tag="T-2"),
        item(
            "tank-c",
            "tank_lng",
            circle(1400, 580, 20),
            base=GROUND_EL,
            top=134.5,
            source="drawing",
            tag="T-3",
        ),
        item("pad-missing", "package", rect(1320, 585, 10, 10)),
        item("pkg-offset", "package", rect(1360, 580, 12, 8), base=GROUND_EL, top=108.5, source="drawing"),
    ]
    return pts, items


def to_site(g: PlantGrid, pts: np.ndarray) -> np.ndarray:
    x, y = g.plant_to_site(pts[:, 0], pts[:, 1])
    return np.column_stack([x, y, pts[:, 2]])


def to_sample(
    g: PlantGrid, pts: np.ndarray, *, epsg: int | None = 32639, wkt=None, cloud_id="c1"
) -> PlantSample:
    from app.asset_models.cloudcheck import PlantSample

    site = to_site(g, pts)
    lo = site[:, :2].min(axis=0) - 1.0
    hi = site[:, :2].max(axis=0) + 1.0
    xyz = np.column_stack([site[:, 0] - lo[0], site[:, 1] - lo[1], site[:, 2]]).astype(np.float32)
    return PlantSample(
        xyz=xyz,
        cloud_id=cloud_id,
        crs_epsg=epsg,
        bbox=(float(lo[0]), float(lo[1]), float(hi[0]), float(hi[1])),
        crs_wkt=wkt,
        origin=(float(lo[0]), float(lo[1])),
        total=len(xyz),
    )
