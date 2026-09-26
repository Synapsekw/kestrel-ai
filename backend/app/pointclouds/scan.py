"""The chunked scan of the work copy (spec §6.4). Peak memory is one 2 M-point chunk plus a
≤ 2 M-value Z sample, whatever the file size."""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import laspy
import numpy as np

from app.jobs.cancellation import JobFailure

CHUNK = 2_000_000
SAMPLE_MAX = 2_000_000
PERCENTILES = {"p01": 0.1, "p1": 1.0, "p5": 5.0, "p50": 50.0, "p95": 95.0, "p99": 99.0, "p999": 99.9}


@dataclass
class ScanResult:
    count: int
    header_count: int
    bounds: list[float]  # [minx, miny, minz, maxx, maxy, maxz], true, from scaled coordinates
    z_stats: dict
    class_counts: dict[str, int]


def scan(
    path: Path,
    *,
    progress: Callable[[int, int], None],
    check_cancelled: Callable[[], None],
    chunk: int = CHUNK,
) -> ScanResult:
    with laspy.open(path) as r:
        header_count = int(r.header.point_count)
        stride = max(1, math.ceil(max(header_count, 1) / SAMPLE_MAX))
        mins, maxs = np.full(3, np.inf), np.full(3, -np.inf)
        zsum, count = 0.0, 0
        hist = np.zeros(256, dtype=np.int64)
        samples: list[np.ndarray] = []
        sampled = 0
        for pts in r.chunk_iterator(chunk):
            check_cancelled()
            axes = (np.asarray(pts.x), np.asarray(pts.y), np.asarray(pts.z))
            for i, a in enumerate(axes):
                mins[i] = min(mins[i], float(a.min()))
                maxs[i] = max(maxs[i], float(a.max()))
            z = axes[2]
            zsum += float(z.sum())
            hist += np.bincount(np.asarray(pts.classification, dtype=np.uint8), minlength=256)
            picked = z[(-count) % stride :: stride].copy()  # every stride-th point by global index
            samples.append(picked)
            sampled += picked.size
            if sampled > 2 * SAMPLE_MAX:  # the header undercounted: thin what we hold, keep bounded
                merged = np.concatenate(samples)[::2]
                samples, sampled, stride = [merged], merged.size, stride * 2
            count += len(z)
            progress(count, header_count)
    if count == 0:
        raise JobFailure("the file has no points")
    sample = np.concatenate(samples)
    if sample.size > SAMPLE_MAX:
        sample = sample[:: math.ceil(sample.size / SAMPLE_MAX)]
    z_stats = {
        "min": float(mins[2]),
        "max": float(maxs[2]),
        "mean": zsum / count,
        "sample_count": int(sample.size),
    }
    for key, q in PERCENTILES.items():
        z_stats[key] = float(np.percentile(sample, q))
    return ScanResult(
        count=count,
        header_count=header_count,
        bounds=[*map(float, mins), *map(float, maxs)],
        z_stats=z_stats,
        class_counts={str(i): int(n) for i, n in enumerate(hist) if n},
    )
