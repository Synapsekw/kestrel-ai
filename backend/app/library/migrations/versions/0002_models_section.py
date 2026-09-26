"""models section: app-wide class maps, datasets across projects and training runs

Foundation F §12.1. Additive only: an existing library keeps every model row, whose class map
starts empty, and gains four empty tables.

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-26
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("library_model", schema=None) as batch_op:
        batch_op.add_column(sa.Column("class_map", sa.JSON(), nullable=False, server_default="{}"))

    op.create_table(
        "dataset",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("task", sa.String(), nullable=False),
        sa.Column("origin", sa.String(), nullable=False),
        sa.Column("filter", sa.JSON(), nullable=True),
        sa.Column("classes", sa.JSON(), nullable=False),
        sa.Column("split_method", sa.String(), nullable=False),
        sa.Column("split_params", sa.JSON(), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("counts", sa.JSON(), nullable=False),
        sa.Column("export_path", sa.String(), nullable=True),
        sa.Column("export_state", sa.String(), nullable=False),
        sa.Column("export_job_id", sa.String(length=36), nullable=True),
        sa.Column("legacy_path", sa.String(), nullable=True),
        sa.Column("legacy_dataset_id", sa.String(length=36), nullable=True),
        sa.Column("job_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("dataset", schema=None) as batch_op:
        batch_op.create_index("ix_dataset_name", ["name"], unique=True)
        batch_op.create_index("ix_dataset_created", ["created_at"], unique=False)
        batch_op.create_index("ix_dataset_legacy_path", ["legacy_path"], unique=True)

    op.create_table(
        "dataset_source",
        sa.Column("dataset_id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("project_folder", sa.String(), nullable=False),
        sa.Column("project_name", sa.String(), nullable=False),
        sa.Column("image_count", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["dataset_id"], ["dataset.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("dataset_id", "project_id"),
    )
    op.create_table(
        "dataset_item",
        sa.Column("dataset_id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("image_id", sa.String(length=36), nullable=False),
        sa.Column("split", sa.String(), nullable=False),
        sa.Column("labels", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["dataset_id"], ["dataset.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("dataset_id", "project_id", "image_id"),
    )
    op.create_table(
        "training_run",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("dataset_id", sa.String(length=36), nullable=False),
        sa.Column("base_model_id", sa.String(length=36), nullable=False),
        sa.Column("params", sa.JSON(), nullable=False),
        sa.Column("job_id", sa.String(length=36), nullable=True),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("model_id", sa.String(length=36), nullable=True),
        sa.Column("metrics", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("training_run", schema=None) as batch_op:
        batch_op.create_index("ix_training_run_created", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_table("training_run")
    op.drop_table("dataset_item")
    op.drop_table("dataset_source")
    op.drop_table("dataset")
    with op.batch_alter_table("library_model", schema=None) as batch_op:
        batch_op.drop_column("class_map")
