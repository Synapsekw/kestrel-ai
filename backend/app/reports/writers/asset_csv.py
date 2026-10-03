"""The asset_sightings CSV (spec 2026-10-02-asset-findings §10): the inspection kit's
`records.csv_text`, byte for byte. UTF-8 with a BOM, CRLF after every row, and the kit's own quoting
(a value is quoted only when it holds a double quote, a comma or a newline; Python's csv module also
quotes a carriage return, so it is not used). Streamed row by row."""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path

HEAD = (
    "finding_id",
    "defect_id",
    "photo_id",
    "file_name",
    "severity",
    "severity_label",
    "class",
    "component",
    "zone",
    "height_m_approx",
    "side_approx",
    "bearing_deg_approx",
    "placed_on_model",
    "coverage_pct_of_photo",
    "note",
    "subject",
    "flight",
    "captured",
    "gps_lat",
    "gps_lon",
    "gps_alt_m",
)
_NEEDS_QUOTES = re.compile(r'[",\n]')


def q(value) -> str:
    if value is None:
        return ""
    s = str(value)
    return '"' + s.replace('"', '""') + '"' if _NEEDS_QUOTES.search(s) else s


def line(values: Sequence) -> str:
    return ",".join(q(v) for v in values)


def write_asset_sightings(
    path: Path, rows: Iterable[Sequence], *, on_row: Callable[[int], None] | None = None
) -> int:
    n = 0
    with Path(path).open("w", encoding="utf-8", newline="") as f:
        f.write("\ufeff" + ",".join(HEAD) + "\r\n")
        for row in rows:
            if len(row) != len(HEAD):
                raise ValueError(f"an asset_sightings row has {len(HEAD)} values, not {len(row)}")
            f.write(line(row) + "\r\n")
            n += 1
            if on_row is not None:
                on_row(n)
    return n
