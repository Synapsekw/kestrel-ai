"""The defect backfill (spec 2026-09-26-foundation sections 7.2, 11.4 step 6; decision F4).

`findings_from_annotations` applies D6's rule, "accepted boxes become findings, Reviewed, no
severity", to the ground-truth and person-drawn boxes of defect types that have no finding yet. It is
idempotent: a re-run after a crash, or a second backfill, only fills the gaps. MG's migration step 6
calls it too. `findings_backfill` is the library job the Catalogue offers when a type is re-marked
`defect`; it walks the recent projects one at a time.
"""

from collections.abc import Callable, Sequence
from pathlib import Path

from sqlalchemy import func, or_, select

from app.catalogue import project_types
from app.db.models import Box, Finding, Job, ProjectType
from app.errors import AppError
from app.findings import activity, annotations, numbers, service
from app.findings.anchors import AnchorIn
from app.jobs.cancellation import JobCancelled, JobFailure
from app.jobs.registry import register_job_type

BATCH = 1000
BACKFILL_JOB = "findings_backfill"
LIVE_STATES = ("queued", "running")


def _candidates(type_ids: Sequence[str]):
    has_finding = select(Finding.id).where(Finding.annotation_id == Box.id).exists()
    return select(Box).where(
        Box.class_id.in_(list(type_ids)),
        or_(Box.review_state.in_(annotations.GROUND_TRUTH), Box.provenance_kind == "person"),
        ~has_finding,
    )


def findings_from_annotations(
    handle,
    type_ids: Sequence[str] | None = None,
    *,
    batch: int = BATCH,
    progress: Callable[[int, int], None] | None = None,
    check_cancelled: Callable[[], None] | None = None,
) -> int:
    """Create the missing findings, `batch` boxes per transaction, numbered in box `created_at`
    order; returns how many were created. `type_ids=None` means every defect type of the project.
    Each batch opens its own session and no session is held across the call, so a caller (MG's
    migration) must not hold one either: two writers never share the SQLite database."""
    with handle.session() as s:
        project_types.refresh_snapshots(s, handle.catalogue, type_ids)
        q = select(ProjectType.type_id).where(ProjectType.kind == "defect")
        if type_ids is not None:
            q = q.where(ProjectType.type_id.in_(list(type_ids)))
        defect_ids = list(s.execute(q).scalars())
        total = 0
        if defect_ids:
            total = s.execute(
                select(func.count()).select_from(_candidates(defect_ids).subquery())
            ).scalar_one()
    done = 0
    for _ in range(total // batch + 2):  # a bound: never an endless loop
        if done >= total:
            break
        if check_cancelled is not None:
            check_cancelled()
        with handle.session() as s:
            # Take the write lock before reading the batch (an UPDATE that reserves nothing), so a
            # box accepted meanwhile cannot get its finding between this read and these inserts.
            numbers.allocate(s, count=0)
            rows = (
                s.execute(_candidates(defect_ids).order_by(Box.created_at, Box.id).limit(batch))
                .scalars()
                .all()
            )
            if not rows:
                break
            first = numbers.allocate(s, count=len(rows))
            for i, box in enumerate(rows):
                service.create_in_session(
                    s,
                    project_id=handle.id,
                    catalogue=handle.catalogue,
                    type_id=box.class_id,
                    anchor=AnchorIn(kind="image", image_id=box.image_id, annotation_id=box.id),
                    severity=None,
                    status="reviewed",
                    created_by=annotations.created_by(box),
                    confidence=box.confidence,
                    created_at=box.created_at,
                    number=first + i,
                    record_activity=False,
                )
            done += len(rows)
        if progress is not None:
            progress(done, total)
    if done:
        with handle.session() as s:
            activity.record(
                s,
                "finding.created",
                None,
                f"Created {done} findings from accepted annotations",
                {"count": done},
            )
    return done


def live_backfill_id(lib, type_id: str) -> str | None:
    """The id of a `findings_backfill` of this type already queued or running, if any. Live
    backfills are few, so their params are matched here rather than in JSON SQL."""
    with lib.session() as s:
        rows = s.execute(
            select(Job.id, Job.params).where(Job.type == BACKFILL_JOB, Job.state.in_(LIVE_STATES))
        ).all()
    return next((r.id for r in rows if (r.params or {}).get("type_id") == type_id), None)


def submit_backfill(lib, runner, type_id: str) -> Job:
    """Queue the backfill, or 409 `job_running` with the live one's id: one per type at a time."""
    live = live_backfill_id(lib, type_id)
    if live is not None:
        raise AppError("job_running", "This type is already being backfilled.", 409, {"job_id": live})
    return runner.submit(lib, BACKFILL_JOB, {"type_id": type_id})


def _upgrading(handle) -> bool:
    """A project still below the foundation schema: its own upgrade (step 6) backfills it. Imported
    here, not at module level: MG's steps import this module."""
    from app.migration import job as migration_job
    from app.migration.pipeline import TARGET_SCHEMA_VERSION

    return migration_job.armed() and handle.schema_version < TARGET_SCHEMA_VERSION


@register_job_type(BACKFILL_JOB)
def run_backfill(ctx) -> dict:
    """Library job: every recent project, one at a time. A project that cannot be opened is reported
    and skipped; the job still succeeds for the others."""
    registry = getattr(ctx.runner, "projects", None)
    if registry is None:
        raise JobFailure("The project list is not available to this job.")
    type_id = ctx.params["type_id"]
    recent = registry.recent()
    report: list[dict] = []
    created = 0
    for i, entry in enumerate(recent):
        ctx.check_cancelled()
        ctx.progress(i / max(len(recent), 1), f"Looking at {entry['name']}")
        folder = Path(entry["folder"])
        if not (folder / "project.db").exists():
            report.append({"project": entry["name"], "created": 0, "skipped": "folder_missing"})
            continue
        try:
            handle = registry.open(folder, remember=False)
            if _upgrading(handle):
                report.append(
                    {"project": entry["name"], "project_id": handle.id, "created": 0, "skipped": "upgrading"}
                )
                continue
            n = findings_from_annotations(
                handle,
                [type_id],
                check_cancelled=ctx.check_cancelled,
                progress=lambda done, total, i=i, name=entry["name"]: ctx.progress(
                    (i + done / total) / len(recent), f"{name}: {done} of {total}"
                ),
            )
        except JobCancelled:
            raise
        except Exception as e:
            ctx.log.exception("the backfill failed in %s", folder)
            report.append({"project": entry["name"], "created": 0, "skipped": f"{type(e).__name__}: {e}"})
            continue
        created += n
        report.append({"project": entry["name"], "project_id": handle.id, "created": n})
    ctx.progress(1, f"Created {created} findings")
    return {"type_id": type_id, "created": created, "projects": report}
