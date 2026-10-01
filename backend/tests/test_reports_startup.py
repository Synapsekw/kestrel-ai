"""R5: the version row of a render the app never finished is marked failed at the next open."""

from types import SimpleNamespace

from reports_render_helpers import new_report

from app.reports import startup, versions
from app.reports.models import ReportVersion


def test_sweep_marks_an_orphaned_render_failed(client, handle, project_id):
    report = new_report(client, project_id)
    vid = versions.create_rendering_row(handle, report["id"], label=None)
    with handle.session() as s:
        s.get(ReportVersion, vid).job_id = "job-from-last-week"
    runner = SimpleNamespace(is_live=lambda job_id: False)
    assert startup.sweep_interrupted(handle, runner) == [vid]
    with handle.session() as s:
        row = s.get(ReportVersion, vid)
        assert (row.state, row.stats["error"]) == ("failed", versions.INTERRUPTED)


def test_sweep_leaves_a_live_render_alone(client, handle, project_id):
    report = new_report(client, project_id)
    vid = versions.create_rendering_row(handle, report["id"], label=None)
    with handle.session() as s:
        s.get(ReportVersion, vid).job_id = "live-job"
    runner = SimpleNamespace(is_live=lambda job_id: job_id == "live-job")
    assert startup.sweep_interrupted(handle, runner) == []
