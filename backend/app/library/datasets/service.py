"""Datasets across projects (foundation F §12): preview, create, read, delete. The jobs live in
`build.py` (`dataset_build`) and `export.py` (`dataset`)."""

from __future__ import annotations

import logging

from app.errors import AppError
from app.library.datasets import selection
from app.library.datasets.schemas import DatasetFilter, DatasetPreview, DatasetPreviewProject

log = logging.getLogger(__name__)


def preview(registry, body: DatasetFilter) -> DatasetPreview:
    """COUNTs only, per project, each under `selection.PREVIEW_TIMEOUT_S`. A project that is
    missing, will not open, or is too slow is reported and never fails the request (decision 14)."""
    f = selection.Filter.from_json(body.model_dump(mode="json"))
    projects: list[DatasetPreviewProject] = []
    per_type: dict[str, int] = {}
    total = 0
    for project_id in f.project_ids:
        entry = DatasetPreviewProject(project_id=project_id, project_name=None, images=0, boxes=0, state="ok")
        try:
            handle = registry.get(project_id)
        except AppError as e:
            projects.append(
                entry.model_copy(update={"state": "missing" if e.status == 404 else "unavailable"})
            )
            continue
        except Exception:
            log.exception("could not open project %s for a dataset preview", project_id)
            projects.append(entry.model_copy(update={"state": "unavailable"}))
            continue
        name = None
        try:
            with handle.session() as s:
                name = handle.row(s).name
                with selection.interrupt_after(s, selection.PREVIEW_TIMEOUT_S):
                    images, boxes = selection.count(s, f)
        except selection.PreviewTimeout:
            projects.append(entry.model_copy(update={"project_name": name, "state": "timed_out"}))
            continue
        except Exception:
            log.exception("could not count project %s for a dataset preview", project_id)
            projects.append(entry.model_copy(update={"project_name": name, "state": "unavailable"}))
            continue
        total += images
        for type_id, n in boxes.items():
            per_type[type_id] = per_type.get(type_id, 0) + n
        projects.append(
            entry.model_copy(update={"project_name": name, "images": images, "boxes": sum(boxes.values())})
        )
    return DatasetPreview(images=total, boxes_per_type=per_type, projects=projects)
