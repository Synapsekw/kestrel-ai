"""Are the saved picks real source points? (spec §17.9) A laspy chunked nearest search.

Usage: python scripts/check_picks.py <source.las|laz> <measurements.csv> [--tolerance 0.001]
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import laspy
import numpy as np

CHUNK = 2_000_000


def point_rows(csv_path: Path) -> list[tuple[float, float, float]]:
    with csv_path.open(newline="", encoding="utf-8") as f:
        return [
            (float(r["x1"]), float(r["y1"]), float(r["z1"]))
            for r in csv.DictReader(f)
            if r["kind"] == "point"
        ]


def nearest_distances(source: Path, picks: list[tuple[float, float, float]]) -> list[float]:
    target = np.asarray(picks, dtype=np.float64).reshape(-1, 3)
    best = np.full(len(target), np.inf)
    with laspy.open(source) as r:
        for pts in r.chunk_iterator(CHUNK):
            xyz = np.column_stack([np.asarray(pts.x), np.asarray(pts.y), np.asarray(pts.z)])
            for i, t in enumerate(target):
                best[i] = min(best[i], float(np.sqrt(((xyz - t) ** 2).sum(axis=1)).min()))
    return best.tolist()


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("source", type=Path)
    p.add_argument("csv", type=Path)
    p.add_argument("--tolerance", type=float, default=0.001)
    a = p.parse_args()
    picks = point_rows(a.csv)
    distances = nearest_distances(a.source, picks)
    for (x, y, z), d in zip(picks, distances, strict=True):
        print(f"pick {x:.3f} {y:.3f} {z:.3f} nearest {d * 1000:.3f} mm")
    ok = bool(picks) and all(d <= a.tolerance + 1e-9 for d in distances)
    print(f"picks ok {len(picks)}" if ok else "picks FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
