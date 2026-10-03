"""After the sightings are placed (spec 2026-10-02-asset-findings §6.5 step 7): group them into
findings, then give the new findings the kit's notes and, for the photo unit, the source masks.

Grouping runs here, in the import's thread, through J4's own functions rather than a queued
`asset_group` job, because the notes and the attachments need the findings it creates (ruling N2).
`group.groups_for_model` picks the rule from the model's review profile: the photo unit groups by
photo and defect type, never by distance, and the region unit clusters by distance and tag.
"""

from __future__ import annotations

from dataclasses import asdict

from sqlalchemy import func, select

from app.asset_review import group
from app.asset_review.kit_format import Kit
from app.asset_review.kit_masks import load_mask, write_palette_png
from app.asset_review.kit_sightings import Written
from app.db.models import AssetModel, Finding, FindingSighting
from app.errors import not_found
from app.findings import attachments, events

NOTE_MAX = 20000
READ_CHUNK = 500


def group_imported(handle, asset_model_id: str, unit: str) -> dict:
    """`unit` is the kit's; the rule itself follows the model's review profile, as Regroup does."""
    with handle.session() as s:
        model = s.get(AssetModel, asset_model_id)
        if model is None:
            raise not_found("asset model", asset_model_id)
        items = group.load_items(s, asset_model_id)
        result = group.apply_groups(s, handle, asset_model_id, group.groups_for_model(model, items))
    return asdict(result)


def finish_findings(handle, ctx, kit: Kit, written: list[Written]) -> dict[str, int]:
    by_id = {w.sighting_id: w for w in written}
    finding_of: dict[str, str] = {}
    ids = list(by_id)
    with handle.session() as s:
        for i in range(0, len(ids), READ_CHUNK):
            q = select(FindingSighting.id, FindingSighting.finding_id).where(
                FindingSighting.id.in_(ids[i : i + READ_CHUNK])
            )
            for sid, fid in s.execute(q).all():
                if fid:
                    finding_of[sid] = fid
        best: dict[str, Written] = {}
        for sid, fid in finding_of.items():
            w, cur = by_id[sid], best.get(fid)
            if cur is None or (-w.severity, w.order) < (-cur.severity, cur.order):
                best[fid] = w
        noted = []
        for fid, w in best.items():
            f = s.get(Finding, fid)
            if f is not None and not f.note and w.note:
                f.note = w.note[:NOTE_MAX]
                noted.append(fid)
        events.mark_changed(s, handle.id, noted)
    attached = 0
    tmp_dir = handle.runs_dir / str(ctx.job_id) / "kit-masks"
    # One attachment per finding and photo: a photo's regions share one source mask.
    masked: dict[tuple[str, str], Written] = {}
    for sid, fid in finding_of.items():
        w = by_id[sid]
        if w.mask_path is not None:
            masked.setdefault((fid, w.kit_photo), w)
    for i, ((fid, _), w) in enumerate(masked.items()):
        ctx.check_cancelled()
        ctx.progress(0.92 + 0.07 * i / max(1, len(masked)), f"Attaching masks {i:,} / {len(masked):,}")
        tmp = write_palette_png(load_mask(w.mask_path), kit.classes, tmp_dir / f"{w.kit_photo} mask.png")
        try:
            attachments.add(handle, fid, str(tmp))
            attached += 1
        finally:
            tmp.unlink(missing_ok=True)
    if tmp_dir.is_dir() and not any(tmp_dir.iterdir()):
        tmp_dir.rmdir()
    return {"notes": len(noted), "attachments": attached}


def finding_counts(handle, asset_model_id: str) -> dict:
    with handle.session() as s:
        q = (
            select(Finding.severity, func.count())
            .where(Finding.asset_model_id == asset_model_id, Finding.status != "closed")
            .group_by(Finding.severity)
        )
        rows = s.execute(q).all()
    return {
        "total": int(sum(n for _, n in rows)),
        "by_severity": {str(sev): int(n) for sev, n in rows if sev is not None},
    }
