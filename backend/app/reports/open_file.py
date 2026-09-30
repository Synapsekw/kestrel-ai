"""Open a file of the project with its default application (spec 2026-09-26-reports §14 `POST
/open`): the report history's *Open PDF*.

The path is trusted with nothing: `resolve_inside_project` (the reveal guard) refuses anything that
leaves the project folder, and only document-like suffixes open (plan R1 Ruling 11), so no caller
can make Windows run a program that happens to sit inside a project.
"""

from __future__ import annotations

import os
from pathlib import Path

from app.errors import AppError, not_found
from app.exports.reveal import resolve_inside_project
from app.projects.service import ProjectHandle

OPENABLE = frozenset({".pdf", ".csv", ".xlsx", ".html", ".json", ".txt", ".png", ".jpg", ".jpeg"})


def start(path: Path) -> None:
    """The one place that hands a file to Windows; tests replace it (tests/conftest.py)."""
    os.startfile(str(path))  # noqa: S606 - our own resolved path; no shell, no arguments


def open_in_default_app(handle: ProjectHandle, relative_path: str) -> None:
    target = resolve_inside_project(handle, relative_path)
    if target.is_dir():
        raise AppError("conflict", "path is a folder; reveal it instead", 409)
    if target.suffix.lower() not in OPENABLE:
        raise AppError(
            "conflict", "Kestrel opens documents only (PDF, CSV, XLSX, HTML, JSON, text, images)", 409
        )
    if not target.is_file():
        raise not_found("path", relative_path)
    try:
        start(target)
    except OSError as e:  # no app registered for the suffix, access denied, ... (final review #3)
        raise AppError(
            "conflict", f"Windows could not open {target.name}: no app is set up to open it here", 409
        ) from e
