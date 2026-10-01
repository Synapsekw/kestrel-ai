"""Helpers for R5's report render tests: a report, findings, a render, a fake job context and a
fake document. `fake_document` is the only place that knows the `ReportDocument` dict shape; if
R0's merged schema differs, change it here only."""

from __future__ import annotations

import logging
from types import SimpleNamespace

from app.jobs.cancellation import JobCancelled

API = "/api/v1"


def new_report(
    client,
    project_id: str,
    *,
    template_id: str = "builtin-findings-summary",
    title: str = "Weekly inspection",
) -> dict:
    from reports_helpers import create_report

    return create_report(client, project_id, title=title, template_id=template_id)


def map_finding(
    client,
    handle,
    project_id: str,
    type_id: str,
    *,
    severity: int | None = 2,
    status: str = "open",
    note: str = "",
) -> dict:
    from findings_helpers import insert_map

    map_id = insert_map(handle)
    body = {
        "type_id": type_id,
        "anchor": {
            "kind": "map",
            "map_id": map_id,
            "geometry": {"type": "Point", "coordinates": [10.0, 20.0]},
        },
        "severity": severity,
        "status": status,
        "note": note,
    }
    r = client.post(f"{API}/projects/{project_id}/findings", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def start_render(client, project_id: str, report_id: str, formats=("pdf", "csv", "xlsx")) -> dict:
    url = f"{API}/projects/{project_id}/reports/{report_id}/renders"
    r = client.post(url, json={"formats": list(formats)})
    assert r.status_code == 202, r.text
    return r.json()["job"]


class FakeCtx:
    """A JobContext stand-in: records progress, cancels on the `cancel_at`-th check."""

    def __init__(self, handle, params: dict, *, cancel_at: int | None = None, catalogue=None):
        self.project, self.params, self.job_id = handle, params, "job-test"
        self.runner = SimpleNamespace(catalogue=catalogue)
        self.values: list[float] = []
        self.messages: list[str] = []
        self.checks, self.cancel_at = 0, cancel_at
        self.log = logging.getLogger("test.report_render")

    def progress(self, fraction: float, message: str = "") -> None:
        self.values.append(fraction)
        self.messages.append(message)

    def publish(self, *_a) -> None:
        pass

    def check_cancelled(self) -> None:
        self.checks += 1
        if self.cancel_at is not None and self.checks >= self.cancel_at:
            raise JobCancelled()


def fake_document(report_id: str, *, figures: int = 0, finding_ids: tuple[str, ...] = ()):
    """A valid ReportDocument (R0 `schemas.py`): one summary section of `figures` figure blocks
    (distinct 32-hex snapshot keys, via `report_docs.figure`) and one `finding_pages` section with
    a minimal finding block per id in `finding_ids`."""
    from report_docs import figure, finding

    from app.reports.schemas import ReportDocument
    from app.reports.theme import THEME_VERSION

    figure_blocks = [figure(f"{report_id}-fig-{i}") for i in range(figures)]
    finding_blocks = []
    for n, fid in enumerate(finding_ids):
        block = finding(n + 1, figs=(), photos=0, comments=0)
        block["finding_id"] = fid
        finding_blocks.append(block)
    return ReportDocument.model_validate(
        {
            "report_id": report_id,
            "version": None,
            "generated_at": "2026-09-30T10:00:00Z",
            "theme_version": str(THEME_VERSION),
            "sections": [
                {"key": "summary", "title": "Summary", "blocks": figure_blocks},
                {"key": "finding_pages", "title": "Findings", "blocks": finding_blocks},
            ],
        }
    )
