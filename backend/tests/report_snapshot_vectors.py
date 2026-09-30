"""The snapshot-key vectors R3 writes to contract/fixtures/report-snapshot-keys.json. R6's
frontend/src/api/reports.ts parity-tests its sorted-key stringify and base64url against the file.

Regenerate after changing a vector or RENDERER_VERSION (from backend/):
    E:/Dev/Yolo/app/backend/.venv/Scripts/python.exe -c \
        "import sys; sys.path.insert(0, 'tests'); import report_snapshot_vectors as v; v.write()"
"""

from __future__ import annotations

import json
from pathlib import Path

from app.reports.snapshots import RENDERER_VERSION
from app.reports.snapshots.keys import canonical_json, encode_spec, key_of

FIXTURE = Path(__file__).resolve().parents[2] / "contract" / "fixtures" / "report-snapshot-keys.json"

NOTE = (
    "canonical = JSON with object keys sorted at every level, separators ',' and ':' and no whitespace, "
    "ASCII only (every non-ASCII character \\u-escaped, as Python's ensure_ascii=True); null is kept; "
    "integral numbers are written without a fraction (3.0 -> 3) and -0 as 0; NaN and Infinity are refused. "
    "param = the canonical UTF-8 bytes in base64url (RFC 4648 section 5 alphabet), no '=' padding. "
    "key = first 32 hex chars of sha256(canonical + '\\n' + source_version + '\\n' + renderer_version). "
    "The server re-parses and re-canonicalises every spec, so a key never depends on the client's bytes; "
    "byte parity is guaranteed only for numbers that are 0 or have 1e-4 <= |x| < 1e21 "
    "(Python and JavaScript switch to exponent notation at different points outside that range)."
)

MAP_A = {
    "kind": "map",
    "item_id": "map-a",
    "geometry": {"type": "Point", "coordinates": [500012.25, 4983010.5]},
    "colour": "#e5af64",
    "label": None,
    "min_extent_m": 40.0,
    "out": [1200, 900],
    "scale_bar": True,
    "north": True,
    "inset": False,
}

VECTORS: list[dict] = [
    {
        "name": "image_crop: non-ASCII label, integral float, ring",
        "source_version": "1048576:1727690400000000000:2026-09-30T10:00:00+00:00",
        "spec": {
            "kind": "image_crop",
            "image_id": "img-1",
            "annotation_id": "box-1",
            "ring": [[10.5, 20], [110.5, 20], [110.5, 95.25], [10.5, 95.25]],
            "colour": "#ff5a4f",
            "label": "F-0042 · Crack",
            "context": 3.0,
            "out": [1200, 900],
            "inset": False,
        },
    },
    {
        "name": "map: null label kept, nested geometry",
        "source_version": "52428800:1727690400000000000:April:2026-09-14",
        "spec": {
            "kind": "map",
            "item_id": "map-1",
            "geometry": {"type": "Point", "coordinates": [500012.25, 4983010.5]},
            "colour": "#e5af64",
            "label": None,
            "min_extent_m": 40.0,
            "out": [1200, 900],
            "scale_bar": True,
            "north": True,
            "inset": False,
        },
    },
    {
        "name": "pair: nested specs, bbox and split",
        "source_version": "a=52428800:1:April:2026-09-14|b=52428800:2:May:2026-09-21",
        "spec": {
            "kind": "pair",
            "a": MAP_A,
            "b": {**MAP_A, "item_id": "map-b"},
            "bbox_wgs84": [15.000123, 44.98, 15.0021, 44.9812],
            "mode": "swipe",
            "split": 0.5,
        },
    },
    {
        "name": "elevation: -0, a small and a large number",
        "source_version": "8388608:1727690400000000000:DSM:",
        "spec": {
            "kind": "elevation",
            "item_id": "srf-1",
            "geometry": {"type": "Point", "coordinates": [-0.0, 0.001, 123456789.125]},
            "overlay": "none",
            "overlay_item_id": None,
            "out": [800, 600],
        },
    },
    {
        "name": "volume_plan: the smallest spec",
        "source_version": "2026-09-30T10:00:00+00:00",
        "spec": {"kind": "volume_plan", "measurement_id": "vm-1"},
    },
]


def build() -> dict:
    out = []
    for v in VECTORS:
        canonical = canonical_json(v["spec"])
        out.append(
            {
                **v,
                "canonical": canonical,
                "param": encode_spec(v["spec"]),
                "key": key_of(canonical, v["source_version"]),
            }
        )
    # R6's parity test reads {"cases": [{"name", "spec", "canonical", "param"}]}; the extra
    # source_version/key fields are the backend's own key regression.
    return {"note": NOTE, "renderer_version": RENDERER_VERSION, "cases": out}


def write() -> None:
    text = json.dumps(build(), indent=2, ensure_ascii=True) + "\n"
    FIXTURE.write_text(text, encoding="utf-8", newline="\n")
