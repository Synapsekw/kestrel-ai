"""Extract the Cowork reference nodes for the B3 builder families (plant model spec §6 realism floor).

Usage (from backend/):
    .venv/Scripts/python.exe scripts/extract_cowork_b3.py <KIPIC_AlZour_LNG_Plant.glb> <landmask.json>

Writes tests/data/plant/cowork_nodes/b3_nodes.json: for every Cowork node of a B3 type that has a
mesh, its footprint in the plant spec's Footprint form, base_el, h, triangle count, materials and
mesh extent; plus the land/mainland rings (plant E/N) and the Cowork terrain stats. Reads only the
GLB's JSON chunk and index accessor counts; the GLB itself stays out of git.
"""

from __future__ import annotations

import json
import math
import re
import struct
import sys
from pathlib import Path

import numpy as np

B3_TYPES = [
    "building",
    "substation",
    "analyzer_house",
    "shelter",
    "gate",
    "road",
    "paved",
    "laydown",
    "parking",
    "trench",
    "channel",
    "basin",
    "wall",
    "fence",
    "revetment",
]
OUT = Path(__file__).resolve().parents[1] / "tests" / "data" / "plant" / "cowork_nodes" / "b3_nodes.json"
# Cowork scene frame: x = plant E - 1300, y = EL - 100, z = -(plant N - 450)
CX, CZ = 1300.0, 450.0


def _read(glb_path: Path):
    b = glb_path.read_bytes()
    n = struct.unpack("<I", b[12:16])[0]
    gltf = json.loads(b[20 : 20 + n])
    return b, 20 + n + 8, gltf


def _positions(b, off, g, acc_i):
    a = g["accessors"][acc_i]
    bv = g["bufferViews"][a["bufferView"]]
    start = off + bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    return np.frombuffer(b, dtype="<f4", count=a["count"] * 3, offset=start).reshape(-1, 3)


def _footprint(fp: dict, ext_en: tuple[float, float]) -> dict:
    t = fp["t"]
    if t == "poly":
        return {"kind": "polygon", "pts": [[round(e, 3), round(n, 3)] for e, n in fp["pts"]]}
    if t == "rect":
        return {
            "kind": "rect",
            "center": [round((fp["E0"] + fp["E1"]) / 2, 3), round((fp["N0"] + fp["N1"]) / 2, 3)],
            "size": [round(fp["N1"] - fp["N0"], 3), round(fp["E1"] - fp["E0"], 3)],
            "rot_deg": 0,
        }
    if t == "circ":
        return {"kind": "circle", "center": [fp["E"], fp["N"]], "d": round(2 * fp["R"], 3)}
    if t == "line":
        return {
            "kind": "line",
            "pts": [[round(e, 3), round(n, 3)] for e, n in fp["pts"]],
            "width": fp.get("w") or 0.2,
        }
    if t == "obb":  # L along an axis at `rot` from plant east; pick the sense that matches the mesh
        best = None
        for sense in (1.0, -1.0):
            r = math.radians(sense * fp["rot"])
            a = np.array([math.cos(r), math.sin(r)])
            c = np.array([-a[1], a[0]])
            ctr = np.array([fp["E"], fp["N"]])
            pts = [
                ctr + sa * a * fp["L"] / 2 + sc * c * fp["W"] / 2
                for sa, sc in ((-1, -1), (1, -1), (1, 1), (-1, 1))
            ]
            ext = np.ptp(np.array(pts), axis=0)
            err = abs(ext[0] - ext_en[0]) + abs(ext[1] - ext_en[1])
            if best is None or err < best[0]:
                best = (err, pts)
        return {"kind": "polygon", "pts": [[round(float(p[0]), 3), round(float(p[1]), 3)] for p in best[1]]}
    raise ValueError(f"unknown Cowork footprint {t!r}")


def main(glb_path: str, landmask_path: str) -> int:
    b, off, g = _read(Path(glb_path))
    mats = [m["name"] for m in g["materials"]]
    nodes = []
    terrain = {}
    for node in g["nodes"]:
        ex = node.get("extras", {})
        if "mesh" not in node:
            continue
        prims = g["meshes"][node["mesh"]]["primitives"]
        tris = sum(g["accessors"][p["indices"]]["count"] // 3 for p in prims)
        pos = np.vstack([_positions(b, off, g, p["attributes"]["POSITION"]) for p in prims])
        ext = np.ptp(pos, axis=0)
        used = sorted({mats[p["material"]] for p in prims})
        if node.get("name") in ("Sea", "Land_Platform", "Mainland"):
            terrain[node["name"]] = {
                "tris": tris,
                "materials": used,
                "y_min": float(pos[:, 1].min()),
                "y_max": float(pos[:, 1].max()),
            }
            continue
        if ex.get("type") not in B3_TYPES or "footprint" not in ex:
            continue
        h = float(ex.get("h") or 0.0)
        base = float(ex["base_el"])
        nodes.append(
            {
                "id": re.sub(r"[^A-Za-z0-9_.-]", "-", ex["id"])[:64],
                "type": ex["type"],
                "footprint": _footprint(ex["footprint"], (float(ext[0]), float(ext[2]))),
                "base_el": base,
                "top_el": round(base + h, 3) if h > 0 else None,
                "tris": tris,
                "materials": used,
                "extent": [round(float(x), 2) for x in ext],
            }
        )
    lm = json.loads(Path(landmask_path).read_text())
    rings = {
        k: [[[round(x + CX, 3), round(CZ - z, 3)] for x, z in ring] for ring in lm[k]]
        for k in ("land", "main")
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "source": "Cowork KIPIC_AlZour_LNG_Plant.glb (B3 types) + landmask.json",
                "nodes": nodes,
                "terrain": terrain,
                "landmask": rings,
            },
            indent=1,
        )
    )
    print(f"wrote {len(nodes)} nodes to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:3]))
