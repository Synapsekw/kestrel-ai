"""Show a file or folder of the project in Windows Explorer (spec G2).

The path a caller sends is trusted with nothing: both sides are resolved and the result must
still sit inside the project folder, so `..`, an absolute path, a UNC path or a drive-relative
path (`C:foo`) are all refused before anything is launched. Explorer is never reached through a
shell: `launch` calls `subprocess.Popen` with a fixed executable and a list of arguments.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from app.errors import AppError, not_found
from app.projects.service import ProjectHandle


def launch(args: list[str]) -> None:
    """The one place that starts Explorer; tests replace this (or `subprocess.Popen`) with a no-op."""
    subprocess.Popen(args, shell=False)  # noqa: S603 - fixed executable ("explorer.exe"), never a shell


def _outside_project(message: str) -> AppError:
    return AppError("validation_error", message, 422)


def resolve_inside_project(handle: ProjectHandle, relative_path: str) -> Path:
    """The absolute path `relative_path` names; raises 422 when it does not resolve inside the project."""
    raw = Path(relative_path)
    if raw.is_absolute() or raw.drive:
        # `is_absolute()` alone misses a drive-relative path like `C:foo` (has a drive, no root).
        raise _outside_project("path must be relative to the project folder")
    root = handle.folder.resolve()
    candidate = (handle.folder / relative_path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        raise _outside_project("path leaves the project folder") from None
    return candidate


def reveal(handle: ProjectHandle, relative_path: str) -> None:
    """Refuses anything outside the project (422), 404 when it does not exist, else starts Explorer."""
    target = resolve_inside_project(handle, relative_path)
    if not target.exists():
        raise not_found("path", relative_path)
    if target.is_dir():
        launch(["explorer.exe", str(target)])
    else:
        launch(["explorer.exe", f"/select,{target}"])
