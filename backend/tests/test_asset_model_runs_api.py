# backend/tests/test_asset_model_runs_api.py
"""Runs over HTTP (spec §9)."""

import pytest

from app.project_agent.history import ModelReply, ToolCall

SHELL = {
    "id": "shell",
    "name": "Shell",
    "group": "Shell",
    "shape": "cylinder",
    "params": {"id": 4000, "thickness": 8, "height": 8000},
    "source": {"kind": "assumed"},
}


@pytest.fixture
def model_url(client, project_id):
    m = client.post(f"/api/v1/projects/{project_id}/asset-models", json={"name": "Tank"}).json()
    return f"/api/v1/projects/{project_id}/asset-models/{m['id']}"


@pytest.fixture
def drawing_id(client, project_id, wait_job, tmp_path):
    from drawings_helpers import build_drawing, inspect_ready
    from look_helpers import vector_pdf

    inspection = inspect_ready(client, project_id, wait_job, vector_pdf(tmp_path / "v.pdf"))
    return build_drawing(client, project_id, wait_job, inspection["id"])["id"]


USAGE = {"input_tokens": 1, "output_tokens": 1}


def scripted(app, *replies):
    async def llm(provider, **kw):
        r = replies[llm.n]
        llm.n += 1
        return r

    llm.n = 0
    app.state.jobs.agent_llm = llm


def test_start_runs_to_a_version(client, app, project_id, model_url, drawing_id, wait_job):
    app.state.keys.set("anthropic", "k")
    scripted(
        app,
        ModelReply(
            "",
            [ToolCall("a", "upsert_parts", {"parts": [SHELL]})],
            usage=USAGE,
        ),
        ModelReply("", [ToolCall("b", "finish", {"summary": "done"})], usage=USAGE),
    )
    r = client.post(
        f"{model_url}/runs",
        json={"mode": "build", "provider": "anthropic", "sources": [{"type": "drawing", "id": drawing_id}]},
    )
    assert r.status_code == 202, r.text
    run = r.json()["run"]
    assert run["state"] == "running" and run["model_name"]
    assert client.get(model_url).json()["status"] == "building"
    wait_job(project_id, r.json()["job"]["id"])
    done = client.get(f"{model_url}/runs/{run['id']}").json()
    assert done["state"] == "finished" and done["version"] == 1
    assert [s["tool"] for s in done["steps"]] == ["upsert_parts", "finish"]
    assert client.get(f"{model_url}/runs").json()["items"][0]["id"] == run["id"]


def test_start_refusals(client, app, model_url, drawing_id):
    body = {"mode": "build", "provider": "anthropic", "sources": [{"type": "drawing", "id": drawing_id}]}
    r = client.post(f"{model_url}/runs", json=body)
    assert r.status_code == 409 and r.json()["error"]["code"] == "provider_key_missing"
    app.state.keys.set("anthropic", "k")
    r = client.post(f"{model_url}/runs", json={**body, "sources": [{"type": "drawing", "id": "nope"}]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_sources"
    r = client.post(f"{model_url}/runs", json={**body, "mode": "refine"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "nothing_to_refine"


def test_second_live_run_is_refused(client, app, project_id, model_url, drawing_id, wait_job):
    app.state.keys.set("anthropic", "k")

    async def slow(provider, **kw):
        import asyncio

        await asyncio.sleep(30)

    app.state.jobs.agent_llm = slow
    body = {"mode": "build", "provider": "anthropic", "sources": [{"type": "drawing", "id": drawing_id}]}
    first = client.post(f"{model_url}/runs", json=body)
    assert first.status_code == 202
    second = client.post(f"{model_url}/runs", json=body)
    assert second.status_code == 409 and second.json()["error"]["code"] == "job_running"
    client.post(f"{model_url}/runs/{first.json()['run']['id']}/stop")
    wait_job(project_id, first.json()["job"]["id"])


def test_stop_ends_the_run(client, app, project_id, model_url, drawing_id, wait_job):
    app.state.keys.set("anthropic", "k")

    async def slow(provider, **kw):
        import asyncio

        await asyncio.sleep(30)

    app.state.jobs.agent_llm = slow
    r = client.post(
        f"{model_url}/runs",
        json={"mode": "build", "provider": "anthropic", "sources": [{"type": "drawing", "id": drawing_id}]},
    ).json()
    assert client.post(f"{model_url}/runs/{r['run']['id']}/stop").status_code == 202
    job = wait_job(project_id, r["job"]["id"])
    assert job["state"] == "cancelled"
    run = client.get(f"{model_url}/runs/{r['run']['id']}").json()
    assert run["state"] == "stopped" and run["stop_reason"] == "user"
    assert client.get(model_url).json()["live_run_id"] is None


def test_submit_failure_releases_the_model(client, app, model_url, drawing_id, monkeypatch):
    app.state.keys.set("anthropic", "k")

    def boom(*a, **k):
        raise RuntimeError("pool down")

    monkeypatch.setattr(app.state.jobs, "submit", boom)
    body = {"mode": "build", "provider": "anthropic", "sources": [{"type": "drawing", "id": drawing_id}]}
    with pytest.raises(RuntimeError):
        client.post(f"{model_url}/runs", json=body)
    m = client.get(model_url).json()
    assert m["live_run_id"] is None and m["status"] == "empty"
    run = client.get(f"{model_url}/runs").json()["items"][0]
    assert run["state"] == "failed" and run["summary"] == "The run could not be started."


def test_thumb_and_overlay_204_when_absent(client, app, model_url, project_id, drawing_id, wait_job):
    app.state.keys.set("anthropic", "k")
    scripted(app, ModelReply("", [ToolCall("b", "finish", {"summary": "nothing"})]))
    r = client.post(
        f"{model_url}/runs",
        json={"mode": "build", "provider": "anthropic", "sources": [{"type": "drawing", "id": drawing_id}]},
    ).json()
    wait_job(project_id, r["job"]["id"])
    rid = r["run"]["id"]
    assert client.get(f"{model_url}/runs/{rid}/steps/1/thumb").status_code == 204
    assert (
        client.get(f"{model_url}/runs/{rid}/overlay/00000000-0000-0000-0000-000000000000").status_code == 204
    )
