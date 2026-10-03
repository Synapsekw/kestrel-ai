# backend/app/asset_models/assemble.py
"""Plant spec -> GLB + register CSV + `asset_item` index (spec 2026-10-03-plant-model-generator §7,
plan 2026-10-03-plant-model-a1).

Node tree: root (site extras) -> area groups -> one node per item (extras = its register row) -> the
builder's child nodes; `environment` and the M1 top-level parts hang off the root. Scene frame (D9):
metres, x = plant N, y = EL - datum, z = plant E. Item nodes sit at the footprint reference point at
base EL; builders draw in that item-local frame.
"""

from __future__ import annotations

import csv
import json
import math
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import trimesh
from sqlalchemy import delete, insert
from sqlalchemy.orm import Session

from app.asset_models.builders import geom
from app.asset_models.builders.base import REGISTRY, BuildCtx, Instanced, MeshNode, build_item, load_all
from app.asset_models.builders.palette import BLEND, DEFAULT_MATERIAL, DOUBLE_SIDED, M1_MATERIAL, PALETTE
from app.asset_models.glbwriter import GlbWriter
from app.asset_models.placement import part_transform
from app.asset_models.shapes import build_shape
from app.asset_models.siteframe import GridError, PlantGrid, footprint_ref
from app.asset_models.spec import AssetSpec, EnvFeature, Item, ItemFlag, PolygonFootprint
from app.db.models import AssetItem

CSV_COLUMNS = [
    "node", "tag", "name", "type", "area", "group", "plant_E", "plant_N", "utm39_E", "utm39_N", "base_EL",
    "height_m", "top_EL", "height_source", "has_geometry", "source_sheet", "notes", "flags", "confidence",
]  # fmt: skip
UTM39_EPSG = 32639
UNASSIGNED_GROUP = "Area_unassigned"
_FORMULA_START = ("=", "+", "@")
_TEXT_COLUMNS = frozenset({"node", "tag", "name", "type", "area", "group", "source_sheet", "notes"})


def grid_of(spec: AssetSpec) -> PlantGrid | None:
    return PlantGrid(spec.site) if spec.site is not None else None


def site_label(spec: AssetSpec) -> str:
    return "utm39" if spec.site is not None and spec.site.crs.epsg == UTM39_EPSG else "site"


def group_name(area: str | None) -> str:
    if not area:
        return UNASSIGNED_GROUP
    return area if area.startswith("Area_") else f"Area_{area}"


def default_height(type_: str) -> float:
    found = REGISTRY.get(type_) or REGISTRY["other"]
    return float(found.default_height_m)


def item_ref(item: Item) -> tuple[float, float]:
    """The footprint reference point in plant (E, N); finite even for a degenerate footprint."""
    try:
        e, n = footprint_ref(item.footprint)
        if math.isfinite(e) and math.isfinite(n):
            return float(e), float(n)
    except Exception:
        pass
    fp = item.footprint
    pts = np.asarray(fp.pts if hasattr(fp, "pts") else [fp.center], dtype=float)
    return float(pts[:, 0].mean()), float(pts[:, 1].mean())


def _r(value, digits: int) -> float | None:
    if value is None:
        return None
    value = float(value)
    return round(value, digits) if math.isfinite(value) else None


def _flags(item: Item, extra: list[ItemFlag] | None) -> list[dict]:
    out = [f.model_dump(mode="json") for f in item.flags]
    seen = {f["code"] for f in out}
    for flag in extra or ():
        if flag.code not in seen:
            out.append(flag.model_dump(mode="json"))
            seen.add(flag.code)
    return out


def _sheet(item: Item, names: dict[str, str] | None) -> str | None:
    src = item.source
    if src.kind != "drawing" or not src.id:
        return None
    return (names or {}).get(src.id, src.id)


def register_rows(
    spec: AssetSpec,
    sheet_names: dict[str, str] | None = None,
    *,
    extra_flags: dict[str, list[ItemFlag]] | None = None,
    markers: set[str] | None = None,
    defaults: dict[str, list[str]] | None = None,
) -> list[dict]:
    """One register row per item, in spec order: CSV_COLUMNS (typed), then `lon`, `lat`."""
    if not spec.items:
        return []
    load_all()
    grid = grid_of(spec)
    ctx = BuildCtx(grid=grid)
    refs = np.array([item_ref(i) for i in spec.items], dtype=float)
    sx = sy = lon = lat = None
    if grid is not None:
        sx, sy = grid.plant_to_site(refs[:, 0], refs[:, 1])
        try:
            lon, lat = grid.site_to_lonlat(sx, sy)
        except GridError:
            lon = lat = None
    rows = []
    for k, item in enumerate(spec.items):
        base, top, defaulted = ctx.height(item, default_height(item.type))
        names = [n for n in (defaults or {}).get(item.id, ()) if n != "height"]
        notes = (
            "; ".join(
                x
                for x in (
                    item.notes,
                    f"Height assumed {top - base:g} m (type default)." if defaulted else None,
                    f"Defaults: {', '.join(names)}." if names else None,
                )
                if x
            )
            or None
        )
        rows.append(
            {
                "node": item.id,
                "tag": item.tag,
                "name": item.name,
                "type": item.type,
                "area": item.area,
                "group": group_name(item.area),
                "plant_E": _r(refs[k, 0], 2),
                "plant_N": _r(refs[k, 1], 2),
                "utm39_E": _r(sx[k], 2) if sx is not None else None,
                "utm39_N": _r(sy[k], 2) if sy is not None else None,
                "base_EL": _r(base, 3),
                "height_m": _r(top - base, 3),
                "top_EL": _r(top, 3),
                "height_source": "indicative" if defaulted else item.height_source,
                "has_geometry": item.id not in (markers or ()),
                "source_sheet": _sheet(item, sheet_names),
                "notes": notes,
                "flags": _flags(item, (extra_flags or {}).get(item.id)),
                "confidence": item.confidence,
                "lon": _r(lon[k], 8) if lon is not None else None,
                "lat": _r(lat[k], 8) if lat is not None else None,
            }
        )
    return rows


def _cell(column: str, value) -> str:
    if value is None:
        return ""
    if column == "has_geometry":
        return "yes" if value else "no"
    if column == "flags":
        return ";".join(f["code"] for f in value)
    if isinstance(value, float):
        return repr(value)
    text = str(value)
    if column in _TEXT_COLUMNS and text.startswith(_FORMULA_START):
        return "'" + text  # never hand Excel a formula read off a drawing
    return text


def write_csv(rows: list[dict], path: Path, *, site_label: str = "utm39") -> None:
    """Cowork's column order; UTF-8 without BOM and CRLF line ends, like Cowork's register."""
    header = [f"{site_label}_{c[6:]}" if c.startswith("utm39_") else c for c in CSV_COLUMNS]
    with open(path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        for row in rows:
            writer.writerow([_cell(c, row.get(c)) for c in CSV_COLUMNS])


MM = 0.001
FALLBACK_MATERIAL = "Equipment_Grey"
MARKER_MATERIAL = "Safety_Red"
ENV_GROUP = "environment"
ENV_SLAB_M = 0.2
ENV_MATERIAL = {
    "land": "Ground",
    "sea": "Sea",
    "road": "Asphalt",
    "paved": "Paving",
    "laydown": "Laydown",
    "slope": "Slope",
    "revetment": "Rock_Armour",
}
MAX_META_IDS = 200
PROGRESS_EVERY = 25


class AssembleError(Exception):
    """A spec the assembler cannot turn into one consistent model (duplicate item ids)."""


@dataclass
class Assembly:
    glb: bytes
    meta: dict
    rows: list[dict]


def palette_materials() -> tuple[list[dict], dict[str, int]]:
    """All 34 palette materials in PALETTE order, so a material's index never depends on the spec."""
    mats: list[dict] = []
    index: dict[str, int] = {}
    for name, (rgba, metallic, roughness) in PALETTE.items():
        mat = {
            "name": name,
            "pbrMetallicRoughness": {
                "baseColorFactor": [round(float(c), 4) for c in rgba],
                "metallicFactor": float(metallic),
                "roughnessFactor": float(roughness),
            },
        }
        if name in DOUBLE_SIDED:
            mat["doubleSided"] = True
        if name in BLEND:
            mat["alphaMode"] = "BLEND"
        index[name] = len(mats)
        mats.append(mat)
    return mats, index


def site_extras(spec: AssetSpec) -> dict:
    site = spec.site
    if site is None:
        return {"crs": None, "frame": "glTF Y-up, metres. x = plant N, y = EL, z = plant E"}
    ox, oy = site.origin_crs
    th = site.plant_north_deg
    return {
        "crs": {"epsg": site.crs.epsg, "wkt": site.crs.wkt},
        "origin_crs": [ox, oy],
        "plant_north_deg": th,
        "datum": {"label": site.datum.label, "el_m": site.datum.el_m},
        "cloud_z_to_el": site.cloud_z_to_el.model_dump(mode="json") if site.cloud_z_to_el else None,
        "frame": f"glTF Y-up, metres. x = plant N, y = EL - {site.datum.el_m:g}, z = plant E",
        "site_from_plant": f"X = {ox} + E cos({th}) + N sin({th}); Y = {oy} - E sin({th}) + N cos({th})",
    }


def env_ref(feature: EnvFeature) -> tuple[float, float]:
    """The feature-local origin in plant (E, N): the polygon's footprint_ref, else the vertex mean."""
    pts = np.asarray(feature.pts, dtype=float)
    if len(pts) >= 3:
        try:
            e, n = footprint_ref(PolygonFootprint(kind="polygon", pts=[list(p) for p in feature.pts]))
            if math.isfinite(e) and math.isfinite(n):
                return float(e), float(n)
        except Exception:
            pass
    return float(pts[:, 0].mean()), float(pts[:, 1].mean())


class _Bounds:
    def __init__(self) -> None:
        self.lo = np.full(3, np.inf)
        self.hi = np.full(3, -np.inf)

    def add(self, bounds, offset) -> None:
        b = np.asarray(bounds, dtype=float) + np.asarray(offset, dtype=float)
        self.lo = np.minimum(self.lo, b[0])
        self.hi = np.maximum(self.hi, b[1])

    def add_instanced(self, bounds, xf: np.ndarray, offset) -> None:
        corners = trimesh.bounds.corners(np.asarray(bounds, dtype=float))
        pts = np.einsum("nij,kj->nki", xf[:, :3, :3], corners) + xf[:, None, :3, 3]
        flat = pts.reshape(-1, 3)
        self.add([flat.min(axis=0), flat.max(axis=0)], offset)

    def as_lists(self) -> tuple[list[float], list[float]]:
        if not (np.isfinite(self.lo).all() and np.isfinite(self.hi).all()):
            return [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]
        return np.round(self.lo, 4).tolist(), np.round(self.hi, 4).tolist()


def _np_scalar(value):
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, np.ndarray):
        return value.tolist()
    raise TypeError(type(value).__name__)


def _clean_extras(extras: dict | None) -> dict | None:
    """Builder extras as plain JSON, or None when they cannot be (a NaN, an unknown type)."""
    if not extras:
        return None
    try:
        return json.loads(json.dumps(extras, default=_np_scalar, allow_nan=False))
    except (TypeError, ValueError):
        return None


def _marker() -> MeshNode:
    box = trimesh.creation.box((1.0, 1.0, 1.0))
    box.apply_translation((0.0, 0.5, 0.0))
    return MeshNode(name="marker", material=MARKER_MATERIAL, geometry=box)


def _part_mesh(part, by_id) -> trimesh.Trimesh:
    mesh = build_shape(part.shape, part.typed_params())
    mesh.apply_transform(part_transform(part, by_id))
    mesh.apply_scale(MM)
    return mesh


def _item_parts(item: Item) -> list[MeshNode]:
    """An item's M1 parts (item-local mm) as extra children; `composite` draws them itself."""
    if not item.parts or item.type == "composite":
        return []
    by_id = {p.id: p for p in item.parts}
    out = []
    for part in item.parts:
        try:
            mesh = _part_mesh(part, by_id)
        except Exception:
            continue
        material = M1_MATERIAL.get(part.material, DEFAULT_MATERIAL)
        out.append(MeshNode(name=part.id, material=material, geometry=mesh, extras={"shape": part.shape}))
    return out


def _build(item: Item, ctx: BuildCtx, invalid_msg: str | None) -> tuple[list[MeshNode], list[ItemFlag]]:
    flags: list[ItemFlag] = []
    target = item
    if invalid_msg is not None:
        target = item.model_copy(update={"type": "other", "params": {}})
        flags.append(ItemFlag(code="builder_fallback", note=f"Built as other: {invalid_msg}"[:300]))
    try:
        nodes, more = build_item(target, ctx)
    except Exception:  # build_item must not raise; the assembler still never trusts that
        return [], [*flags, ItemFlag(code="builder_fallback", note="Could not be built; shown as a marker.")]
    return [*nodes, *_item_parts(item)], [*flags, *more]


def _emit(
    w: GlbWriter,
    nodes,
    parent: int,
    prefix: str,
    mats: dict[str, int],
    bounds: _Bounds,
    offset,
    *,
    flat: bool = False,
) -> int:
    count = 0
    for mn in nodes:
        material = mats.get(mn.material, mats[FALLBACK_MATERIAL])
        name = mn.name if flat else f"{prefix}/{mn.name}"
        extras = _clean_extras(mn.extras)
        try:
            geometry = mn.geometry
            if isinstance(geometry, Instanced):
                xf = np.asarray(geometry.transforms, dtype=float).reshape(-1, 4, 4)
                if len(xf) == 0 or not np.isfinite(xf).all():
                    continue
                mesh = w.add_mesh(geometry.mesh, material)
                if mesh is None:
                    continue
                w.add_node(name, parent=parent, extras=extras, mesh=mesh, instances=xf)
                bounds.add_instanced(geometry.mesh.bounds, xf, offset)
            else:
                mesh = w.add_mesh(geometry, material)
                if mesh is None:
                    continue
                w.add_node(name, parent=parent, extras=extras, mesh=mesh)
                bounds.add(geometry.bounds, offset)
        except Exception:
            continue
        count += 1
    return count


def _env_builder():
    """B3's `build_environment` when it has landed; None makes the assembler draw flat slabs."""
    try:
        from app.asset_models.builders.environment import build_environment
    except ImportError:
        return None
    return build_environment


def _env_extras(feature: EnvFeature, extras: dict | None) -> dict:
    return {
        **(_clean_extras(extras) or {}),
        "id": feature.id,
        "kind": feature.kind,
        "el": feature.el,
        "confidence": feature.confidence,
    }


def _flat_env(feature: EnvFeature, datum: float) -> MeshNode:
    """A 0.2 m slab in the scene frame (x = N, z = E), its top face at the feature's EL."""
    pts = np.asarray(feature.pts, dtype=float)
    slab = geom.extrude(np.column_stack([pts[:, 1], pts[:, 0]]), ENV_SLAB_M)
    slab.apply_translation((0.0, feature.el - datum - ENV_SLAB_M, 0.0))
    return MeshNode(name=feature.id, material=ENV_MATERIAL[feature.kind], geometry=slab)


def _emit_env(w, group, mn: MeshNode, feature: EnvFeature, mats, bounds) -> bool:
    extras = _env_extras(feature, mn.extras)
    clean = MeshNode(name=mn.name, material=mn.material, geometry=mn.geometry, extras=extras)
    return _emit(w, [clean], group, "", mats, bounds, (0.0, 0.0, 0.0), flat=True) == 1


def _environment(w, spec, root, ctx, mats, bounds, datum, tick) -> tuple[int, list[str]]:
    if not spec.environment:
        return 0, []
    group = w.add_node(ENV_GROUP, parent=root)
    by_id = {f.id: f for f in spec.environment}
    build = _env_builder()
    built: list[MeshNode] | None = None
    if build is not None:
        try:
            built = list(build(list(spec.environment), ctx))
        except Exception:
            built = None
    got: set[str] = set()
    for mn in built or ():
        feature = by_id.get((mn.extras or {}).get("id")) or by_id.get(mn.name)
        if feature is not None and _emit_env(w, group, mn, feature, mats, bounds):
            got.add(feature.id)
    for feature in spec.environment:
        tick()
        if built is None:
            try:
                if _emit_env(w, group, _flat_env(feature, datum), feature, mats, bounds):
                    got.add(feature.id)
            except Exception:
                pass
    done = [f.id for f in spec.environment if f.id in got]
    return len(done), [f.id for f in spec.environment if f.id not in got]


def _top_parts(w, spec, root, mats, bounds) -> list[dict]:
    """M1 top-level parts stay under the root, in the scene frame at the plant origin, as in M1."""
    by_id = {p.id: p for p in spec.parts}
    out = []
    for part in spec.parts:
        try:
            mesh = _part_mesh(part, by_id)
        except Exception:
            continue
        index = w.add_mesh(mesh, mats[M1_MATERIAL.get(part.material, DEFAULT_MATERIAL)])
        if index is None:
            continue
        extras = _clean_extras(
            {"name": part.name, "group": part.group, "shape": part.shape, "params": part.params}
        )
        w.add_node(part.id, parent=root, mesh=index, extras=extras)
        bounds.add(mesh.bounds, (0.0, 0.0, 0.0))
        out.append({"id": part.id, "name": part.name, "group": part.group, "triangles": int(len(mesh.faces))})
    return out


def assemble(
    spec: AssetSpec,
    *,
    lod: float = 1.0,
    progress: Callable[[float], None] | None = None,
    sheet_names: dict[str, str] | None = None,
    invalid: dict[str, str] | None = None,
) -> Assembly:
    """The GLB, its meta and the register rows of one plant spec. `invalid` maps item ids that
    `validate()` rejected to its message: those are built as `other` with a `builder_fallback` flag."""
    dupes = sorted(k for k, c in Counter(i.id for i in spec.items).items() if c > 1)
    if dupes:
        raise AssembleError(f"{len(dupes)} item ids are used more than once (first: {dupes[0]})")
    load_all()
    grid = grid_of(spec)
    datum = spec.site.datum.el_m if spec.site is not None else 0.0
    ctx = BuildCtx(grid=grid, lod=lod)
    mats, mat_index = palette_materials()
    w = GlbWriter(mats)
    bounds = _Bounds()
    root = w.add_node(spec.asset.name or "plant", extras=site_extras(spec))
    total = max(len(spec.items) + len(spec.environment), 1)
    step = [0]

    def tick() -> None:
        if progress is not None and step[0] % PROGRESS_EVERY == 0:
            progress(step[0] / total)
        step[0] += 1

    groups: dict[str, int] = {}
    item_nodes: dict[str, int] = {}
    extra_flags: dict[str, list[ItemFlag]] = {}
    defaults: dict[str, list[str]] = {}
    markers: list[str] = []
    for item in spec.items:
        tick()
        group = group_name(item.area)
        if group not in groups:
            groups[group] = w.add_node(group, parent=root)
        e, n = item_ref(item)
        base, _top, _defaulted = ctx.height(item, default_height(item.type))
        offset = (n, base - datum, e)
        node = w.add_node(item.id, parent=groups[group], translation=offset)
        item_nodes[item.id] = node
        nodes, flags = _build(item, ctx, (invalid or {}).get(item.id))
        first = nodes[0] if nodes and isinstance(nodes[0], MeshNode) else None
        listed = (first.extras or {}).get("defaults") if first is not None else None
        if isinstance(listed, list | tuple):
            defaults[item.id] = [str(x) for x in listed]
        if _emit(w, nodes, node, item.id, mat_index, bounds, offset) == 0:
            _emit(w, [_marker()], node, item.id, mat_index, bounds, offset)
            markers.append(item.id)
            if not any(f.code == "builder_fallback" for f in flags):
                flags.append(ItemFlag(code="builder_fallback", note="Nothing to draw; shown as a marker."))
        if flags:
            extra_flags[item.id] = flags
    env_count, env_skipped = _environment(w, spec, root, ctx, mat_index, bounds, datum, tick)
    parts_meta = _top_parts(w, spec, root, mat_index, bounds)
    rows = register_rows(spec, sheet_names, extra_flags=extra_flags, markers=set(markers), defaults=defaults)
    for row in rows:
        w.set_extras(item_nodes[row["node"]], row)
    glb = w.to_glb()
    fallbacks = [i for i, fl in extra_flags.items() if any(f.code == "builder_fallback" for f in fl)]
    lo, hi = bounds.as_lists()
    meta = {
        "bounds_m": [lo, hi],
        "top_m": hi[1],
        "triangles": w.triangles,
        "node_count": w.node_count,
        "items": len(spec.items),
        "environment": env_count,
        "env_skipped": env_skipped[:MAX_META_IDS],
        "fallback_count": len(fallbacks),
        "fallbacks": fallbacks[:MAX_META_IDS],
        "markers": markers[:MAX_META_IDS],
        "instanced": {"nodes": w.instanced_nodes, "instances": w.instances},
        "parts": parts_meta,
    }
    if progress is not None:
        progress(1.0)
    return Assembly(glb=glb, meta=meta, rows=rows)


def assemble_glb(
    spec: AssetSpec,
    *,
    lod: float = 1.0,
    progress: Callable[[float], None] | None = None,
    sheet_names: dict[str, str] | None = None,
    invalid: dict[str, str] | None = None,
) -> tuple[bytes, dict]:
    a = assemble(spec, lod=lod, progress=progress, sheet_names=sheet_names, invalid=invalid)
    return a.glb, a.meta


INDEX_CHUNK = 500


def index_items(s: Session, model_id: str, version: int, rows: list[dict]) -> int:
    """Replace the version's `asset_item` rows with `rows` (spec §9). Returns the count written."""
    s.execute(delete(AssetItem).where(AssetItem.model_id == model_id, AssetItem.version == version))
    payload = [
        {
            "model_id": model_id,
            "version": version,
            "node": r["node"],
            "tag": r["tag"],
            "name": r["name"],
            "type": r["type"],
            "area": r["area"],
            "plant_e": r["plant_E"],
            "plant_n": r["plant_N"],
            "site_x": r["utm39_E"],
            "site_y": r["utm39_N"],
            "lon": r["lon"],
            "lat": r["lat"],
            "base_el": r["base_EL"],
            "top_el": r["top_EL"],
            "height_source": r["height_source"],
            "confidence": r["confidence"],
            "flags": r["flags"],
            "source_sheet": r["source_sheet"],
            "has_geometry": bool(r["has_geometry"]),
        }
        for r in rows
    ]
    for k in range(0, len(payload), INDEX_CHUNK):
        s.execute(insert(AssetItem), payload[k : k + INDEX_CHUNK])
    return len(payload)
