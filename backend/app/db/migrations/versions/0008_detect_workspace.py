"""detection workspace: sources, run metadata, review state, class maps, site areas

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-23 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

EMPTY = sa.text("'{}'")


def _run_columns(table: str) -> None:
    op.add_column(table, sa.Column("source_id", sa.String(36), nullable=True))
    op.add_column(table, sa.Column("model_snapshot", sa.JSON(), nullable=False, server_default=EMPTY))
    op.add_column(table, sa.Column("class_map", sa.JSON(), nullable=False, server_default=EMPTY))
    op.add_column(table, sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column(table, sa.Column("verified_counts", sa.JSON(), nullable=False, server_default=EMPTY))


def upgrade() -> None:
    # Only nullable or defaulted columns and new tables: no row is rewritten, so this cannot fail
    # on user data and cannot be the reason a project does not open. MapRun.counts keeps its
    # {class_id: n} shape (plan 2 deviation 1); the survey timeline keeps reading it.
    op.add_column("source", sa.Column("kind", sa.String(), nullable=False, server_default="images"))
    op.add_column("source", sa.Column("label", sa.String(), nullable=True))
    op.add_column("source", sa.Column("captured_on", sa.Date(), nullable=True))

    # SQLite accepts a REFERENCES clause on ADD COLUMN when the default is NULL; Alembic's
    # add_column would try a separate ALTER for the constraint, which SQLite has no form of.
    op.execute("ALTER TABLE geo_map ADD COLUMN source_id VARCHAR(36) REFERENCES source (id) ON DELETE SET NULL")

    _run_columns("map_run")
    op.add_column("map_run", sa.Column("area_counts", sa.JSON(), nullable=False, server_default=EMPTY))
    _run_columns("query_run")
    op.add_column("query_run", sa.Column("counts", sa.JSON(), nullable=False, server_default=EMPTY))

    op.add_column(
        "map_detection", sa.Column("review_state", sa.String(), nullable=False, server_default="unreviewed")
    )
    op.add_column(
        "map_detection",
        sa.Column("provenance_kind", sa.String(), nullable=False, server_default="local_model"),
    )
    op.create_index("ix_map_detection_run_state", "map_detection", ["run_id", "review_state"])

    op.create_table(
        "model_class_map",
        sa.Column("library_model_id", sa.String(36), primary_key=True),
        sa.Column("mapping", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "site_area",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("polygon_wgs84", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("site_area")
    op.drop_table("model_class_map")
    op.drop_index("ix_map_detection_run_state", table_name="map_detection")
    # Plain `ALTER TABLE ... DROP COLUMN` (SQLite 3.35+), not a batch table rebuild.
    drops = {
        "map_detection": ["provenance_kind", "review_state"],
        "query_run": ["counts", "verified_counts", "pinned", "class_map", "model_snapshot", "source_id"],
        "map_run": ["area_counts", "verified_counts", "pinned", "class_map", "model_snapshot", "source_id"],
        # A column-level REFERENCES clause drops with its column. A batch rebuild would DROP TABLE
        # geo_map, and with foreign keys on that cascades into map_run and map_detection.
        "geo_map": ["source_id"],
        "source": ["captured_on", "label", "kind"],
    }
    for table, columns in drops.items():
        for column in columns:
            op.execute(f"ALTER TABLE {table} DROP COLUMN {column}")
