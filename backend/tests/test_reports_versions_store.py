"""R5 version store: number allocation, the rendering row, promote (spec §4, §6.1, §6.3)."""

import pytest
from reports_render_helpers import new_report
from sqlalchemy import select

from app.jobs.cancellation import JobFailure
from app.reports import versions
from app.reports.models import ReportVersion, ReportVersionFinding


@pytest.fixture
def report(client, project_id):
    return new_report(client, project_id)


def _partial(handle, report_id, name=".partial-2026-09-30_100000"):
    p = versions.reports_root(handle, report_id) / name
    p.mkdir(parents=True)
    (p / "document.json").write_text("{}", "utf-8")
    return p


def test_first_number_is_one(handle, report):
    assert versions.next_number(handle, report["id"]) == 1


def test_next_number_skips_a_leftover_version_folder(handle, report):
    (versions.reports_root(handle, report["id"]) / "v007").mkdir(parents=True)
    assert versions.next_number(handle, report["id"]) == 8


def test_a_rendering_row_has_no_number(handle, report):
    vid = versions.create_rendering_row(handle, report["id"], label="draft for Anna")
    with handle.session() as s:
        row = s.get(ReportVersion, vid)
        assert (row.state, row.number, row.folder) == ("rendering", None, None)
        assert row.stats["label"] == "draft for Anna"
        assert row.config == report["config"]
    assert versions.next_number(handle, report["id"]) == 1


def test_promote_allocates_the_number_and_records_findings(handle, report):
    vid = versions.create_rendering_row(handle, report["id"], label=None)
    partial = _partial(handle, report["id"])
    final = versions.promote(
        handle,
        report_id=report["id"],
        version_id=vid,
        number=1,
        partial=partial,
        files=[{"name": "a.pdf", "kind": "pdf", "bytes": 3, "sha256": "0" * 64, "pages": 1}],
        stats={"finding_count": 1, "page_count": 1, "part_count": 1, "warnings": []},
        baseline_version_id=None,
        states=[("f1", "t1", 2, "open")],
    )
    assert final.name == "v001" and final.is_dir() and not partial.exists()
    with handle.session() as s:
        row = s.get(ReportVersion, vid)
        assert (row.state, row.number, row.folder) == ("ready", 1, f"reports/{report['id']}/v001")
        q = select(ReportVersionFinding).where(ReportVersionFinding.version_id == vid)
        frozen = s.execute(q).scalars().all()
        assert [(f.finding_id, f.type_id, f.severity, f.status) for f in frozen] == [("f1", "t1", 2, "open")]
    assert versions.next_number(handle, report["id"]) == 2


def test_promote_refuses_an_existing_folder_and_keeps_the_partial_gone(handle, report):
    vid = versions.create_rendering_row(handle, report["id"], label=None)
    (versions.reports_root(handle, report["id"]) / "v001").mkdir(parents=True)
    partial = _partial(handle, report["id"])
    with pytest.raises(JobFailure):
        versions.promote(
            handle,
            report_id=report["id"],
            version_id=vid,
            number=1,
            partial=partial,
            files=[],
            stats={},
            baseline_version_id=None,
            states=[],
        )
    assert partial.exists()  # the job's own except-branch removes it, not promote


def test_promote_removes_the_final_folder_when_the_row_is_gone(handle, report):
    vid = versions.create_rendering_row(handle, report["id"], label=None)
    versions.discard(handle, vid)
    partial = _partial(handle, report["id"])
    with pytest.raises(JobFailure):
        versions.promote(
            handle,
            report_id=report["id"],
            version_id=vid,
            number=1,
            partial=partial,
            files=[],
            stats={},
            baseline_version_id=None,
            states=[],
        )
    assert not (versions.reports_root(handle, report["id"]) / "v001").exists()


def test_mark_failed_keeps_the_message(handle, report):
    vid = versions.create_rendering_row(handle, report["id"], label=None)
    versions.mark_failed(handle, vid, "The disk is full")
    with handle.session() as s:
        row = s.get(ReportVersion, vid)
        assert (row.state, row.number, row.stats["error"]) == ("failed", None, "The disk is full")


def test_a_new_rendering_row_clears_earlier_failures(handle, report):
    old = versions.create_rendering_row(handle, report["id"], label=None)
    versions.mark_failed(handle, old, "boom")
    versions.clear_failed(handle, report["id"])
    with handle.session() as s:
        assert s.get(ReportVersion, old) is None
