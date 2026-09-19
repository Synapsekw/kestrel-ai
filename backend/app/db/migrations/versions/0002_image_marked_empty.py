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
    # Not `batch_alter_table`: its SQLite strategy recreates the table (copy, drop, rename), and
    # `image.id` is referenced by `box.image_id` with `ondelete="CASCADE"` — the drop would take
    # every box with it. A plain `ALTER TABLE ... DROP COLUMN` (SQLite 3.35+) never drops the table.
    op.execute("ALTER TABLE image DROP COLUMN marked_empty")
