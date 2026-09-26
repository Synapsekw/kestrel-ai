"""library: library_model and job

Revision ID: 0001
Revises:
Create Date: 2026-09-23
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "library_model",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("notes", sa.String(), nullable=False),
        sa.Column("supplier", sa.String(), nullable=True),
        sa.Column("task", sa.String(), nullable=False),
        sa.Column("format", sa.String(), nullable=False),
        sa.Column("origin", sa.String(), nullable=False),
        sa.Column("weights_path", sa.String(), nullable=False),
        sa.Column("class_names", sa.JSON(), nullable=False),
        sa.Column("class_aliases", sa.JSON(), nullable=False),
        sa.Column("provenance", sa.JSON(), nullable=False),
        sa.Column("hyperparameters", sa.JSON(), nullable=False),
        sa.Column("metrics", sa.JSON(), nullable=True),
        sa.Column("exports", sa.JSON(), nullable=False),
        sa.Column("artifacts", sa.JSON(), nullable=False),
        sa.Column("train_gsd_cm", sa.Float(), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("library_model", schema=None) as batch_op:
        batch_op.create_index("ix_library_model_sha256", ["sha256"], unique=True)
        batch_op.create_index("ix_library_model_created", ["created_at"], unique=False)

    # The same columns as a project's `job` table, so `app.db.models.Job` maps onto it unchanged.
    op.create_table(
        "job",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("progress", sa.Float(), nullable=False),
        sa.Column("message", sa.String(), nullable=False),
        sa.Column("log_path", sa.String(), nullable=False),
        sa.Column("params", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("job", schema=None) as batch_op:
        batch_op.create_index("ix_job_created", ["created_at"], unique=False)
        batch_op.create_index("ix_job_state", ["state"], unique=False)


def downgrade() -> None:
    op.drop_table("job")
    op.drop_table("library_model")
