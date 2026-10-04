"""The PDF's `volume` blocks go through the existing volume pages (index "Block kinds": R4 calls
the injected hook, R5 wires it to `volumes.report_pdf.measurement_flowables`). A stale, not-ready
or deleted measurement prints "stale, recalculate" instead of numbers (spec §16). reportlab loads
only when a volume block is rendered."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from app.errors import AppError
from app.jobs.cancellation import JobFailure

STALE_TEXT = "This measurement is stale, recalculate it in Measurements before reporting."


def _stale(block: Any) -> list:
    from xml.sax.saxutils import escape

    from reportlab.platypus import Paragraph

    from app.volumes.report_pdf import STYLES

    return [
        Paragraph(escape(block.title), STYLES["Heading2"]),
        Paragraph(f"{escape(block.title)}: stale, recalculate. {STALE_TEXT}", STYLES["BodyText"]),
    ]


def volume_flowables_for(handle, snapshot_path: Callable[[Any], Path | None]) -> Callable[[Any], list]:
    """`handle` is the project's `ProjectHandle`. `snapshot_path` maps a `SnapshotRef` to a rendered
    JPEG path, or `None` when that snapshot never mapped (Ruling P7), the item then keeps its own
    `plan_png` rather than failing."""

    def flowables(block: Any) -> list:
        from app.volumes import jobs_export, report_pdf

        if block.stale:
            return _stale(block)
        try:
            item = jobs_export._load(SimpleNamespace(project=handle), [block.measurement_id])[0]
        except (JobFailure, AppError):
            return _stale(block)
        if block.figure is not None:
            path = snapshot_path(block.figure.snapshot)
            if path is not None:
                item.plan_png = Path(path).read_bytes()  # JPEG; reportlab sniffs it
        return report_pdf.measurement_flowables(item)

    return flowables
