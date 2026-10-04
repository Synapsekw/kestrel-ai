"""Writes the S3 e2e plant: spec v1 (JSON) and the v1/v2 GLBs, built by A1's assembler.

Run from the worktree's backend folder with the backend venv:
    E:\\Dev\\Yolo\\app\\backend\\.venv\\Scripts\\python.exe ../frontend/e2e/fixtures/make_plant_site.py
v2 differs from v1 only in 20-T-0001's top EL (135 -> 140), the edit the e2e makes.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend"))
from app.asset_models.assemble import assemble_glb  # noqa: E402
from app.asset_models.spec import AssetSpec  # noqa: E402

SITE = {
    "crs": {"epsg": 32639},
    "origin_crs": [244338.089, 3179515.69],
    "plant_north_deg": 17.9991,
    "datum": {"label": "HPFS", "el_m": 100.0},
    "source": {"kind": "assumed"},
}


def item(id_, tag, name, footprint, top, area):
    return {
        "id": id_,
        "tag": tag,
        "name": name,
        "type": "other",
        "area": area,
        "footprint": footprint,
        "base_el": 100.0,
        "top_el": top,
        "height_source": "drawing",
        "source": {"kind": "drawing", "id": "dr-1", "region": [0.1, 0.2, 0.3, 0.4]},
        "confidence": "high",
    }


def items(tank_top):
    return [
        item("20-T-0001", "20-T-0001", "LNG tank 1", {"kind": "circle", "center": [100.0, 200.0], "d": 80.0}, tank_top, "20"),
        item("30-P-0001", "30-P-0001", "Send-out pump 1", {"kind": "rect", "center": [260.0, 180.0], "size": [6.0, 3.0], "rot_deg": 0.0}, 103.0, "30"),
        item("untagged-1", None, "Pipe rack segment", {"kind": "line", "pts": [[150.0, 150.0], [250.0, 150.0]], "width": 8.0}, 108.0, "30"),
    ]


here = Path(__file__).parent
for version, top in ((1, 135.0), (2, 140.0)):
    spec = AssetSpec.model_validate({"site": SITE, "items": items(top)})
    glb, meta = assemble_glb(spec)
    (here / f"plant-site-v{version}.glb").write_bytes(glb)
    if version == 1:
        (here / "plant-site-spec-v1.json").write_text(json.dumps(spec.model_dump(mode="json"), indent=2) + "\n", encoding="utf-8")
    print(version, len(glb), meta.get("node_count"))
