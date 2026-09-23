"""project kind and model adoption

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
    # Every project that exists before this migration is a training project; `server_default`
    # says so without a backfill pass over any row, so this cannot fail on user data.
    op.add_column("project", sa.Column("kind", sa.String(), nullable=False, server_default="train"))
    # Filled by the library adoption job (unit BM); a new table, nothing existing is rewritten.
    op.create_table(
        "model_adoption",
        sa.Column("old_model_id", sa.String(36), primary_key=True),
        sa.Column("library_model_id", sa.String(36), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("model_adoption")
    # A plain `ALTER TABLE ... DROP COLUMN` (SQLite 3.35+), not a batch table rebuild.
    op.execute("ALTER TABLE project DROP COLUMN kind")
