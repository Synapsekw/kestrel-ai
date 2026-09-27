"""map workspace: the frame row, drawings, map measurements, and the columns M's units fill

The one project schema change of the map-workspace sub-project (spec 2026-09-26-map-workspace §12,
unit M-C0). Additive only: three tables, nullable or server-defaulted columns, indexes. Plain
`ALTER TABLE ADD COLUMN`, never a batch rebuild: `map_detection` can hold millions of rows. The one
data step, dating cloud DSMs from their clouds, is best effort: a failure logs and leaves the column
null (AGENTS.md: a broken migration must never be the reason the app won't open).

Revision ID: 0012
Revises: 0011
Create Date: 2026-09-27 00:00:00.000000
"""

import logging

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"  # I-C0's (R4: 0010 -> 0011 -> 0012 -> 0013)
branch_labels = None
depends_on = None

log = logging.getLogger(__name__)

BACKFILL_CAPTURED_ON = (
    "UPDATE surface SET captured_on = (SELECT point_cloud.captured_on FROM point_cloud"
    " WHERE point_cloud.id = surface.point_cloud_id)"
    " WHERE kind = 'cloud_dsm' AND point_cloud_id IS NOT NULL AND captured_on IS NULL"
)


def backfill_captured_on(bind) -> bool:
    """Date each cloud DSM from its cloud. SQLite undoes only the failed statement, so on a failure
    the upgrade's transaction goes on and the column stays null (M-B2 fills new builds)."""
    try:
        bind.exec_driver_sql(BACKFILL_CAPTURED_ON)
        return True
    except Exception:
        log.warning("surface.captured_on backfill failed; the column stays null", exc_info=True)
        return False


def upgrade() -> None:
    op.add_column("surface", sa.Column("elevation_role", sa.String(), nullable=True))
    op.add_column("surface", sa.Column("captured_on", sa.Date(), nullable=True))
    op.add_column("volume_measurement", sa.Column("material", sa.JSON(), nullable=True))
    op.add_column("map_run", sa.Column("scope", sa.String(), nullable=False, server_default="map"))
    op.add_column("map_run", sa.Column("region_px", sa.JSON(), nullable=True))
    op.add_column("map_detection", sa.Column("finding_id", sa.String(36), nullable=True))
    op.add_column("site_area", sa.Column("category", sa.String(), nullable=False, server_default="general"))
    op.create_index(
        "ux_map_detection_finding",
        "map_detection",
        ["finding_id"],
        unique=True,
        sqlite_where=sa.text("finding_id IS NOT NULL"),
    )
    op.create_index("ix_volume_measurement_created", "volume_measurement", ["created_at", "id"])
    op.create_index("ix_cloud_measurement_created", "cloud_measurement", ["created_at", "id"])
    op.create_table(
        "map_workspace",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("frame_kind", sa.String(), nullable=False),
        sa.Column("crs_wkt", sa.String(), nullable=True),
        sa.Column("epsg", sa.Integer(), nullable=True),
        sa.Column("state", sa.JSON(), nullable=False),
        sa.Column("planned_surveys", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_map_workspace_one_row"),
    )
    op.create_table(
        "drawing",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("format", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column("job_id", sa.String(36), nullable=True),
        sa.Column("source_path", sa.String(), nullable=False),
        sa.Column("source_size", sa.Integer(), nullable=False),
        sa.Column("source_sha256", sa.String(), nullable=True),
        sa.Column("page", sa.Integer(), nullable=True),
        sa.Column("units", sa.String(), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("dpi", sa.Integer(), nullable=True),
        sa.Column("extent_src", sa.JSON(), nullable=True),
        sa.Column("layers", sa.JSON(), nullable=False),
        sa.Column("georef", sa.JSON(), nullable=True),
        sa.Column("georef_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("bounds_site", sa.JSON(), nullable=True),
        sa.Column("layer_state", sa.JSON(), nullable=False),
        sa.Column("captured_on", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_drawing_status", "drawing", ["status"])
    op.create_index("ix_drawing_created", "drawing", ["created_at", "id"])
    op.create_table(
        "map_measurement",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("crs_wkt", sa.String(), nullable=True),
        sa.Column("epsg", sa.Integer(), nullable=True),
        sa.Column("geometry", sa.JSON(), nullable=False),
        sa.Column("surface_ids", sa.JSON(), nullable=False),
        sa.Column("map_id", sa.String(36), sa.ForeignKey("geo_map.id", ondelete="SET NULL"), nullable=True),
        sa.Column("results", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_map_measurement_created", "map_measurement", ["created_at", "id"])
    backfill_captured_on(op.get_bind())


def downgrade() -> None:
    for table in ("map_measurement", "drawing", "map_workspace"):
        op.drop_table(table)
    op.drop_index("ix_cloud_measurement_created", table_name="cloud_measurement")
    op.drop_index("ix_volume_measurement_created", table_name="volume_measurement")
    op.drop_index("ux_map_detection_finding", table_name="map_detection")
    # Plain `ALTER TABLE ... DROP COLUMN` (SQLite 3.35+), not a batch rebuild (as 0008 does).
    drops = {
        "site_area": ["category"],
        "map_detection": ["finding_id"],
        "map_run": ["region_px", "scope"],
        "volume_measurement": ["material"],
        "surface": ["captured_on", "elevation_role"],
    }
    for table, columns in drops.items():
        for column in columns:
            op.execute(f"ALTER TABLE {table} DROP COLUMN {column}")
