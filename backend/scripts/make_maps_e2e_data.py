"""Two small orthomosaics in EPSG:32633 with different extents, for the real-backend map flow
(spec 2026-09-26-map-workspace section 15). Written window by window; nothing binary is committed.

Usage: python scripts/make_maps_e2e_data.py <out-dir>
Prints one JSON line: {"aug": <path>, "sep": <path>, "epsg": 32633, "origin": [e, n]}.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.windows import Window

E0, N0 = 500000.0, 4983000.0
PIXEL = 0.1
SIZE = 1000  # 100 m square
BLOCK = 256


def write_ortho(path: Path, origin: tuple[float, float], seed: int) -> None:
    rng = np.random.default_rng(seed)
    profile = dict(
        driver="GTiff",
        width=SIZE,
        height=SIZE,
        count=3,
        dtype="uint8",
        crs="EPSG:32633",
        transform=from_origin(origin[0], origin[1], PIXEL, PIXEL),
        tiled=True,
        blockxsize=BLOCK,
        blockysize=BLOCK,
    )
    with rasterio.open(path, "w", **profile) as dst:
        for row in range(0, SIZE, BLOCK):
            h = min(BLOCK, SIZE - row)
            data = rng.integers(40, 200, size=(3, h, SIZE), dtype=np.uint8)
            dst.write(data, window=Window(0, row, SIZE, h))


def main(argv: list[str]) -> int:
    out = Path(argv[1])
    out.mkdir(parents=True, exist_ok=True)
    aug, sep = out / "ortho-aug.tif", out / "ortho-sep.tif"
    write_ortho(aug, (E0, N0), seed=1)
    write_ortho(sep, (E0 + 20.0, N0 - 10.0), seed=2)  # another extent: the frame must still align
    print(json.dumps({"aug": str(aug), "sep": str(sep), "epsg": 32633, "origin": [E0, N0]}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
