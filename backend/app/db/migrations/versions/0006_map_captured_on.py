"""map captured_on

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-23 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable with no backfill: a migration that cannot fail cannot stop the app opening.
    op.add_column("geo_map", sa.Column("captured_on", sa.Date(), nullable=True))


def downgrade() -> None:
    op.execute("ALTER TABLE geo_map DROP COLUMN captured_on")
