"""model train_gsd_cm

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-23 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable with no backfill. Deriving a scale needs image I/O, which a migration must never
    # depend on: an app that cannot open is worse than a column that is null until first asked.
    op.add_column("model", sa.Column("train_gsd_cm", sa.Float(), nullable=True))


def downgrade() -> None:
    op.execute("ALTER TABLE model DROP COLUMN train_gsd_cm")
