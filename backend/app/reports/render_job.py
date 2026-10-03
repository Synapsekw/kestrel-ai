"""The `report_render` job (spec 2026-09-26-reports §15, §16; plan R5).

compose (5 %) -> snapshots (55 %, per figure) -> PDF (35 %, per flowable, through R4) -> tables
(5 %), all into `reports/<rid>/.partial-<stamp>`; then `versions.promote` renames it to `v<NNN>`
and allocates the number (ruling 2). Cancel: between figures, flowables, parts and every 200 table
rows; a cancelled render leaves no row and no folder; a failed one is marked `failed`.

The document is composed through ONE `ComposeContext` carrying the version number (so the cover
prints `v001`, not "Preview"); its warnings and its ordered finding ids come from the same context
(ruling P1). reportlab and openpyxl load inside the PDF and table phases only (index rule)."""

from __future__ import annotations

import errno
import hashlib
import re
import shutil
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel
from sqlalchemy import select

from app.db.models import Finding
from app.exports.job import _now_local, _reserve_partial_folder
from app.jobs.cancellation import JobCancelled, JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.reports import versions
from app.reports.baseline import resolve_baseline
from app.reports.compose import ComposeContext, compose_in, iter_findings
from app.reports.schemas import ReportConfig, ReportDocument, SnapshotRef, TableDotCell
from app.reports.service import PAGE_COUNT_KEY
from app.reports.snapshots import render_to_cache
from app.reports.snapshots.cache import prune
from app.reports.theme import THEME_VERSION
from app.reports.writers import csv_out, rows, xlsx_out

PHASES = {"compose": (0.0, 0.05), "snapshots": (0.05, 0.60), "pdf": (0.60, 0.95), "tables": (0.95, 1.0)}
TABLE_CHECK_EVERY = 200
DISK_FULL = "The disk is full, so the report could not be written. Free some space and render again."
_WIN_DISK_FULL = {112, 39}  # ERROR_DISK_FULL, ERROR_HANDLE_DISK_FULL


class _Progress:
    """`ctx.progress` mapped into a phase's band and never allowed to go backwards (§17)."""

    def __init__(self, ctx: JobContext):
        self.ctx, self.last = ctx, 0.0

    def phase(self, name: str, fraction: float, message: str) -> None:
        lo, hi = PHASES[name]
        value = max(self.last, lo + (hi - lo) * max(0.0, min(1.0, float(fraction))))
        self.last = value
        self.ctx.progress(value, message)


def _slug(text: str, fallback: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower() or fallback


def iter_snapshot_refs(node) -> Iterator[SnapshotRef]:
    """Every SnapshotRef anywhere in the document (figures, figure rows, finding figures and
    photos, volume figures), without knowing the block kinds."""
    if isinstance(node, SnapshotRef):
        yield node
    elif isinstance(node, BaseModel):
        for name in type(node).model_fields:
            yield from iter_snapshot_refs(getattr(node, name))
    elif isinstance(node, list | tuple):
        for item in node:
            yield from iter_snapshot_refs(item)
    elif isinstance(node, dict):
        for item in node.values():
            yield from iter_snapshot_refs(item)


def unique_refs(doc: ReportDocument) -> list[SnapshotRef]:
    seen: dict[str, SnapshotRef] = {}
    for ref in iter_snapshot_refs(doc):
        seen.setdefault(ref.key, ref)
    return list(seen.values())


def drop_findings(doc: ReportDocument, missing: set[str]) -> ReportDocument:
    sections = [
        sec.model_copy(
            update={
                "blocks": [
                    b
                    for b in sec.blocks
                    if not (getattr(b, "kind", None) == "finding" and b.finding_id in missing)
                ]
            }
        )
        for sec in doc.sections
    ]
    return doc.model_copy(update={"sections": sections})


def finding_ids(ctx: ComposeContext) -> list[str]:
    """The filtered findings in number order (ruling 5), through R2's filter SQL on the compose ctx."""
    return [row.id for row in iter_findings(ctx, "number")]


def _baseline_id(baseline) -> str | None:
    return None if baseline is None else baseline.version_id


def _states(handle, ids: list[str]) -> dict[str, tuple[str, int | None, str]]:
    out: dict[str, tuple[str, int | None, str]] = {}
    with handle.session() as s:
        for start in range(0, len(ids), versions.STATES_CHUNK):
            chunk = ids[start : start + versions.STATES_CHUNK]
            q = select(Finding.id, Finding.type_id, Finding.severity, Finding.status).where(
                Finding.id.in_(chunk)
            )
            for fid, type_id, severity, status in s.execute(q):
                out[fid] = (type_id, severity, status)
    return out


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def _file_entry(path: Path, kind: str) -> dict:
    return {
        "name": path.name,
        "kind": kind,
        "bytes": path.stat().st_size,
        "sha256": _sha256(path),
        "pages": None,
    }


def _render_snapshots(
    handle, doc: ReportDocument, ctx: JobContext, progress: _Progress, warnings: list[dict]
) -> dict[str, Path]:
    """One render per unique key. A figure that cannot render (for example a broken engine import)
    is logged and left unmapped, so R4 prints its placeholder (ruling P7); a cancel propagates."""
    refs = unique_refs(doc)
    paths: dict[str, Path] = {}
    failed = 0
    for i, ref in enumerate(refs, 1):
        ctx.check_cancelled()
        try:
            paths[ref.key] = render_to_cache(handle, ref.spec)
        except JobCancelled:
            raise
        except Exception:
            failed += 1
            ctx.log.exception("snapshot %s could not be rendered", ref.key)
        progress.phase("snapshots", i / len(refs), f"figure {i} of {len(refs)}")
    progress.phase("snapshots", 1.0, f"{len(refs)} figures ready")
    if failed:
        warnings.append(
            {
                "code": "snapshot_failed",
                "message": f"{failed} figure(s) could not be rendered and print as a placeholder.",
                "count": failed,
                "link": None,
            }
        )
    return paths


def _render_pdf(
    handle, doc, partial: Path, base_name: str, paths: dict[str, Path], ctx, progress, brand=None
) -> list[dict]:
    from app.reports.pdf import document as pdf_document  # reportlab loads here (index rule)
    from app.reports.volume_hook import volume_flowables_for

    def snapshot_path(ref: SnapshotRef) -> Path | None:
        return paths.get(ref.key)  # None: R4 prints the placeholder (ruling P7)

    parts = pdf_document.render_pdf(
        doc,
        partial,
        base_name,
        snapshot_path=snapshot_path,
        volume_flowables=volume_flowables_for(handle, snapshot_path),
        progress=lambda f: progress.phase("pdf", f, "writing the PDF"),
        check_cancelled=ctx.check_cancelled,
        brand=brand,
    )
    return [
        {"name": p.name, "kind": "pdf", "bytes": p.bytes, "sha256": p.sha256, "pages": p.pages} for p in parts
    ]


def _counts_tables(doc: ReportDocument) -> list[list[list]]:
    """The `object_counts` tables as plain values; a TableDotCell prints its text (ruling P5)."""
    tables = []
    for sec in doc.sections:
        if sec.key != "object_counts":
            continue
        for b in sec.blocks:
            if getattr(b, "kind", None) == "table":
                body = [[c.text if isinstance(c, TableDotCell) else c for c in r] for r in b.rows]
                tables.append([[c.label for c in b.columns], *body])
    return tables


def _write_tables(
    handle,
    ctx,
    progress,
    partial: Path,
    *,
    formats,
    ids,
    doc,
    config,
    scale,
    title,
    number,
    baseline_id,
    generated_at,
) -> list[dict]:
    wanted = [f for f in ("csv", "xlsx") if f in formats]
    files: list[dict] = []
    if not wanted:
        progress.phase("tables", 1.0, "no tables requested")
        return files
    total = max(1, len(ids) * len(wanted))
    done = {"n": 0}

    def on_row(_n: int) -> None:
        done["n"] += 1
        if done["n"] % TABLE_CHECK_EVERY == 0:
            ctx.check_cancelled()
            progress.phase("tables", done["n"] / total, f"tables: {done['n']} of {total} rows")

    enabled = [s.key for s in config.sections if s.enabled]
    for fmt in wanted:
        ctx.check_cancelled()
        source = rows.export_rows(handle, ids, scale=scale, version_number=number)
        if fmt == "csv":
            path = partial / "findings.csv"
            csv_out.write_csv(path, source, on_row=on_row)
        else:
            path = partial / "findings.xlsx"
            xlsx_out.write_xlsx(
                path,
                source,
                scale=scale,
                measurements=rows.measurement_rows(handle) if "measurements" in enabled else None,
                counts=_counts_tables(doc) if "object_counts" in enabled else [],
                report_info=[
                    ("Report", title),
                    ("Version", versions.version_dir_name(number)),
                    ("Generated at", generated_at.isoformat()),
                    ("Baseline", versions.describe_version(handle, baseline_id)),
                    ("Sections", ", ".join(enabled)),
                    ("Filters", config.filters.model_dump_json()),
                    ("Paper", config.paper.model_dump_json()),
                ],
                on_row=on_row,
            )
        files.append(_file_entry(path, fmt))
    progress.phase("tables", 1.0, "tables written")
    return files


def _disk_full(e: OSError) -> bool:
    return e.errno == errno.ENOSPC or getattr(e, "winerror", None) in _WIN_DISK_FULL


def _run_pipeline(ctx: JobContext) -> dict:
    handle, p = ctx.project, ctx.params
    report_id, version_id = p["report_id"], p["version_id"]
    formats = list(dict.fromkeys(p["formats"]))
    progress = _Progress(ctx)

    progress.phase("compose", 0.0, "composing the report")
    title = versions.report_title(handle, report_id)
    config = ReportConfig.model_validate(versions.rendering_config(handle, version_id))  # frozen at click
    number = versions.next_number(handle, report_id)
    generated_at = datetime.now(UTC)  # the one clock read (spec §8.1)
    baseline = resolve_baseline(handle, report_id)
    cctx = ComposeContext(
        handle=handle,
        config=config,
        report_id=report_id,
        baseline=baseline,
        generated_at=generated_at,
        version=number,
        issued=False,
    )
    doc = compose_in(cctx, theme_version=str(THEME_VERSION))
    ids = finding_ids(cctx)
    warnings: list[dict] = [w.model_dump() for w in cctx.warnings]
    from app.reports.brand import BRAND_MISSING, resolve_brand

    brand = resolve_brand(handle, config, generated_at)
    if config.brand_id and brand is None:
        warnings.append({"code": "brand_missing", "message": BRAND_MISSING, "count": 1, "link": None})
    scale = {lv.level: lv for lv in cctx.scale}  # read_scale(handle), read once by the ctx
    progress.phase("compose", 1.0, f"composed: {len(ids)} findings")
    base_name = (
        f"{_slug(cctx.project_name, 'project')}-{_slug(title, 'report')}-{versions.version_dir_name(number)}"
    )

    root = versions.reports_root(handle, report_id)
    try:
        root.mkdir(parents=True, exist_ok=True)
        partial, _stamp, _n = _reserve_partial_folder(root, _now_local())
    except OSError as e:
        if _disk_full(e):
            raise JobFailure(DISK_FULL) from e
        raise
    try:
        paths = _render_snapshots(handle, doc, ctx, progress, warnings)
        ctx.check_cancelled()
        states = _states(handle, ids)
        missing = {i for i in ids if i not in states}
        if missing:
            doc = drop_findings(doc, missing)
            ids = [i for i in ids if i in states]
            warnings.append(
                {
                    "code": "finding_deleted",
                    "message": f"{len(missing)} finding(s) were deleted during the render and were left out.",
                    "count": len(missing),
                    "link": None,
                }
            )
        pdf_files: list[dict] = []
        if "pdf" in formats:
            pdf_files = _render_pdf(handle, doc, partial, base_name, paths, ctx, progress, brand=brand)
        progress.phase("pdf", 1.0, "PDF written" if pdf_files else "no PDF requested")
        table_files = _write_tables(
            handle,
            ctx,
            progress,
            partial,
            formats=formats,
            ids=ids,
            doc=doc,
            config=config,
            scale=scale,
            title=title,
            number=number,
            baseline_id=_baseline_id(baseline),
            generated_at=generated_at,
        )
        (partial / "document.json").write_text(doc.model_dump_json(), "utf-8")
        ctx.check_cancelled()
        files = pdf_files + table_files
        stats = {
            "finding_count": len(ids),
            PAGE_COUNT_KEY: sum(f["pages"] or 0 for f in pdf_files),
            "part_count": len(pdf_files),
            "warnings": warnings,
            "formats": formats,
        }
        final = versions.promote(
            handle,
            report_id=report_id,
            version_id=version_id,
            number=number,
            partial=partial,
            files=files,
            stats=stats,
            baseline_version_id=_baseline_id(baseline),
            states=[(i, *states[i]) for i in ids],
        )
    except OSError as e:
        shutil.rmtree(partial, ignore_errors=True)
        if _disk_full(e):
            raise JobFailure(DISK_FULL) from e
        raise
    except BaseException:
        shutil.rmtree(partial, ignore_errors=True)
        raise
    finally:
        try:
            prune(handle)
        except Exception:
            ctx.log.exception("snapshot cache prune failed")
    folder = "/".join(final.relative_to(handle.folder).parts)
    ctx.log.info("report %s rendered as %s: %s", report_id, folder, [f["name"] for f in files])
    return {"version_id": version_id, "number": number, "folder": folder, "files": [f["name"] for f in files]}


run_pipeline = _run_pipeline  # the offline seam (ruling 12): tests/conftest.py replaces it


def _discard_queued(ctx: JobContext) -> None:
    versions.discard(ctx.project, ctx.params["version_id"])


@register_job_type("report_render", on_cancelled_before_start=_discard_queued)
def run_report_render(ctx: JobContext) -> dict:
    version_id = ctx.params["version_id"]
    try:
        return run_pipeline(ctx)
    except JobCancelled:
        try:
            versions.discard(ctx.project, version_id)
        except Exception:
            ctx.log.exception("could not discard cancelled version %s", version_id)
        raise
    except JobFailure as e:
        _settle_failed(ctx, version_id, str(e))
        raise
    except Exception as e:
        _settle_failed(ctx, version_id, f"{type(e).__name__}: {e}")
        raise


def _settle_failed(ctx: JobContext, version_id: str, message: str) -> None:
    """Before the runner's terminal write, so a client reloading on `job.state` sees `failed`."""
    try:
        versions.mark_failed(ctx.project, version_id, message)
    except Exception:
        ctx.log.exception("could not mark version %s failed", version_id)
