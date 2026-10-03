"""The fallback family (spec 2026-10-03-plant-model-generator §6; plan F0 Task 6).

- `other` extrudes the footprint from base_el to top_el. It is also what `build_item` builds when an
  item's own builder fails, so `footprint_body` must build something for any footprint: a crossing
  outline is mended, a flat one becomes its convex hull, and nothing at all becomes a 1 m box.
- `composite` is made only of the item's M1 parts (item-local millimetres, built by M1's code).
"""

from __future__ import annotations

import numpy as np
from pydantic import field_validator
from shapely.geometry import MultiPoint, Polygon

from app.asset_models.builders.base import BuildCtx, MeshNode, Params, builder
from app.asset_models.builders.geom import box, extrude
from app.asset_models.builders.palette import DEFAULT_MATERIAL, M1_MATERIAL, PALETTE
from app.asset_models.siteframe import footprint_polygon
from app.asset_models.spec import AssetSpec, Item

MIN_AREA_M2 = 1e-4
MIN_HEIGHT_M = 0.1
OTHER_HEIGHT_M = 3.0


def _solid_outline(ring: np.ndarray) -> np.ndarray | None:
    """A buildable [x, z] outline for `ring`, or None when there is no area to build."""
    if len(ring) < 3 or not np.isfinite(ring).all():
        return None
    poly = Polygon(ring)
    if not poly.is_valid:
        poly = poly.buffer(0)  # a crossing outline: its largest piece
        if poly.geom_type == "MultiPolygon":
            poly = max(poly.geoms, key=lambda g: g.area)
    if poly.is_empty or poly.geom_type != "Polygon" or poly.area < MIN_AREA_M2:
        poly = MultiPoint([tuple(p) for p in ring]).convex_hull
    if poly.geom_type != "Polygon" or poly.area < MIN_AREA_M2:
        return None
    return np.asarray(poly.exterior.coords)[:-1]


def footprint_body(
    item: Item, ctx: BuildCtx, *, material: str = DEFAULT_MATERIAL, default_height_m: float = OTHER_HEIGHT_M
) -> list[MeshNode]:
    """The footprint extruded from base_el to top_el (default_height_m when top_el is missing)."""
    base, top, _ = ctx.height(item, default_m=default_height_m)
    h = max(top - base, MIN_HEIGHT_M)
    try:
        ring = ctx.local(item, *footprint_polygon(item.footprint).T)
    except ValueError:
        ring = np.empty((0, 2))
    outline = _solid_outline(ring)
    mesh = extrude(outline, h) if outline is not None else box(1.0, 1.0, h)
    return [MeshNode(name="body", material=material, geometry=mesh)]


def last_resort(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    """A 1 m box at the item's reference point: what an item becomes when even `other` fails."""
    try:
        base, top, _ = ctx.height(item, default_m=OTHER_HEIGHT_M)
        h = max(top - base, MIN_HEIGHT_M)
    except Exception:
        h = OTHER_HEIGHT_M
    return [MeshNode(name="body", material=DEFAULT_MATERIAL, geometry=box(1.0, 1.0, h))]


class OtherParams(Params):
    material: str = DEFAULT_MATERIAL

    @field_validator("material")
    @classmethod
    def _palette_name(cls, v: str) -> str:
        if v not in PALETTE:
            raise ValueError("material must be a palette name")
        return v


@builder(
    "other",
    family="fallback",
    params=OtherParams,
    doc="Anything without its own type: the footprint extruded from base_el to top_el, in one material.",
    default_height_m=OTHER_HEIGHT_M,
)
def build_other(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    p = OtherParams.model_validate(item.params)
    return footprint_body(item, ctx, material=p.material, default_height_m=OTHER_HEIGHT_M)


class CompositeParams(Params):
    pass


@builder(
    "composite",
    family="fallback",
    params=CompositeParams,
    doc=(
        "An item made only of its M1 parts (millimetres; item-local: origin at the footprint's"
        " reference point at base_el, Y up, X plant north, Z plant east). Use it when a detailed"
        " drawing shows the item."
    ),
    default_height_m=1.0,
)
def build_composite(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    from app.asset_models.build import build_meshes  # M1; raises SpecInvalid on a bad part

    if not item.parts:
        raise ValueError("a composite item needs parts")
    meshes = build_meshes(AssetSpec(parts=item.parts))
    return [
        MeshNode(
            name=p.id,
            material=M1_MATERIAL[p.material],
            geometry=meshes[p.id],
            extras={"group": p.group, "shape": p.shape},
        )
        for p in item.parts
    ]
