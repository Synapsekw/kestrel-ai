"""point cloud workspace: measurement params and status, camera height offsets, report views

The one project schema change of the point-cloud workspace (spec 2026-09-26-point-cloud-workspace
sections 8.1, 10.1 and 11.2). New nullable columns on `cloud_measurement` (every existing row becomes
`ready`) and two new tables; the table is recreated by batch mode with every row copied, and nothing
is computed from user data, so it cannot fail on user data and cannot be the reason a project does
not open.

Revision ID: 0013
Revises: 0010
Create Date: 2026-09-27 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

# Frozen here (the text of app.db.models.CLOUD_VIEW_SUBJECT_CHECK on 2026-09-27), so a later model
# edit cannot rewrite this revision's history.
CLOUD_VIEW_SUBJECT_CHECK = "(finding_id IS NULL) <> (cloud_measurement_id IS NULL)"

revision = "0013"
down_revision = "0010"  # TEMP: 0012 (M-C0) after rebase (R4)
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("cloud_measurement") as b:
        b.add_column(sa.Column("params", sa.JSON(), nullable=True))
        b.add_column(sa.Column("status", sa.String(), nullable=False, server_default="ready"))
        b.add_column(sa.Column("error", sa.String(), nullable=True))
        b.add_column(sa.Column("job_id", sa.String(36), nullable=True))
        b.add_column(sa.Column("finding_id", sa.String(36), nullable=True))
        b.create_foreign_key(
            "fk_cloud_measurement_finding", "finding", ["finding_id"], ["id"], ondelete="SET NULL"
        )
        b.create_index("ix_cloud_measurement_finding", ["finding_id"])
    op.create_table(
        "cloud_camera_offset",
        sa.Column(
            "point_cloud_id",
            sa.String(36),
            sa.ForeignKey("point_cloud.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "source_id", sa.String(36), sa.ForeignKey("source.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("height_offset_m", sa.Float(), nullable=False, server_default="0"),
    )
    op.create_table(
        "cloud_view",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "point_cloud_id",
            sa.String(36),
            sa.ForeignKey("point_cloud.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "finding_id", sa.String(36), sa.ForeignKey("finding.id", ondelete="CASCADE"), nullable=True
        ),
        sa.Column(
            "cloud_measurement_id",
            sa.String(36),
            sa.ForeignKey("cloud_measurement.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("anchor_normal", sa.JSON(), nullable=True),
        sa.Column("pose", sa.JSON(), nullable=False),
        sa.Column("render", sa.JSON(), nullable=False),
        sa.Column("path", sa.String(), nullable=False),
        sa.Column("sha256", sa.String(), nullable=False),
        sa.Column("bytes", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("anchor_hash", sa.String(), nullable=False),
        sa.Column("captured_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(CLOUD_VIEW_SUBJECT_CHECK, name="ck_cloud_view_subject"),
    )
    op.create_index("ux_cloud_view_finding", "cloud_view", ["finding_id"], unique=True)
    op.create_index("ux_cloud_view_measurement", "cloud_view", ["cloud_measurement_id"], unique=True)
    op.create_index("ix_cloud_view_cloud", "cloud_view", ["point_cloud_id"])


def downgrade() -> None:
    op.drop_table("cloud_view")
    op.drop_table("cloud_camera_offset")
    with op.batch_alter_table("cloud_measurement") as b:
        b.drop_index("ix_cloud_measurement_finding")
        b.drop_constraint("fk_cloud_measurement_finding", type_="foreignkey")
        for column in ("finding_id", "job_id", "error", "status", "params"):
            b.drop_column(column)
