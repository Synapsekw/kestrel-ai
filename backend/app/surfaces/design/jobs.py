"""The `design_import` job (spec §4.1): one job type, three phases, one module per phase.

Phase modules are imported when a job runs, so importing the router never pulls in ezdxf, scipy or
rasterio: a broken native library must not stop the backend from starting (AGENTS.md).
"""

from __future__ import annotations

import importlib

from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type

PHASES = {
    "inspect": "app.surfaces.design.phase_inspect",
    "preview": "app.surfaces.design.phase_preview",
    "build": "app.surfaces.design.phase_build",
}
MESSAGES = {
    "inspect": "Reading design file",
    "preview": "Previewing design",
    "build": "Importing design surface",
}


def _cancelled_before_start(ctx) -> None:
    """Only a build leaves a row behind (inspections and previews are folders their dialog owns)."""
    if ctx.params.get("phase") == "build":
        importlib.import_module(PHASES["build"]).cancelled_before_start(ctx)


@register_job_type("design_import", on_cancelled_before_start=_cancelled_before_start)
def run_design_import(ctx) -> dict:
    phase = ctx.params.get("phase")
    if phase not in PHASES:
        raise JobFailure(f"unknown design import phase {phase!r}")
    ctx.progress(0.0, MESSAGES[phase])
    return importlib.import_module(PHASES[phase]).run(ctx)
