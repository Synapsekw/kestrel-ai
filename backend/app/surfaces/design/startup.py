"""Startup sweep, run by `app.main.project_opened` each time the project opens.

Design inspection folders under `cache/design-inspections/` whose jobs are not live and whose
`request.json` is more than 24 h old are removed (spec 2026-09-23-design-surfaces section 4.4).

Foundation F0 wires it in as a no-op; S3 unit U1 fills in only this function's body and never edits
`app/main.py`. It must log and continue on its own failures: a failing sweep never blocks opening
the project.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.projects.service import ProjectHandle


def sweep_interrupted(handle: ProjectHandle, runner) -> list[str]:
    """Returns the ids of the rows it changed; none until S3 unit U1 builds it."""
    return []
