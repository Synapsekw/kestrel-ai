"""Startup sweep, run by `app.main.project_opened` each time the project opens.

A `calculating` measurement whose job is not live becomes `stale` (earlier results) or `failed`;
orphan `*.partial` files are removed (spec 2026-09-23-volumes section 3).

Foundation F0 wires it in as a no-op; S2 unit V5 fills in only this function's body and never edits
`app/main.py`. It must log and continue on its own failures: a failing sweep never blocks opening
the project.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.projects.service import ProjectHandle


def sweep_interrupted(handle: ProjectHandle, runner) -> list[str]:
    """Returns the ids of the rows it changed; none until S2 unit V5 builds it."""
    return []
