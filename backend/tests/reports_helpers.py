"""Reports test helpers (plan R1): a valid config taken from the built-ins, creating a report over
the API, and `report_version` rows written directly (R5 writes them for real)."""

from datetime import UTC, datetime

from app.db.base import new_id
from app.reports.models import ReportVersion
from app.reports.templates.builtins import BUILTIN_TEMPLATES

PROJECTS = "/api/v1/projects"
TEMPLATES = "/api/v1/report-templates"


def builtin(template_id: str = "builtin-full"):
    return next(t for t in BUILTIN_TEMPLATES if t.id == template_id)


def config_json(template_id: str = "builtin-full") -> dict:
    """A valid ReportConfig as JSON (the built-in's), safe to mutate."""
    return builtin(template_id).config.model_dump(mode="json", by_alias=True)


def reports_url(pid: str) -> str:
    return f"{PROJECTS}/{pid}/reports"


def create_report(client, pid: str, title: str = "Site A", template_id: str | None = None) -> dict:
    body: dict = {"title": title}
    if template_id is not None:
        body["template_id"] = template_id
    r = client.post(reports_url(pid), json=body)
    assert r.status_code == 201, r.text
    return r.json()


def add_version(
    handle,
    report_id: str,
    *,
    number: int | None,
    state: str = "ready",
    issued_at: datetime | None = None,
    pages: int | None = None,
    created_at: datetime | None = None,
) -> str:
    """One report_version row, as R5's promote would leave it (only the columns R1 reads matter)."""
    vid = new_id()
    with handle.session() as s:
        s.add(
            ReportVersion(
                id=vid,
                report_id=report_id,
                number=number,
                state=state,
                issued_at=issued_at,
                job_id=new_id(),
                folder=f"reports/{report_id}/v{(number or 0):03d}",
                files=[],
                config={},
                baseline_version_id=None,
                stats={"page_count": pages} if pages is not None else {},
                created_at=created_at or datetime.now(UTC),
            )
        )
    return vid
