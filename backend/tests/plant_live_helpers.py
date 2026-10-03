# backend/tests/plant_live_helpers.py
"""Helpers for the Al-Zour live acceptance test (K1): copy a project's Kestrel state and pick the
run's sources. Plain functions, so the gate can test them without a key."""

from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path

# Kestrel-managed folders the plant run reads. Raw data (Drawings/, Point_Cloud/, Ortho/, ...) is not
# copied: the rows hold absolute paths and the run only ever reads those files.
KESTREL_DIRS = ("drawings", "maps", "pointclouds")
SKIP_DIRS = frozenset({"octree", ".work"})  # display copies and scratch the run never reads
SHEETS = ("T0003", "T0005", "T0006", "T0007", "T0008")  # the overall and the four area plot plans
MAX_SOURCES = 200  # the contract's AssetModelRunStart.sources maxItems


def copy_project_state(src: Path, dst: Path) -> Path:
    """A consistent copy of `src`'s database (sqlite backup: the WAL is folded in) plus the Kestrel
    folders, minus octrees and work folders. The source is opened read-only and never written."""
    dst.mkdir(parents=True, exist_ok=True)
    a = sqlite3.connect((src / "project.db").resolve().as_uri() + "?mode=ro", uri=True)
    b = sqlite3.connect(dst / "project.db")
    try:
        a.backup(b)
    finally:
        b.close()
        a.close()
    for name in KESTREL_DIRS:
        if (src / name).is_dir():
            shutil.copytree(
                src / name, dst / name, ignore=lambda _d, names: [n for n in names if n in SKIP_DIRS]
            )
    return dst


def pick_sources(
    drawings: list[dict],
    clouds: list[dict],
    sheets: tuple[str, ...] = SHEETS,
    limit: int = MAX_SOURCES,
) -> tuple[list[dict], list[str]]:
    """(run sources, sheets with no ready drawing page). Ready clouds first, then every ready page whose
    name carries one of the sheet numbers, by name, up to the contract's 200 sources."""
    pages = sorted(
        (d for d in drawings if d.get("status") == "ready" and any(s in d["name"] for s in sheets)),
        key=lambda d: d["name"],
    )
    missing = [s for s in sheets if not any(s in d["name"] for d in pages)]
    out = [{"type": "point_cloud", "id": c["id"]} for c in clouds if c.get("status") == "ready"][:limit]
    out += [{"type": "drawing", "id": d["id"]} for d in pages][: limit - len(out)]
    return out, missing
