"""Re-marking a type `defect` and backfilling (spec 2026-09-26-foundation section 7.2, decision F4,
section 11.4 step 6): accepted and person-drawn boxes of that type become `reviewed` findings with no
severity, numbered in box order, once."""

import pytest
from findings_helpers import add_type, use_types
from library_helpers import wait_library_job

from app.db.models import Box, Job
from app.findings.backfill import BACKFILL_JOB, findings_from_annotations
from app.jobs.cancellation import JobCancelled

API = "/api/v1"
TYPES = f"{API}/catalogue/types"


@pytest.fixture
def ctx(client, project, handle, import_source, tmp_path, make_jpeg) -> dict:
    """An object type `pothole` with a person box, an accepted, a pending and a rejected proposal."""
    pothole = add_type(client, "pothole", kind="object")
    use_types(client, project, pothole)
    folder = tmp_path / "frames"
    make_jpeg(folder / "S_0001_0001.jpg", 320, 240, seed=1)
    import_source(project["id"], folder)
    base = f"{API}/projects/{project['id']}"
    image_id = client.get(f"{base}/images").json()["items"][0]["id"]
    r = client.post(
        f"{base}/images/{image_id}/boxes", json={"class_id": pothole["id"], "x": 1, "y": 1, "w": 10, "h": 10}
    )
    assert r.status_code == 201, r.text
    with handle.session() as s:
        for state in ("accepted", "unreviewed", "rejected"):
            s.add(
                Box(
                    image_id=image_id,
                    class_id=pothole["id"],
                    x=20,
                    y=20,
                    w=10,
                    h=10,
                    confidence=0.9,
                    provenance_kind="local_model",
                    model_id="m1",
                    review_state=state,
                )
            )
    return {"base": base, "type_id": pothole["id"], "project_id": project["id"]}


def _findings(client, ctx) -> list[dict]:
    return client.get(f"{ctx['base']}/findings", params={"sort": "number"}).json()["items"]


def _backfill(client, ctx) -> dict:
    r = client.post(f"{TYPES}/{ctx['type_id']}/backfill")
    assert r.status_code == 202, r.text
    job = wait_library_job(client, r.json()["job"]["id"])
    assert job["state"] == "succeeded", job
    return job["result"]


def test_marking_a_type_defect_and_backfilling_makes_reviewed_findings(client, ctx):
    r = client.patch(f"{TYPES}/{ctx['type_id']}", json={"kind": "defect"})
    assert r.json()["backfill_candidates"] is True
    assert _findings(client, ctx) == []  # the kind change alone creates nothing (F4)
    assert _backfill(client, ctx)["created"] == 2
    found = _findings(client, ctx)
    assert [(f["number"], f["status"], f["severity"], f["created_by"]) for f in found] == [
        (1, "reviewed", None, "human"),
        (2, "reviewed", None, "model:m1"),
    ]
    assert _backfill(client, ctx)["created"] == 0
    assert len(_findings(client, ctx)) == 2


def test_an_object_type_cannot_be_backfilled(client, ctx):
    r = client.post(f"{TYPES}/{ctx['type_id']}/backfill")
    assert (r.status_code, r.json()["error"]["code"]) == (422, "not_a_defect")


def test_a_second_backfill_of_the_same_type_while_one_is_live_is_refused(client, app, ctx):
    client.patch(f"{TYPES}/{ctx['type_id']}", json={"kind": "defect"})
    with app.state.library.session() as s:
        live = Job(type=BACKFILL_JOB, params={"type_id": ctx["type_id"]}, state="running")
        other = Job(type=BACKFILL_JOB, params={"type_id": "another-type"}, state="queued")
        s.add_all([live, other])
        s.flush()
        live_id = live.id
    r = client.post(f"{TYPES}/{ctx['type_id']}/backfill")
    assert r.status_code == 409, r.text
    assert (r.json()["error"]["code"], r.json()["error"]["details"]) == ("job_running", {"job_id": live_id})
    with app.state.library.session() as s:
        s.get(Job, live_id).state = "succeeded"
    assert _backfill(client, ctx)["created"] == 2  # a finished one no longer blocks


def test_a_missing_recent_folder_is_reported_and_skipped(client, app, ctx, tmp_path):
    app.state.projects.appdata.remember("gone-id", "Gone", str(tmp_path / "gone"))
    client.patch(f"{TYPES}/{ctx['type_id']}", json={"kind": "defect"})
    result = _backfill(client, ctx)
    assert {"project": "Gone", "created": 0, "skipped": "folder_missing"} in result["projects"]
    assert result["created"] == 2


def test_a_project_waiting_for_its_upgrade_is_left_to_the_migration(client, app, handle, ctx, monkeypatch):
    """Its upgrade's step 6 backfills every defect type; two writers never share its database."""
    from app.migration import job as migration_job

    client.patch(f"{TYPES}/{ctx['type_id']}", json={"kind": "defect"})
    monkeypatch.setattr(migration_job, "armed", lambda: True)
    monkeypatch.setattr(handle, "schema_version", 1)
    result = _backfill(client, ctx)
    entry = next(p for p in result["projects"] if p.get("project_id") == ctx["project_id"])
    assert (entry["created"], entry["skipped"]) == (0, "upgrading")
    monkeypatch.undo()
    assert _findings(client, ctx) == []


def test_the_function_pages_in_batches(client, handle, ctx):
    client.patch(f"{TYPES}/{ctx['type_id']}", json={"kind": "defect"})
    seen: list[tuple[int, int]] = []
    assert (
        findings_from_annotations(
            handle, [ctx["type_id"]], batch=1, progress=lambda d, t: seen.append((d, t))
        )
        == 2
    )
    assert seen == [(1, 2), (2, 2)]
    assert findings_from_annotations(handle, [ctx["type_id"]]) == 0


def test_a_cancel_between_batches_keeps_what_committed_and_a_rerun_fills_the_gap(client, handle, ctx):
    client.patch(f"{TYPES}/{ctx['type_id']}", json={"kind": "defect"})
    calls = []

    def cancel_on_second_batch() -> None:
        calls.append(1)
        if len(calls) == 2:
            raise JobCancelled()

    with pytest.raises(JobCancelled):
        findings_from_annotations(handle, [ctx["type_id"]], batch=1, check_cancelled=cancel_on_second_batch)
    assert [f["number"] for f in _findings(client, ctx)] == [1]
    assert findings_from_annotations(handle, None) == 1  # None: every defect type of the project
    assert [f["number"] for f in _findings(client, ctx)] == [1, 2]
