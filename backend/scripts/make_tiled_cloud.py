"""The 195 M-point synthetic cloud (spec §1): a source tiled 3 x 3 with a gap, streamed.

Usage: python scripts/make_tiled_cloud.py <source> <out.las> [--gap 50]
"""

from __future__ import annotations

import argparse
from pathlib import Path

import laspy

CHUNK = 2_000_000


def tile(source: Path, out: Path, gap: float = 50.0) -> int:
    with laspy.open(source) as r:
        h = r.header
        ext = h.maxs - h.mins
        hdr = laspy.LasHeader(point_format=h.point_format, version=h.version)
        hdr.scales, hdr.offsets = h.scales, h.offsets
        for v in h.vlrs:
            hdr.vlrs.append(v)
    written = 0
    with laspy.open(out, mode="w", header=hdr) as w:
        for i in range(3):
            for j in range(3):
                dx = int(round(i * (ext[0] + gap) / hdr.scales[0]))
                dy = int(round(j * (ext[1] + gap) / hdr.scales[1]))
                with laspy.open(source) as rr:
                    for pts in rr.chunk_iterator(CHUNK):
                        pts.array["X"] += dx
                        pts.array["Y"] += dy
                        w.write_points(pts)
                        written += len(pts)
    return written


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("source", type=Path)
    p.add_argument("out", type=Path)
    p.add_argument("--gap", type=float, default=50.0)
    a = p.parse_args()
    print(f"tiled ok {tile(a.source, a.out, a.gap)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
