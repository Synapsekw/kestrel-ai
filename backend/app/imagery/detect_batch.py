"""Batch detection over many images as one `infer` job (image inspection spec §11.3, §15).

The scope — ids, a source, or the browser's filter — is resolved to image ids once, when the run
is created, so the job's work is fixed and resumable. Everything a request can be refused for is
checked before the run row is written (as `detect/runs.create_runs` does).
"""

from __future__ import annotations

from collections.abc import Callable

from sqlalchemy import select

from app.db.models import Image, Job, QueryRun, Source
from app.detect import class_maps
from app.errors import AppError, not_found
from app.imagery import index
from app.imagery.detect_models import resolve_model
from app.imagery.detect_schemas import DetectBatchRequest, DetectBatchScope, ImageFilter
from app.imagery.filters import ImageFilters
from app.inference import service as inference
from app.library.catalogue_port import CataloguePort
from app.library.handle import LibraryHandle
from app.projects.service import ProjectHandle
from app.providers.config import ProviderConfigStore
from app.providers.keys import KeyStore

ID_CHUNK = 10_000  # SQLite's bound-parameter limit is 32,766; stay well under it


def _existing(handle: ProjectHandle, ids: list[str]) -> None:
    with handle.session() as s:
        for i in range(0, len(ids), ID_CHUNK):
            chunk = ids[i : i + ID_CHUNK]
            found = set(s.execute(select(Image.id).where(Image.id.in_(chunk))).scalars())
            missing = [x for x in chunk if x not in found]
            if missing:
                raise not_found("image", missing[0])


def _filters(f: ImageFilter) -> ImageFilters:
    """The contract's body filter as BX's `ImageFilters` (severity levels are text there). A filter
    with an unknown `source_id` is a query that matches nothing, so it answers 422 `no_images`, not
    404."""
    values = f.model_dump(exclude_none=True)
    if "severity" in values:
        values["severity"] = [str(v) for v in values["severity"]]
    return ImageFilters(**values)


def scope_image_ids(handle: ProjectHandle, scope: DetectBatchScope) -> tuple[list[str], str | None]:
    """`(image_ids, source_id)` for the run (ruling R-BP7). The schema already made the scope exactly
    one of the three."""
    source_id = None
    if scope.image_ids is not None:
        ids = list(dict.fromkeys(scope.image_ids))
        _existing(handle, ids)
    elif scope.source_id is not None:
        with handle.session() as s:
            if s.get(Source, scope.source_id) is None:
                raise not_found("source", scope.source_id)
            ids = list(
                s.execute(
                    select(Image.id).where(Image.source_id == scope.source_id).order_by(Image.path)
                ).scalars()
            )
        source_id = scope.source_id
    else:
        ids = list(
            index.build_index(handle, _filters(scope.filter), sort="path", order="asc", geo=False)["ids"]
        )
    if len(ids) > index.INDEX_CAP:
        raise AppError(
            "too_many_images",
            f"{len(ids)} images are more than one batch takes ({index.INDEX_CAP}); narrow the scope.",
            422,
            {"total": len(ids), "cap": index.INDEX_CAP},
        )
    if not ids:
        raise AppError("no_images", "No images match this scope.", 422)
    return ids, source_id


def create_batch(
    handle: ProjectHandle,
    lib: LibraryHandle | None,
    catalogue_fn: Callable[[], CataloguePort],
    keys: KeyStore,
    config: ProviderConfigStore,
    body: DetectBatchRequest,
    submit: Callable[[str, dict], Job],
) -> tuple[QueryRun, Job]:
    """The run and its queued `infer` job. `catalogue_fn` is only called for a library model, so a
    cloud batch never fails on an unavailable catalogue (foundation plan BM A11)."""
    local = body.kind == "local_model"
    if (local and not body.model_id) or (not local and not body.provider):
        raise AppError(
            "model_or_provider_required",
            "A local_model batch needs model_id; a cloud_provider batch needs provider.",
            422,
        )
    image_ids, source_id = scope_image_ids(handle, body.scope)
    if local:
        resolved = resolve_model(handle, lib, catalogue_fn(), body.model_id)
        common = {
            "kind": "local_model",
            "model_id": resolved.model.id,
            "provider": None,
            "model_name": resolved.model.name,
            "query": "",
            "model_snapshot": class_maps.model_snapshot(resolved.model),
            "class_map": resolved.mapping,
        }
    else:
        if not (body.query or "").strip():
            raise AppError("query_required", "a cloud provider run needs a non-empty query", 422)
        if keys.get(body.provider) is None:
            raise AppError("conflict", f"no API key stored for {body.provider}", 409)
        common = {
            "kind": "cloud_provider",
            "model_id": None,
            "provider": body.provider,
            "model_name": config.get(body.provider).model_name,
            "query": body.query.strip(),
            "model_snapshot": {},
            "class_map": {},
        }
    with handle.session() as s:
        run = QueryRun(
            **common,
            source_id=source_id,
            image_ids=image_ids,
            tiling=body.tiling.model_dump(),
            conf=body.conf,
        )
        s.add(run)
        s.flush()
        run_id = run.id
    try:
        job = submit("infer", {"query_run_id": run_id})
    except Exception:
        with handle.session() as s:  # no run that will never start is left in the list
            row = s.get(QueryRun, run_id)
            if row is not None:
                s.delete(row)
        raise
    return inference.set_job(handle, run_id, job.id), job
