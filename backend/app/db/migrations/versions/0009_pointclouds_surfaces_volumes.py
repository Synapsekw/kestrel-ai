"""point clouds, cloud measurements, surfaces and volume measurements (foundation F0)

The one schema change for the point-cloud, volumes and design-surface specs (spec
2026-09-23-point-clouds section 5 item 3): no later unit of those three specs adds a migration.
Only new tables: nothing existing is rewritten, so this cannot fail on user data and cannot be the
reason a project does not open.

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-24 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "point_cloud",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column("source_path", sa.String(), nullable=False),
        sa.Column("source_size", sa.Integer(), nullable=False),
        sa.Column("source_sha256", sa.String(), nullable=True),
        sa.Column("source_mtime", sa.Float(), nullable=True),
        sa.Column("las_version", sa.String(), nullable=True),
        sa.Column("point_format", sa.Integer(), nullable=True),
        sa.Column("point_count", sa.Integer(), nullable=True),
        sa.Column("has_rgb", sa.Boolean(), nullable=True),
        sa.Column("scale", sa.JSON(), nullable=True),
        sa.Column("crs_wkt", sa.String(), nullable=True),
        sa.Column("epsg", sa.Integer(), nullable=True),
        sa.Column("proj4", sa.String(), nullable=True),
        sa.Column("vertical_crs", sa.String(), nullable=True),
        sa.Column("crs_source", sa.String(), nullable=True),
        sa.Column("bounds_native", sa.JSON(), nullable=True),
        sa.Column("bounds_repaired", sa.Boolean(), nullable=True),
        sa.Column("bounds_wgs84", sa.JSON(), nullable=True),
        sa.Column("octree_spacing_m", sa.Float(), nullable=True),
        sa.Column("z_stats", sa.JSON(), nullable=True),
        sa.Column("class_counts", sa.JSON(), nullable=True),
        sa.Column("octree_bytes", sa.Integer(), nullable=True),
        sa.Column("captured_on", sa.Date(), nullable=True),
        sa.Column("map_id", sa.String(36), sa.ForeignKey("geo_map.id", ondelete="SET NULL"), nullable=True),
        sa.Column("job_id", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "cloud_measurement",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "point_cloud_id",
            sa.String(36),
            sa.ForeignKey("point_cloud.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("points", sa.JSON(), nullable=False),
        sa.Column("results", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_cloud_measurement_cloud", "cloud_measurement", ["point_cloud_id"])
    op.create_table(
        "surface",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column(
            "point_cloud_id",
            sa.String(36),
            sa.ForeignKey("point_cloud.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("design_source", sa.JSON(), nullable=True),
        sa.Column("crs_wkt", sa.String(), nullable=True),
        sa.Column("epsg", sa.Integer(), nullable=True),
        sa.Column("cell_size_m", sa.Float(), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("geotransform", sa.JSON(), nullable=True),
        sa.Column("bounds_native", sa.JSON(), nullable=True),
        sa.Column("z_min", sa.Float(), nullable=True),
        sa.Column("z_max", sa.Float(), nullable=True),
        sa.Column("coverage_fraction", sa.Float(), nullable=True),
        sa.Column("method", sa.String(), nullable=True),
        sa.Column("build_params", sa.JSON(), nullable=True),
        sa.Column("stats", sa.JSON(), nullable=True),
        sa.Column("job_id", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_surface_status", "surface", ["status"])
    op.create_table(
        "volume_measurement",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("polygon_native", sa.JSON(), nullable=False),
        sa.Column(
            "top_surface_id",
            sa.String(36),
            sa.ForeignKey("surface.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("base", sa.JSON(), nullable=False),
        sa.Column("masks", sa.JSON(), nullable=False),
        sa.Column("alignment", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column("results", sa.JSON(), nullable=True),
        sa.Column("job_id", sa.String(36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_volume_measurement_top_surface", "volume_measurement", ["top_surface_id"])


def downgrade() -> None:
    op.drop_index("ix_volume_measurement_top_surface", table_name="volume_measurement")
    op.drop_table("volume_measurement")
    op.drop_index("ix_surface_status", table_name="surface")
    op.drop_table("surface")
    op.drop_index("ix_cloud_measurement_cloud", table_name="cloud_measurement")
    op.drop_table("cloud_measurement")
    op.drop_table("point_cloud")
