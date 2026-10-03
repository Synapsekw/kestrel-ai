# backend/tests/test_asset_models_assemble_perf.py
"""Spec §7 budget: a 2 000-item plant validates and assembles in under 2 minutes and 1.5 GB of RAM.
Run in a fresh interpreter so the peak working set is this build's alone (Windows `peak_wset`)."""

import json
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
PROBE = r"""
import json, sys, time
sys.path.insert(0, "tests")
import psutil
from plant_fixture import synthetic_plant
from app.asset_models.assemble import assemble
from app.asset_models.jobs_glb import invalid_items
from app.asset_models.spec import AssetSpec
from app.asset_models.validate import validate

spec = AssetSpec.model_validate(synthetic_plant(2000))
t0 = time.perf_counter()
report = validate(spec)
a = assemble(spec, invalid=invalid_items(report, spec))
seconds = time.perf_counter() - t0
info = psutil.Process().memory_info()
peak = getattr(info, "peak_wset", None) or info.rss
print(json.dumps({"seconds": seconds, "peak": peak, "items": a.meta["items"],
                  "triangles": a.meta["triangles"], "glb": len(a.glb),
                  "fallbacks": a.meta["fallback_count"]}))
"""


def test_two_thousand_items_build_within_budget():
    r = subprocess.run(
        [sys.executable, "-c", PROBE], cwd=BACKEND, capture_output=True, text=True, timeout=600
    )
    assert r.returncode == 0, r.stderr[-3000:]
    out = json.loads(r.stdout.strip().splitlines()[-1])
    print(out)  # shown with -s: the numbers for the report
    assert out["items"] == 2000
    assert out["seconds"] < 120, out
    assert out["peak"] < 1.5 * 1024**3, out
