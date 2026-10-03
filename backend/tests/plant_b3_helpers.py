"""Shared helpers for the B3 builder tests (building, civil, environment)."""

from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image

from app.asset_models.builders.base import BuildCtx, Instanced, MeshNode, build_item, load_all
from app.asset_models.raster import View, render
from app.asset_models.spec import Item

load_all()
DATA = Path(__file__).parent / "data" / "plant"
GOLDEN = DATA / "golden" / "b3"
COWORK = DATA / "cowork_nodes" / "b3_nodes.json"
REGEN = os.environ.get("KESTREL_REGEN_GOLDEN") == "1"
CTX = BuildCtx(grid=None)
# raster.render colours by M1 part group; map our materials onto distinct ones for the goldens
MAT_GROUP = {
    "Glass": "Nozzle",
    "Building_Roof": "Head",
    "Shelter_Roof": "Head",
    "Steel_Dark": "Lining",
    "Steel_Structure": "Support",
    "Fence": "Access",
    "Grating": "Access",
    "Water_Pit": "Internal",
    "Concrete_Dark": "Bottom",
    "Paving": "Manway",
}


def make_item(
    type_: str,
    footprint: dict,
    *,
    base_el: float = 100.0,
    top_el: float | None = None,
    params: dict | None = None,
    id_: str = "it-1",
) -> Item:
    return Item.model_validate(
        {
            "id": id_,
            "name": id_,
            "type": type_,
            "footprint": footprint,
            "base_el": base_el,
            "top_el": top_el,
            "params": params or {},
            "source": {"kind": "assumed"},
        }
    )


def build_ok(item: Item, ctx: BuildCtx = CTX) -> list[MeshNode]:
    """Build through the registry and insist the builder itself succeeded (no fallback)."""
    nodes, flags = build_item(item, ctx)
    assert not [f for f in flags if f.code == "builder_fallback"], flags
    assert nodes
    return nodes


def by_name(nodes: list[MeshNode]) -> dict[str, MeshNode]:
    return {n.name: n for n in nodes}


def tri_count(nodes: list[MeshNode]) -> int:
    total = 0
    for n in nodes:
        g = n.geometry
        total += len(g.mesh.faces) * len(g.transforms) if isinstance(g, Instanced) else len(g.faces)
    return total


def expand(nodes: list[MeshNode]) -> dict[str, trimesh.Trimesh]:
    out = {}
    for n in nodes:
        g = n.geometry
        if isinstance(g, Instanced):
            out[n.name] = trimesh.util.concatenate([g.mesh.copy().apply_transform(t) for t in g.transforms])
        else:
            out[n.name] = g
    return out


def bounds(nodes: list[MeshNode]) -> np.ndarray:
    b = np.array([m.bounds for m in expand(nodes).values()])
    return np.array([b[:, 0].min(axis=0), b[:, 1].max(axis=0)])


def materials(nodes: list[MeshNode]) -> set[str]:
    return {n.material for n in nodes}


def same_geometry(a: list[MeshNode], b: list[MeshNode]) -> bool:
    if [(n.name, n.material) for n in a] != [(n.name, n.material) for n in b]:
        return False
    for x, y in zip(a, b, strict=True):
        gx, gy = x.geometry, y.geometry
        if isinstance(gx, Instanced):
            if not (
                np.array_equal(gx.transforms, gy.transforms)
                and np.array_equal(gx.mesh.vertices, gy.mesh.vertices)
            ):
                return False
        elif not (np.array_equal(gx.vertices, gy.vertices) and np.array_equal(gx.faces, gy.faces)):
            return False
    return True


def assert_golden(nodes: list[MeshNode], name: str, view: str = "iso") -> None:
    """Render with the M1 rasterizer and compare with the committed PNG (KESTREL_REGEN_GOLDEN=1 rewrites)."""
    groups = {n.name: MAT_GROUP.get(n.material, "Shell") for n in nodes}
    img = render(expand(nodes), View(view), size=256, groups=groups)
    path = GOLDEN / f"{name}_{view}.png"
    if REGEN:
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path)
    assert path.exists(), f"missing golden {path.name}; run with KESTREL_REGEN_GOLDEN=1 and look at it"
    golden = np.asarray(Image.open(path).convert("RGB"), dtype=np.int16)
    diff = np.abs(np.asarray(img, dtype=np.int16) - golden)
    assert (diff > 40).mean() < 0.01  # under 1 % of pixels differ visibly


def cowork() -> dict:
    return json.loads(COWORK.read_text())


def cowork_item(node: dict) -> Item:
    return make_item(
        node["type"], node["footprint"], base_el=node["base_el"], top_el=node["top_el"], id_=node["id"]
    )
