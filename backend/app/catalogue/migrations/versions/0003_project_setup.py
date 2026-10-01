"""catalogue: definition and severity_rules on catalogue_type, origin 'template', and
project_template seeded with the three built-in project templates

Spec 2026-09-30-project-setup section 5 (plan 2026-09-30-setup-u1, index ruling S-R1). The seed is
a frozen copy of app/setup/builtins.py on 2026-09-30, never imported, so a later edit there cannot
rewrite this revision; tests/test_catalogue_migration_0003.py pins that the two agree.

SQLite cannot alter a CHECK constraint, so catalogue_type is rebuilt in batch mode. Its two partial
unique indexes (live names, live hotkeys) are dropped first and re-created after with their WHERE
clauses, so the rebuild can never turn them into full unique indexes that archived rows would break.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-30
"""

from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

SEEDED_AT = datetime(2026, 9, 30)  # naive UTC, as UTCDateTime stores it
ORIGIN_CHECK_0002 = "origin IN ('user', 'migrated')"
ORIGIN_CHECK_0003 = "origin IN ('user', 'migrated', 'template')"

PHOTOS = ["jpg", "jpeg"]
GEOTIFF = ["tif", "tiff"]
CLOUD = ["las", "laz"]
DRAWING = ["pdf", "dxf", "xml"]
VIDEO = ["mp4", "mov"]


def _slot(key: str, label: str, route: str, required: bool, accepts: list[str], match: dict | None = None):
    return {
        "key": key,
        "label": label,
        "route": route,
        "required": required,
        "accepts": list(accepts),
        "match": match,
    }


def _type(name: str, kind: str, severity: int, hotkey: str, colour: str, definition: str):
    return {
        "name": name,
        "kind": kind,
        "colour": colour,
        "default_severity": severity,
        "hotkey": hotkey,
        "definition": definition,
        "severity_rules": [],
    }


BUILTIN_ROWS = [
    {
        "id": "builtin-mapping",
        "name_key": "mapping and survey",
        "name": "Mapping and survey",
        "description": "Orthomosaics, elevation models and design files for earthworks, stockpiles and"
        " site progress.",
        "config": {
            "config_version": 1,
            "slots": [
                _slot("ortho", "Orthomosaic", "map", True, GEOTIFF, {"raster": "ortho"}),
                _slot(
                    "elevation", "Elevation (DSM/DTM)", "elevation", False, GEOTIFF, {"raster": "elevation"}
                ),
                _slot("design", "Design surface / CAD", "drawing", False, DRAWING),
                _slot("raw_images", "Raw drone images", "images", False, PHOTOS),
            ],
            "types": [
                _type(
                    "Stockpile",
                    "object",
                    1,
                    "1",
                    "#d4a24c",
                    "A heap of loose material such as soil, aggregate, sand or spoil stored on the ground."
                    " From above it shows as a mound with a clear toe line and a shadow on one side.",
                ),
                _type(
                    "Erosion / washout",
                    "defect",
                    3,
                    "2",
                    "#ff9c3a",
                    "Ground where running water has carried soil away, leaving rills, gullies or undercut"
                    " edges. Look for fresh channels, exposed pipes or roots, and sediment fans downslope.",
                ),
                _type(
                    "Standing water",
                    "defect",
                    2,
                    "3",
                    "#3b82f6",
                    "Water ponding on a surface that should drain, such as a haul road, a pad or a"
                    " formation level. It shows as a flat dark or reflective patch with a sharp edge.",
                ),
                _type(
                    "Unapproved machinery",
                    "object",
                    2,
                    "4",
                    "#a855f7",
                    "Plant or vehicles parked or working outside their approved zone, or in an area they"
                    " have no permit for. Mark each machine, not the group.",
                ),
                _type(
                    "Slope failure",
                    "defect",
                    4,
                    "5",
                    "#ff5a4f",
                    "A section of a cut, fill or natural slope that has slumped, slipped or cracked at the"
                    " crest. Signs are a fresh scarp, tension cracks behind the crest and a bulging toe.",
                ),
                _type(
                    "Vegetation encroachment",
                    "defect",
                    1,
                    "6",
                    "#3fb68e",
                    "Plants growing where they should not, such as on bunds, drains, access roads or"
                    " against structures. Mark the extent of the growth, not single weeds.",
                ),
            ],
        },
    },
    {
        "id": "builtin-vertical",
        "name_key": "vertical asset inspection",
        "name": "Vertical asset inspection",
        "description": "Visual and thermal photos, point clouds and drawings for towers, masts, poles and"
        " other tall structures.",
        "config": {
            "config_version": 1,
            "slots": [
                _slot("visual", "Visual photos", "images", True, PHOTOS, {"thermal": False}),
                _slot("thermal", "Thermal photos", "images", False, PHOTOS, {"thermal": True}),
                _slot("point_cloud", "3D point cloud", "pointcloud", False, CLOUD),
                _slot("drawings", "Asset drawings", "drawing", False, DRAWING),
            ],
            "types": [
                _type(
                    "Corrosion",
                    "defect",
                    2,
                    "1",
                    "#c2410c",
                    "Rust on steel members, fixings or plates, seen as orange-brown staining, flaking or"
                    " pitting. Staining that runs from a joint counts as corrosion at that joint.",
                ),
                _type(
                    "Coating damage",
                    "defect",
                    1,
                    "2",
                    "#eab308",
                    "Paint or galvanising that is chipped, peeling, blistered or worn through while the"
                    " metal beneath is not yet rusting. Once rust shows, use Corrosion instead.",
                ),
                _type(
                    "Loose / missing bolt",
                    "defect",
                    3,
                    "3",
                    "#f97316",
                    "A bolt, nut or fastener that is absent, backed off or visibly not seated at a"
                    " connection. Mark the connection and note how many fasteners are affected.",
                ),
                _type(
                    "Antenna misalignment",
                    "defect",
                    3,
                    "4",
                    "#06b6d4",
                    "An antenna or dish that is tilted, twisted or shifted compared with its neighbours on"
                    " the same mount. Bent or loose mounting brackets count here too.",
                ),
                _type(
                    "Bird nest",
                    "object",
                    2,
                    "5",
                    "#84cc16",
                    "A nest of sticks or other material built on the structure, a platform or equipment."
                    " Mark each nest, and note when it blocks a cable way or sits near live equipment.",
                ),
                _type(
                    "Thermal hot spot",
                    "defect",
                    4,
                    "6",
                    "#ef4444",
                    "A component that is clearly warmer than identical parts around it in a thermal"
                    " image, such as a connector, fuse or joint. Record the temperature difference when"
                    " it is known.",
                ),
                _type(
                    "Cracked weld",
                    "defect",
                    4,
                    "7",
                    "#ec4899",
                    "A visible crack in or beside a weld bead, often shown by a dark line, rust bleed or a"
                    " paint split along the weld toe. Any crack in a load-bearing weld is critical.",
                ),
            ],
        },
    },
    {
        "id": "builtin-confined",
        "name_key": "confined space inspection",
        "name": "Confined space inspection",
        "description": "Video, stills and LiDAR scans for tanks, vessels, culverts and other enclosed"
        " spaces.",
        "config": {
            "config_version": 1,
            "slots": [
                # Required once video import (S4) lands; until then Stills is the required slot.
                _slot("video", "Inspection video", "video", False, VIDEO),
                _slot("stills", "Stills", "images", True, PHOTOS),
                _slot("lidar", "LiDAR scan", "pointcloud", False, CLOUD),
                _slot("drawings", "Structure drawings", "drawing", False, DRAWING),
            ],
            "types": [
                _type(
                    "Pitting corrosion",
                    "defect",
                    3,
                    "1",
                    "#b45309",
                    "Local corrosion that forms small cavities in the metal surface, often in clusters"
                    " on the floor or below the liquid line. Note the pitted area and whether pits have"
                    " joined up.",
                ),
                _type(
                    "Weld crack",
                    "defect",
                    4,
                    "2",
                    "#ff5a4f",
                    "A crack along or across a weld seam or the metal beside it, seen as a sharp dark line"
                    " that may weep or stain. Treat any crack that goes through the wall as critical.",
                ),
                _type(
                    "Liner blistering",
                    "defect",
                    2,
                    "3",
                    "#a855f7",
                    "Raised bubbles or lifted patches in a coating or liner where it has lost its bond"
                    " with the wall. Mark the blistered area and note any blisters that have burst.",
                ),
                _type(
                    "Deposits / scale",
                    "defect",
                    1,
                    "4",
                    "#94a3b8",
                    "Build-up of sediment, sludge, scale or product on walls and floors. Mark the extent;"
                    " thick deposits hide the surface and limit what else can be judged.",
                ),
                _type(
                    "Wall deformation",
                    "defect",
                    3,
                    "5",
                    "#6366f1",
                    "A dent, bulge, buckle or out-of-round section of a wall, shell or roof plate. It"
                    " shows as a distorted reflection of the light or a kink along a seam.",
                ),
                _type(
                    "Leak / seepage",
                    "defect",
                    4,
                    "6",
                    "#0ea5e9",
                    "Liquid passing through the wall, a seam, a nozzle or a fitting, shown by wet patches,"
                    " drips, trails or staining. Active flow is more severe than dried staining.",
                ),
                _type(
                    "Debris / foreign object",
                    "object",
                    1,
                    "7",
                    "#78716c",
                    "A loose item left inside the space, such as a tool, an offcut, packaging or fallen"
                    " material. Mark each item that must be removed before the space returns to service.",
                ),
            ],
        },
    },
]


def _prepare_rebuild() -> None:
    """pysqlite commits DDL at once, so an interrupted run can leave the partial indexes dropped or a
    half-built temp table behind while alembic_version still says the old revision. Every step here
    is safe to meet again, so the next open recovers instead of failing forever."""
    op.drop_index("ux_catalogue_type_live_hotkey", table_name="catalogue_type", if_exists=True)
    op.drop_index("ux_catalogue_type_live_name", table_name="catalogue_type", if_exists=True)
    op.execute("DROP TABLE IF EXISTS _alembic_tmp_catalogue_type")


def _create_live_indexes() -> None:
    """Exactly 0001's two partial unique indexes."""
    op.create_index(
        "ux_catalogue_type_live_name",
        "catalogue_type",
        ["name_key"],
        unique=True,
        sqlite_where=sa.text("archived = 0"),
        if_not_exists=True,
    )
    op.create_index(
        "ux_catalogue_type_live_hotkey",
        "catalogue_type",
        ["hotkey"],
        unique=True,
        sqlite_where=sa.text("archived = 0 AND hotkey IS NOT NULL"),
        if_not_exists=True,
    )


def upgrade() -> None:
    _prepare_rebuild()
    with op.batch_alter_table("catalogue_type", recreate="always") as batch:
        batch.add_column(sa.Column("definition", sa.Text(), nullable=True))
        batch.add_column(sa.Column("severity_rules", sa.JSON(), nullable=False, server_default="[]"))
        batch.drop_constraint("ck_catalogue_type_origin", type_="check")
        batch.create_check_constraint("ck_catalogue_type_origin", ORIGIN_CHECK_0003)
    _create_live_indexes()

    table = op.create_table(
        "project_template",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("name_key", sa.String(80), nullable=False),
        sa.Column("description", sa.String(300), nullable=False, server_default=""),
        sa.Column("builtin", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ux_project_template_name_key", "project_template", ["name_key"], unique=True)
    op.bulk_insert(
        table,
        [{**row, "builtin": True, "created_at": SEEDED_AT, "updated_at": SEEDED_AT} for row in BUILTIN_ROWS],
    )


def downgrade() -> None:
    op.drop_index("ux_project_template_name_key", table_name="project_template")
    op.drop_table("project_template")
    # 0002's check has no 'template': those types become 'user' types, which is what 0002 calls them.
    op.execute("UPDATE catalogue_type SET origin = 'user' WHERE origin = 'template'")
    _prepare_rebuild()
    with op.batch_alter_table("catalogue_type", recreate="always") as batch:
        batch.drop_constraint("ck_catalogue_type_origin", type_="check")
        batch.create_check_constraint("ck_catalogue_type_origin", ORIGIN_CHECK_0002)
        batch.drop_column("severity_rules")
        batch.drop_column("definition")
    _create_live_indexes()
