"""The builder registry (spec 2026-10-03-plant-model-generator §6; plan 2026-10-03-plant-model-f0 Task 6).

A builder turns one plant item into mesh nodes in the item-local frame: metres, Y up from base_el,
x = plant north, z = plant east, origin at the footprint's reference point (siteframe.footprint_ref).
Builders are pure (no DB, no I/O) and deterministic, and rotate by their footprint's rot_deg
themselves. `build_item` is the only way the assembler calls one: it validates the params, catches
any failure and builds the item as `other` instead, with a `builder_fallback` flag, so one bad item
never fails a GLB.
"""

from __future__ import annotations

import importlib
import inspect
import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal

import numpy as np
import trimesh
from pydantic import BaseModel, ConfigDict, ValidationError

from app.asset_models.builders.palette import DEFAULT_MATERIAL, PALETTE
from app.asset_models.siteframe import PlantGrid, footprint_ref
from app.asset_models.spec import Item, ItemFlag

log = logging.getLogger(__name__)

Family = Literal["structure", "equipment", "building", "civil", "environment", "fallback"]
FAMILY_ORDER: tuple[str, ...] = ("structure", "equipment", "building", "civil", "environment", "fallback")
FAMILY_MODULES: tuple[str, ...] = ("structure", "equipment", "building", "civil", "environment")
FALLBACK_TYPE = "other"
FALLBACK_HEIGHT_M = 3.0

# The G1 catalogue (spec §6): every type a unit has promised to build, and its family. A type here
# without a registered builder is a validation warning (`builder_missing`) and builds as `other`; a
# type in neither this table nor REGISTRY is an error (`unknown_type`).
PLANNED_TYPES: dict[str, str] = {
    **dict.fromkeys(
        (
            "trestle",
            "jetty_platform",
            "dolphin",
            "pipe_rack",
            "pipe_sleeper",
            "catwalk",
            "walkway",
            "stair_tower",
            "overbridge",
            "platform",
            "gangway",
        ),
        "structure",
    ),
    **dict.fromkeys(
        (
            "tank_lng",
            "vessel_v",
            "vessel_h",
            "storage_tank_small",
            "pump",
            "pump_group",
            "compressor",
            "heater",
            "vaporizer_orv",
            "vaporizer_scv",
            "stack",
            "flare",
            "loading_arm",
            "crane",
            "monitor",
            "generator",
            "transformer",
            "package",
            "nav_aid",
        ),
        "equipment",
    ),
    **dict.fromkeys(("building", "substation", "analyzer_house", "shelter", "gate"), "building"),
    **dict.fromkeys(
        ("road", "paved", "laydown", "parking", "trench", "channel", "basin", "wall", "fence", "revetment"),
        "civil",
    ),
    "other": "fallback",
    "composite": "fallback",
}


class Params(BaseModel):
    """The base of every builder's params model: unknown keys and NaN or infinity are errors, and
    every field must have a default (the builder checks this when it registers)."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


@dataclass(frozen=True)
class Instanced:
    """One mesh drawn at each of `transforms` ((N, 4, 4), item-local metres): EXT_mesh_gpu_instancing."""

    mesh: trimesh.Trimesh
    transforms: np.ndarray


@dataclass
class MeshNode:
    name: str
    material: str  # a palette.PALETTE name
    geometry: trimesh.Trimesh | Instanced
    extras: dict = field(default_factory=dict)


@dataclass(frozen=True)
class BuildCtx:
    grid: PlantGrid | None
    lod: float = 1.0  # 1 = full detail; builders scale segment counts and instance density by it

    def local(self, item: Item, e, n) -> np.ndarray:
        """Plant [E, N] -> item-local [x, z] metres (x north, z east), origin at footprint_ref."""
        re, rn = footprint_ref(item.footprint)
        e, n = np.asarray(e, dtype=np.float64), np.asarray(n, dtype=np.float64)
        return np.stack([n - rn, e - re], axis=-1)

    def height(self, item: Item, default_m: float) -> tuple[float, float, bool]:
        """(base_el, top_el, defaulted). A missing base_el is the datum (grade), 0 without a grid; a
        missing top_el, or one not above the base, is base + default_m. defaulted is True when either
        was filled in."""
        grade = float(self.grid.frame.datum.el_m) if self.grid is not None else 0.0
        base = float(item.base_el) if item.base_el is not None else grade
        if item.top_el is not None and item.top_el > base:
            return base, float(item.top_el), item.base_el is None
        return base, base + float(default_m), True


@dataclass(frozen=True)
class BuilderDef:
    type: str
    family: str
    params: type[BaseModel]
    fn: Callable[[Item, BuildCtx], list[MeshNode]]
    doc: str
    default_height_m: float


REGISTRY: dict[str, BuilderDef] = {}


def builder(
    type: str, *, family: str, params: type[BaseModel], doc: str, default_height_m: float
) -> Callable:  # noqa: A002
    """Register `fn` as the builder of `type`. Refuses a second builder for a type, a family that is
    not one of FAMILY_ORDER, a planned type in another family, and params that are not a `Params`
    with a default for every field."""

    def register(fn: Callable[[Item, BuildCtx], list[MeshNode]]):
        if type in REGISTRY:
            raise ValueError(f"the builder for {type!r} is registered twice")
        if family not in FAMILY_ORDER:
            raise ValueError(f"{family!r} is not a builder family")
        planned = PLANNED_TYPES.get(type)
        if planned is not None and planned != family:
            raise ValueError(f"{type!r} belongs to the {planned} family")
        if not (inspect.isclass(params) and issubclass(params, Params)):
            raise TypeError("builder params must subclass builders.base.Params")
        try:
            params()
        except ValidationError:
            raise TypeError(f"every param of {type!r} needs a default") from None
        if not default_height_m > 0:
            raise ValueError("default_height_m must be positive")
        REGISTRY[type] = BuilderDef(type, family, params, fn, " ".join(doc.split()), float(default_height_m))
        return fn

    return register


def typed_params(item: Item) -> BaseModel:
    """The item's params validated by its builder's model (KeyError for a type with no builder)."""
    return REGISTRY[item.type].params.model_validate(item.params)


def defaulted_params(item: Item) -> list[str]:
    """The params the item left to their defaults (the CSV `notes` records them, spec §6)."""
    d = REGISTRY.get(item.type)
    return [] if d is None else sorted(set(d.params.model_fields) - set(item.params))


def _check(nodes) -> None:
    if not isinstance(nodes, list) or not nodes:
        raise ValueError("a builder returned no nodes")
    names = set()
    for node in nodes:
        if not isinstance(node, MeshNode) or not node.name or node.name in names:
            raise ValueError("every node needs its own name")
        names.add(node.name)
        if node.material not in PALETTE:
            raise ValueError("a node names a material outside the palette")
        geom = node.geometry
        mesh = geom.mesh if isinstance(geom, Instanced) else geom
        if (
            not isinstance(mesh, trimesh.Trimesh)
            or len(mesh.faces) == 0
            or not np.isfinite(mesh.vertices).all()
        ):
            raise ValueError("a node has an empty or non-finite mesh")
        if isinstance(geom, Instanced):
            t = np.asarray(geom.transforms)
            if t.ndim != 3 or t.shape[1:] != (4, 4) or len(t) == 0 or not np.isfinite(t).all():
                raise ValueError("instancing needs (N, 4, 4) finite transforms")
            if (np.linalg.det(t[:, :3, :3]) <= 1e-12).any():
                raise ValueError("an instance transform is mirrored or flat")


def _fallback(item: Item, ctx: BuildCtx) -> list[MeshNode]:
    from app.asset_models.builders.fallback import footprint_body, last_resort

    d = REGISTRY.get(item.type)
    height = d.default_height_m if d is not None else FALLBACK_HEIGHT_M
    try:
        nodes = footprint_body(item, ctx, material=DEFAULT_MATERIAL, default_height_m=height)
        _check(nodes)
        return nodes
    except Exception:
        return last_resort(item, ctx)


def build_item(item: Item, ctx: BuildCtx) -> tuple[list[MeshNode], list[ItemFlag]]:
    """The item's nodes, and the flags building it raised: [] or one `builder_fallback`. Never raises."""
    load_all()
    d = REGISTRY.get(item.type)
    if d is None:
        reason = (
            f"no builder for {item.type!r} yet"
            if item.type in PLANNED_TYPES
            else f"{item.type!r} is not a builder type"
        )
    else:
        try:
            d.params.model_validate(item.params)
            nodes = d.fn(item, ctx)
            _check(nodes)
            return nodes, []
        except Exception as exc:  # one bad item never fails the GLB (spec §6)
            reason = f"the {item.type} builder failed ({type(exc).__name__})"
            log.info("builder %s fell back to %s (%s)", item.type, FALLBACK_TYPE, type(exc).__name__)
    return _fallback(item, ctx), [ItemFlag(code="builder_fallback", note=reason[:300])]


_load_lock = threading.Lock()
_loaded = False


def load_all() -> None:
    """Import the fallback builders and every family module that exists. A family module that is not
    there yet is skipped silently; one that fails to import is logged and skipped (the app must start)."""
    global _loaded
    if _loaded:
        return
    with _load_lock:
        if _loaded:
            return
        importlib.import_module("app.asset_models.builders.fallback")
        for name in FAMILY_MODULES:
            module = f"app.asset_models.builders.{name}"
            try:
                importlib.import_module(module)
            except ModuleNotFoundError as exc:
                if exc.name != module:
                    log.exception("builder module %s failed to import; its types build as other", name)
            except Exception:
                log.exception("builder module %s failed to import; its types build as other", name)
        _loaded = True


def catalogue() -> list[dict]:
    """[{type, family, doc, default_height_m, params_schema}] of every registered builder, by family
    (FAMILY_ORDER) then type. The item editor and the agent's tool descriptions read it."""
    load_all()
    order = {f: i for i, f in enumerate(FAMILY_ORDER)}
    return [
        {
            "type": d.type,
            "family": d.family,
            "doc": d.doc,
            "default_height_m": d.default_height_m,
            "params_schema": d.params.model_json_schema(),
        }
        for d in sorted(REGISTRY.values(), key=lambda d: (order[d.family], d.type))
    ]
