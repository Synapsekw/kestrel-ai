"""images: camera and pose columns, annotation shapes, image summary, image measurements

The one project schema change of the image inspection sub-project (spec 2026-09-26-image-inspection
sections 7.3, 8.1 and 9.3). Columns are added with plain `ALTER TABLE ... ADD COLUMN`, never a batch
rebuild: `finding.annotation_id` references `box`, and a rebuild drops and recreates that table. The
two updates and the summary seed are single SQL statements, so no row passes through Python and
nothing here can fail on user data.

The camera and pose column names are read by the point-cloud workspace
(`app/pointclouds/cameras.py:_pose_columns`); they are not to be renamed.

Revision ID: 0011
Revises: 0010
Create Date: 2026-09-27 00:00:00.000000
"""

from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"  # main's project head at merge time (programme ruling R4)
branch_labels = None
depends_on = None

# (name, type) of the nullable camera, pose and bookkeeping columns on `image` (spec §7.3).
IMAGE_COLUMNS = (
    ("rel_alt", sa.Float()),
    ("gimbal_pitch", sa.Float()),
    ("gimbal_yaw", sa.Float()),
    ("gimbal_roll", sa.Float()),
    ("flight_yaw", sa.Float()),
    ("lrf_distance_m", sa.Float()),
    ("focal_px", sa.Float()),
    ("focal_mm", sa.Float()),
    ("sensor_w_mm", sa.Float()),
    ("orig_w", sa.Integer()),
    ("orig_h", sa.Integer()),
    ("camera_model", sa.String()),
    ("original_name", sa.String()),
    ("subject_distance_m", sa.Float()),
    ("footprint", sa.JSON()),
)
BOX_COLUMNS = ("shape", "points", "assist", "area_px", "updated_at")

# The semantics `app.imagery.summary.touch` recomputes for one image (plan 2026-09-27-images-c0,
# ruling 4): ground truth that is not a point, unreviewed proposals, their best confidence.
SEED_SUMMARY = """
INSERT INTO image_summary (image_id, annotation_count, pending_count, max_pending_conf, updated_at)
SELECT image.id,
       COUNT(CASE WHEN box.review_state IN ('accepted', 'edited') AND box.shape <> 'point' THEN 1 END),
       COUNT(CASE WHEN box.review_state = 'unreviewed' THEN 1 END),
       MAX(CASE WHEN box.review_state = 'unreviewed' THEN box.confidence END),
       :now
FROM image LEFT JOIN box ON box.image_id = image.id
GROUP BY image.id
"""


def upgrade() -> None:
    for name, type_ in IMAGE_COLUMNS:
        op.add_column("image", sa.Column(name, type_, nullable=True))
    op.add_column("image", sa.Column("footprint_kind", sa.String(), nullable=False, server_default="none"))
    op.add_column("image", sa.Column("metadata_version", sa.Integer(), nullable=False, server_default="0"))

    op.add_column("box", sa.Column("shape", sa.String(), nullable=False, server_default="box"))
    op.add_column("box", sa.Column("points", sa.JSON(), nullable=True))
    op.add_column("box", sa.Column("assist", sa.String(), nullable=True))
    op.add_column("box", sa.Column("area_px", sa.Float(), nullable=False, server_default="0"))
    op.add_column("box", sa.Column("updated_at", sa.DateTime(), nullable=True))
    op.execute("UPDATE box SET shape = 'rbox' WHERE angle <> 0")
    op.execute("UPDATE box SET area_px = w * h, updated_at = COALESCE(reviewed_at, created_at)")
    op.create_index("ix_box_image_class", "box", ["image_id", "class_id"])
    op.create_index("ix_box_image_review", "box", ["image_id", "review_state"])

    op.create_table(
        "image_summary",
        sa.Column("image_id", sa.String(36), sa.ForeignKey("image.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("annotation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("pending_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_pending_conf", sa.Float(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "image_measurement",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("image_id", sa.String(36), sa.ForeignKey("image.id", ondelete="CASCADE"), nullable=False),
        sa.Column("x1", sa.Float(), nullable=False),
        sa.Column("y1", sa.Float(), nullable=False),
        sa.Column("x2", sa.Float(), nullable=False),
        sa.Column("y2", sa.Float(), nullable=False),
        sa.Column("label", sa.String(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_image_measurement_image", "image_measurement", ["image_id"])

    now = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S.%f")
    op.get_bind().execute(sa.text(SEED_SUMMARY), {"now": now})


def downgrade() -> None:
    op.drop_index("ix_image_measurement_image", table_name="image_measurement")
    op.drop_table("image_measurement")
    op.drop_table("image_summary")
    op.drop_index("ix_box_image_review", table_name="box")
    op.drop_index("ix_box_image_class", table_name="box")
    # Plain DROP COLUMN (SQLite 3.35+), as 0003 does: a batch rebuild would churn every box row.
    for name in BOX_COLUMNS:
        op.execute(f"ALTER TABLE box DROP COLUMN {name}")
    for name in [n for n, _ in IMAGE_COLUMNS] + ["footprint_kind", "metadata_version"]:
        op.execute(f"ALTER TABLE image DROP COLUMN {name}")
