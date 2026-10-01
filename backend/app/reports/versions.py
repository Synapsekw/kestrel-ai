"""Report versions (spec 2026-09-26-reports §4, §6.1, §6.3; plan R5 rulings 1-4, 13).

A render inserts a `rendering` row with no number. Only `promote` gives it one: it renames the
job's partial folder to `reports/<rid>/v<NNN>` and, in one transaction, writes the number, files,
stats and the `report_version_finding` rows the next version's deltas are computed against. A
cancelled render deletes its row; a failed one keeps it as `failed` with the message."""

from __future__ import annotations

import os
import re
import shutil
import threading
import time
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path

from sqlalchemy import delete, func, insert, select
from sqlalchemy.exc import IntegrityError

from app.errors import AppError, not_found
from app.exports.job import RENAME_RETRIES, RENAME_RETRY_DELAY_S
from app.jobs.cancellation import JobFailure
from app.pagination import decode_cursor, encode_cursor, newest_first_page
from app.reports import schemas as rs
from app.reports.models import Report as ReportRow
from app.reports.models import ReportVersion as ReportVersionRow
from app.reports.models import ReportVersionFinding
from app.reports.service import reports_folder

VERSION_DIR_RE = re.compile(r"^v(\d{3,})$")
STATES_CHUNK = 500
INTERRUPTED = "Interrupted by an application restart. Render the report again."
# Serialises "is a render running? then insert a row and submit" (POST /renders) with the startup
# sweep, so two quick clicks can never both pass the check.
render_lock = threading.Lock()


def reports_root(handle, report_id: str) -> Path:
    return reports_folder(handle, report_id)


def version_dir_name(number: int) -> str:
    return f"v{number:03d}"


def next_number(handle, report_id: str) -> int:
    """max(numbered rows, `v<NNN>` folders on disk) + 1 (ruling 3)."""
    with handle.session() as s:
        top = s.execute(
            select(func.max(ReportVersionRow.number)).where(ReportVersionRow.report_id == report_id)
        ).scalar()
    on_disk = 0
    root = reports_root(handle, report_id)
    if root.is_dir():
        for entry in root.iterdir():
            m = VERSION_DIR_RE.match(entry.name)
            if m:
                on_disk = max(on_disk, int(m.group(1)))
    return max(top or 0, on_disk) + 1


def report_title(handle, report_id: str) -> str:
    with handle.session() as s:
        report = s.get(ReportRow, report_id)
        if report is None:
            raise JobFailure("The report was deleted before it could be rendered.")
        return report.title


def rendering_config(handle, version_id: str) -> dict:
    """The config frozen on the version row at click time, so the stored and printed configs agree."""
    with handle.session() as s:
        row = s.get(ReportVersionRow, version_id)
        if row is None:
            raise JobFailure("The render was cancelled before it started.")
        return dict(row.config)


def create_rendering_row(handle, report_id: str, *, label: str | None) -> str:
    with handle.session() as s:
        report = s.get(ReportRow, report_id)
        if report is None:
            raise not_found("report", report_id)
        row = ReportVersionRow(
            report_id=report_id,
            number=None,
            state="rendering",
            files=[],
            config=dict(report.config),
            stats={"label": label} if label else {},
        )
        s.add(row)
        s.flush()
        return row.id


def clear_failed(handle, report_id: str) -> None:
    """Ruling 4: only the latest failure stays in the history."""
    with handle.session() as s:
        s.execute(
            delete(ReportVersionRow).where(
                ReportVersionRow.report_id == report_id, ReportVersionRow.state == "failed"
            )
        )


def mark_failed(handle, version_id: str, message: str) -> None:
    with handle.session() as s:
        row = s.get(ReportVersionRow, version_id)
        if row is None or row.state != "rendering":
            return
        row.state = "failed"
        row.stats = {**(row.stats or {}), "error": message}


def discard(handle, version_id: str) -> None:
    """A cancelled render leaves no version behind (ruling 4)."""
    with handle.session() as s:
        row = s.get(ReportVersionRow, version_id)
        if row is not None and row.state == "rendering":
            s.delete(row)


def start_render(handle, runner, report_id: str, *, formats: list[str], label: str | None):
    """POST /renders: 404 for an unknown report, 409 `render_running` while one is live."""
    with render_lock:
        with handle.session() as s:
            if s.get(ReportRow, report_id) is None:
                raise not_found("report", report_id)
            active = s.execute(
                select(ReportVersionRow.id, ReportVersionRow.job_id).where(
                    ReportVersionRow.report_id == report_id, ReportVersionRow.state == "rendering"
                )
            ).all()
        for version_id, job_id in active:
            if job_id is not None and runner.is_live(job_id):
                raise AppError(
                    "render_running",
                    "This report is already rendering. Wait for it, or cancel it in Jobs.",
                    409,
                    {"job_id": job_id},
                )
            mark_failed(handle, version_id, INTERRUPTED)  # left over from an earlier process
        clear_failed(handle, report_id)
        version_id = create_rendering_row(handle, report_id, label=label)
        try:
            job = runner.submit(
                handle,
                "report_render",
                {"report_id": report_id, "version_id": version_id, "formats": formats, "label": label},
            )
        except BaseException:
            discard(handle, version_id)
            raise
        with handle.session() as s:
            row = s.get(ReportVersionRow, version_id)
            if row is not None:  # a job that already finished and was discarded leaves no row
                row.job_id = job.id
        return job


def _rename_into_place(partial: Path, final: Path) -> None:
    """`os.replace` with `exports.job._promote`'s bounded retry for a briefly locked folder; a real
    clash (the destination exists) is refused, never renamed around (ruling 13)."""
    attempt = 0
    while True:
        if final.exists():
            raise JobFailure(f"A folder named {final.name} already exists for this report. Render again.")
        try:
            os.replace(partial, final)
            return
        except PermissionError:
            attempt += 1
            if attempt >= RENAME_RETRIES:
                raise
            time.sleep(RENAME_RETRY_DELAY_S)


def promote(
    handle,
    *,
    report_id: str,
    version_id: str,
    number: int,
    partial: Path,
    files: list[dict],
    stats: dict,
    baseline_version_id: str | None,
    states: list[tuple[str, str, int | None, str]],
) -> Path:
    final = reports_root(handle, report_id) / version_dir_name(number)
    _rename_into_place(partial, final)
    try:
        with handle.session() as s:
            row = s.get(ReportVersionRow, version_id)
            if row is None:
                raise JobFailure("The render was cancelled while it was being saved.")
            row.number = number
            row.state = "ready"
            row.folder = "/".join(final.relative_to(handle.folder).parts)
            row.files = files
            row.stats = {**(row.stats or {}), **stats}
            row.baseline_version_id = baseline_version_id
            s.flush()  # the unique (report_id, number) index is the last guard (ruling 2)
            for start in range(0, len(states), STATES_CHUNK):
                chunk = states[start : start + STATES_CHUNK]
                s.execute(
                    insert(ReportVersionFinding),
                    [
                        {
                            "version_id": version_id,
                            "finding_id": f,
                            "type_id": t,
                            "severity": sev,
                            "status": st,
                        }
                        for f, t, sev, st in chunk
                    ],
                )
    except IntegrityError as e:
        shutil.rmtree(final, ignore_errors=True)
        raise JobFailure(
            "The version could not be saved (it changed during the render). Render again."
        ) from e
    except BaseException:
        shutil.rmtree(final, ignore_errors=True)
        raise
    return final


def describe_version(handle, version_id: str | None) -> str:
    """ "Weekly inspection v3, issued 2026-09-20" for the XLSX Report sheet; "First report" for none."""
    if version_id is None:
        return "First report"
    with handle.session() as s:
        row = s.get(ReportVersionRow, version_id)
        if row is None or row.number is None:
            return "First report"
        report = s.get(ReportRow, row.report_id)
        title = report.title if report is not None else "another report"
        issued = f", issued {row.issued_at.date().isoformat()}" if row.issued_at else ""
        return f"{title} {version_dir_name(row.number)}{issued}"


DOCUMENT_MAX_LIMIT = 50


def to_schema(row: ReportVersionRow) -> rs.ReportVersion:
    return rs.ReportVersion.model_validate(
        {
            "id": row.id,
            "report_id": row.report_id,
            "number": row.number,
            "state": row.state,
            "issued_at": row.issued_at,
            "job_id": row.job_id,
            "folder": row.folder,
            "files": row.files or [],
            "config": row.config,  # R10's plan reads ReportVersion.config
            "baseline_version_id": row.baseline_version_id,
            "stats": row.stats or {},
            "created_at": row.created_at,
        }
    )


def _require_report(s, report_id: str) -> None:
    if s.get(ReportRow, report_id) is None:
        raise not_found("report", report_id)


def list_versions(handle, report_id: str, *, limit: int | None, cursor: str | None) -> rs.ReportVersionPage:
    with handle.session() as s:
        _require_report(s, report_id)
        q = select(ReportVersionRow).where(ReportVersionRow.report_id == report_id)
        found, next_cursor = newest_first_page(
            s, q, ReportVersionRow.created_at, ReportVersionRow.id, limit, cursor
        )
        return rs.ReportVersionPage(items=[to_schema(r) for r in found], next_cursor=next_cursor)


def _numbered(s, report_id: str, number: int) -> ReportVersionRow:
    _require_report(s, report_id)
    row = s.execute(
        select(ReportVersionRow).where(
            ReportVersionRow.report_id == report_id, ReportVersionRow.number == number
        )
    ).scalar_one_or_none()
    if row is None:
        raise not_found("report version", str(number))
    return row


def get_numbered(handle, report_id: str, number: int) -> rs.ReportVersion:
    with handle.session() as s:
        return to_schema(_numbered(s, report_id, number))


def set_issued(handle, report_id: str, number: int, issued: bool) -> rs.ReportVersion:
    with handle.session() as s:
        row = _numbered(s, report_id, number)
        if issued and row.issued_at is None:
            row.issued_at = datetime.now(UTC)
        elif not issued:
            row.issued_at = None
        s.flush()
        return to_schema(row)


def delete_version(handle, report_id: str, number: int) -> None:
    """Only a never-issued version; its rows first, then its folder (a folder a locked file keeps is
    skipped by `next_number`, ruling 3)."""
    with handle.session() as s:
        row = _numbered(s, report_id, number)
        if row.issued_at is not None:
            raise AppError("issued_version", "An issued version cannot be deleted. Unissue it first.", 409)
        folder = row.folder
        s.execute(delete(ReportVersionFinding).where(ReportVersionFinding.version_id == row.id))
        s.delete(row)
    if folder:
        target = handle.folder / folder
        root = reports_root(handle, report_id)
        if VERSION_DIR_RE.match(target.name) and target.resolve().parent == root.resolve():
            shutil.rmtree(target, ignore_errors=True)


@lru_cache(maxsize=4)
def _parsed(path: str, _mtime_ns: int, _size: int) -> rs.ReportDocument:
    return rs.ReportDocument.model_validate_json(Path(path).read_bytes())


def _block_index(cursor: str | None) -> int:
    """The `i` of a document cursor: an int >= 0, else the same 422 as any other bad cursor."""
    if not cursor:
        return 0
    i = decode_cursor(cursor, "i")["i"]
    if not isinstance(i, int) or isinstance(i, bool) or i < 0:
        raise AppError("validation_error", "invalid cursor", 422)
    return i


def document_page(
    handle, report_id: str, number: int, *, cursor: str | None, limit: int | None
) -> rs.ReportDocumentPage:
    with handle.session() as s:
        row = _numbered(s, report_id, number)
        folder = row.folder
    path = handle.folder / folder / "document.json"
    try:
        st = path.stat()
    except FileNotFoundError:
        raise not_found("report version document", str(number)) from None
    doc = _parsed(str(path), st.st_mtime_ns, st.st_size)
    n = max(1, min(DOCUMENT_MAX_LIMIT, limit or DOCUMENT_MAX_LIMIT))
    start = _block_index(cursor)
    stop = start + n
    out, i = [], 0
    for sec in doc.sections:
        count = len(sec.blocks)
        lo, hi = max(start - i, 0), min(stop - i, count)
        if lo < hi:
            out.append(sec.model_copy(update={"blocks": sec.blocks[lo:hi]}))
        i += count
    return rs.ReportDocumentPage(
        report_id=doc.report_id,
        version=doc.version,
        generated_at=doc.generated_at,
        theme_version=doc.theme_version,
        sections=out,
        next_cursor=encode_cursor(i=stop) if stop < i else None,
    )
