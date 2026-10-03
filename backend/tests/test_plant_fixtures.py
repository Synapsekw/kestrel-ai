"""The KIPIC reference fixtures (spec 2026-10-03-plant-model-generator §13; plan pm-f0 Task 1)."""

import csv
import json
from pathlib import Path

DATA = Path(__file__).parent / "data" / "plant"
COWORK_COLUMNS = [
    "node", "tag", "name", "type", "area", "group", "plant_E", "plant_N", "utm39_E", "utm39_N",
    "base_EL", "height_m", "top_EL", "height_source", "has_geometry", "source_sheet", "notes",
]  # fmt: skip


def test_the_register_is_cowork_s_885_rows():
    with (DATA / "kipic_register.csv").open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    assert reader.fieldnames == COWORK_COLUMNS
    assert len(rows) == 885
    assert sum(1 for r in rows if r["plant_E"] and r["utm39_E"]) == 878
    assert sum(1 for r in rows if r["tag"]) == 404
    assert len({r["type"] for r in rows}) == 46


def test_the_landmask_holds_closed_outlines():
    mask = json.loads((DATA / "kipic_landmask.json").read_text("utf-8"))
    assert set(mask) == {"land", "main"}
    for rings in mask.values():
        assert rings and all(len(ring) >= 3 and all(len(p) == 2 for p in ring) for ring in rings)
