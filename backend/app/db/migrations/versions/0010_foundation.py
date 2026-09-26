"""foundation: project types, findings, counts, activity, migration bookkeeping

The one project schema change of the foundation sub-project (spec 2026-09-26-foundation section
11.1). New tables, one new column (`project.finding_seq`) and one dropped column (`project.kind`,
which unit BK unmapped from the Project model); no row is rewritten here. The data steps are MG's
job (section 11.4), and MG's copy-first backup runs before this revision (section 11.2).

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-26 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

from app.db.models import ANCHOR_CHECK

revision = "0010"
down_revision = "0009"  # main's project head at merge time
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("project") as b:
        b.add_column(sa.Column("finding_seq", sa.Integer(), nullable=False, server_default="0"))
        b.drop_column("kind")
    op.create_index("ix_box_class", "box", ["class_id"])
    op.create_table(
        "project_type",
        sa.Column("type_id", sa.String(36), primary_key=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("hotkey_override", sa.String(1), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("colour", sa.String(7), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("default_severity", sa.Integer(), nullable=True),
        sa.Column("hotkey", sa.String(1), nullable=True),
        sa.Column("group", sa.String(), nullable=True),
        sa.Column("refreshed_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_project_type_position", "project_type", ["position"])
    op.create_table(
        "finding",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("type_id", sa.String(36), nullable=False),
        sa.Column("severity", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("created_by", sa.String(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("anchor_kind", sa.String(), nullable=False),
        sa.Column("image_id", sa.String(36), nullable=True),
        sa.Column("annotation_id", sa.String(36), sa.ForeignKey("box.id"), nullable=True),
        sa.Column("map_id", sa.String(36), nullable=True),
        sa.Column("geometry", sa.JSON(), nullable=True),
        sa.Column("cloud_id", sa.String(36), nullable=True),
        sa.Column("x", sa.Float(), nullable=True),
        sa.Column("y", sa.Float(), nullable=True),
        sa.Column("z", sa.Float(), nullable=True),
        sa.Column("uncertainty_m", sa.Float(), nullable=True),
        sa.Column("lon", sa.Float(), nullable=True),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("data_type", sa.String(), nullable=False),
        sa.Column("data_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint(ANCHOR_CHECK, name="ck_finding_anchor"),
        sa.CheckConstraint("status IN ('open', 'reviewed', 'closed')", name="ck_finding_status"),
    )
    op.create_index("ux_finding_number", "finding", ["number"], unique=True)
    op.create_index("ux_finding_annotation", "finding", ["annotation_id"], unique=True)
    op.create_index("ix_finding_status_severity_number", "finding", ["status", "severity", "number"])
    op.create_index("ix_finding_type", "finding", ["type_id"])
    op.create_index("ix_finding_data", "finding", ["data_id"])
    op.create_index("ix_finding_updated", "finding", ["updated_at"])
    op.create_index("ix_finding_image", "finding", ["anchor_kind", "image_id"])
    op.create_index("ix_finding_location", "finding", ["lon", "lat"])
    op.create_table(
        "finding_attachment",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "finding_id", sa.String(36), sa.ForeignKey("finding.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("path", sa.String(), nullable=False),
        sa.Column("original_name", sa.String(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_finding_attachment_finding", "finding_attachment", ["finding_id", "created_at"])
    op.create_table(
        "finding_comment",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "finding_id", sa.String(36), sa.ForeignKey("finding.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("author", sa.String(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("edited_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_finding_comment_finding", "finding_comment", ["finding_id", "created_at"])
    op.create_table(
        "finding_count",
        sa.Column("status", sa.String(), primary_key=True),
        sa.Column("severity", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("type_id", sa.String(36), primary_key=True),
        sa.Column("n", sa.Integer(), nullable=False),
    )
    op.create_table(
        "finding_daily",
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("open", sa.Integer(), nullable=False),
        sa.Column("open_by_severity", sa.JSON(), nullable=False),
        sa.Column("closed", sa.Integer(), nullable=False),
        sa.Column("closed_by_severity", sa.JSON(), nullable=False),
    )
    op.create_table(
        "activity",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("at", sa.DateTime(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("subject_id", sa.String(36), nullable=True),
        sa.Column("summary", sa.String(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
    )
    op.create_index("ix_activity_at", "activity", ["at"])
    op.create_index("ix_activity_subject", "activity", ["subject_id", "at"])
    op.create_table(
        "migration_step",
        sa.Column("name", sa.String(), primary_key=True),
        sa.Column("done_at", sa.DateTime(), nullable=False),
        sa.Column("detail", sa.JSON(), nullable=False),
    )
    op.create_table(
        "class_id_map",
        sa.Column("old_class_id", sa.String(36), primary_key=True),
        sa.Column("type_id", sa.String(36), nullable=False),
    )


def downgrade() -> None:
    for table in (
        "class_id_map",
        "migration_step",
        "activity",
        "finding_daily",
        "finding_count",
        "finding_comment",
        "finding_attachment",
        "finding",
        "project_type",
    ):
        op.drop_table(table)
    op.drop_index("ix_box_class", table_name="box")
    with op.batch_alter_table("project") as b:
        b.drop_column("finding_seq")
        b.add_column(sa.Column("kind", sa.String(), nullable=False, server_default="train"))
