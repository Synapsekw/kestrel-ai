"""Moving a past map out of a training project into a detection project (spec 2026-09-23 section 6.3).

Before the train/detect split, maps were imported into what are now training projects. "Move to a
detection project" copies one of them: the `GeoMap` row (same id, in the target's database), its
derived folder (display raster, preview, source record) without the `runs/` inside it, its zones and
its labels. Runs are not copied; the map is re-run there with a library model. The operator's source
file is only referenced (`source_path` is absolute), never copied or modified, and the training
project keeps its map untouched.

The work is a `map_move` job that lives in the **target** project, params `{source_project_id,
map_id}`; it reports progress by bytes copied.
"""

from __future__ import annotations

import shutil
import threading
from pathlib import Path

from sqlalchemy import select

from app.db.base import new_id
from app.db.models import GeoMap, MapLabel, MapZone
from app.errors import AppError
from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type
from app.maps import service
from app.maps.startup import map_dir
from app.projects.kinds import DETECT, project_kind
from app.projects.service import normalise_classes

MOVE_JOB = "map_move"
COPY_CHUNK = 8 * 1024 * 1024
SKIPPED = {"runs"}  # the map's run outputs stay with the runs, in the training project
# One move at a time: two moves of the same map must not copy into the same folder at once.
_MOVE_LOCK = threading.Lock()


def submit_move(registry, runner, source, map_id: str, target_id: str):
    """404 for an unknown map or target, 409 `conflict` for a map that has not finished importing,
    409 `wrong_project_kind` for a target that is not a detection project; otherwise the `map_move`
    job, queued in the target project."""
    service.require_ready(source, map_id)
    target = registry.get(target_id)
    kind = project_kind(target)
    if kind != DETECT:
        raise AppError(
            "wrong_project_kind",
            "A map can only be moved into a detection project.",
            409,
            {"kind": kind, "allowed": [DETECT]},
        )
    return target, runner.submit(target, MOVE_JOB, {"source_project_id": source.id, "map_id": map_id})


def _files(folder: Path) -> list[Path]:
    """Every file under the map folder except the skipped top-level folders, in a stable order."""
    out: list[Path] = []
    for child in sorted(folder.iterdir()) if folder.is_dir() else []:
        if child.is_dir():
            if child.name not in SKIPPED:
                out.extend(p for p in sorted(child.rglob("*")) if p.is_file())
        elif child.is_file():
            out.append(child)
    return out


def _copy_folder(ctx, src: Path, dst: Path) -> None:
    files = _files(src)
    total = sum(f.stat().st_size for f in files) or 1
    done = 0
    for f in files:
        target = dst / f.relative_to(src)
        target.parent.mkdir(parents=True, exist_ok=True)
        with f.open("rb") as fin, target.open("wb") as fout:
            while chunk := fin.read(COPY_CHUNK):
                ctx.check_cancelled()
                fout.write(chunk)
                done += len(chunk)
                ctx.progress(0.95 * done / total, f"Copying {f.name}")
        shutil.copystat(f, target)


def _class_mapping(source_classes: list[dict], target_classes: list[dict], used: set[str]):
    """Old class id -> target class id for the classes the labels use, and the target's new class
    list: a class with the same name is joined, any other is added (keeping its id, without a hotkey,
    unless the target already uses that id for another class: then it gets a new one)."""
    by_id = {c["id"]: c for c in source_classes}
    by_name = {c["name"].casefold(): c["id"] for c in target_classes}
    ids = {c["id"] for c in target_classes}
    classes = [dict(c) for c in target_classes]
    mapping: dict[str, str] = {}
    for class_id in sorted(used):
        src = by_id.get(class_id)
        if src is None:  # a label whose class was removed: keep it as it is
            mapping[class_id] = class_id
            continue
        key = src["name"].casefold()
        if key not in by_name:
            added = src["id"] if src["id"] not in ids else new_id()
            classes.append({"id": added, "name": src["name"], "colour": src.get("colour")})
            by_name[key] = added
            ids.add(added)
        mapping[class_id] = by_name[key]
    return mapping, classes


def _columns(row) -> dict:
    return {c.key: getattr(row, c.key) for c in row.__table__.columns}


@register_job_type(MOVE_JOB)
def run_map_move(ctx) -> dict:
    target, p = ctx.project, ctx.params
    map_id = p["map_id"]
    registry = getattr(ctx.runner, "projects", None)
    try:
        if registry is None:
            raise AppError("not_found", "no project registry", 404)
        source = registry.get(p["source_project_id"])
    except AppError as e:
        raise JobFailure("The project the map comes from could not be opened.") from e

    ctx.progress(0, "Reading the map")
    with source.session() as s:
        gmap = s.get(GeoMap, map_id)
        if gmap is None:
            raise JobFailure("The map is no longer in the project it comes from.")
        if gmap.status != "ready":
            raise JobFailure(f"{gmap.name} has not finished importing, so it cannot be moved.")
        map_row = _columns(gmap)
        zones = [_columns(z) for z in s.execute(select(MapZone).where(MapZone.map_id == map_id)).scalars()]
        labels = [
            _columns(lab) for lab in s.execute(select(MapLabel).where(MapLabel.map_id == map_id)).scalars()
        ]
        source_classes = list(source.row(s).classes or [])
    if not _MOVE_LOCK.acquire(blocking=False):
        ctx.progress(0, "Waiting for another move to finish")
        _MOVE_LOCK.acquire()
    try:
        return _copy_into_target(ctx, source, target, map_id, map_row, zones, labels, source_classes)
    finally:
        _MOVE_LOCK.release()


def _copy_into_target(ctx, source, target, map_id, map_row, zones, labels, source_classes) -> dict:
    with target.session() as s:
        if s.get(GeoMap, map_id) is not None:
            raise JobFailure(f"This map is already in {target.row(s).name}.")

    src, dst = map_dir(source, map_id), map_dir(target, map_id)
    shutil.rmtree(dst, ignore_errors=True)  # a copy an earlier, interrupted move left behind
    try:
        _copy_folder(ctx, src, dst)
        ctx.check_cancelled()
        ctx.progress(0.97, "Adding the map to this project")
        with target.session() as s:
            project = target.row(s)
            mapping, classes = _class_mapping(
                source_classes, list(project.classes or []), {lab["class_id"] for lab in labels}
            )
            if len(classes) != len(project.classes or []):
                project.classes = normalise_classes(classes)
            s.add(GeoMap(**{**map_row, "job_id": ctx.job_id}))
            s.flush()
            s.add_all(MapZone(**z) for z in zones)
            s.add_all(MapLabel(**{**lab, "class_id": mapping[lab["class_id"]]}) for lab in labels)
    except BaseException:
        shutil.rmtree(dst, ignore_errors=True)
        raise
    ctx.publish("maps.changed", {"map_ids": [map_id]})
    ctx.progress(1, f"{map_row['name']} is in this project")
    ctx.log.info("copied map %s from project %s", map_id, source.id)
    return {"map_id": map_id}
