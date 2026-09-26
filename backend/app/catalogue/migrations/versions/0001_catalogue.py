"""catalogue: catalogue_type, severity_level, catalogue_meta

Revision ID: 0001
Revises:
Create Date: 2026-09-26
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "catalogue_type",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("name_key", sa.String(), nullable=False),
        sa.Column("colour", sa.String(length=7), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("default_severity", sa.Integer(), nullable=True),
        sa.Column("hotkey", sa.String(length=1), nullable=True),
        sa.Column("group", sa.String(), nullable=True),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("origin", sa.String(), nullable=False, server_default="user"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("kind IN ('defect', 'object')", name="ck_catalogue_type_kind"),
        sa.CheckConstraint("origin IN ('user', 'migrated')", name="ck_catalogue_type_origin"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ux_catalogue_type_live_name",
        "catalogue_type",
        ["name_key"],
        unique=True,
        sqlite_where=sa.text("archived = 0"),
    )
    op.create_index(
        "ux_catalogue_type_live_hotkey",
        "catalogue_type",
        ["hotkey"],
        unique=True,
        sqlite_where=sa.text("archived = 0 AND hotkey IS NOT NULL"),
    )
    op.create_table(
        "severity_level",
        sa.Column("level", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("colour", sa.String(length=7), nullable=False),
        sa.PrimaryKeyConstraint("level"),
    )
    op.create_table(
        "catalogue_meta",
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("value", sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    op.drop_table("catalogue_meta")
    op.drop_table("severity_level")
    op.drop_index("ux_catalogue_type_live_hotkey", table_name="catalogue_type")
    op.drop_index("ux_catalogue_type_live_name", table_name="catalogue_type")
    op.drop_table("catalogue_type")
