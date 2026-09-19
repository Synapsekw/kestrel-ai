"""image marked_empty

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-19 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "image",
        sa.Column("marked_empty", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    with op.batch_alter_table("image", schema=None) as batch_op:
        batch_op.drop_column("marked_empty")
