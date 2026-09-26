"""Numbers the migration must not change (foundation spec §16: row counts, and the counts and
area-count totals equal before and after). Read read-only with plain sqlite3 (like
`app.migration.backup.quick_check`), so they work on a database at any revision and are safe by
construction even if ever pointed at an original; only tables present before are compared.
"""

import json
import sqlite3
from pathlib import Path

ROW_TABLES = (
    "source",
    "image",
    "box",
    "dataset",
    "dataset_image",
    "model",
    "job",
    "geo_map",
    "map_run",
    "map_detection",
    "map_zone",
    "map_label",
    "query_run",
    "site_area",
    "point_cloud",
    "cloud_measurement",
    "surface",
    "volume_measurement",
)
JSON_TOTALS = {
    "query_run": ("counts", "verified_counts"),
    "map_run": ("counts", "verified_counts", "area_counts"),
}


def _total(value) -> float:
    """Sum every number in a JSON value: {class: n} or {area: {class: {total, verified}}}."""
    if isinstance(value, bool):
        return 0
    if isinstance(value, int | float):
        return value
    if isinstance(value, dict):
        return sum(_total(v) for v in value.values())
    return 0


def snapshot(db: Path) -> dict:
    """Read-only, so this can never write to whatever `db` points at (safety, not just speed)."""
    con = sqlite3.connect(f"{Path(db).resolve().as_uri()}?mode=ro", uri=True)
    try:
        tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        rows = {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ROW_TABLES if t in tables}
        totals = {}
        for table, columns in JSON_TOTALS.items():
            if table not in tables:
                continue
            present = {r[1] for r in con.execute(f"PRAGMA table_info({table})")}
            for column in columns:
                if column in present:
                    values = con.execute(f"SELECT {column} FROM {table}").fetchall()
                    totals[f"{table}.{column}"] = sum(_total(json.loads(v or "{}")) for (v,) in values)
        return {"rows": rows, "totals": totals}
    finally:
        con.close()


def compare(before: dict, after: dict) -> list[str]:
    problems = []
    for group in ("rows", "totals"):
        for key, n in before[group].items():
            m = after[group].get(key)
            if m != n:
                problems.append(f"{key}: {n} before, {m} after")
    return problems
