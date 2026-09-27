"""summary_rebuild (image inspection spec §7.1, §15): the repair job, its route and the open check."""

from image_summary_helpers import add_box, expected_summary, new_image, stored_summary
from sqlalchemy import delete

from app.db.models import ImageSummary, MigrationStep
from app.imagery import jobs_summary


def _wipe(handle):
    with handle.session() as s:
        s.execute(delete(ImageSummary))


def test_rebuild_restores_every_row(client, project, handle, wait_job, monkeypatch):
    monkeypatch.setattr(jobs_summary, "BATCH", 2)
    cls = [c["id"] for c in project["classes"]]
    ids = [new_image(handle) for _ in range(5)]
    for n, i in enumerate(ids):
        add_box(handle, i, cls[0])
        add_box(handle, i, cls[1], state="unreviewed", conf=0.1 * (n + 1))
    _wipe(handle)
    r = client.post(f"/api/v1/projects/{project['id']}/image-summary/rebuild")
    assert r.status_code == 202, r.text
    job = wait_job(project["id"], r.json()["job"]["id"])
    assert job["state"] == "succeeded", job
    assert job["type"] == "summary_rebuild"
    for i in ids:
        assert stored_summary(handle, i) == expected_summary(handle, i)


def test_a_second_rebuild_while_one_is_live_is_refused(client, project, handle, monkeypatch):
    monkeypatch.setattr(jobs_summary, "live_rebuild_id", lambda h: "job-1")
    r = client.post(f"/api/v1/projects/{project['id']}/image-summary/rebuild")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "job_running"
    assert r.json()["error"]["details"]["job_id"] == "job-1"


def test_open_queues_a_rebuild_once_when_rows_are_missing(app, project, handle, wait_job):
    """Review Focus 3: boxes without summary rows. 0011 seeds every image, so on a healthy project
    this guard normally finds nothing; here the rows are wiped by hand. The marker is written first
    so the missing-rows probe (not the marker check) is what's under test."""
    with handle.session() as s:
        s.merge(MigrationStep(name=jobs_summary.REBUILD_MARKER, detail={"images": 0}))
    cls = [c["id"] for c in project["classes"]]
    image_id = new_image(handle)
    add_box(handle, image_id, cls[0])
    _wipe(handle)
    job = jobs_summary.check_on_open(handle, app.state.jobs)
    assert job is not None
    assert wait_job(project["id"], job.id)["state"] == "succeeded"
    assert stored_summary(handle, image_id) == (1, 0, None)
    assert jobs_summary.check_on_open(handle, app.state.jobs) is None


def test_open_queues_nothing_for_a_project_without_boxes(app, handle):
    new_image(handle)  # imported images have no row until a box is written; that reads as zeros
    assert jobs_summary.check_on_open(handle, app.state.jobs) is None
    with handle.session() as s:
        assert s.get(MigrationStep, jobs_summary.REBUILD_MARKER) is not None


def test_open_queues_nothing_on_a_healthy_project(app, project, handle):
    add_box(handle, new_image(handle), project["classes"][0]["id"])  # the session events wrote its row
    # A healthy project already carries the marker (written on an earlier open, or here directly);
    # without it, Ruling 1 queues one rebuild regardless of row health to close the C0 no-op window.
    with handle.session() as s:
        s.merge(MigrationStep(name=jobs_summary.REBUILD_MARKER, detail={"images": 0}))
    assert jobs_summary.check_on_open(handle, app.state.jobs) is None


def test_open_rebuilds_stale_seeded_rows_once(app, project, handle, wait_job):
    """Controller ruling (hand-off I-C0 -> I-BX): C0 shipped `summary.touch` as a no-op, so a
    project written between 0011's seed and BX landing can hold a stale seeded row that the
    missing-rows probe can't see (the row exists, it's just wrong). No marker -> one rebuild."""
    image_id = new_image(handle)
    add_box(handle, image_id, project["classes"][0]["id"])
    with handle.session() as s:
        row = s.get(ImageSummary, image_id)
        row.annotation_count = 99
        # The `project` fixture opens the handle, which already ran check_on_open once with zero
        # boxes and wrote the marker. Clear it to simulate an existing pre-BX project.
        s.execute(delete(MigrationStep).where(MigrationStep.name == jobs_summary.REBUILD_MARKER))
    assert stored_summary(handle, image_id) != expected_summary(handle, image_id)
    with handle.session() as s:
        assert s.get(MigrationStep, jobs_summary.REBUILD_MARKER) is None

    job = jobs_summary.check_on_open(handle, app.state.jobs)
    assert job is not None
    assert wait_job(project["id"], job.id)["state"] == "succeeded"
    assert stored_summary(handle, image_id) == expected_summary(handle, image_id)
    with handle.session() as s:
        assert s.get(MigrationStep, jobs_summary.REBUILD_MARKER) is not None

    assert jobs_summary.check_on_open(handle, app.state.jobs) is None
