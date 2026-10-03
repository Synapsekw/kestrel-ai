"""Extract the Cowork reference stats for the equipment family (unit B2).

Reads the git-ignored Cowork GLB's JSON chunk and writes `equipment.json` beside this script: per
type, the node count, triangle min/median/max, sub-mesh (primitive) count, materials and one
example. tank_lng is a group node in Cowork; its reference is the group minus the separately
tagged roof pumps, cranes and package.

    python tests/data/plant/cowork_nodes/extract_equipment.py <KIPIC_AlZour_LNG_Plant.glb>
"""

from __future__ import annotations

import json
import statistics
import struct
import sys
from pathlib import Path

TYPES = [
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
]
TAGGED_ON_ROOF = {"pump", "crane", "package"}  # tagged items of their own, not part of tank_lng


def read_gltf(path: Path) -> dict:
    data = path.read_bytes()
    clen, ctype = struct.unpack_from("<I4s", data, 12)
    if ctype != b"JSON":
        raise ValueError("the first GLB chunk is not JSON")
    return json.loads(data[20 : 20 + clen])


def mesh_stats(doc: dict, node: dict) -> tuple[int, list[str], list[float]]:
    acc, mats = doc["accessors"], [m["name"] for m in doc["materials"]]
    if "mesh" not in node:
        return 0, [], [0.0, 0.0, 0.0]
    tris, names, lo, hi = 0, [], [1e18] * 3, [-1e18] * 3
    for prim in doc["meshes"][node["mesh"]]["primitives"]:
        ref = prim.get("indices", prim["attributes"]["POSITION"])
        tris += acc[ref]["count"] // 3
        names.append(mats[prim.get("material", 0)])
        pos = acc[prim["attributes"]["POSITION"]]
        lo = [min(a, b) for a, b in zip(lo, pos["min"], strict=True)]
        hi = [max(a, b) for a, b in zip(hi, pos["max"], strict=True)]
    return tris, names, [round(h - low, 2) for low, h in zip(lo, hi, strict=True)]


def main(glb: Path) -> dict:
    doc = read_gltf(glb)
    nodes = doc["nodes"]
    out: dict = {"source": f"Cowork {glb.name}, extras.type per node", "types": {}}
    for t in TYPES:
        rows = []
        for n in nodes:
            if (n.get("extras") or {}).get("type") != t:
                continue
            if t == "tank_lng":
                kids = [nodes[c] for c in n.get("children", [])]
                kids = [kd for kd in kids if (kd.get("extras") or {}).get("type") not in TAGGED_ON_ROOF]
                stats = [mesh_stats(doc, kd) for kd in kids]
                ext = max((s[2] for s in stats), key=lambda e: e[0] * e[2])
                mats = [m for s in stats for m in s[1]]
                rows.append((n["name"], sum(s[0] for s in stats), mats, ext, [kd["name"] for kd in kids]))
            elif "mesh" in n:
                tris, mats, ext = mesh_stats(doc, n)
                rows.append((n["name"], tris, mats, ext, None))
        counts = [r[1] for r in rows]
        first = rows[0]
        entry = {
            "count": len(rows),
            "tris_min": min(counts),
            "tris_median": int(statistics.median(counts)),
            "tris_max": max(counts),
            "submeshes_max": max(len(r[2]) for r in rows),
            "materials": sorted({m for r in rows for m in r[2]}),
            "example": {"node": first[0], "tris": first[1], "extents_m": first[3]},
        }
        if first[4]:
            entry["example"]["children"] = first[4]
        out["types"][t] = entry
    return out


if __name__ == "__main__":
    result = main(Path(sys.argv[1]))
    dest = Path(__file__).with_name("equipment.json")
    dest.write_text(json.dumps(result, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {dest} ({len(result['types'])} types)")
