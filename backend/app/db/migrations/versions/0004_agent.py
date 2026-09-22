"""project agent tables

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-22 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_turn",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("model_name", sa.String(), nullable=False),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column("tool_calls", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "agent_item",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("turn_id", sa.String(length=36), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("text", sa.String(), nullable=False),
        sa.Column("tool_name", sa.String(), nullable=True),
        sa.Column("tool_call_id", sa.String(), nullable=True),
        sa.Column("tool_input", sa.JSON(), nullable=True),
        sa.Column("tool_status", sa.String(), nullable=True),
        sa.Column("tool_summary", sa.String(), nullable=True),
        sa.Column("tool_result", sa.String(), nullable=True),
        sa.Column("result_image_id", sa.String(length=36), nullable=True),
        sa.Column("job_ids", sa.JSON(), nullable=False),
        sa.Column("approval", sa.JSON(), nullable=True),
        sa.Column("navigate", sa.JSON(), nullable=True),
        sa.Column("provider", sa.String(), nullable=True),
        sa.Column("provider_payload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["turn_id"], ["agent_turn.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("agent_item", schema=None) as batch_op:
        batch_op.create_index("ix_agent_item_seq", ["seq"], unique=True)
        batch_op.create_index("ix_agent_item_turn", ["turn_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("agent_item", schema=None) as batch_op:
        batch_op.drop_index("ix_agent_item_turn")
        batch_op.drop_index("ix_agent_item_seq")
    op.drop_table("agent_item")
    op.drop_table("agent_turn")
