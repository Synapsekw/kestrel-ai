"""Plant runs over HTTP (spec §10; index contract additions)."""

import pytest
from plant_fakes import KIPIC, FakePlantLlm, item, reply

from app.asset_models import store
from app.asset_models.agent.plant.state import load_state


@pytest.fixture
def model_url(client, project_id):
    m = client.post(f"/api/v1/projects/{project_id}/asset-models", json={"name": "Plant"}).json()
    return f"/api/v1/projects/{project_id}/asset-models/{m['id']}"


@pytest.fixture
def drawing_id(client, project_id, wait_job, tmp_path):
    from drawings_helpers import build_drawing, inspect_ready
    from look_helpers import vector_pdf

    inspection = inspect_ready(client, project_id, wait_job, vector_pdf(tmp_path / "v.pdf"))
    return build_drawing(client, project_id, wait_job, inspection["id"])["id"]


def plant_script(did):
    orchestrator = [
        reply(("set_site", KIPIC)),
        reply(
            (
                "plan_packages",
                {"packages": [{"label": "Tanks", "drawing_id": did, "area": "20", "brief": "b"}]},
            )
        ),
        reply(("next_stage", {"summary": "1"})),
        reply(("next_stage", {"summary": "no environment"})),
        reply(("finish", {"summary": "done"})),
    ]
    return FakePlantLlm(
        orchestrator,
        {
            "P1": [
                reply(("upsert_items", {"items": [item("t1", tag="T1", did=did)]})),
                reply(("finish_package", {"summary": "ok"})),
            ]
        },
    )


def start(client, model_url, did, **body):
    body = {
        "mode": "plant",
        "provider": "anthropic",
        "model_name": "claude-opus-5-5",
        "sources": [{"type": "drawing", "id": did}],
        **body,
    }
    return client.post(f"{model_url}/runs", json=body)


def test_a_plant_run_over_http(client, app, project_id, model_url, drawing_id, wait_job, handle):
    app.state.keys.set("anthropic", "k")
    app.state.jobs.agent_llm = plant_script(drawing_id)
    r = start(client, model_url, drawing_id, limits={"parallel": 2})
    assert r.status_code == 202, r.text
    run = r.json()["run"]
    assert run["mode"] == "plant"
    wait_job(project_id, r.json()["job"]["id"])
    done = client.get(f"{model_url}/runs/{run['id']}").json()
    assert done["state"] == "finished" and done["version"] == 1
    assert done["packages"] == {"total": 1, "done": 1, "failed": 0, "running": 0}
    assert set(done["usage"]) == {"input_tokens", "output_tokens"}
    ubs = done["usage_by_stage"]
    assert ubs["current"] == "done" and "survey" in ubs["stages"] and "estimate" in ubs["cost_label"].lower()
    assert isinstance(ubs["cost_estimate_usd"], float)
    pkgs = client.get(f"{model_url}/runs/{run['id']}/packages").json()["items"]
    assert [(p["n"], p["label"], p["state"], p["item_count"]) for p in pkgs] == [(1, "Tanks", "done", 1)]
    model_id = model_url.rsplit("/", 1)[1]
    assert load_state(store.run_dir(handle, model_id, run["id"])).limits["parallel"] == 2
    from app.db.models import AssetModel

    with handle.session() as s:
        assert s.get(AssetModel, model_id).kind == "plant"


def test_refusals(client, app, model_url, drawing_id):
    app.state.keys.set("anthropic", "k")
    r = client.post(
        f"{model_url}/runs",
        json={
            "mode": "build",
            "provider": "anthropic",
            "sources": [{"type": "drawing", "id": drawing_id}],
            "limits": {"parallel": 2},
        },
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "plant_fields_not_allowed"
    r = start(client, model_url, drawing_id, mode="plant_package", package_ids=["x"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "nothing_to_refine"


def test_plant_package_reruns_a_package(client, app, project_id, model_url, drawing_id, wait_job):
    app.state.keys.set("anthropic", "k")
    app.state.jobs.agent_llm = plant_script(drawing_id)
    first = start(client, model_url, drawing_id)
    wait_job(project_id, first.json()["job"]["id"])
    run_id = first.json()["run"]["id"]
    pid = client.get(f"{model_url}/runs/{run_id}/packages").json()["items"][0]["id"]
    bad = start(client, model_url, drawing_id, mode="plant_package", package_ids=["nope"])
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "unknown_package"
    app.state.jobs.agent_llm = FakePlantLlm(
        packages={
            "P1": [
                reply(("upsert_items", {"items": [item("t2", tag="T2", e=40, did=drawing_id)]})),
                reply(("finish_package", {"summary": "ok"})),
            ]
        }
    )
    again = start(client, model_url, drawing_id, mode="plant_package", package_ids=[pid])
    assert again.status_code == 202, again.text
    wait_job(project_id, again.json()["job"]["id"])
    out = client.get(f"{model_url}/runs/{again.json()['run']['id']}").json()
    assert out["state"] == "finished" and out["version"] == 2
    pk2 = client.get(f"{model_url}/runs/{out['id']}/packages").json()["items"]
    assert [(p["label"], p["state"]) for p in pk2] == [("Tanks", "done")]


def test_packages_of_another_models_run_are_404(client, model_url, project_id):
    other = client.post(f"/api/v1/projects/{project_id}/asset-models", json={"name": "Other"}).json()
    r = client.get(f"/api/v1/projects/{project_id}/asset-models/{other['id']}/runs/nope/packages")
    assert r.status_code == 404


def test_m1_runs_have_no_plant_fields(client, app, project_id, model_url, drawing_id, wait_job):
    app.state.keys.set("anthropic", "k")

    async def llm(provider, **kw):
        from app.project_agent.history import ModelReply

        return ModelReply("Done.", [], usage={"input_tokens": 1, "output_tokens": 1})

    app.state.jobs.agent_llm = llm
    r = client.post(
        f"{model_url}/runs",
        json={"mode": "build", "provider": "anthropic", "sources": [{"type": "drawing", "id": drawing_id}]},
    )
    wait_job(project_id, r.json()["job"]["id"])
    out = client.get(f"{model_url}/runs/{r.json()['run']['id']}").json()
    assert out["packages"] is None and out["usage_by_stage"] is None


def test_package_fields_on_m1_modes_and_duplicates_are_422(client, app, model_url, drawing_id):
    app.state.keys.set("anthropic", "k")
    for body in ({"package_ids": ["x"]}, {"limits": {"parallel": 2}}):
        for mode in ("build", "refine"):
            r = client.post(
                f"{model_url}/runs",
                json={
                    "mode": mode,
                    "provider": "anthropic",
                    "sources": [{"type": "drawing", "id": drawing_id}],
                    **body,
                },
            )
            assert r.status_code == 422 and r.json()["error"]["code"] == "plant_fields_not_allowed", (
                mode,
                body,
                r.text,
            )
    r = start(client, model_url, drawing_id, mode="plant_package", package_ids=["x", "x"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


def test_null_limits_are_accepted(client, app, model_url, drawing_id):
    app.state.keys.set("anthropic", "k")
    r = client.post(
        f"{model_url}/runs",
        json={
            "mode": "build",
            "provider": "anthropic",
            "sources": [{"type": "drawing", "id": drawing_id}],
            "limits": None,
        },
    )
    assert r.status_code != 422, r.text


def test_a_plant_run_needs_a_drawing(client, app, model_url):
    app.state.keys.set("anthropic", "k")
    r = client.post(
        f"{model_url}/runs",
        json={"mode": "plant", "provider": "anthropic", "sources": [{"type": "image", "id": "nope"}]},
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_sources"
