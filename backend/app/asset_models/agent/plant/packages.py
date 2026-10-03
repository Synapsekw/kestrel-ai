# backend/app/asset_models/agent/plant/packages.py
"""`site_model_package` rows (spec §9): one per package of a plant run, plus the work a sub-run gets."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select

from app.db.base import utcnow
from app.db.models import AssetModelRun, SiteModelPackage

TERMINAL = ("done", "failed", "skipped")


@dataclass(frozen=True)
class PackageWork:
    id: str
    n: int
    label: str
    drawing_id: str | None
    region: tuple[float, ...] | None
    area: str | None
    brief: str
    expected_tags: tuple[str, ...] = ()


def rows(s, run_id: str) -> list[SiteModelPackage]:
    return list(
        s.scalars(
            select(SiteModelPackage).where(SiteModelPackage.run_id == run_id).order_by(SiteModelPackage.n)
        )
    )


def replace_queued(s, run_id: str, specs: list[dict]) -> list[SiteModelPackage]:
    """Drop the run's still-queued packages and add `specs` after the highest kept n (the survey may
    re-plan; started packages are kept)."""
    kept = []
    for r in rows(s, run_id):
        if r.state == "queued":
            s.delete(r)
        else:
            kept.append(r)
    s.flush()
    n0 = max((r.n for r in kept), default=0)
    out = []
    for k, spec in enumerate(specs, start=1):
        region = spec.get("region")
        row = SiteModelPackage(
            run_id=run_id,
            n=n0 + k,
            label=str(spec["label"])[:80],
            drawing_id=spec.get("drawing_id"),
            region=[float(v) for v in region] if region else None,
            area=spec.get("area"),
            state="queued",
            usage={},
            item_count=0,
            summary=None,
        )
        s.add(row)
        out.append(row)
    s.flush()
    return out


def set_state(s, package_id: str, state: str, *, usage=None, item_count=None, summary=None) -> None:
    row = s.get(SiteModelPackage, package_id)
    row.state = state
    if state == "running":
        row.started_at, row.ended_at = utcnow(), None
    elif state == "queued":
        row.started_at, row.ended_at = None, None
    if state in TERMINAL:
        row.ended_at = utcnow()
    if usage is not None:
        row.usage = dict(usage)
    if item_count is not None:
        row.item_count = int(item_count)
    if summary is not None:
        row.summary = summary[:2000]


def summary(s, run_id: str) -> dict:
    out = {"total": 0, "done": 0, "failed": 0, "running": 0}
    for r in rows(s, run_id):
        out["total"] += 1
        if r.state in ("done", "failed", "running"):
            out[r.state] += 1
    return out


def mark_unfinished(s, run_id: str, state: str = "skipped", note: str | None = None) -> list[str]:
    changed = []
    for r in rows(s, run_id):
        if r.state in ("queued", "running"):
            set_state(s, r.id, state, summary=note)
            changed.append(r.label)
    return changed


def work_of(row, meta: dict) -> PackageWork:
    return PackageWork(
        id=row.id,
        n=row.n,
        label=row.label,
        drawing_id=row.drawing_id,
        region=tuple(row.region) if row.region else None,
        area=row.area,
        brief=str(meta.get("brief") or row.label),
        expected_tags=tuple(meta.get("expected_tags") or ()),
    )


def find_for_model(s, model_id: str, ids) -> list[SiteModelPackage]:
    return list(
        s.scalars(
            select(SiteModelPackage)
            .join(AssetModelRun, AssetModelRun.id == SiteModelPackage.run_id)
            .where(AssetModelRun.model_id == model_id, SiteModelPackage.id.in_(list(ids)))
            .order_by(SiteModelPackage.n)
        )
    )


def copy_for_rerun(s, run_id: str, old: list[SiteModelPackage]) -> list[SiteModelPackage]:
    specs = [{"label": r.label, "drawing_id": r.drawing_id, "region": r.region, "area": r.area} for r in old]
    return replace_queued(s, run_id, specs)
