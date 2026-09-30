"""catalogue: report_template, seeded with the four built-in report templates

Spec 2026-09-26-reports section 6.2 (plan 2026-09-30-reports-r0). The seed is a frozen copy of
app/reports/templates/builtins.py on 2026-09-30, never imported, so a later edit there cannot
rewrite this revision; tests/test_catalogue_migration_0002.py pins that the two agree.

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-30
"""

import json
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

SEEDED_AT = datetime(2026, 9, 30)  # naive UTC, as UTCDateTime stores it
ORDER = (
    "cover",
    "summary",
    "findings_table",
    "finding_pages",
    "measurements",
    "comparison",
    "object_counts",
    "appendix",
)
OPTIONS = {
    "cover": {"show_locator": True},
    "summary": {"narrative": "", "show_deltas": True},
    "findings_table": {
        "columns": ["number", "type", "severity", "status", "data_item", "observed", "note"],
        "sort": "severity_desc",
    },
    "finding_pages": {
        "snapshots": ["image", "map", "cloud"],
        "photos_max": 4,
        "comments": "last",
        "context_inset": True,
    },
    "measurements": {
        "kinds": ["length", "area", "height", "lean", "profile", "volume"],
        "snapshots": True,
        "measurement_ids": None,
    },
    "comparison": {"pairs": "auto", "mode": "both", "counts_chart": True},
    "object_counts": {"type_ids": None, "per_area": True, "verified_only": False},
    "appendix": {"include_methods": True},
}
COVER = {
    "title": "",
    "subtitle": None,
    "site": None,
    "client": None,
    "author": "",
    "logo_asset_id": None,
    "report_date": None,
}
PAPER = {"size": "A4", "orientation": "portrait"}
FILTERS = {
    "severity_min": None,
    "include_ungraded": True,
    "statuses": ["open", "reviewed"],
    "type_ids": None,
    "data_item_ids": None,
    "date": {"rule": "all", "from": None, "to": None, "days": None},
}


def _copy(value):
    return json.loads(json.dumps(value))


def _config(on: tuple[str, ...], overrides: dict | None = None) -> dict:
    sections = []
    for key in [*on, *(k for k in ORDER if k not in on)]:
        options = {**_copy(OPTIONS[key]), **_copy((overrides or {}).get(key, {}))}
        sections.append({"key": key, "enabled": key in on, "options": options})
    return {"cover": _copy(COVER), "paper": _copy(PAPER), "filters": _copy(FILTERS), "sections": sections}


BUILTIN_ROWS = [
    {
        "id": "builtin-full",
        "name": "Full inspection report",
        "description": "Every section: cover, summary, findings table, a page per finding, measurements,"
        " survey comparison, object counts and the data appendix.",
        "config": _config(ORDER),
    },
    {
        "id": "builtin-findings-summary",
        "name": "Findings summary",
        "description": "Cover, executive summary and the findings table.",
        "config": _config(("cover", "summary", "findings_table")),
    },
    {
        "id": "builtin-survey-counts",
        "name": "Survey count report",
        "description": "Cover, survey comparison and object counts. Replaces the detection PDF per source.",
        "config": _config(("cover", "comparison", "object_counts")),
    },
    {
        "id": "builtin-volumes",
        "name": "Volumes report",
        "description": "Cover, volume measurements and the data appendix.",
        "config": _config(("cover", "measurements", "appendix"), {"measurements": {"kinds": ["volume"]}}),
    },
]


def upgrade() -> None:
    table = op.create_table(
        "report_template",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=False, server_default=""),
        sa.Column("builtin", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_report_template_list", "report_template", ["builtin", "name", "id"])
    op.bulk_insert(
        table,
        [{**row, "builtin": True, "created_at": SEEDED_AT, "updated_at": SEEDED_AT} for row in BUILTIN_ROWS],
    )


def downgrade() -> None:
    op.drop_index("ix_report_template_list", table_name="report_template")
    op.drop_table("report_template")
