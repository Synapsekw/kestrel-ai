# backend/tests/test_plant_live.py
"""G1 acceptance on Al-Zour (spec 2026-10-03 §13). Outside the gate (marker `live`): needs
ANTHROPIC_API_KEY and the LNG Terminal project folder (KESTREL_LNG_PROJECT, default
E:\\Asset Inspections\\LNG Terminal) with the five plot plans imported, all pages. It runs one plant
run on a copy of the project's Kestrel state, scores the register against Cowork's, and writes the
evidence to docs/evidence/2026-10-03-plant-model-g1/. The original project is only ever read."""

import json
import os
import time
from pathlib import Path

import pytest
from plant_live_helpers import copy_project_state, pick_sources

from app.asset_models import score as sc

pytestmark = pytest.mark.live
PROJECT = Path(os.environ.get("KESTREL_LNG_PROJECT", r"E:\Asset Inspections\LNG Terminal"))
DATA = Path(__file__).parent / "data" / "plant"
EVIDENCE = Path(__file__).resolve().parents[2] / "docs" / "evidence" / "2026-10-03-plant-model-g1"
RUN_TIMEOUT_S = 4 * 3600 + 1800  # the run's own 4 h limit plus merge, check and build
CSV_TIMEOUT_S = 900
MAX_TOKENS = 40_000_000
MAX_SECONDS = 4 * 3600
RUN_FIELDS = (
    "state",
    "stop_reason",
    "summary",
    "open_questions",
    "usage",
    "usage_by_stage",
    "packages",
    "version",
    "started_at",
    "ended_at",
)


def _wait_csv(client, url: str) -> bytes:
    """The version's register CSV, once the GLB job has written it."""
    deadline = time.monotonic() + CSV_TIMEOUT_S
    while time.monotonic() < deadline:
        r = client.get(url)
        if r.status_code == 200:
            return r.content
        assert r.status_code == 409, f"register CSV request failed: {r.status_code} {r.text}"  # 409 not_ready
        time.sleep(5)
    raise AssertionError(f"no register CSV within {CSV_TIMEOUT_S} s")


def test_al_zour_plant_acceptance(client, app, wait_job, tmp_path):
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key or not (PROJECT / "project.db").exists():
        pytest.skip("needs ANTHROPIC_API_KEY and the LNG Terminal project folder (KESTREL_LNG_PROJECT)")
    copy = copy_project_state(PROJECT, tmp_path / "LNG Terminal copy")
    opened = client.post("/api/v1/projects/open", json={"folder": str(copy)})
    assert opened.status_code == 200, opened.text
    pid = opened.json()["id"]
    app.state.keys.set("anthropic", key)
    drawings = client.get(f"/api/v1/projects/{pid}/drawings").json()["items"]
    clouds = client.get(f"/api/v1/projects/{pid}/pointclouds").json()["items"]
    sources, missing = pick_sources(drawings, clouds)
    if missing:
        pytest.skip(f"import these plot plans (all pages) into the project first: {', '.join(missing)}")
    base = f"/api/v1/projects/{pid}/asset-models"
    made = client.post(base, json={"name": "Al-Zour LNG plant (acceptance)", "kind": "plant"})
    assert made.status_code == 201, made.text
    mid = made.json()["id"]
    started = time.monotonic()
    r = client.post(f"{base}/{mid}/runs", json={"mode": "plant", "provider": "anthropic", "sources": sources})
    assert r.status_code == 202, r.text
    body = r.json()
    wait_job(pid, body["job"]["id"], timeout=RUN_TIMEOUT_S)
    seconds = time.monotonic() - started
    run = client.get(f"{base}/{mid}/runs/{body['run']['id']}").json()
    tokens = run["usage"]["input_tokens"] + run["usage"]["output_tokens"]
    facts = {k: run.get(k) for k in RUN_FIELDS} | {"seconds": round(seconds), "tokens": tokens}
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    (EVIDENCE / "run.json").write_text(json.dumps(facts, indent=2), encoding="utf-8")
    assert run["version"] is not None, run["summary"]
    version = run["version"]
    csv_bytes = _wait_csv(client, f"{base}/{mid}/versions/{version}/csv")
    spec = client.get(f"{base}/{mid}/versions/{version}").json()["spec"]

    (EVIDENCE / "register.csv").write_bytes(csv_bytes)
    gen = sc.with_footprint_sizes(sc.read_register(EVIDENCE / "register.csv"), spec)
    rep = sc.score(
        gen,
        sc.read_register(DATA / "kipic_register.csv"),
        gen_land=sc.land_from_environment(spec.get("environment", [])),
        ref_land=sc.read_land(DATA / "kipic_landmask.json"),
    )
    (EVIDENCE / "score.json").write_text(json.dumps(sc.report_dict(rep), indent=2), encoding="utf-8")
    (EVIDENCE / "score.md").write_text(sc.report_markdown(rep), encoding="utf-8")

    assert run["state"] == "finished", run["summary"]
    assert rep.type_accuracy >= 0.95, sc.report_markdown(rep)
    assert rep.within_tol >= 0.95, sc.report_markdown(rep)
    assert all(rep.required_present.values()), rep.required_present
    assert rep.landmask_hausdorff_m is not None and rep.landmask_hausdorff_m <= 10.0
    assert tokens <= MAX_TOKENS and seconds <= MAX_SECONDS
