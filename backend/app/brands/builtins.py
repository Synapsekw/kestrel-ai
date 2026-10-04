"""The two built-in report brands (spec 2026-10-02-asset-findings §5.8).

Seeded once into `catalogue.db` by catalogue migration 0004, which carries a frozen copy of this list
(tests/test_catalogue_migration_0004.py pins that the two agree). An edit here after 0004 has shipped
changes nothing in an existing catalogue: it needs a new catalogue migration that updates the rows.

e& takes its colours, fonts and text from the asset-inspection kit's brands/eand/brand.yaml (DRA
tokens v1.0). Its logos are customer-supplied and never committed (spec A10): the operator imports
them once in the brand editor. White label takes the kit's brands/whitelabel/brand.yaml colours and
Inter. Plain dicts, not pydantic models, so the migration's copy compares as JSON.
"""

from datetime import datetime

BUILTIN_EAND = "builtin-eand"
BUILTIN_WHITE_LABEL = "builtin-white-label"
BUILTIN_IDS = (BUILTIN_EAND, BUILTIN_WHITE_LABEL)
SEEDED_AT = datetime(2026, 10, 3)  # naive UTC, as UTCDateTime stores it

# A new brand starts from White label's colours (kit brands/whitelabel/brand.yaml).
DEFAULT_COLORS: dict[str, str] = {
    "accent": "#1F4FD1",
    "accent_dark": "#173DA6",
    "navy": "#131A26",
    "ink": "#141821",
    "pale": "#E8EEFF",
    "line": "#E3E6EC",
}

BUILTIN_BRANDS: list[dict] = [
    {
        "id": BUILTIN_EAND,
        "name": "e&",
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
        "id": BUILTIN_WHITE_LABEL,
        "name": "White label",
        "colors": dict(DEFAULT_COLORS),
        "font_text": "Inter",
        "font_numerals": "Inter",
        "website": "",
        "owner": "",
        "confidentiality": "Confidential. Prepared for {customer}."
        " Do not distribute without written consent.",
        "pdf_author": "",
    },
]
