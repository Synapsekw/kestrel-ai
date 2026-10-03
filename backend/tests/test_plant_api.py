"""Plant model F0 over HTTP: the 501 stubs per unit, the live catalogue, the model kind, the plant run
refusal and large specs validated in the GLB job (plan 2026-10-03-plant-model-f0 Tasks 8 and 10)."""

import re
from types import SimpleNamespace

from test_contract import EXPECTED_STUBS
from test_plant_contract import PLANT_OPERATIONS

from app.asset_models import stubs_plant
from app.asset_models.schemas import AssetModelRunOut, AssetModelRunPackagesOut

PROJECT = "/api/v1/projects/{projectId}"
UNIT_LISTS = {
    "A1": stubs_plant.A1_STUBS,
    "S1": stubs_plant.S1_STUBS,
}


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "1", path)


def _kwargs(method: str) -> dict:
    return {"json": {}} if method in ("POST", "PUT", "PATCH") else {}


def _all_stubs():
    return [s for listed in UNIT_LISTS.values() for s in listed]


def test_each_stub_sits_in_its_units_list_with_the_contract_path():
    for unit, listed in UNIT_LISTS.items():
        for method, path, op_id in listed:
            assert PLANT_OPERATIONS[op_id] == (method.lower(), PROJECT + path, unit), op_id
    assert stubs_plant.stub_operation_ids() <= EXPECTED_STUBS


def test_a_project_reaches_the_501_stubs(client, project_id):
    for method, path, op_id in _all_stubs():
        r = client.request(method, f"/api/v1/projects/{project_id}{_concrete(path)}", **_kwargs(method))
        assert r.status_code == 501, (op_id, r.text)
        assert r.json()["error"]["code"] == "not_implemented", op_id


def test_an_unknown_project_is_404_before_any_stub(client):
    for method, path, op_id in _all_stubs():
        r = client.request(method, f"/api/v1/projects/nope{_concrete(path)}", **_kwargs(method))
        assert r.status_code == 404, (op_id, r.text)


def test_the_catalogue_lists_the_registered_builders(client):
    r = client.get("/api/v1/asset-models/catalogue")
    assert r.status_code == 200, r.text
    types = r.json()["types"]
    assert {"other", "composite"} <= {t["type"] for t in types}
    other = next(t for t in types if t["type"] == "other")
    assert other["family"] == "fallback" and other["default_height_m"] == 3.0
    assert other["params_schema"]["properties"]["material"]["default"] == "Equipment_Grey"


def test_the_catalogue_needs_the_token(anon):
    assert anon.get("/api/v1/asset-models/catalogue").status_code == 401


def test_a_model_is_an_asset_unless_created_as_a_plant(client, project_id):
    base = f"/api/v1/projects/{project_id}/asset-models"
    plain = client.post(base, json={"name": "Tank"}).json()
    plant = client.post(base, json={"name": "Al-Zour", "kind": "plant"}).json()
    assert (plain["kind"], plant["kind"]) == ("asset", "plant")
    kinds = {m["id"]: m["kind"] for m in client.get(base).json()["items"]}
    assert kinds == {plain["id"]: "asset", plant["id"]: "plant"}


def test_a_run_reads_its_stage_usage_from_its_usage():
    by_stage = {
        "current": "trace",
        "stages": {"survey": {"input_tokens": 10, "output_tokens": 2, "images": 3, "calls": 4}},
        "cost_estimate_usd": 0.12,
        "cost_label": "Estimate",
    }
    row = SimpleNamespace(
        id="r1",
        model_id="m1",
        job_id="j1",
        provider="anthropic",
        model_name="claude-opus-5-5",
        mode="plant",
        notes=None,
        state="running",
        stop_reason=None,
        phase="reading",
        steps=[],
        summary=None,
        open_questions=[],
        usage={"input_tokens": 10, "output_tokens": 2, "by_stage": by_stage},
        sources=[],
        version=None,
        comparison=None,
        started_at="2026-10-03T00:00:00Z",
        ended_at=None,
    )
    counts = AssetModelRunPackagesOut(total=3, done=1, failed=0, running=2)
    out = AssetModelRunOut.of(row, packages=counts)
    assert out.packages == counts
    assert out.usage_by_stage.model_dump() == by_stage
    row.usage = {"input_tokens": 0, "output_tokens": 0, "by_stage": {"current": "trace"}}  # not R1's shape
    assert AssetModelRunOut.of(row).usage_by_stage is None
    row.usage = {"input_tokens": 0, "output_tokens": 0}  # a build or refine run
    assert AssetModelRunOut.of(row).usage_by_stage is None and AssetModelRunOut.of(row).packages is None
