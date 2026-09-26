"""Opening a dataset's source project from a library job (foundation F §12.2)."""

from __future__ import annotations

from pathlib import Path


def open_source(registry, project_id: str, folder: str):
    """The project by id (open or recent), else by the folder recorded when the dataset was built,
    provided the folder still holds that same project. None when neither works."""
    try:
        return registry.get(project_id)
    except Exception:
        pass
    try:
        handle = registry.open(Path(folder), remember=False)
    except Exception:
        return None
    return handle if handle.id == project_id else None
