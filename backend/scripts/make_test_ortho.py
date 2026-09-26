"""A synthetic orthomosaic rasterised from a cloud's RGB (spec §17.12): the highest point per cell.

Bounded memory: the Z buffer and the RGB buffer are disk-backed memmaps; the cloud is read in
2 M-point chunks. Usage: python scripts/make_test_ortho.py <cloud> <out.tif> [--cell 0.05]
"""

from __future__ import annotations

import argparse
import math
import tempfile
from pathlib import Path

import laspy
import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.windows import Window

CHUNK = 2_000_000
BLOCK = 2048


def rasterise(cloud: Path, out: Path, cell: float) -> tuple[int, int]:
    with laspy.open(cloud) as r:
        crs = r.header.parse_crs()
        minx, miny, _ = r.header.mins
        maxx, maxy, _ = r.header.maxs
        width = max(1, math.ceil((maxx - minx) / cell) + 1)
        height = max(1, math.ceil((maxy - miny) / cell) + 1)
        with tempfile.TemporaryDirectory(prefix="kestrel-ortho-") as tmp:
            zbuf = np.memmap(Path(tmp) / "z.bin", dtype=np.float32, mode="w+", shape=(height * width,))
            rgb = np.memmap(Path(tmp) / "rgb.bin", dtype=np.uint8, mode="w+", shape=(height * width, 3))
            zbuf[:] = -np.inf
            for pts in r.chunk_iterator(CHUNK):
                x, y, z = np.asarray(pts.x), np.asarray(pts.y), np.asarray(pts.z)
                col = np.clip(((x - minx) / cell).astype(np.int64), 0, width - 1)
                row = np.clip(((maxy - y) / cell).astype(np.int64), 0, height - 1)
                idx = row * width + col
                colours = np.column_stack([np.asarray(pts.red), np.asarray(pts.green), np.asarray(pts.blue)])
                colours = (colours >> 8).astype(np.uint8) if colours.max() > 255 else colours.astype(np.uint8)
                order = np.argsort(z, kind="stable")  # ascending: the last write per cell is the highest
                idx, z, colours = idx[order], z[order].astype(np.float32), colours[order]
                higher = z > zbuf[idx]
                zbuf[idx[higher]] = z[higher]
                rgb[idx[higher]] = colours[higher]
            profile = dict(
                driver="GTiff",
                width=width,
                height=height,
                count=3,
                dtype="uint8",
                crs=crs,
                transform=from_origin(minx, maxy, cell, cell),
                tiled=True,
                blockxsize=512,
                blockysize=512,
                compress="deflate",
            )
            grid = rgb.reshape(height, width, 3)
            with rasterio.open(out, "w", **profile) as dst:
                for top in range(0, height, BLOCK):
                    rows = min(BLOCK, height - top)
                    dst.write(
                        np.moveaxis(np.asarray(grid[top : top + rows]), -1, 0),
                        window=Window(0, top, width, rows),
                    )
            del zbuf, rgb, grid
    return width, height


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("cloud", type=Path)
    p.add_argument("out", type=Path)
    p.add_argument("--cell", type=float, default=0.05)
    a = p.parse_args()
    w, h = rasterise(a.cloud, a.out, a.cell)
    with rasterio.open(a.out) as ds:
        print(f"ortho ok {w}x{h} {a.cell} EPSG:{ds.crs.to_epsg() if ds.crs else 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
