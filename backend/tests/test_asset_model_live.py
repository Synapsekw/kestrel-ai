"""A real model builds the HCl tank from its GA drawing (spec §11 acceptance). Outside the gate:
needs a key in the environment and the operator's drawing at tests/data/asset_models/hcl-tank-ga.pdf."""

import os
from pathlib import Path

import pytest

pytestmark = pytest.mark.live
DRAWING = Path(__file__).parent / "data" / "asset_models" / "hcl-tank-ga.pdf"
NOZZLES = {
    "N1",
    "N1B",
    "N2",
    "N3",
    "N4",
    "N5",
    "N6",
    "N6B",
    "N7",
    "N8",
    "N9",
    "N10",
    "N11",
    "N12",
    "N13",
    "M1",
    "M2",
}
# Bearing (+-2 deg) and elevation (+-25 mm) checks are added once the operator supplies the drawing:
# the expected values get transcribed from its nozzle schedule (model_meta.json), not from memory.


@pytest.mark.parametrize(
    "provider,env",
    [("anthropic", "ANTHROPIC_API_KEY"), ("gemini", "GEMINI_API_KEY"), ("openai", "OPENAI_API_KEY")],
)
def test_hcl_tank_acceptance(client, app, project_id, wait_job, provider, env):
    key = os.environ.get(env)
    if not key or not DRAWING.exists():
        pytest.skip(f"needs {env} and {DRAWING.name}")
    from drawings_helpers import build_drawing, inspect_ready

    app.state.keys.set(provider, key)
    inspection = inspect_ready(client, project_id, wait_job, DRAWING)
    did = build_drawing(client, project_id, wait_job, inspection["id"])["id"]
    base = f"/api/v1/projects/{project_id}/asset-models"
    mid = client.post(base, json={"name": "HCl tank 710-D-130335"}).json()["id"]
    r = client.post(
        f"{base}/{mid}/runs",
        json={"mode": "build", "provider": provider, "sources": [{"type": "drawing", "id": did}]},
    ).json()
    wait_job(project_id, r["job"]["id"], timeout=1500)
    run = client.get(f"{base}/{mid}/runs/{r['run']['id']}").json()
    assert run["state"] == "finished", run["summary"]
    spec = client.get(f"{base}/{mid}/versions/{run['version']}").json()["spec"]
    parts = {p["id"]: p for p in spec["parts"]}
    shells = [p for p in spec["parts"] if p["shape"] == "cylinder" and p["group"] == "Shell"]
    assert all(abs(p["params"]["id"] - 4000) <= 5 for p in shells)
    assert abs(sum(p["params"]["height"] for p in shells) - 8000) <= 5
    assert len(shells) == 3
    present = {pid for pid in parts if pid in NOZZLES} | {
        p["name"].split()[0] for p in spec["parts"]
    } & NOZZLES
    assert present == NOZZLES
    assert all(
        p["source"]["kind"] != "assumed"
        for p in spec["parts"]
        if p["group"] in ("Shell", "Head", "Nozzle", "Manway")
    )
