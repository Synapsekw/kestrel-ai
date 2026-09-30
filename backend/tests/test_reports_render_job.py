"""R5 job tests (spec §17 "Job"): progress monotonic, cancel removes the partial folder, the number
is allocated only on promote, a failed version is marked, deleted findings are skipped."""

import errno
import json

import pytest
from PIL import Image as PILImage
from report_docs import key
from reports_render_helpers import FakeCtx, fake_document, map_finding, new_report

from app.jobs.cancellation import JobCancelled, JobFailure
from app.reports import render_job, versions
from app.reports.models import ReportVersion
from app.reports.pdf.document import PdfPart

REAL_COMPOSE_IN, REAL_FINDING_IDS = render_job.compose_in, render_job.finding_ids


@pytest.fixture
def live_render(app, monkeypatch):
    monkeypatch.setattr(render_job, "run_pipeline", render_job._run_pipeline)


@pytest.fixture
def report(client, project_id):
    return new_report(client, project_id)


def _fake_render_pdf(
    doc, out_dir, base_name, *, snapshot_path, volume_flowables, progress, check_cancelled, **_
):
    for f in (0.25, 0.5, 1.0):
        check_cancelled()
        progress(f)
    path = out_dir / f"{base_name}.pdf"
    path.write_bytes(b"%PDF-1.4 fake")
    return [PdfPart(name=path.name, path=path, pages=3, bytes=path.stat().st_size, sha256="0" * 64)]


@pytest.fixture
def fakes(monkeypatch, tmp_path):
    """compose, snapshots and the PDF replaced; the tables, promote and document.json are real."""
    state = {"doc": None, "ids": [], "renders": 0}
    jpeg = tmp_path / "snap.jpg"
    PILImage.new("RGB", (8, 6), "grey").save(jpeg, "JPEG")

    def fake_render_to_cache(handle, spec):
        state["renders"] += 1
        return jpeg

    def fake_compose_in(ctx, **_):
        return state["doc"].model_copy(update={"version": ctx.version})

    monkeypatch.setattr(render_job, "compose_in", fake_compose_in)
    monkeypatch.setattr(render_job, "finding_ids", lambda *a, **k: list(state["ids"]))
    monkeypatch.setattr(render_job, "resolve_baseline", lambda *a, **k: None)
    monkeypatch.setattr(render_job, "render_to_cache", fake_render_to_cache)
    monkeypatch.setattr(render_job, "prune", lambda *a, **k: None)
    monkeypatch.setattr("app.reports.pdf.document.render_pdf", _fake_render_pdf)
    return state


def _ctx(handle, report, formats=("pdf", "csv"), **kw):
    vid = versions.create_rendering_row(handle, report["id"], label=None)
    params = {"report_id": report["id"], "version_id": vid, "formats": list(formats), "label": None}
    return FakeCtx(handle, params, **kw), vid


def _row(handle, vid):
    with handle.session() as s:
        row = s.get(ReportVersion, vid)
        if row is None:
            return None
        s.expunge(row)
        return row


def _partials(handle, report):
    root = versions.reports_root(handle, report["id"])
    return list(root.glob(".partial-*")) if root.is_dir() else []


def test_a_render_promotes_v001_with_files_and_document(live_render, handle, report, fakes):
    fakes["doc"] = fake_document(report["id"], figures=3)
    ctx, vid = _ctx(handle, report)
    result = render_job.run_report_render(ctx)
    row = _row(handle, vid)
    assert (row.state, row.number, result["number"]) == ("ready", 1, 1)
    folder = handle.folder / row.folder
    assert folder.name == "v001"
    names = sorted(f["name"] for f in row.files)
    assert names == sorted(["findings.csv", next(p.name for p in folder.glob("*.pdf"))])
    assert next(folder.glob("*.pdf")).name.endswith("-v001.pdf")
    assert {f["name"]: f["pages"] for f in row.files}["findings.csv"] is None
    assert json.loads((folder / "document.json").read_text("utf-8"))["version"] == 1
    assert fakes["renders"] == 3 and _partials(handle, report) == []
    assert row.stats["page_count"] == 3 and row.stats["part_count"] == 1


def test_progress_is_monotonic_and_reaches_one(live_render, handle, report, fakes):
    fakes["doc"] = fake_document(report["id"], figures=4)
    ctx, _ = _ctx(handle, report)
    render_job.run_report_render(ctx)
    assert ctx.values == sorted(ctx.values)
    assert ctx.values[-1] == pytest.approx(1.0)
    assert any(0.05 < v <= 0.60 for v in ctx.values) and any(0.60 < v <= 0.95 for v in ctx.values)


def test_cancel_mid_snapshots_removes_partial_and_row_and_consumes_no_number(
    live_render, handle, report, fakes
):
    fakes["doc"] = fake_document(report["id"], figures=5)
    ctx, vid = _ctx(handle, report, cancel_at=3)
    with pytest.raises(JobCancelled):
        render_job.run_report_render(ctx)
    assert _row(handle, vid) is None and _partials(handle, report) == []
    assert versions.next_number(handle, report["id"]) == 1


def test_the_number_is_written_only_on_promote(live_render, handle, report, fakes, monkeypatch):
    fakes["doc"] = fake_document(report["id"], figures=1)
    seen = {}
    real_promote = versions.promote

    def spy(handle_, **kw):
        seen["before"] = _row(handle_, kw["version_id"]).number
        return real_promote(handle_, **kw)

    monkeypatch.setattr(versions, "promote", spy)
    ctx, vid = _ctx(handle, report)
    render_job.run_report_render(ctx)
    assert seen["before"] is None and _row(handle, vid).number == 1


def test_a_failure_marks_the_version_failed(live_render, handle, report, fakes, monkeypatch):
    fakes["doc"] = fake_document(report["id"], figures=1)

    def broken(*a, **k):
        raise RuntimeError("renderer exploded")

    monkeypatch.setattr("app.reports.pdf.document.render_pdf", broken)
    ctx, vid = _ctx(handle, report)
    with pytest.raises(RuntimeError):
        render_job.run_report_render(ctx)
    row = _row(handle, vid)
    assert (row.state, row.number) == ("failed", None)
    assert "renderer exploded" in row.stats["error"] and _partials(handle, report) == []


def test_disk_full_fails_with_a_plain_message(live_render, handle, report, fakes, monkeypatch):
    fakes["doc"] = fake_document(report["id"], figures=0)

    def full(*a, **k):
        raise OSError(errno.ENOSPC, "No space left on device")

    monkeypatch.setattr("app.reports.pdf.document.render_pdf", full)
    ctx, vid = _ctx(handle, report)
    with pytest.raises(JobFailure, match="disk is full"):
        render_job.run_report_render(ctx)
    assert _row(handle, vid).stats["error"].startswith("The disk is full")
    assert _partials(handle, report) == []


def test_a_finding_deleted_between_compose_and_render_is_skipped(
    live_render, client, handle, project_id, report, crack, fakes, monkeypatch
):
    a = map_finding(client, handle, project_id, crack["id"])
    b = map_finding(client, handle, project_id, crack["id"])
    fakes["doc"] = fake_document(report["id"], figures=1, finding_ids=(a["id"], b["id"]))
    fakes["ids"] = [a["id"], b["id"]]

    def delete_b_then_render(handle_, spec):
        client.delete(f"/api/v1/projects/{project_id}/findings/{b['id']}")
        return fakes_jpeg

    fakes_jpeg = render_job.render_to_cache(handle, None)
    monkeypatch.setattr(render_job, "render_to_cache", delete_b_then_render)
    ctx, vid = _ctx(handle, report, formats=("pdf", "csv"))
    render_job.run_report_render(ctx)
    row = _row(handle, vid)
    assert row.stats["finding_count"] == 1
    assert any(w["code"] == "findings_deleted" for w in row.stats["warnings"])
    doc = json.loads((handle.folder / row.folder / "document.json").read_text("utf-8"))
    printed = [
        blk["finding_id"] for sec in doc["sections"] for blk in sec["blocks"] if blk["kind"] == "finding"
    ]
    assert printed == [a["id"]]
    from sqlalchemy import select

    from app.reports.models import ReportVersionFinding

    with handle.session() as s:
        frozen = (
            s.execute(select(ReportVersionFinding.finding_id).where(ReportVersionFinding.version_id == vid))
            .scalars()
            .all()
        )
    assert frozen == [a["id"]]


def test_a_failed_snapshot_is_a_warning_and_maps_to_none(live_render, handle, report, fakes, monkeypatch):
    """Ruling P7: one broken figure prints a placeholder instead of failing the whole report."""
    fakes["doc"] = fake_document(report["id"], figures=2)
    bad = key(f"{report['id']}-fig-0")
    good_jpeg = render_job.render_to_cache(handle, None)
    calls = []

    def flaky(handle_, spec):
        calls.append(spec)
        if len(calls) == 1:
            raise ImportError("no snapshot engine")
        return good_jpeg

    seen = {}

    def recording_render_pdf(doc, out_dir, base_name, *, snapshot_path, **kw):
        seen.update({ref.key: snapshot_path(ref) for ref in render_job.unique_refs(doc)})
        return _fake_render_pdf(doc, out_dir, base_name, snapshot_path=snapshot_path, **kw)

    monkeypatch.setattr(render_job, "render_to_cache", flaky)
    monkeypatch.setattr("app.reports.pdf.document.render_pdf", recording_render_pdf)
    ctx, vid = _ctx(handle, report)
    render_job.run_report_render(ctx)
    row = _row(handle, vid)
    assert row.state == "ready"
    assert seen[bad] is None and seen[key(f"{report['id']}-fig-1")] == good_jpeg
    assert len(calls) == 2  # no second render_to_cache for the unmapped key
    failed = [w for w in row.stats["warnings"] if w["code"] == "snapshot_failed"]
    assert len(failed) == 1 and failed[0]["count"] == 1
    assert set(failed[0]) == {"code", "message", "count", "link"}


def test_a_cancel_during_a_snapshot_is_not_swallowed(live_render, handle, report, fakes, monkeypatch):
    fakes["doc"] = fake_document(report["id"], figures=2)

    def cancelled(handle_, spec):
        raise JobCancelled()

    monkeypatch.setattr(render_job, "render_to_cache", cancelled)
    ctx, vid = _ctx(handle, report)
    with pytest.raises(JobCancelled):
        render_job.run_report_render(ctx)
    assert _row(handle, vid) is None and _partials(handle, report) == []


def test_snapshot_refs_are_deduplicated_by_key(report):
    doc = fake_document(report["id"], figures=2)
    doc.sections[0].blocks.append(doc.sections[0].blocks[0])
    assert [r.key for r in render_job.unique_refs(doc)] == [key(f"{report['id']}-fig-{i}") for i in range(2)]


def test_a_csv_only_render_writes_no_pdf(live_render, handle, report, fakes):
    fakes["doc"] = fake_document(report["id"], figures=2)
    ctx, vid = _ctx(handle, report, formats=("csv",))
    render_job.run_report_render(ctx)
    row = _row(handle, vid)
    assert [f["kind"] for f in row.files] == ["csv"] and row.stats["page_count"] == 0


def test_counts_tables_flatten_dot_cells():
    from report_docs import document, table_section

    doc = document([{**table_section(1), "key": "object_counts"}])
    assert render_job._counts_tables(doc) == [[["No.", "Type", "Severity"], ["F-0001", "Crack", "Major"]]]


def test_the_real_compose_carries_the_version_and_its_findings(
    live_render, client, handle, project_id, report, crack, fakes, monkeypatch
):
    """Ruling P1: one ComposeContext with version=number; ids come from the same ctx."""
    monkeypatch.setattr(render_job, "compose_in", REAL_COMPOSE_IN)
    monkeypatch.setattr(render_job, "finding_ids", REAL_FINDING_IDS)
    map_finding(client, handle, project_id, crack["id"])
    ctx, vid = _ctx(handle, report, formats=("csv",))
    render_job.run_report_render(ctx)
    row = _row(handle, vid)
    doc = json.loads((handle.folder / row.folder / "document.json").read_text("utf-8"))
    assert doc["version"] == 1 and row.stats["finding_count"] == 1
    cover = next(sec for sec in doc["sections"] if sec["key"] == "cover")["blocks"][0]
    assert ["Version", "v001"] in cover["rows"]
    lines = (handle.folder / row.folder / "findings.csv").read_text("utf-8-sig").splitlines()
    assert len(lines) == 2 and lines[1].startswith("F-0001,")
