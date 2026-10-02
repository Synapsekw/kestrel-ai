"""Spec -> meshes (metres, asset frame) -> GLB (spec 2026-10-02 §6.4). Pure and deterministic.

One glTF node per part, named by part id. trimesh's exporter does not write per-node extras, so
`inject_node_extras` patches the GLB's JSON chunk afterwards.
"""

from __future__ import annotations

import json
import struct

import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial

from app.asset_models.placement import part_transform
from app.asset_models.shapes import build_shape
from app.asset_models.spec import AssetSpec
from app.asset_models.validate import Report, validate

MM = 0.001


class SpecInvalid(Exception):
    def __init__(self, report: Report):
        super().__init__("the model spec has errors")
        self.report = report


def _lin(c: float) -> float:
    # colours are authored in sRGB; glTF baseColorFactor is linear
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _mat(name, rgb, metal, rough):
    return PBRMaterial(
        name=name,
        baseColorFactor=[*[_lin(c) for c in rgb], 1.0],
        metallicFactor=metal,
        roughnessFactor=rough,
        doubleSided=True,
    )


MATERIALS = {
    "paint": _mat("Paint", [0.78, 0.79, 0.80], 0.1, 0.6),
    "steel": _mat("Steel", [0.62, 0.64, 0.66], 0.6, 0.4),
    "rubber": _mat("Rubber", [0.17, 0.17, 0.18], 0.0, 0.8),
    "concrete": _mat("Concrete", [0.60, 0.59, 0.56], 0.0, 0.9),
    "grating": _mat("Grating", [0.45, 0.47, 0.50], 0.5, 0.5),
    "galvanised": _mat("Galvanised", [0.70, 0.72, 0.74], 0.7, 0.35),
    "glass": _mat("Glass", [0.75, 0.85, 0.90], 0.0, 0.1),
    "other": _mat("Other", [0.55, 0.55, 0.58], 0.2, 0.6),
}


def _empty_glb() -> bytes:
    # trimesh refuses to export an empty scene; a spec with no parts is still a valid (blank) model
    body = json.dumps(
        {"asset": {"version": "2.0", "generator": "kestrel"}, "scene": 0, "scenes": [{"nodes": []}]},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    body += b" " * (-len(body) % 4)
    total = 12 + 8 + len(body)
    return struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(body), b"JSON") + body


_EMPTY_GLB = _empty_glb()


def build_meshes(spec: AssetSpec) -> dict[str, trimesh.Trimesh]:
    report = validate(spec)
    if not report.ok:
        raise SpecInvalid(report)
    by_id = {p.id: p for p in spec.parts}
    out: dict[str, trimesh.Trimesh] = {}
    for part in spec.parts:
        mesh = build_shape(part.shape, part.typed_params())
        mesh.apply_transform(part_transform(part, by_id))
        mesh.apply_scale(MM)
        out[part.id] = mesh
    return out


def build_glb(spec: AssetSpec) -> tuple[bytes, dict]:
    meshes = build_meshes(spec)
    if not spec.parts:
        return _EMPTY_GLB, {"bounds_m": [[0, 0, 0], [0, 0, 0]], "top_m": 0.0, "triangles": 0, "parts": []}
    scene = trimesh.Scene()
    parts_meta = []
    for part in spec.parts:
        mesh = meshes[part.id].copy()
        mesh.visual = trimesh.visual.TextureVisuals(material=MATERIALS[part.material])
        scene.add_geometry(mesh, node_name=part.id, geom_name=part.id)
        parts_meta.append(
            {"id": part.id, "name": part.name, "group": part.group, "triangles": int(len(mesh.faces))}
        )
    glb = scene.export(file_type="glb")
    extras = {
        p.id: {"name": p.name, "group": p.group, "shape": p.shape, "params": p.params} for p in spec.parts
    }
    glb = inject_node_extras(glb, extras)
    if meshes:
        lo = np.min([m.bounds[0] for m in meshes.values()], axis=0)
        hi = np.max([m.bounds[1] for m in meshes.values()], axis=0)
    else:
        lo = hi = np.zeros(3)
    meta = {
        "bounds_m": [np.round(lo, 4).tolist(), np.round(hi, 4).tolist()],
        "top_m": round(float(hi[1]), 4),
        "triangles": sum(p["triangles"] for p in parts_meta),
        "parts": parts_meta,
    }
    return glb, meta


def inject_node_extras(glb: bytes, extras_by_node: dict[str, dict]) -> bytes:
    magic, version, _ = struct.unpack_from("<4sII", glb, 0)
    if magic != b"glTF":
        raise ValueError("not a GLB")
    clen, ctype = struct.unpack_from("<I4s", glb, 12)
    if ctype != b"JSON":
        raise ValueError("the first GLB chunk is not JSON")
    doc = json.loads(glb[20 : 20 + clen])
    for node in doc.get("nodes", []):
        extra = extras_by_node.get(node.get("name"))
        if extra is not None:
            node["extras"] = extra
    body = json.dumps(doc, separators=(",", ":"), sort_keys=True).encode("utf-8")
    body += b" " * (-len(body) % 4)
    rest = glb[20 + clen :]
    total = 12 + 8 + len(body) + len(rest)
    return struct.pack("<4sII", magic, version, total) + struct.pack("<I4s", len(body), b"JSON") + body + rest
