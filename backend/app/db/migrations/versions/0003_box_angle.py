"""box angle

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-20 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # `server_default="0"` is the whole migration: every existing box becomes angle 0, which is
    # exactly what it already meant. No backfill pass, so this cannot fail on user data — and a
    # migration that cannot fail cannot be the reason the app will not open.
    op.add_column("box", sa.Column("angle", sa.Float(), nullable=False, server_default="0"))


def downgrade() -> None:
    # Not `batch_alter_table`: its SQLite strategy recreates the table (copy, drop, rename), which
    # would churn every box row. A plain `ALTER TABLE ... DROP COLUMN` (SQLite 3.35+) does not.
    op.execute("ALTER TABLE box DROP COLUMN angle")
