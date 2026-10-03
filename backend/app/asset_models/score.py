# backend/app/asset_models/score.py
"""Score a generated plant register against a reference one (spec 2026-10-03 §13, unit K1).

Offline and pure: two registers (CSV rows as dicts) and optional land outlines in, numbers out. Tags
match after normalising case, whitespace and dashes. Positions are plant metres. Nothing here
touches the database or the network.

CLI: python -m app.asset_models.score <gen.csv> <ref.csv> [--gen-land x.json --ref-land y.json]
     [--gen-spec spec.json] [--json out.json]
"""

from __future__ import annotations

import csv
import re
from pathlib import Path

TYPE_FAMILY: dict[str, str] = {
    **dict.fromkeys(
        [
            "trestle", "jetty_platform", "dolphin", "pipe_rack", "pipe_sleeper", "catwalk", "walkway",
            "stair_tower", "overbridge", "platform", "gangway",
        ],
        "structure",
    ),
    **dict.fromkeys(
        [
            "tank_lng", "vessel_v", "vessel_h", "storage_tank_small", "pump", "pump_group", "compressor",
            "heater", "vaporizer_orv", "vaporizer_scv", "stack", "flare", "loading_arm", "crane", "monitor",
            "generator", "transformer", "package", "nav_aid",
        ],
        "equipment",
    ),
    **dict.fromkeys(["building", "substation", "analyzer_house", "shelter", "gate"], "building"),
    **dict.fromkeys(
        ["road", "paved", "laydown", "parking", "trench", "channel", "basin", "wall", "fence", "revetment"],
        "civil",
    ),
    "other": "fallback",
    "composite": "fallback",
}  # fmt: skip
FALLBACK_TYPES = frozenset({"other", "composite"})
_DASHES = "-" + "".join(chr(c) for c in range(0x2010, 0x2016)) + chr(0x2212)  # hyphens, en/em dashes, minus
_SEP = re.compile(r"[\s" + re.escape(_DASHES) + "]+")


def normalise_tag(tag: object) -> str:
    """'20 – t – 0001' and '20-T-0001' are the same tag: case, whitespace and dashes do not count."""
    if tag is None:
        return ""
    return _SEP.sub("", str(tag)).upper()


def types_match(gen_type: str, ref_type: str) -> bool:
    """Equal types match. A fallback type (other/composite) on either side matches anything; `package`
    matches any equipment type (spec §13: type-family match accepted for package/other)."""
    if gen_type == ref_type:
        return True
    if gen_type in FALLBACK_TYPES or ref_type in FALLBACK_TYPES:
        return True
    if "package" in (gen_type, ref_type):
        other = ref_type if gen_type == "package" else gen_type
        return TYPE_FAMILY.get(other) == "equipment"
    return False


def read_register(path: Path) -> list[dict]:
    with Path(path).open(encoding="utf-8-sig", newline="") as f:
        return [{(k or "").strip(): (v or "").strip() for k, v in row.items()} for row in csv.DictReader(f)]
