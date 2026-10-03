# backend/app/asset_models/agent/guide.py
"""A compact field guide for `upsert_parts`, generated from the spec models so it cannot drift."""

from __future__ import annotations

from typing import get_args

from app.asset_models.spec import SHAPE_PARAMS, Group, Material, Part, Placement, Source


def _fields(model, skip=()) -> str:
    """`name` for required fields, `name?` for optional ones, in declaration order."""
    return ", ".join(
        n if f.is_required() else f"{n}?" for n, f in model.model_fields.items() if n not in skip
    )


def build_guide() -> str:
    shapes = "; ".join(f"{shape}: {_fields(model)}" for shape, model in SHAPE_PARAMS.items())
    return (
        f"Part fields ('?' = optional): {_fields(Part)}. "
        f"group is one of {'|'.join(get_args(Group))}; material one of {'|'.join(get_args(Material))}. "
        f"placement fields: {_fields(Placement)} (host is a part id; mount by bearing_deg + elevation_mm on "
        f"a shell, or e_mm + n_mm on a head or plate; free parts use origin_mm + axis). "
        f"source fields: {_fields(Source)} (kind is drawing|cloud|photo|assumed; region is page fractions "
        f"[x0,y0,x1,y1]). "
        f"params per shape, lengths in mm, angles in degrees, unknown names are rejected: {shapes}. "
        f"In params, id means inner diameter, d outer diameter, w/l/h width/length/height; "
        f"points_mm, path_mm are [x,y,z] lists; profile_mm, outline_mm are [x,y] lists."
    )


GUIDE = build_guide()
