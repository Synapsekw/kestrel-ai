"""reports: report, report_version, report_version_finding, report_asset

The one project schema change of Reports (spec 2026-09-26-reports section 6.1, plan R0). New tables
only; no existing row is touched, so this cannot fail on user data and cannot be the reason a
project does not open.

Revision ID: 0014
Revises: 0013
Create Date: 2026-09-30 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

# Frozen here (the text of app.reports.models' checks on 2026-09-30), so a later model edit cannot
# rewrite this revision's history.
REPORT_VERSION_STATE_CHECK = "state IN ('rendering', 'ready', 'failed')"
REPORT_ASSET_KIND_CHECK = "kind IN ('logo')"

revision = "0014"
down_revision = "0013"  # C-C0's revision; re-check `alembic heads` on main before merging
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "report",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("template_id", sa.String(64), nullable=True),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_report_list", "report", ["archived", "updated_at", "id"])
    op.create_table(
        "report_version",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("report_id", sa.String(36), sa.ForeignKey("report.id", ondelete="CASCADE"), nullable=False),
        sa.Column("number", sa.Integer(), nullable=True),
        sa.Column("state", sa.String(), nullable=False, server_default="rendering"),
        sa.Column("issued_at", sa.DateTime(), nullable=True),
        sa.Column("job_id", sa.String(36), nullable=True),
        sa.Column("folder", sa.String(), nullable=True),
        sa.Column("files", sa.JSON(), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column(
            "baseline_version_id",
            sa.String(36),
            sa.ForeignKey("report_version.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("stats", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(REPORT_VERSION_STATE_CHECK, name="ck_report_version_state"),
    )
    op.create_index("ux_report_version_number", "report_version", ["report_id", "number"], unique=True)
    op.create_index("ix_report_version_issued", "report_version", ["issued_at"])
    op.create_table(
        "report_version_finding",
        sa.Column(
            "version_id",
            sa.String(36),
            sa.ForeignKey("report_version.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("finding_id", sa.String(36), primary_key=True),
        sa.Column("type_id", sa.String(36), nullable=False),
        sa.Column("severity", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
    )
    op.create_index("ix_report_version_finding_finding", "report_version_finding", ["finding_id"])
    op.create_table(
        "report_asset",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("path", sa.String(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(REPORT_ASSET_KIND_CHECK, name="ck_report_asset_kind"),
    )
    op.create_index("ux_report_asset_sha256", "report_asset", ["sha256"], unique=True)


def downgrade() -> None:
    op.drop_table("report_asset")
    op.drop_table("report_version_finding")
    op.drop_table("report_version")
    op.drop_table("report")
