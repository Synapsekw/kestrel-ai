"""Test helpers for the models backend (plan BM): projects, images and boxes written directly,
so the tests do not depend on the project-creation API that BK and BC change in parallel."""

import inspect
from pathlib import Path

from app.projects.service import ProjectHandle


def make_project(app, folder: Path, name: str) -> ProjectHandle:
    """An empty project. The one place BM's tests create one: `ProjectRegistry.create` loses its
    `kind` argument in BK (foundation §6.1), and this call works on either side of that merge."""
    registry = app.state.projects
    if "kind" in inspect.signature(registry.create).parameters:
        return registry.create(name, folder, [], "detect")
    return registry.create(name, folder, [])
