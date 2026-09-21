"""Exercise the setup path across real project, import, jobs and review storage.

Only the external planner and vision SDK calls are replaced; no paid calls or user imagery.
"""

import json
from types import SimpleNamespace

from sqlalchemy import select

from app.db.models import Box
from app.providers.base import Detection, TileResult


def test_plan_to_import_to_first_labels(client, app, tmp_path, make_jpeg, wait_job, monkeypatch):
    plan = {
        "name": "Crane survey",
        "classes": ["crane"],
        "starter_model_key": "yolo26n",
        "image_guidance": "Choose varied flights and include empty scenes.",
        "labeling_query": "Find cranes and draw tight bounding boxes.",
    }

    class Planner:
        def __init__(self, **kwargs):
            self.responses = self

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def create(self, **kwargs):
            return SimpleNamespace(
                output_text=json.dumps({"message": "Review your plan.", "plan": plan}),
                output=[],
                status="completed",
            )

    class Vision:
        name = "openai"

        def detect_tile(self, image, tile, query, classes, **kwargs):
            assert classes == ["crane"]
            assert query == plan["labeling_query"]
            return TileResult(tile, [Detection("crane", 10, 10, 40, 30, 0.9)])

    monkeypatch.setattr("openai.AsyncOpenAI", Planner)
    monkeypatch.setattr("app.inference.jobs.get_provider", lambda *args, **kwargs: Vision())
    app.state.keys.set("openai", "test-only-secret")
    reply = client.post(
        "/api/v1/agent/chat",
        json={
            "provider": "openai",
            "messages": [{"role": "user", "content": "Build a crane detector"}],
        },
    )
    assert reply.status_code == 200, reply.text
    draft = reply.json()["plan"]
    created = client.post(
        "/api/v1/projects",
        json={
            "name": draft["name"],
            "folder": str(tmp_path / "survey"),
            "classes": [{"name": name, "colour": "#e5af64"} for name in draft["classes"]],
        },
    )
    assert created.status_code == 201, created.text
    project_id = created.json()["id"]
    base = f"/api/v1/projects/{project_id}"
    for i in range(3):
        make_jpeg(tmp_path / "frames" / f"flight_{i}.jpg", 128, 96, seed=i)
    imported = client.post(f"{base}/sources", json={"folder": str(tmp_path / "frames")})
    assert imported.status_code == 202, imported.text
    import_job = wait_job(project_id, imported.json()["job"]["id"], timeout=15)
    assert import_job["state"] == "succeeded", import_job
    images = client.get(f"{base}/images", params={"limit": 24}).json()["items"]
    assert len(images) == 3
    selected = [images[0]["id"], images[2]["id"]]
    body = {
        "kind": "cloud_provider",
        "provider": "openai",
        "image_ids": selected,
        "query": draft["labeling_query"],
        "tiling": {"enabled": False},
        "conf": 0.25,
    }
    estimate = client.post(f"{base}/query-runs/estimate", json=body)
    assert estimate.status_code == 200, estimate.text
    assert estimate.json()["images"] == 2
    queued = client.post(f"{base}/query-runs", json=body)
    assert queued.status_code == 202, queued.text
    result = wait_job(project_id, queued.json()["job"]["id"], timeout=15)
    assert result["state"] == "succeeded", result
    handle = app.state.projects.get(project_id)
    with handle.session() as session:
        labels = list(session.scalars(select(Box)))
        assert {box.image_id for box in labels} == set(selected)
        assert len(labels) == 2
        assert all(box.review_state == "unreviewed" for box in labels)
        assert all(box.class_id == created.json()["classes"][0]["id"] for box in labels)
    pending = client.get(f"{base}/images", params={"has_pending": True, "limit": 24}).json()
    assert {image["id"] for image in pending["items"]} == set(selected)
    for log_path in handle.runs_dir.rglob("*.log"):
        assert "test-only-secret" not in log_path.read_text("utf-8")
