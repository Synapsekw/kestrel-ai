"""Write contract/fixtures/plant-grid-vectors.json from the KIPIC register fixture.

The plant grid's golden vectors (plan 2026-10-03-plant-model-f0 Task 3): 50 register rows spread
evenly over the 878 that have coordinates, as Cowork wrote them (plant_E/N -> utm39_E/N), plus five
scene vectors. pytest (tests/test_plant_siteframe.py) and S1's vitest pin the grid to this file.

Run from backend/:  ..\\backend\\.venv\\Scripts\\python.exe scripts\\plant_grid_vectors.py
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REGISTER = ROOT / "backend" / "tests" / "data" / "plant" / "kipic_register.csv"
OUT = ROOT / "contract" / "fixtures" / "plant-grid-vectors.json"
FRAME = {
    "crs": {"epsg": 32639, "wkt": None},
    "origin_crs": [244338.089, 3179515.690],
    "plant_north_deg": 17.9991,
    "datum": {"label": "HPFS", "el_m": 100.0},
}
ROWS = 50
SCENE_ROWS = 5


def main() -> None:
    with REGISTER.open(encoding="utf-8", newline="") as f:
        rows = [r for r in csv.DictReader(f) if r["plant_E"] and r["utm39_E"]]
    n = len(rows)
    picks = [rows[round(i * (n - 1) / (ROWS - 1))] for i in range(ROWS)]
    vectors = [
        {
            "node": r["node"],
            "plant_E": float(r["plant_E"]),
            "plant_N": float(r["plant_N"]),
            "site_X": float(r["utm39_E"]),
            "site_Y": float(r["utm39_N"]),
        }
        for r in picks
    ]
    with_el = [r for r in picks if r["base_EL"]][:SCENE_ROWS]
    datum = FRAME["datum"]["el_m"]
    scene = [
        {
            "plant_E": float(r["plant_E"]),
            "plant_N": float(r["plant_N"]),
            "el": float(r["base_EL"]),
            "x": float(r["plant_N"]),
            "y": round(float(r["base_EL"]) - datum, 6),
            "z": float(r["plant_E"]),
        }
        for r in with_el
    ]
    doc = {
        "source": "KIPIC Al-Zour asset register (Cowork), backend/tests/data/plant/kipic_register.csv",
        "formula": "X = ox + cos(t)*E + sin(t)*N; Y = oy - sin(t)*E + cos(t)*N; t = plant_north_deg",
        "scene_formula": "x = N; y = EL - datum.el_m; z = E",
        "tolerance_m": 0.05,
        "frame": FRAME,
        "rows": vectors,
        "scene": scene,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(vectors)} rows and {len(scene)} scene vectors to {OUT}")


if __name__ == "__main__":
    main()
