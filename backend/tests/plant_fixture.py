# backend/tests/plant_fixture.py
"""A small plant spec for tests and the Site 3D e2e (plan 2026-10-03-plant-model-a1, task 5), and a
synthetic plant of any size for the assembler's budget probe. Deterministic: no randomness.

From backend/: `python tests/plant_fixture.py` rewrites tests/data/plant/fixture_plant_spec.json;
`python tests/plant_fixture.py --build DIR` assembles it into DIR/fixture_plant.glb and .csv.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

FIXTURE = Path(__file__).resolve().parent / "data" / "plant" / "fixture_plant_spec.json"

SITE = {
    "crs": {"epsg": 32639, "wkt": None},
    "origin_crs": [244338.089, 3179515.69],
    "plant_north_deg": 17.9991,
    "datum": {"label": "HPFS", "el_m": 100.0},
    "source": {"kind": "assumed", "note": "KIPIC Al-Zour plant grid, from the Cowork register"},
}

# Area -> plant (E, N) of its first item, laid out like Al-Zour's areas.
AREAS = {
    "10": (2250.0, 500.0),
    "20": (1250.0, 550.0),
    "30": (1050.0, 300.0),
    "50": (1500.0, 250.0),
    "70": (850.0, 250.0),
    "80": (650.0, 470.0),
}
ROW_WIDTH_M = 420.0
SYNTH_ROW_WIDTH_M = 1500.0
ROW_STEP_M = 140.0
GAP_M = 8.0
MARINE_BASE_EL = 93.56  # Al-Zour MSL: trestle and jetty structures stand in the sea
MARINE = frozenset({"trestle", "jetty_platform", "dolphin", "revetment"})

# type -> (footprint kind, (E extent or diameter, N extent), height m or None (flat), area, tag code)
TYPES: dict[str, tuple[str, tuple[float, float], float | None, str, str | None]] = {
    "trestle": ("line", (120.0, 13.5), 10.9, "10", None),
    "jetty_platform": ("rect", (60.0, 40.0), 10.9, "10", None),
    "dolphin": ("rect", (12.0, 12.0), 12.0, "10", None),
    "pipe_rack": ("line", (80.0, 9.0), 16.2, "30", None),
    "pipe_sleeper": ("line", (60.0, 2.0), 0.6, "30", None),
    "catwalk": ("line", (50.0, 1.5), 2.0, "10", None),
    "walkway": ("line", (30.0, 1.2), 2.0, "30", None),
    "stair_tower": ("rect", (3.0, 8.0), 16.2, "30", None),
    "overbridge": ("line", (20.0, 3.0), 6.0, "70", None),
    "platform": ("rect", (8.0, 6.0), 6.0, "30", None),
    "gangway": ("rect", (4.0, 20.0), 6.0, "10", "A"),
    "tank_lng": ("circle", (93.5, 93.5), 51.5, "20", "T"),
    "vessel_v": ("circle", (3.0, 3.0), 12.0, "30", "V"),
    "vessel_h": ("rect", (12.0, 3.5), 4.5, "30", "V"),
    "storage_tank_small": ("circle", (8.0, 8.0), 8.0, "70", "T"),
    "pump": ("rect", (3.0, 1.5), 2.0, "50", "P"),
    "pump_group": ("rect", (12.0, 6.0), 3.0, "50", "P"),
    "compressor": ("rect", (15.0, 8.0), 6.0, "30", "K"),
    "heater": ("rect", (10.0, 6.0), 12.0, "50", "H"),
    "vaporizer_orv": ("rect", (30.0, 10.0), 8.0, "50", "E"),
    "vaporizer_scv": ("rect", (12.0, 8.0), 10.0, "50", "E"),
    "stack": ("circle", (2.0, 2.0), 30.0, "70", "S"),
    "flare": ("circle", (3.0, 3.0), 90.0, "70", "F"),
    "loading_arm": ("rect", (4.0, 4.0), 18.0, "10", "L"),
    "crane": ("rect", (3.0, 3.0), 25.0, "10", "A"),
    "monitor": ("circle", (1.0, 1.0), 4.0, "10", "M"),
    "generator": ("rect", (15.5, 6.2), 4.0, "70", "G"),
    "transformer": ("rect", (5.0, 4.0), 4.0, "70", "TR"),
    "package": ("rect", (6.0, 4.0), 3.0, "70", "PK"),
    "nav_aid": ("circle", (1.5, 1.5), 8.0, "10", "N"),
    "building": ("rect", (40.0, 20.0), 8.0, "80", "B"),
    "substation": ("rect", (30.0, 15.0), 9.0, "80", "SS"),
    "analyzer_house": ("rect", (4.0, 3.0), 3.5, "30", "AH"),
    "shelter": ("rect", (67.0, 20.0), 20.6, "30", "BC"),
    "gate": ("rect", (10.0, 2.0), 3.0, "80", None),
    "road": ("line", (200.0, 7.0), None, "80", None),
    "paved": ("polygon", (40.0, 30.0), None, "70", None),
    "laydown": ("polygon", (50.0, 40.0), None, "70", None),
    "parking": ("polygon", (30.0, 15.0), None, "80", None),
    "trench": ("line", (60.0, 1.2), None, "50", None),
    "channel": ("line", (80.0, 3.0), None, "50", None),
    "basin": ("rect", (20.0, 10.0), None, "70", None),
    "wall": ("line", (50.0, 0.3), 3.0, "70", None),
    "fence": ("line", (150.0, 0.1), 2.4, "80", None),
    "revetment": ("line", (120.0, 8.0), None, "10", None),
    "other": ("polygon", (10.0, 8.0), 3.0, "70", None),
}

# Item count per type in Cowork's 885-row register (the synthetic plant's mix).
COWORK_COUNTS = {
    "package": 93, "pump": 93, "road": 71, "other": 56, "platform": 53, "paved": 42, "pipe_rack": 36,
    "pipe_sleeper": 33, "laydown": 28, "catwalk": 24, "dolphin": 24, "vessel_v": 24, "trench": 23,
    "crane": 21, "fence": 21, "heater": 15, "storage_tank_small": 14, "vessel_h": 14, "building": 13,
    "basin": 13, "walkway": 13, "stair_tower": 12, "shelter": 12, "vaporizer_orv": 12, "wall": 11,
    "parking": 11, "overbridge": 9, "loading_arm": 8, "jetty_platform": 8, "tank_lng": 8, "trestle": 7,
    "revetment": 7, "compressor": 6, "gate": 6, "generator": 5, "transformer": 5, "pump_group": 5,
    "channel": 5, "nav_aid": 4, "monitor": 4, "substation": 4, "analyzer_house": 3, "vaporizer_scv": 3,
    "stack": 3, "gangway": 2, "flare": 1,
}  # fmt: skip

FIXTURE_EXTRA = {
    "pump": 3,
    "vessel_v": 2,
    "tank_lng": 1,
    "package": 2,
    "road": 1,
    "pipe_rack": 1,
    "dolphin": 1,
}

ENVIRONMENT = [
    {
        "id": "env-land",
        "kind": "land",
        "pts": [[600.0, 200.0], [2150.0, 200.0], [2150.0, 900.0], [600.0, 900.0]],
        "el": 100.0,
        "source": {"kind": "assumed"},
        "confidence": "medium",
    },
    {
        "id": "env-sea",
        "kind": "sea",
        "pts": [[2150.0, 150.0], [2900.0, 150.0], [2900.0, 950.0], [2150.0, 950.0]],
        "el": 93.56,
        "source": {"kind": "assumed"},
        "confidence": "medium",
    },
    {
        "id": "env-ring-road",
        "kind": "road",
        "pts": [[640.0, 880.0], [2100.0, 880.0], [2100.0, 888.0], [640.0, 888.0]],
        "el": 100.0,
        "source": {"kind": "assumed"},
        "confidence": "medium",
    },
]

COMPOSITE_ITEM = {
    "id": "70-T-0099",
    "tag": "70-T-0099",
    "name": "HCL TANK",
    "type": "composite",
    "area": "70",
    "footprint": {"kind": "circle", "center": [880.0, 220.0], "d": 4.2},
    "base_el": 100.0,
    "top_el": 108.0,
    "height_source": "drawing",
    "source": {"kind": "drawing", "id": "fixture-sheet-70", "page": 1},
    "confidence": "high",
    "parts": [
        {
            "id": "shell",
            "name": "Shell",
            "group": "Shell",
            "shape": "cylinder",
            "params": {"id": 4000, "thickness": 10, "height": 8000},
            "source": {"kind": "assumed"},
        }
    ],
}


def _r(v: float) -> float:
    return round(float(v), 2)


def _footprint(kind: str, a: float, b: float, e: float, n: float) -> dict:
    if kind == "rect":  # size = (along, across); along = plant north at rot_deg 0
        return {"kind": "rect", "center": [_r(e + a / 2), _r(n + b / 2)], "size": [b, a], "rot_deg": 0.0}
    if kind == "circle":
        return {"kind": "circle", "center": [_r(e + a / 2), _r(n + a / 2)], "d": a}
    if kind == "line":
        return {"kind": "line", "pts": [[_r(e), _r(n + b / 2)], [_r(e + a), _r(n + b / 2)]], "width": b}
    pts = [[e, n], [e + a, n], [e + a, n + b], [e + a / 2, n + b * 1.25], [e, n + b]]
    return {"kind": "polygon", "pts": [[_r(x), _r(y)] for x, y in pts]}


def _items(counts: dict[str, int], origins: dict[str, tuple[float, float]] | None) -> list[dict]:
    tag_seq: dict[tuple[str, str], int] = {}
    type_seq: dict[str, int] = {}
    cursor: dict[str, tuple[float, int]] = {}
    items = []
    for type_, count in counts.items():
        kind, (a, b), height, area, code = TYPES[type_]
        for _ in range(count):
            key = area if origins is not None else "_"
            e0, n0 = origins[area] if origins is not None else (500.0, 0.0)
            width = ROW_WIDTH_M if origins is not None else SYNTH_ROW_WIDTH_M
            off, row = cursor.get(key, (0.0, 0))
            if off > 0 and off + a > width:
                off, row = 0.0, row + 1
            e, n = e0 + off, n0 + row * ROW_STEP_M
            cursor[key] = (off + a + GAP_M, row)
            k = type_seq[type_] = type_seq.get(type_, 0) + 1
            tag = None
            if code:
                t = tag_seq[(area, code)] = tag_seq.get((area, code), 0) + 1
                tag = f"{area}-{code}-{t:04d}"
            base = MARINE_BASE_EL if type_ in MARINE else (104.5 if area == "10" else 100.0)
            drawn = height is not None and k % 3 == 1
            items.append(
                {
                    "id": tag or f"{type_}-{k:03d}",
                    "tag": tag,
                    "name": f"{type_.replace('_', ' ').upper()} {k}",
                    "type": type_,
                    "area": area,
                    "footprint": _footprint(kind, a, b, e, n),
                    "base_el": base,
                    "top_el": _r(base + height) if drawn else None,
                    "height_source": "drawing" if drawn else "indicative",
                    "source": {"kind": "drawing", "id": f"fixture-sheet-{area}", "page": 1},
                    "confidence": "high" if drawn else "medium",
                }
            )
    return items


def _first(items: list[dict], type_: str) -> dict:
    return next(i for i in items if i["type"] == type_)


def fixture_plant_spec() -> dict:
    """58 items: every one of Cowork's 46 types at least once, a composite with an M1 part, two
    flagged items, a name with a comma and quotes, and land, sea and road environment features."""
    items = _items({t: 1 + FIXTURE_EXTRA.get(t, 0) for t in TYPES}, AREAS)
    _first(items, "pump")["flags"] = [
        {"code": "height_mismatch", "value": 0.8, "note": "Cloud top is 0.8 m above the drawing."}
    ]
    _first(items, "vessel_h")["flags"] = [
        {"code": "missing_in_cloud", "value": None, "note": "Scanned area, no points."}
    ]
    _first(items, "building")["name"] = 'CONTROL BUILDING, "MAIN"'
    items.append(json.loads(json.dumps(COMPOSITE_ITEM)))
    return {
        "asset": {"name": "Fixture plant", "type": "plant"},
        "site": json.loads(json.dumps(SITE)),
        "items": items,
        "environment": json.loads(json.dumps(ENVIRONMENT)),
    }


def _scaled(counts: dict[str, int], n: int) -> dict[str, int]:
    total = sum(counts.values())
    raw = {t: c * n / total for t, c in counts.items()}
    out = {t: int(v) for t, v in raw.items()}
    for t in sorted(raw, key=lambda t: (-(raw[t] - out[t]), t))[: n - sum(out.values())]:
        out[t] += 1
    return out


def synthetic_plant(n: int = 2000, *, types: Sequence[str] | None = None) -> dict:
    """`n` items in Cowork's type mix (or cycling `types`), on one non-overlapping grid."""
    if types:
        counts = {t: 0 for t in types}
        for k in range(n):
            counts[types[k % len(types)]] += 1
    else:
        counts = _scaled(COWORK_COUNTS, n)
    return {
        "asset": {"name": f"Synthetic plant ({n} items)", "type": "plant"},
        "site": json.loads(json.dumps(SITE)),
        "items": _items(counts, None),
        "environment": json.loads(json.dumps(ENVIRONMENT)),
    }


def write_fixture() -> Path:
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps(fixture_plant_spec(), indent=1) + "\n", encoding="utf-8")
    return FIXTURE


def build_fixture(out_dir: Path) -> tuple[Path, Path]:
    from app.asset_models.assemble import assemble, site_label, write_csv
    from app.asset_models.spec import AssetSpec

    spec = AssetSpec.model_validate(fixture_plant_spec())
    a = assemble(spec)
    out_dir.mkdir(parents=True, exist_ok=True)
    glb, csv_path = out_dir / "fixture_plant.glb", out_dir / "fixture_plant.csv"
    glb.write_bytes(a.glb)
    write_csv(a.rows, csv_path, site_label=site_label(spec))
    return glb, csv_path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--build", type=Path, help="assemble the fixture into this folder instead")
    args = ap.parse_args(argv)
    if args.build:
        for p in build_fixture(args.build):
            print(p)
    else:
        print(write_fixture())
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/, for `app`
    raise SystemExit(main())
