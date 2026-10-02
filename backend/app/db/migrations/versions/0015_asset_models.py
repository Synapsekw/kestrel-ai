"""asset models (spec 2026-10-02-asset-model-builder §5)

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-02
"""

import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "asset_model",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("asset_type", sa.String(), nullable=True),
        sa.Column("tag", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("current_version", sa.Integer(), nullable=True),
        sa.Column("live_run_id", sa.String(36), nullable=True),
        sa.Column("captured_on", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_asset_model_created", "asset_model", ["created_at", "id"])
    op.create_table(
        "asset_model_version",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "model_id", sa.String(36), sa.ForeignKey("asset_model.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("spec", sa.JSON(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("glb_status", sa.String(), nullable=False),
        sa.Column("glb_job_id", sa.String(36), nullable=True),
        sa.Column("meta", sa.JSON(), nullable=True),
        sa.Column("source_ids", sa.JSON(), nullable=False),
        sa.Column("run_id", sa.String(36), nullable=True),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("part_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("model_id", "version", name="uq_asset_model_version"),
    )
    op.create_table(
        "asset_model_run",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "model_id", sa.String(36), sa.ForeignKey("asset_model.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("job_id", sa.String(36), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("model_name", sa.String(), nullable=False),
        sa.Column("mode", sa.String(), nullable=False),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("stop_reason", sa.String(), nullable=True),
        sa.Column("phase", sa.String(), nullable=False),
        sa.Column("steps", sa.JSON(), nullable=False),
        sa.Column("summary", sa.String(), nullable=True),
        sa.Column("open_questions", sa.JSON(), nullable=False),
        sa.Column("usage", sa.JSON(), nullable=False),
        sa.Column("sources", sa.JSON(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=True),
        sa.Column("comparison", sa.JSON(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_asset_model_run_model", "asset_model_run", ["model_id", "started_at"])


def downgrade() -> None:
    op.drop_index("ix_asset_model_run_model", table_name="asset_model_run")
    op.drop_table("asset_model_run")
    op.drop_table("asset_model_version")
    op.drop_index("ix_asset_model_created", table_name="asset_model")
    op.drop_table("asset_model")
