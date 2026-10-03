"""catalogue: brand, seeded with the e& and White label report brands

Spec 2026-10-02-asset-findings section 5.8 (plan 2026-10-03-asset-findings-d2). The seed is a frozen
copy of app/brands/builtins.py on 2026-10-03, never imported, so a later edit there cannot rewrite
this revision; tests/test_catalogue_migration_0004.py pins that the two agree. Logos are never seeded:
e&'s are customer-supplied and the operator imports them in the brand editor.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-03
"""

from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

SEEDED_AT = datetime(2026, 10, 3)  # naive UTC, as UTCDateTime stores it

BUILTIN_ROWS = [
    {
        "id": "builtin-eand",
        "name": "e&",
        "name_key": "e&",
        "colors": {
            "accent": "#BC0000",
            "accent_dark": "#9E0000",
            "navy": "#141D2D",
            "ink": "#1A1A1A",
            "pale": "#FFE5E5",
            "line": "#E7E4DE",
        },
        "font_text": "Nunito Sans",
        "font_numerals": "Poppins",
        "website": "www.eand.com",
        "owner": "e&",
        "confidentiality": "© {year} e&. All rights reserved. This report contains information owned by e&"
        " and is intended only for the recipient and approved partners. Any copying, sharing, or"
        " disclosure without written consent is not allowed.",
        "pdf_author": "e& Drones, Robotics & AI",
    },
    {
        "id": "builtin-white-label",
        "name": "White label",
        "name_key": "white label",
        "colors": {
            "accent": "#1F4FD1",
            "accent_dark": "#173DA6",
            "navy": "#131A26",
            "ink": "#141821",
            "pale": "#E8EEFF",
            "line": "#E3E6EC",
        },
        "font_text": "Inter",
        "font_numerals": "Inter",
        "website": "",
        "owner": "",
        "confidentiality": "Confidential. Prepared for {customer}."
        " Do not distribute without written consent.",
        "pdf_author": "",
    },
]


def upgrade() -> None:
    table = op.create_table(
        "brand",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("name_key", sa.String(80), nullable=False),
        sa.Column("colors", sa.JSON(), nullable=False),
        sa.Column("font_text", sa.String(80), nullable=True),
        sa.Column("font_numerals", sa.String(80), nullable=True),
        sa.Column("logo_on_light", sa.String(64), nullable=True),
        sa.Column("logo_on_dark", sa.String(64), nullable=True),
        sa.Column("logo_flat", sa.String(64), nullable=True),
        sa.Column("website", sa.String(200), nullable=False, server_default=""),
        sa.Column("owner", sa.String(120), nullable=False, server_default=""),
        sa.Column("confidentiality", sa.Text(), nullable=False, server_default=""),
        sa.Column("pdf_author", sa.String(120), nullable=False, server_default=""),
        sa.Column("builtin", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ux_brand_name_key", "brand", ["name_key"], unique=True)
    op.bulk_insert(
        table,
        [
            {
                **row,
                "logo_on_light": None,
                "logo_on_dark": None,
                "logo_flat": None,
                "builtin": True,
                "created_at": SEEDED_AT,
                "updated_at": SEEDED_AT,
            }
            for row in BUILTIN_ROWS
        ],
    )


def downgrade() -> None:
    op.drop_index("ux_brand_name_key", table_name="brand")
    op.drop_table("brand")
