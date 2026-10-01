"""findings.csv (spec §11.2): utf-8-sig so Excel opens it as UTF-8, streamed row by row."""

from __future__ import annotations

import csv
from collections.abc import Callable, Iterable
from pathlib import Path

from app.reports.writers.rows import COLUMNS


def write_csv(path: Path, rows: Iterable[dict], *, on_row: Callable[[int], None] | None = None) -> int:
    n = 0
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
            n += 1
            if on_row is not None:
                on_row(n)
    return n
