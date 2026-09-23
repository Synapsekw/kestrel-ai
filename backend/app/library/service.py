"""Library models: add, list, edit, delete, and where their files are (spec section 4).

Every model has its own folder, `models/<slug>-<id8>/`, holding `weights.pt`, `exports/` and
`artifacts/`. `weights_path` is relative to the library root; `exports` and `artifacts` are
relative to the model's folder, as the contract describes them. Reading a checkpoint is the one
operation that needs ultralytics, and it imports lazily.
"""

from __future__ import annotations

import hashlib
import logging
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

from sqlalchemy import func, select, tuple_
from sqlalchemy.exc import IntegrityError

from app.db.base import new_id
from app.errors import AppError, not_found
from app.library.db import LibraryModel
from app.library.handle import LibraryHandle
from app.pagination import clamp_limit, decode_cursor, encode_cursor

if TYPE_CHECKING:
    from app.projects.service import ProjectRegistry

log = logging.getLogger(__name__)

HASH_CHUNK = 1024 * 1024
EDITABLE = {"name", "notes", "supplier", "class_aliases"}


def slug(name: str) -> str:
    """A file-safe stem for a model folder."""
    s = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return s or "model"


def sha256_file(path: Path) -> str:
    """Streamed in chunks: weights files run to hundreds of megabytes."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while chunk := fh.read(HASH_CHUNK):
            h.update(chunk)
    return h.hexdigest()


def read_checkpoint(weights: Path) -> tuple[str, list[str]]:
    """`(task, class_names)` of a YOLO checkpoint, class names in index order (lazy ultralytics)."""
    from ultralytics import YOLO

    model = YOLO(str(weights))
    names = model.names or {}
    if isinstance(names, dict):
        class_names = [str(names[k]) for k in sorted(names, key=lambda k: int(k))]
    else:
        class_names = [str(n) for n in names]
    return str(model.task), class_names


def _detached(s, row: LibraryModel) -> LibraryModel:
    s.flush()
    s.expunge(row)
    return row


def find_by_sha(lib: LibraryHandle, sha256: str) -> LibraryModel | None:
    with lib.session() as s:
        row = s.execute(select(LibraryModel).where(LibraryModel.sha256 == sha256)).scalar_one_or_none()
        if row is not None:
            s.expunge(row)
        return row


def _already(existing: LibraryModel) -> AppError:
    return AppError(
        "already_exists",
        f"This weights file is already in the library as {existing.name}.",
        409,
        {"model_id": existing.id},
    )


def _copy_into(folder: Path, sub: str, files: dict[str, Path] | None) -> dict[str, str]:
    """Copy each existing file to `<folder>/<sub>/<name>`; values are relative to `folder`, posix."""
    out: dict[str, str] = {}
    for key, src in (files or {}).items():
        src = Path(src)
        if not src.is_file():
            continue
        target = folder / sub / src.name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, target)
        out[key] = target.relative_to(folder).as_posix()
    return out


def add_model(
    lib: LibraryHandle,
    *,
    source_weights: Path,
    name: str,
    origin: str,
    task: str,
    class_names: list[str],
    class_aliases: dict | None = None,
    provenance: dict | None = None,
    metrics: dict | None = None,
    hyperparameters: dict | None = None,
    artifacts: dict[str, Path] | None = None,
    exports: dict[str, Path] | None = None,
    supplier: str | None = None,
    train_gsd_cm: float | None = None,
    sha256: str | None = None,
) -> LibraryModel:
    """Copy the weights (and artifacts/exports) into a new model folder and register the row.

    The source files are only read. A file whose sha256 is already in the library is refused with
    409 `already_exists` naming the existing model, and nothing is left behind.
    """
    source = Path(source_weights)
    digest = sha256 or sha256_file(source)
    existing = find_by_sha(lib, digest)
    if existing is not None:
        raise _already(existing)
    model_id = new_id()
    folder = lib.models_dir / f"{slug(name)}-{model_id[:8]}"
    suffix = source.suffix.lower() or ".pt"
    target = folder / f"weights{suffix}"
    try:
        folder.mkdir(parents=True, exist_ok=False)
        shutil.copy2(source, target)
        row = LibraryModel(
            id=model_id,
            name=name,
            notes="",
            supplier=supplier,
            task=task,
            format=suffix.lstrip("."),
            origin=origin,
            weights_path=target.relative_to(lib.folder).as_posix(),
            class_names=list(class_names or []),
            class_aliases=dict(class_aliases or {}),
            provenance=dict(provenance or {}),
            hyperparameters=dict(hyperparameters or {}),
            metrics=metrics or None,
            exports=_copy_into(folder, "exports", exports),
            artifacts=_copy_into(folder, "artifacts", artifacts),
            train_gsd_cm=train_gsd_cm,
            sha256=digest,
        )
        with lib.session() as s:
            s.add(row)
            return _detached(s, row)
    except IntegrityError:
        # Two adds of the same file raced past the lookup; the unique index kept one of them.
        shutil.rmtree(folder, ignore_errors=True)
        existing = find_by_sha(lib, digest)
        if existing is None:
            raise
        raise _already(existing) from None
    except BaseException:
        shutil.rmtree(folder, ignore_errors=True)
        raise


def list_models(
    lib: LibraryHandle, limit: int | None, cursor: str | None, task: str | None = None
) -> tuple[list[LibraryModel], str | None]:
    n = clamp_limit(limit)
    q = select(LibraryModel).order_by(LibraryModel.created_at.desc(), LibraryModel.id.desc())
    if task:
        q = q.where(LibraryModel.task == task)
    c = decode_cursor(cursor, "created_at", "id")
    if c:
        try:
            after = datetime.fromisoformat(str(c["created_at"]))
        except ValueError:
            raise AppError("validation_error", "invalid cursor", 422) from None
        q = q.where(tuple_(LibraryModel.created_at, LibraryModel.id) < (after, str(c["id"])))
    with lib.session() as s:
        rows = list(s.execute(q.limit(n + 1)).scalars())
        for r in rows:
            s.expunge(r)
    next_cursor = None
    if len(rows) > n:
        rows = rows[:n]
        next_cursor = encode_cursor(created_at=rows[-1].created_at.isoformat(), id=rows[-1].id)
    return rows, next_cursor


def get_model(lib: LibraryHandle, model_id: str) -> LibraryModel:
    with lib.session() as s:
        row = s.get(LibraryModel, model_id)
        if row is None:
            raise not_found("model", model_id)
        s.expunge(row)
        return row


def update_model(lib: LibraryHandle, model_id: str, **fields) -> LibraryModel:
    """Rename, or change notes, supplier or class aliases. Anything else is a programming error."""
    unknown = set(fields) - EDITABLE
    if unknown:
        raise ValueError(f"not editable: {sorted(unknown)}")
    with lib.session() as s:
        row = s.get(LibraryModel, model_id)
        if row is None:
            raise not_found("model", model_id)
        for k, v in fields.items():
            setattr(row, k, dict(v) if k == "class_aliases" else v)
        return _detached(s, row)


def weights_file(lib: LibraryHandle, row: LibraryModel) -> Path:
    return lib.folder / row.weights_path


def model_dir(lib: LibraryHandle, row: LibraryModel) -> Path:
    return weights_file(lib, row).parent


def delete_model(lib: LibraryHandle, model_id: str) -> None:
    """Drop the row and the model's own folder. Nothing outside `models/<that folder>` is touched."""
    with lib.session() as s:
        row = s.get(LibraryModel, model_id)
        if row is None:
            raise not_found("model", model_id)
        folder = model_dir(lib, row)
        s.delete(row)
    models = lib.models_dir.resolve()
    if folder.resolve().parent == models and folder.resolve() != models:
        shutil.rmtree(folder, ignore_errors=True)
    else:
        log.warning("model %s points outside the library models folder; its files were kept", model_id)


def state_of(lib: LibraryHandle, row: LibraryModel) -> str:
    return "ready" if weights_file(lib, row).is_file() else "unavailable"


def require_ready(lib: LibraryHandle, model_id: str) -> LibraryModel:
    """The model, or 404 when unknown and 409 `model_unavailable` when its weights file is gone."""
    row = get_model(lib, model_id)
    if state_of(lib, row) != "ready":
        raise AppError(
            "model_unavailable",
            f"The weights file of {row.name} is missing from the library folder.",
            409,
            {"model_id": row.id},
        )
    return row


def set_export(lib: LibraryHandle, model_id: str, fmt: str, path: Path) -> LibraryModel:
    with lib.session() as s:
        row = s.get(LibraryModel, model_id)
        if row is None:
            raise not_found("model", model_id)
        rel = Path(path).resolve().relative_to(model_dir(lib, row).resolve()).as_posix()
        row.exports = {**(row.exports or {}), fmt: rel}
        return _detached(s, row)


def usage(lib: LibraryHandle, registry: ProjectRegistry, model_id: str) -> list[dict]:
    """Recent projects that use the model: pre-annotation, detection runs and map runs.

    Only the recent-projects list is scanned (at most 20 projects), with one COUNT per table per
    project. A project that fails to open is skipped with a log line.
    """
    from app.db.models import MapRun, QueryRun

    get_model(lib, model_id)
    out = []
    for recent in registry.recent():
        folder = Path(recent["folder"])
        if not (folder / "project.db").is_file():
            continue
        try:
            handle = registry.open(folder, remember=False)
            with handle.session() as s:
                project = handle.row(s)
                query_runs = s.execute(
                    select(func.count()).select_from(QueryRun).where(QueryRun.model_id == model_id)
                ).scalar_one()
                map_runs = s.execute(
                    select(func.count()).select_from(MapRun).where(MapRun.model_id == model_id)
                ).scalar_one()
                preannotation = project.preannotation_model_id == model_id
                entry = {
                    "project_id": project.id,
                    "name": project.name,
                    "folder": str(handle.folder),
                    "preannotation": preannotation,
                    "query_runs": int(query_runs),
                    "map_runs": int(map_runs),
                }
        except Exception:
            log.exception("could not scan project at %s for uses of model %s", folder, model_id)
            continue
        if preannotation or query_runs or map_runs:
            out.append(entry)
    return out
