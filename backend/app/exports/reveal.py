"""Show a file or folder of the project in Windows Explorer (spec G2).

The path a caller sends is trusted with nothing: both sides are resolved and the result must
still sit inside the project folder, so `..`, an absolute path, a UNC path or a drive-relative
path (`C:foo`) are all refused (409 `conflict`: the request is schema-valid, the project just
cannot serve it) before anything is launched.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from app.errors import AppError, not_found
from app.projects.service import ProjectHandle

EXPLORER = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "explorer.exe"


def launch(command: str) -> None:
    """The one place that starts Explorer; tests replace this (or `subprocess.Popen`) with a no-op.

    `command` is a single string, not a list, but this still never goes through a shell:
    `subprocess.Popen` defaults to `shell=False`, and on Windows a string command with `shell=False`
    is handed to `CreateProcess` as-is, never to `cmd.exe`. `target` (quoted inside `command`) is
    always our own path, freshly resolved against the project folder in `resolve_inside_project`,
    never text the caller supplies verbatim; a `"` cannot occur inside a Windows path, so it cannot
    break out of the quotes it is wrapped in.
    """
    subprocess.Popen(command)  # noqa: S603 - shell=False (the default); command embeds only our own resolved path


def _outside_project(message: str) -> AppError:
    return AppError("conflict", message, 409)


def resolve_inside_project(handle: ProjectHandle, relative_path: str) -> Path:
    """The absolute path `relative_path` names; raises 409 when it does not resolve inside the project."""
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
    """Refuses anything outside the project (409), 404 when it does not exist, else starts Explorer."""
    target = resolve_inside_project(handle, relative_path)
    if not (target.is_file() or target.is_dir()):
        # Not `.exists()` alone: a reserved device name (`NUL`, `CON`, ...) can behave oddly under
        # `.exists()` on Windows, and neither `is_file()` nor `is_dir()` is ever true for one, so
        # this still lands on a clean 404 instead of the ambiguous branch below.
        raise not_found("path", relative_path)
    if target.is_dir():
        launch(f'"{EXPLORER}" "{target}"')
    else:
        launch(f'"{EXPLORER}" /select,"{target}"')
