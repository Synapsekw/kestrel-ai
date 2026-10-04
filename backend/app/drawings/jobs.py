"""The `drawing_import` job (spec §8.2): one job type, two phases, one module per phase.

Phase modules are imported when a job runs, so importing the router never pulls in ezdxf,
pypdfium2, scipy or rasterio: a broken native library must not stop the backend (AGENTS.md).
"""

from __future__ import annotations

import importlib

from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type

PHASES = {
    "inspect": "app.drawings.phase_inspect",
    "build": "app.drawings.phase_build",
    "pages": "app.drawings.phase_pages",
}
MESSAGES = {"inspect": "Reading drawing", "build": "Importing drawing", "pages": "Importing drawing pages"}


def _cancelled_before_start(ctx) -> None:
    """A queued job cancelled before it ran: a build fails its row, an inspection its inspection.json
    (neither phase module imports a native library at module scope)."""
    phase = ctx.params.get("phase")
    if phase in PHASES:
        importlib.import_module(PHASES[phase]).cancelled_before_start(ctx)


@register_job_type("drawing_import", on_cancelled_before_start=_cancelled_before_start)
def run_drawing_import(ctx) -> dict:
    phase = ctx.params.get("phase")
    if phase not in PHASES:
        raise JobFailure(f"unknown drawing import phase {phase!r}")
    ctx.progress(0.0, MESSAGES[phase])
    return importlib.import_module(PHASES[phase]).run(ctx)
