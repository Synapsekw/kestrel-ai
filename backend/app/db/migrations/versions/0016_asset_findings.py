"""asset findings: asset frame and review, the asset anchor, poses, photo review, sightings

The one project schema change of the asset findings phase (spec 2026-10-02-asset-findings-design
sections 5.1 to 5.6).

- `asset_model` gains `frame` and `review` by plain `ALTER TABLE ... ADD COLUMN`. A batch rebuild of
  `asset_model` would drop the table, and with `foreign_keys=ON` that drop cascades every version
  and run away.
- `finding` is rebuilt in batch mode, because SQLite cannot alter a CHECK: the anchor CHECK gains
  its `asset` branch, plus a placement CHECK, the asset columns, a foreign key to `asset_model` and
  two indexes. The rebuild runs with foreign keys switched off. With them on, SQLite's
  `DROP TABLE finding` runs an implicit `DELETE FROM finding` first, which cascades every comment,
  attachment and cloud view away and nulls `cloud_measurement.finding_id` (ADR
  2026-10-03-gotcha-sqlite-rebuild-cascades-children).
- `image_pose`, `image_review` and `finding_sighting` are new tables.

Copy-first: `open_project_db` backs the database up before this revision runs
(`app.migration.backup.REBUILD_GUARDS`). Every step is safe to meet again, so an open interrupted
half way recovers on the next open instead of failing forever. No row is rewritten.

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-03 00:00:00.000000
"""

from collections.abc import Iterator
from contextlib import contextmanager

import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"  # main's project head at merge time; re-check `alembic heads` before merging
branch_labels = None
depends_on = None

# Frozen here (0010's text, for the downgrade), so a later model edit cannot rewrite history.
ANCHOR_CHECK_0010 = (
    "(anchor_kind = 'image' AND image_id IS NOT NULL AND annotation_id IS NOT NULL"
    " AND map_id IS NULL AND geometry IS NULL AND cloud_id IS NULL"
    " AND x IS NULL AND y IS NULL AND z IS NULL AND uncertainty_m IS NULL)"
    " OR (anchor_kind = 'map' AND map_id IS NOT NULL AND geometry IS NOT NULL"
    " AND image_id IS NULL AND annotation_id IS NULL AND cloud_id IS NULL"
    " AND x IS NULL AND y IS NULL AND z IS NULL AND uncertainty_m IS NULL)"
    " OR (anchor_kind = 'cloud' AND cloud_id IS NOT NULL AND x IS NOT NULL AND y IS NOT NULL"
    " AND z IS NOT NULL AND image_id IS NULL AND annotation_id IS NULL AND map_id IS NULL"
    " AND geometry IS NULL)"
)

# Frozen here (the text of app.db.models.ANCHOR_CHECK on 2026-10-03).
ANCHOR_CHECK = (
    "(anchor_kind = 'image' AND image_id IS NOT NULL AND annotation_id IS NOT NULL"
    " AND map_id IS NULL AND geometry IS NULL AND cloud_id IS NULL"
    " AND x IS NULL AND y IS NULL AND z IS NULL AND uncertainty_m IS NULL"
    " AND asset_model_id IS NULL AND ax IS NULL AND ay IS NULL AND az IS NULL)"
    " OR (anchor_kind = 'map' AND map_id IS NOT NULL AND geometry IS NOT NULL"
    " AND image_id IS NULL AND annotation_id IS NULL AND cloud_id IS NULL"
    " AND x IS NULL AND y IS NULL AND z IS NULL AND uncertainty_m IS NULL"
    " AND asset_model_id IS NULL AND ax IS NULL AND ay IS NULL AND az IS NULL)"
    " OR (anchor_kind = 'cloud' AND cloud_id IS NOT NULL AND x IS NOT NULL AND y IS NOT NULL"
    " AND z IS NOT NULL AND image_id IS NULL AND annotation_id IS NULL AND map_id IS NULL"
    " AND geometry IS NULL"
    " AND asset_model_id IS NULL AND ax IS NULL AND ay IS NULL AND az IS NULL)"
    " OR (anchor_kind = 'asset' AND asset_model_id IS NOT NULL"
    " AND image_id IS NULL AND annotation_id IS NULL AND map_id IS NULL AND geometry IS NULL"
    " AND cloud_id IS NULL AND x IS NULL AND y IS NULL AND z IS NULL AND uncertainty_m IS NULL"
    " AND ((ax IS NULL AND ay IS NULL AND az IS NULL)"
    " OR (ax IS NOT NULL AND ay IS NOT NULL AND az IS NOT NULL)))"
)
FINDING_PLACEMENT_CHECK = "placement IS NULL OR placement IN ('point', 'patch', 'none')"
IMAGE_REVIEW_STATUS_CHECK = "status IN ('finding', 'none', 'uncertain', 'not_assessed')"
SIGHTING_PLACEMENT_CHECK = "placement IN ('point', 'patch', 'none', 'pending')"

# (name, type) of the nullable asset columns on `finding` (spec §5.5).
FINDING_COLUMNS = (
    ("asset_model_id", sa.String(36)),
    ("asset_version", sa.Integer()),
    ("ax", sa.Float()),
    ("ay", sa.Float()),
    ("az", sa.Float()),
    ("an_x", sa.Float()),
    ("an_y", sa.Float()),
    ("an_z", sa.Float()),
    ("placement", sa.String()),
    ("height_m", sa.Float()),
    ("bearing_deg", sa.Float()),
    ("side", sa.String()),
    ("zone", sa.String()),
    ("component", sa.String()),
)
NEW_TABLES = ("finding_sighting", "image_review", "image_pose")


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


@contextmanager
def _foreign_keys_off() -> Iterator[None]:
    """Switch foreign keys off for a table rebuild, and back on after it.

    `PRAGMA foreign_keys` is a no-op inside a transaction, and an earlier revision of the same
    upgrade may have left one open (its `alembic_version` UPDATE), so it is committed first. The
    switch is read back: a rebuild with foreign keys still on would delete the children, so it
    stops instead. On success the rebuild is committed before foreign keys are switched back on;
    on failure it is rolled back (the next open meets a clean `finding` again)."""
    raw = op.get_bind().connection.driver_connection
    if raw.in_transaction:
        raw.commit()
    raw.execute("PRAGMA foreign_keys=OFF")
    if raw.execute("PRAGMA foreign_keys").fetchone()[0] != 0:
        raise RuntimeError("Revision 0016 could not switch foreign keys off; the finding table is unchanged.")
    try:
        yield
    except BaseException:
        if raw.in_transaction:
            raw.rollback()
        raw.execute("PRAGMA foreign_keys=ON")
        raise
    if raw.in_transaction:
        raw.commit()
    raw.execute("PRAGMA foreign_keys=ON")


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS _alembic_tmp_finding")  # left by an interrupted rebuild

    have = _columns("asset_model")
    for name in ("frame", "review"):
        if name not in have:
            op.add_column("asset_model", sa.Column(name, sa.JSON(), nullable=True))

    if "asset_model_id" not in _columns("finding"):
        with _foreign_keys_off():
            with op.batch_alter_table("finding", recreate="always") as b:
                for name, type_ in FINDING_COLUMNS:
                    b.add_column(sa.Column(name, type_, nullable=True))
                b.add_column(sa.Column("sighting_count", sa.Integer(), nullable=False, server_default="0"))
                b.create_foreign_key("fk_finding_asset_model", "asset_model", ["asset_model_id"], ["id"])
                b.drop_constraint("ck_finding_anchor", type_="check")
                b.create_check_constraint("ck_finding_anchor", ANCHOR_CHECK)
                b.create_check_constraint("ck_finding_placement", FINDING_PLACEMENT_CHECK)
                b.create_index("ix_finding_asset", ["anchor_kind", "asset_model_id"])
                b.create_index("ix_finding_asset_zone", ["asset_model_id", "zone"])

    op.create_table(
        "image_pose",
        sa.Column(
            "asset_model_id",
            sa.String(36),
            sa.ForeignKey("asset_model.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("image_id", sa.String(36), sa.ForeignKey("image.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("position", sa.JSON(), nullable=False),
        sa.Column("target", sa.JSON(), nullable=False),
        sa.Column("up", sa.JSON(), nullable=False),
        sa.Column("hfov_deg", sa.Float(), nullable=False),
        sa.Column("vfov_deg", sa.Float(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("accuracy_m", sa.Float(), nullable=True),
        sa.Column("sequence", sa.String(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        if_not_exists=True,
    )
    op.create_index("ix_image_pose_image", "image_pose", ["image_id"], if_not_exists=True)
    op.create_index(
        "ix_image_pose_sequence", "image_pose", ["asset_model_id", "sequence", "image_id"], if_not_exists=True
    )
    op.create_table(
        "image_review",
        sa.Column("image_id", sa.String(36), sa.ForeignKey("image.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("coverage", sa.Float(), nullable=True),
        sa.Column("uncertain_coverage", sa.Float(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(IMAGE_REVIEW_STATUS_CHECK, name="ck_image_review_status"),
        if_not_exists=True,
    )
    op.create_index("ix_image_review_status", "image_review", ["status", "image_id"], if_not_exists=True)
    op.create_table(
        "finding_sighting",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "finding_id", sa.String(36), sa.ForeignKey("finding.id", ondelete="CASCADE"), nullable=True
        ),
        sa.Column(
            "asset_model_id",
            sa.String(36),
            sa.ForeignKey("asset_model.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("image_id", sa.String(36), sa.ForeignKey("image.id"), nullable=False),
        sa.Column("annotation_id", sa.String(36), sa.ForeignKey("box.id"), nullable=False),
        sa.Column("severity", sa.Integer(), nullable=True),
        sa.Column("group_tag", sa.String(), nullable=True),
        sa.Column("placement", sa.String(), nullable=False, server_default="pending"),
        sa.Column("cx", sa.Float(), nullable=True),
        sa.Column("cy", sa.Float(), nullable=True),
        sa.Column("cz", sa.Float(), nullable=True),
        sa.Column("nx", sa.Float(), nullable=True),
        sa.Column("ny", sa.Float(), nullable=True),
        sa.Column("nz", sa.Float(), nullable=True),
        sa.Column("part", sa.String(), nullable=True),
        sa.Column("coverage", sa.Float(), nullable=True),
        sa.Column("patch_path", sa.String(), nullable=True),
        sa.Column("placed_version", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(SIGHTING_PLACEMENT_CHECK, name="ck_finding_sighting_placement"),
        if_not_exists=True,
    )
    op.create_index(
        "ux_finding_sighting_annotation",
        "finding_sighting",
        ["annotation_id"],
        unique=True,
        if_not_exists=True,
    )
    op.create_index(
        "ix_finding_sighting_finding", "finding_sighting", ["finding_id", "created_at"], if_not_exists=True
    )
    op.create_index("ix_finding_sighting_image", "finding_sighting", ["image_id"], if_not_exists=True)
    op.create_index(
        "ix_finding_sighting_model", "finding_sighting", ["asset_model_id", "finding_id"], if_not_exists=True
    )


def downgrade() -> None:
    for table in NEW_TABLES:
        op.drop_table(table)
    # Plain Alembic never sets PRAGMA foreign_keys, so nothing cascades here: delete the children of
    # the asset findings explicitly, or they would be orphaned.
    asset = "SELECT id FROM finding WHERE anchor_kind = 'asset'"
    op.execute(f"DELETE FROM finding_comment WHERE finding_id IN ({asset})")
    op.execute(f"DELETE FROM finding_attachment WHERE finding_id IN ({asset})")
    op.execute(f"DELETE FROM cloud_view WHERE finding_id IN ({asset})")
    op.execute(f"UPDATE cloud_measurement SET finding_id = NULL WHERE finding_id IN ({asset})")
    op.execute("DELETE FROM finding WHERE anchor_kind = 'asset'")
    with _foreign_keys_off():
        with op.batch_alter_table("finding", recreate="always") as b:
            b.drop_index("ix_finding_asset_zone")
            b.drop_index("ix_finding_asset")
            b.drop_constraint("ck_finding_placement", type_="check")
            b.drop_constraint("ck_finding_anchor", type_="check")
            b.create_check_constraint("ck_finding_anchor", ANCHOR_CHECK_0010)
            b.drop_constraint("fk_finding_asset_model", type_="foreignkey")
            b.drop_column("sighting_count")
            for name, _ in reversed(FINDING_COLUMNS):
                b.drop_column(name)
    op.drop_column("asset_model", "review")
    op.drop_column("asset_model", "frame")
