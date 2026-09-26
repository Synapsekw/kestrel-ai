"""The `detect_export` job (spec 2026-09-23 section 10, plan 2 unit E).

Writes the detection numbers into `exports/<stamp>/`, exactly like a results export: a partial
folder promoted only when every file is written, removed on failure or cancellation.

- `csv`: one `detect-<project-slug>-<date>.csv`, one row per source x class x site area.
- `pdf`: one `detect-<source-slug>.pdf` per source that has a run (or just the requested source).

Reads run rows, sources, maps and site areas; the overview images are the map preview and at most
nine photo thumbnails per source.
"""

from __future__ import annotations

import re
import shutil

from app.detect import export_csv
from app.exports.job import _now_local, _promote, _reserve_partial_folder
from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext


def slug(name: str, fallback: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").lower() or fallback


def _unique(name: str, taken: set[str]) -> str:
    """`detect-a.pdf`, then `detect-a-2.pdf` when two sources share a label."""
    stem, dot, ext = name.rpartition(".")
    candidate, n = name, 2
    while candidate in taken:
        candidate = f"{stem}-{n}{dot}{ext}"
        n += 1
    taken.add(candidate)
    return candidate


def _pdf_reports(reports: list, source_id: str | None) -> list:
    """Every source that has a run; a source asked for by name gets its report regardless."""
    return [r for r in reports if r.run is not None or source_id is not None]


@register_job_type("detect_export")
def run_detect_export(ctx: JobContext) -> dict:
    handle = ctx.project
    fmt: str = ctx.params["format"]
    source_id: str | None = ctx.params.get("source_id")

    ctx.progress(0.0, "reading the counts")
    reports = export_csv.gather(handle, source_id)
    # A source asked for by name gets its PDF even without a run; otherwise an export needs a run.
    has_content = bool(export_csv.rows(reports)) if fmt == "csv" else bool(_pdf_reports(reports, source_id))
    if not has_content:
        # Fail before reserving a folder, so a "succeeded" export never holds nothing.
        what = "This source has" if source_id is not None else "No source has"
        raise JobFailure(f"{what} a detection run yet, so there is nothing to export.")
    with handle.session() as s:
        project_name = handle.row(s).name

    base = handle.exports_dir
    base.mkdir(parents=True, exist_ok=True)
    now = _now_local()
    partial, stamp, n = _reserve_partial_folder(base, now)
    files: list[str] = []
    try:
        if fmt == "csv":
            name = f"detect-{slug(project_name, 'project')}-{now.date().isoformat()}.csv"
            export_csv.write(partial / name, reports)
            files.append(name)
            ctx.progress(1.0, f"{name} written")
        else:
            from app.detect import export_pdf  # reportlab loads only when a PDF is asked for

            wanted = _pdf_reports(reports, source_id)
            taken: set[str] = set()
            for i, report in enumerate(wanted):
                ctx.check_cancelled()
                name = _unique(f"detect-{slug(report.label, 'source')}.pdf", taken)
                export_pdf.write(
                    partial / name,
                    report,
                    project_name=project_name,
                    overview=export_pdf.overview_image(handle, report),
                )
                files.append(name)
                ctx.progress((i + 1) / len(wanted), f"{name} written ({i + 1} of {len(wanted)})")
        final = _promote(base, partial, stamp, n)
    except BaseException:
        shutil.rmtree(partial, ignore_errors=True)
        raise

    folder = "/".join(final.relative_to(handle.folder).parts)
    ctx.log.info("detect export (%s) to %s: %s", fmt, folder, files)
    return {"folder": folder, "files": files, "source_count": len(reports)}
