"""plant model: the register index, plant-run packages and the model kind

The one project schema change of the plant model generator (spec 2026-10-03-plant-model-generator
section 9; plan 2026-10-03-plant-model-f0 Task 4). Additive only:

- `asset_model` gains `kind` by plain `ALTER TABLE ... ADD COLUMN`. Never a batch rebuild: P1's
  0016 owns the rebuilds of `asset_model`, `asset_model_version` and `finding`, and dropping
  `asset_model` with foreign keys on would cascade every version, run, pose and sighting away.
- `asset_item` (the register index the GLB job writes) and `site_model_package` (a plant run's
  packages) are new tables.

Every step is safe to meet again, so an open interrupted half way recovers on the next open. No
row is rewritten, so no copy-first guard is needed (`app.migration.backup.REBUILD_GUARDS`).

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-03 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"  # P1's asset findings revision; re-check `alembic heads` before merging
branch_labels = None
depends_on = None

PACKAGE_STATE_CHECK = "state IN ('queued', 'running', 'done', 'failed', 'skipped')"


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if "kind" not in _columns("asset_model"):
        op.add_column("asset_model", sa.Column("kind", sa.String(), nullable=False, server_default="asset"))

    op.create_table(
        "asset_item",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "model_id", sa.String(36), sa.ForeignKey("asset_model.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("node", sa.String(), nullable=False),
        sa.Column("tag", sa.String(), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("area", sa.String(), nullable=True),
        sa.Column("plant_e", sa.Float(), nullable=True),
        sa.Column("plant_n", sa.Float(), nullable=True),
        sa.Column("site_x", sa.Float(), nullable=True),
        sa.Column("site_y", sa.Float(), nullable=True),
        sa.Column("lon", sa.Float(), nullable=True),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("base_el", sa.Float(), nullable=True),
        sa.Column("top_el", sa.Float(), nullable=True),
        sa.Column("height_source", sa.String(), nullable=False),
        sa.Column("confidence", sa.String(), nullable=False),
        sa.Column("flags", sa.JSON(), nullable=False),
        sa.Column("source_sheet", sa.String(), nullable=True),
        sa.Column("has_geometry", sa.Boolean(), nullable=False),
        if_not_exists=True,
    )
    op.create_index("ix_asset_item_version", "asset_item", ["model_id", "version"], if_not_exists=True)
    op.create_index("ix_asset_item_tag", "asset_item", ["model_id", "version", "tag"], if_not_exists=True)
    op.create_index("ix_asset_item_type", "asset_item", ["model_id", "version", "type"], if_not_exists=True)

    op.create_table(
        "site_model_package",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "run_id", sa.String(36), sa.ForeignKey("asset_model_run.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("n", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("drawing_id", sa.String(36), nullable=True),
        sa.Column("region", sa.JSON(), nullable=True),
        sa.Column("area", sa.String(), nullable=True),
        sa.Column("expected", sa.JSON(), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("usage", sa.JSON(), nullable=False),
        sa.Column("item_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("items", sa.JSON(), nullable=True),
        sa.Column("summary", sa.String(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint(PACKAGE_STATE_CHECK, name="ck_site_model_package_state"),
        if_not_exists=True,
    )
    op.create_index(
        "ux_site_model_package_run_n", "site_model_package", ["run_id", "n"], unique=True, if_not_exists=True
    )


def downgrade() -> None:
    op.drop_table("site_model_package")
    op.drop_table("asset_item")
    # A native DROP COLUMN, never a batch rebuild of asset_model (see the module docstring).
    op.drop_column("asset_model", "kind")
