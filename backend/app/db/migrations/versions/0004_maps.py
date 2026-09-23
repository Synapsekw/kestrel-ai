"""geotiff maps

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
    # Only new tables: nothing existing is rewritten, so this cannot fail on user data.
    op.create_table(
        "geo_map",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column("source_path", sa.String(), nullable=False),
        sa.Column("source_size", sa.Integer(), nullable=False),
        sa.Column("source_sha256", sa.String(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("band_count", sa.Integer(), nullable=False),
        sa.Column("dtype", sa.String(), nullable=False),
        sa.Column("crs_wkt", sa.String(), nullable=True),
        sa.Column("epsg", sa.Integer(), nullable=True),
        sa.Column("proj4", sa.String(), nullable=True),
        sa.Column("geotransform", sa.JSON(), nullable=True),
        sa.Column("bounds_native", sa.JSON(), nullable=True),
        sa.Column("bounds_wgs84", sa.JSON(), nullable=True),
        sa.Column("gsd_cm", sa.Float(), nullable=True),
        sa.Column("stretch", sa.JSON(), nullable=False),
        sa.Column("labels_version", sa.Integer(), nullable=False),
        sa.Column("job_id", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "map_run",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("map_id", sa.String(36), sa.ForeignKey("geo_map.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("model_id", sa.String(36), nullable=True),
        sa.Column("provider", sa.String(), nullable=True),
        sa.Column("model_name", sa.String(), nullable=True),
        sa.Column("query", sa.String(), nullable=False),
        sa.Column("tile_size", sa.Integer(), nullable=False),
        sa.Column("overlap", sa.Float(), nullable=False),
        sa.Column("nms_iou", sa.Float(), nullable=False),
        sa.Column("conf", sa.Float(), nullable=False),
        sa.Column("target_gsd_cm", sa.Float(), nullable=True),
        sa.Column("counts", sa.JSON(), nullable=False),
        sa.Column("job_id", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_map_run_map", "map_run", ["map_id"])
    op.create_table(
        "map_detection",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("run_id", sa.String(36), sa.ForeignKey("map_run.id", ondelete="CASCADE"), nullable=False),
        sa.Column("class_id", sa.String(36), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("x", sa.Float(), nullable=False),
        sa.Column("y", sa.Float(), nullable=False),
        sa.Column("w", sa.Float(), nullable=False),
        sa.Column("h", sa.Float(), nullable=False),
        sa.Column("angle", sa.Float(), nullable=True),
    )
    op.create_index("ix_map_detection_run_xy", "map_detection", ["run_id", "x", "y"])
    op.create_table(
        "map_zone",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("map_id", sa.String(36), sa.ForeignKey("geo_map.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("polygon", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_map_zone_map", "map_zone", ["map_id"])
    op.create_table(
        "map_label",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("map_id", sa.String(36), sa.ForeignKey("geo_map.id", ondelete="CASCADE"), nullable=False),
        sa.Column("class_id", sa.String(36), nullable=False),
        sa.Column("x", sa.Float(), nullable=False),
        sa.Column("y", sa.Float(), nullable=False),
        sa.Column("w", sa.Float(), nullable=False),
        sa.Column("h", sa.Float(), nullable=False),
        sa.Column("angle", sa.Float(), nullable=True),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_map_label_map", "map_label", ["map_id"])


def downgrade() -> None:
    for table in ("map_label", "map_zone", "map_detection", "map_run", "geo_map"):
        op.drop_table(table)
