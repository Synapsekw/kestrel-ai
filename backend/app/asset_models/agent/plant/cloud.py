# backend/app/asset_models/agent/plant/cloud.py
"""The cloud check stage (spec §8.2.4; D5): C1's module (`app.asset_models.cloudcheck`) over the merged
register, in app code; the orchestrator only reviews the outcome. Positions never move; heights fill in
only where indicative (or from an earlier cloud check).

C1's call recipe: `cloud_in_frame` first (skip with its note); `cancel=lambda: check_cancelled() or
False`; `CheckResult.note` becomes a run note; ALL items go to `check_items`; the site datum is reused
only for the same cloud, else fitted and persisted. The sample is cached in the run folder for a resume
and re-read when the plant box has grown past it."""

from __future__ import annotations

import logging

import numpy as np

from app.errors import AppError

log = logging.getLogger(__name__)
MARGIN_M = 50.0
MAX_CANDIDATES = 200
SUMMARY_CHARS = 2000
GONE = "the point cloud is no longer in the project."


def _note(rc, text: str) -> None:
    with rc.lock:
        if text not in rc.state.notes:
            rc.state.notes.append(text)
    rc.save()


def _pick_cloud(rc, ids: list[str]) -> str:
    """Ruling R16: the largest cloud among the sources."""
    from app.db.models import PointCloud

    with rc.handle.session() as s:
        sized = [((getattr(s.get(PointCloud, i), "point_count", None) or 0), i) for i in ids]
    return max(sized)[1]


def _skip_text(rc, cc, cid: str, frame) -> str:
    """C1's own skip sentence for a cloud that is not in the site's frame."""
    from app.pointclouds import rows

    row = rows.get_cloud(rc.handle, cid)
    known_cloud = row.epsg is not None or bool(row.crs_wkt)
    known_site = frame.crs.epsg is not None or bool(frame.crs.wkt)
    return cc.SKIP_OTHER_CRS if known_cloud and known_site else cc.SKIP_NO_CRS


def _candidate(c) -> dict:
    pts = np.asarray(c.pts, float)  # plant [E, N] (C1 traces candidates on the plant grid)
    return {
        "id": c.id,
        "e": float(pts[:, 0].mean()),
        "n": float(pts[:, 1].mean()),
        "size_m": [float(v) for v in c.size_m],
        "top_el": float(c.top_el),
    }


def _inside(inner, outer) -> bool:
    return inner[0] >= outer[0] and inner[1] >= outer[1] and inner[2] <= outer[2] and inner[3] <= outer[3]


def _sample(rc, cc, cid: str, bbox):
    """The cached sample when it still covers the plant box (C1 hand-off 2), else one fresh read."""
    path = rc.run_dir / f"plant_sample_{cid}.npz"
    if path.exists():
        try:
            cached = cc.PlantSample.load(path)
        except Exception as e:  # noqa: BLE001 - BadZipFile, EOFError, ...: a damaged cache is read again
            log.warning("plant cloud sample cache unreadable (%s); sampling again", type(e).__name__)
            cached = None
        if cached is not None and cached.cloud_id == cid and _inside(bbox, cached.bbox):
            return cached
    sample = cc.sample_plant_cloud(
        rc.handle,
        cid,
        bbox,
        cancel=lambda: rc.check_cancelled() or False,
        progress=None,
    )
    rc.run_dir.mkdir(parents=True, exist_ok=True)
    sample.save(path)
    return sample


def _datum(rc, cc, sample, grid, items):
    """The site datum when it was fitted to this cloud (C1 hand-off 1), else a fresh fit."""
    site = rc.site()
    held = site.cloud_z_to_el if site is not None else None
    if held is not None and held.cloud_id == getattr(sample, "cloud_id", None):
        return held
    return cc.fit_datum(sample, grid, items)


def digest(summary: dict) -> str:
    """One line from C1's `summarise` digest, for the review message (the note is a run note)."""
    n = int(summary.get("checked") or 0)
    k = int(summary.get("candidates_total") or 0)
    flags = ", ".join(f"{c} {v}" for c, v in (summary.get("flag_counts") or {}).items()) or "none"
    d = summary.get("datum")
    if d:
        datum = f"plant EL = cloud z {float(d['offset_m']):+.2f} m" + (
            " with a tilt" if d.get("tilt") else ""
        )
    else:
        datum = "no datum, so heights are not given"
    return (
        f"{n} item{'' if n == 1 else 's'} checked; cloud flags: {flags}; "
        f"{k} unregistered candidate{'' if k == 1 else 's'}; {datum}."
    )[:SUMMARY_CHARS]


def check_all(rc, cc, sample, grid):
    """Check EVERY item (a subset would turn the others' bodies into candidates), apply the heights and
    flags, persist the datum, and refresh the candidates and the summary. Returns the CheckResult."""
    with rc.lock:
        items = list(rc.store.values())
    datum = _datum(rc, cc, sample, grid, items)
    result = cc.check_items(sample, grid, items, datum)
    if getattr(result, "note", None):
        _note(rc, result.note)
    checked = cc.apply_check(items, result)
    fitted = result.datum  # C1 drops a datum from another cloud, so this is this cloud's or None
    with rc.lock:
        for i in checked:
            rc.store[i.id] = i
        if fitted is not None and rc.state.site:
            rc.state.site = {**rc.state.site, "cloud_z_to_el": fitted.model_dump(mode="json")}
        biggest = sorted(result.candidates, key=lambda c: -(c.size_m[0] * c.size_m[1]))[:MAX_CANDIDATES]
        rc.state.candidates = [_candidate(c) for c in biggest]
        rc.state.check_summary = digest(cc.summarise(result))
    rc.cloud, rc.check = sample, result
    rc.save_store()
    rc.save()
    return result


def cloud_stage(rc) -> None:
    from app.asset_models import cloudcheck as cc
    from app.asset_models.look import LookError

    ids = [x["id"] for x in rc.sources if x["type"] == "point_cloud"]
    if not ids:
        _note(rc, "No cloud check: no point cloud among the run's sources.")
        return
    grid = rc.grid()
    if grid is None:
        _note(
            rc, "No cloud check: the site frame is not set, so the cloud can't be related to the plant grid."
        )
        return
    with rc.lock:
        items = list(rc.store.values())
    if not items:
        _note(rc, "No cloud check: the register is empty.")
        return
    cid = _pick_cloud(rc, ids)
    try:
        if not cc.cloud_in_frame(rc.handle, cid, grid.frame):
            _note(rc, f"No cloud check: {_skip_text(rc, cc, cid, grid.frame)}")
            return
    except AppError:
        _note(rc, f"No cloud check: {GONE}")
        return
    bbox = cc.plant_bbox_site(grid, items, MARGIN_M)
    if bbox is None:
        _note(rc, "No cloud check: no item has a usable footprint.")
        return
    try:
        sample = _sample(rc, cc, cid, bbox)
    except LookError as e:
        _note(rc, f"No cloud check: {e.message}")
        return
    except AppError:
        _note(rc, f"No cloud check: {GONE}")
        return
    rc.check_cancelled()
    result = check_all(rc, cc, sample, grid)
    log.info(
        "plant cloud check items=%d candidates=%d datum=%s",
        len(result.items),
        len(result.candidates),
        result.datum is not None,
    )
