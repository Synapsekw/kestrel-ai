"""M-C0: contract/fixtures/site-grid-vectors.json follows the site tile grid of spec
2026-09-26-map-workspace §6. M-B1's `workspace/grid.py` and M-W1's `mapws/view/siteGrid.ts` both test
against this file; this test proves the file itself with a reference implementation of the formulas."""

import json
import math
from pathlib import Path

VECTORS = Path(__file__).resolve().parents[2] / "contract" / "fixtures" / "site-grid-vectors.json"


def _res(z: int) -> float:
    return 1024 / 2**z


def _max_zoom(native_m: float) -> int:
    for z in range(21):
        if _res(z) <= native_m / 2:
            return z
    return 20


def _vectors() -> dict:
    return json.loads(VECTORS.read_text("utf-8"))


def test_the_vectors_follow_the_section_6_formulas():
    v = _vectors()
    assert v["tile_px"] == 256
    for r in v["res"]:
        assert r["res"] == _res(r["z"]), r
    for t in v["tiles"]:
        span = 256 * _res(t["z"])
        assert (t["x"], t["y"]) == (math.floor(t["e"] / span), math.floor(-t["n"] / span)), t
    for b in v["bounds"]:
        span = 256 * _res(b["z"])
        want = [b["x"] * span, -(b["y"] + 1) * span, (b["x"] + 1) * span, -b["y"] * span]
        assert [b["minx"], b["miny"], b["maxx"], b["maxy"]] == want, b
    for m in v["max_zoom"]:
        assert m["max_zoom"] == _max_zoom(m["native_m"]), m


def test_the_vectors_cover_the_edges():
    v = _vectors()
    assert any(t["x"] < 0 for t in v["tiles"]) and any(t["y"] < 0 for t in v["tiles"])
    assert any(t["e"] == 0 and t["n"] == 0 for t in v["tiles"])  # the origin: a JavaScript floor gives -0
    assert {m["max_zoom"] for m in v["max_zoom"]} >= {0, 20}
    assert "-0" in v["note"]
