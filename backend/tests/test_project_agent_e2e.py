"""Task 7: an HTTP-only smoke test of the project agent's headline flow.

Drives the whole "label the first 5 images with excavator and dump_truck" scenario through the
project's REST routes only (no direct `store`/`runner` calls), with a scripted fake LLM installed
on `app.state.agent_llm` — see `test_project_agent_runner.py` for the fake and its helpers, reused
here. No paid provider is ever called: the model is fully scripted and the cloud labeling job runs
against an empty fake detection provider.
"""

import time

import pytest
from test_project_agent_runner import EmptyProvider, FakeLlm, answer, calls

BASE = "/api/v1/projects"
SECRET_KEY = "sk-ant-test-SECRET-e2e-9d3f1a"
N_IMAGES = 6
N_LABEL = 5


@pytest.fixture
def image_ids(client, project_id, tmp_path, make_jpeg, import_source) -> list[str]:
    src = tmp_path / "flight"
    # Created in reverse so the path order differs from the creation order.
    for i in reversed(range(N_IMAGES)):
        make_jpeg(src / f"img{i:02d}.jpg", 96, 64, seed=500 + i)
    import_source(project_id, src)
    page = client.get(f"{BASE}/{project_id}/images", params={"limit": 100, "sort": "path"}).json()
    assert len(page["items"]) == N_IMAGES
    return [i["id"] for i in page["items"]]


def _settle(client, project_id: str, timeout: float = 10.0) -> dict:
    """Poll `GET /agent` until the newest turn is no longer `running`."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = client.get(f"{BASE}/{project_id}/agent").json()
        if body["turn"] and body["turn"]["state"] != "running":
            return body
        time.sleep(0.02)
    raise AssertionError(f"the turn never left running: {client.get(f'{BASE}/{project_id}/agent').json()}")


def test_label_the_first_five_images_end_to_end(client, app, project_id, image_ids, monkeypatch):
    """Add a class, prepare a cloud labeling run, approve it over HTTP, and check every surface an
    operator would look at: the approval card's cost, the created query run's image selection, the
    background job, the final assistant text and the tool items' statuses and summaries."""
    monkeypatch.setattr("app.inference.jobs.get_provider", lambda *a, **k: EmptyProvider())
    app.state.keys.set("anthropic", SECRET_KEY)

    selection = {"sort": "path", "order": "asc", "offset": 0, "limit": N_LABEL}
    labeler = {"kind": "cloud_provider", "provider": "anthropic", "query": "every excavator and dump truck"}
    fake = FakeLlm(
        [
            calls(("update_classes", {"add": ["dump_truck"]})),
            calls(("label_images", {"selection": selection, "labeler": labeler})),
            answer("Labeling 5 images with excavator and dump_truck has started."),
        ]
    )
    app.state.agent_llm = fake

    r = client.post(
        f"{BASE}/{project_id}/agent/turns",
        json={"provider": "anthropic", "message": "label the first 5 images with excavator and dump_truck"},
    )
    assert r.status_code == 202, r.text

    body = _settle(client, project_id)
    turn = body["turn"]
    assert turn["state"] == "awaiting_approval", body
    card = body["items"][-1]
    assert card["tool_name"] == "label_images"
    assert card["tool_status"] == "awaiting_approval"
    assert isinstance(card["approval"]["estimated_cost"], int | float)
    assert card["approval"]["estimated_cost"] > 0

    classes = [c["name"] for c in client.get(f"{BASE}/{project_id}").json()["classes"]]
    assert "dump_truck" in classes
    assert client.get(f"{BASE}/{project_id}/query-runs").json()["items"] == []  # nothing ran yet

    approve = client.post(f"{BASE}/{project_id}/agent/turns/{turn['id']}/approval", json={"approve": True})
    assert approve.status_code == 200, approve.text
    assert approve.json()["state"] == "running"

    body = _settle(client, project_id)
    assert body["turn"]["state"] == "succeeded", body
    final = body["items"][-1]
    assert final["kind"] == "assistant"
    assert final["text"].startswith("Labeling 5 images")

    runs = client.get(f"{BASE}/{project_id}/query-runs").json()["items"]
    assert len(runs) == 1
    assert runs[0]["image_ids"] == image_ids[:N_LABEL]
    assert runs[0]["kind"] == "cloud_provider"
    job_id = runs[0]["job_id"]
    assert job_id
    job = client.get(f"{BASE}/{project_id}/jobs/{job_id}")
    assert job.status_code == 200, job.text

    tool_items = [i for i in body["items"] if i["kind"] == "tool"]
    assert [i["tool_name"] for i in tool_items] == ["update_classes", "label_images"]
    assert [i["tool_status"] for i in tool_items] == ["ok", "ok"]
    assert all(i["tool_summary"] for i in tool_items)
    assert tool_items[1]["job_ids"] == [job_id]

    # No key reached the model or the project folder.
    for call in fake.calls:
        assert SECRET_KEY not in call["system"]
        for entry in call["history"]:
            assert SECRET_KEY not in repr(entry)
    for path in app.state.projects.get(project_id).folder.rglob("*"):
        if path.is_file():
            assert SECRET_KEY.encode() not in path.read_bytes(), path
