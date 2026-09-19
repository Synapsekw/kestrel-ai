import time

import pytest
from starlette.websockets import WebSocketDisconnect

from app.errors import AppError
from app.jobs.registry import register_job_type


@register_job_type("test_sleep")
def _sleep_job(ctx):
    for i in range(5):
        ctx.check_cancelled()
        ctx.progress(i / 5, f"step {i}")
        ctx.log.info("step %d", i)
        time.sleep(0.05)
    return {"steps": 5}


@register_job_type("test_fail")
def _fail_job(ctx):
    raise RuntimeError("boom")


@register_job_type("test_domain_event")
def _domain_event_job(ctx):
    ctx.publish("images.changed", {"source_id": "s1", "count": 3})
    return None


@register_job_type("test_fast_progress")
def _fast_progress_job(ctx):
    # Three messages well inside the database write interval: only the first is stored at once.
    for i in (1, 2, 3):
        ctx.progress(i / 3, f"{i} / 3 images")
    return None


def _project(client, project_dir):
    return client.post(
        "/api/v1/projects", json={"name": "A", "folder": str(project_dir), "classes": []}
    ).json()["id"]


def _wait(client, pid, jid, states=("succeeded", "failed", "cancelled"), timeout=5):
    t0 = time.time()
    while time.time() - t0 < timeout:
        j = client.get(f"/api/v1/projects/{pid}/jobs/{jid}").json()
        if j["state"] in states:
            return j
        time.sleep(0.05)
    raise AssertionError("timeout waiting for job")


def test_job_runs_to_success_with_progress_and_log(client, project_dir, app):
    pid = _project(client, project_dir)
    job = app.state.jobs.submit(app.state.projects.get(pid), "test_sleep", {"k": 1})
    assert job.state == "queued" and job.log_path == f"runs/{job.id}/job.log"
    j = _wait(client, pid, job.id)
    assert j["state"] == "succeeded" and j["progress"] == 1.0 and j["result"] == {"steps": 5}
    assert j["project_id"] == pid and j["params"] == {"k": 1}
    assert j["started_at"] and j["finished_at"]
    log = client.get(f"/api/v1/projects/{pid}/jobs/{job.id}/log", params={"tail": 50}).json()
    assert any("step 4" in line for line in log["lines"])
    assert log["path"] == job.log_path
    assert (project_dir / "runs" / job.id / "job.log").exists()


def test_a_finished_job_keeps_its_last_progress_message(client, project_dir, app):
    """The database write is throttled; the terminal write must carry the newest message."""
    pid = _project(client, project_dir)
    job = app.state.jobs.submit(app.state.projects.get(pid), "test_fast_progress", {})
    j = _wait(client, pid, job.id)
    assert j["state"] == "succeeded" and j["message"] == "3 / 3 images"


def test_log_tail_limits_lines(client, project_dir, app):
    pid = _project(client, project_dir)
    job = app.state.jobs.submit(app.state.projects.get(pid), "test_sleep", {})
    _wait(client, pid, job.id)
    log = client.get(f"/api/v1/projects/{pid}/jobs/{job.id}/log", params={"tail": 2}).json()
    assert len(log["lines"]) == 2


def test_failed_job_records_error(client, project_dir, app):
    pid = _project(client, project_dir)
    job = app.state.jobs.submit(app.state.projects.get(pid), "test_fail", {})
    j = _wait(client, pid, job.id)
    assert j["state"] == "failed" and "boom" in j["error"]
    log = client.get(f"/api/v1/projects/{pid}/jobs/{job.id}/log").json()
    assert any("Traceback" in line for line in log["lines"])


def test_cancel_job(client, project_dir, app):
    pid = _project(client, project_dir)
    job = app.state.jobs.submit(app.state.projects.get(pid), "test_sleep", {})
    r = client.post(f"/api/v1/projects/{pid}/jobs/{job.id}/cancel")
    assert r.status_code == 200
    assert _wait(client, pid, job.id)["state"] == "cancelled"


def test_cancel_finished_job_is_noop(client, project_dir, app):
    pid = _project(client, project_dir)
    job = app.state.jobs.submit(app.state.projects.get(pid), "test_sleep", {})
    _wait(client, pid, job.id)
    r = client.post(f"/api/v1/projects/{pid}/jobs/{job.id}/cancel")
    assert r.status_code == 200 and r.json()["state"] == "succeeded"


def test_jobs_list_paginates_newest_first(client, project_dir, app):
    pid = _project(client, project_dir)
    ids = [app.state.jobs.submit(app.state.projects.get(pid), "test_sleep", {}).id for _ in range(3)]
    page = client.get(f"/api/v1/projects/{pid}/jobs", params={"limit": 2}).json()
    assert [j["id"] for j in page["items"]] == ids[::-1][:2] and page["next_cursor"]
    page2 = client.get(
        f"/api/v1/projects/{pid}/jobs", params={"limit": 2, "cursor": page["next_cursor"]}
    ).json()
    assert [j["id"] for j in page2["items"]] == [ids[0]] and page2["next_cursor"] is None
    for jid in ids:
        _wait(client, pid, jid)


def test_jobs_list_filters_by_state_and_type(client, project_dir, app):
    pid = _project(client, project_dir)
    ok = app.state.jobs.submit(app.state.projects.get(pid), "test_sleep", {})
    bad = app.state.jobs.submit(app.state.projects.get(pid), "test_fail", {})
    _wait(client, pid, ok.id)
    _wait(client, pid, bad.id)
    failed = client.get(f"/api/v1/projects/{pid}/jobs", params={"state": "failed"}).json()["items"]
    assert [j["id"] for j in failed] == [bad.id]
    typed = client.get(f"/api/v1/projects/{pid}/jobs", params={"type": "test_sleep"}).json()["items"]
    assert [j["id"] for j in typed] == [ok.id]


def test_unknown_job_is_404(client, project_dir):
    pid = _project(client, project_dir)
    r = client.get(f"/api/v1/projects/{pid}/jobs/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_unknown_job_type_is_422(client, project_dir, app):
    pid = _project(client, project_dir)
    with pytest.raises(AppError) as e:
        app.state.jobs.submit(app.state.projects.get(pid), "nope", {})
    assert e.value.status == 422


def test_websocket_receives_job_events(client, project_dir, app):
    pid = _project(client, project_dir)
    with client.websocket_connect("/api/v1/events?token=test-token") as ws:
        job = app.state.jobs.submit(app.state.projects.get(pid), "test_sleep", {})
        seen = set()
        for _ in range(40):
            ev = ws.receive_json()
            if ev["job_id"] != job.id:
                continue
            assert ev["project_id"] == pid
            seen.add(ev["type"])
            if ev["type"] == "job.state" and ev["payload"]["state"] == "succeeded":
                assert ev["payload"]["result"] == {"steps": 5}
                break
        assert {"job.progress", "job.state"} <= seen


def test_websocket_receives_domain_events(client, project_dir, app):
    pid = _project(client, project_dir)
    with client.websocket_connect("/api/v1/events?token=test-token") as ws:
        job = app.state.jobs.submit(app.state.projects.get(pid), "test_domain_event", {})
        for _ in range(20):
            ev = ws.receive_json()
            if ev["type"] == "images.changed":
                assert ev["payload"] == {"source_id": "s1", "count": 3} and ev["job_id"] == job.id
                break
        else:
            raise AssertionError("images.changed not received")


def test_websocket_rejects_bad_token(anon):
    with pytest.raises(WebSocketDisconnect):
        with anon.websocket_connect("/api/v1/events?token=wrong"):
            pass


@register_job_type("test_block")
def _block_job(ctx):
    ctx.cancelled.wait(10)
    ctx.check_cancelled()
    return {"unexpected": True}


def test_stop_cancels_running_and_queued_jobs(settings, project_dir):
    from fastapi.testclient import TestClient

    from app.main import create_app

    app = create_app(settings)
    with TestClient(app, headers={"Authorization": "Bearer test-token"}) as c:
        pid = _project(c, project_dir)
        h = app.state.projects.get(pid)
        running = [app.state.jobs.submit(h, "test_block", {}) for _ in range(2)]  # fills both workers
        queued = app.state.jobs.submit(h, "test_block", {})
        time.sleep(0.2)
    with TestClient(create_app(settings), headers={"Authorization": "Bearer test-token"}) as c:
        for job in running + [queued]:
            assert c.get(f"/api/v1/projects/{pid}/jobs/{job.id}").json()["state"] == "cancelled"
    assert not app.state.jobs._contexts


def test_malformed_cursor_is_422(client, project_dir):
    pid = _project(client, project_dir)
    import base64

    bad = base64.urlsafe_b64encode(b'{"nope": 1}').decode()
    r = client.get(f"/api/v1/projects/{pid}/jobs", params={"cursor": bad})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    r = client.get(f"/api/v1/projects/{pid}/jobs", params={"cursor": "%%%"})
    assert r.status_code == 422
