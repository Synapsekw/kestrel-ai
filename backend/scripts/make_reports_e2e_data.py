"""Inputs for the Reports real-backend e2e (plan 2026-09-30-reports-r10): photos, two dated orthos,
a LAZ point cloud and a site photo for a finding attachment. Nothing binary is committed; the orthos
are written window by window and the photos one at a time.

Usage (from backend/): python scripts/make_reports_e2e_data.py <out-dir> [--images N] [--image-size WxH]
Prints one JSON line:
{"photos": dir, "orthos": [aug, sep], "ortho_origin": [e, n], "ortho_epsg": 32633,
 "cloud": laz, "cloud_origin": [x, y, z], "attachment": jpg, "image_size": [w, h]}
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # make_maps_e2e_data, next to this file
sys.path.insert(0, str(HERE.parent))  # `app`, when run as a script from backend/

from make_maps_e2e_data import E0, N0, write_ortho  # noqa: E402


def write_photo(path: Path, width: int, height: int, seed: int) -> Path:
    """A seeded-noise JPEG with a darker band, so an image crop has something to show."""
    rng = np.random.default_rng(seed)
    arr = rng.integers(90, 200, size=(height, width, 3), dtype=np.uint8)
    arr[height // 2 - height // 40 : height // 2 + height // 40, :, :] //= 3
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr, "RGB").save(path, "JPEG", quality=88)
    return path


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog=Path(argv[0]).name)
    parser.add_argument("out")
    parser.add_argument("--images", type=int, default=2)
    parser.add_argument("--image-size", default="1600x1200")
    args = parser.parse_args(argv[1:])
    width, height = (int(v) for v in args.image_size.lower().split("x"))

    out = Path(args.out)
    photos = out / "photos"
    for n in range(args.images):
        write_photo(photos / f"IMG_{n:04d}.jpg", width, height, seed=n)

    aug, sep = out / "ortho-aug.tif", out / "ortho-sep.tif"
    write_ortho(aug, (E0, N0), seed=1)
    write_ortho(sep, (E0 + 20.0, N0 - 10.0), seed=2)

    from app.pointclouds.selftest import ORIGIN, write_fixture

    cloud = write_fixture(out / "cloud.laz")
    attachment = write_photo(out / "site-photo.jpg", 800, 600, seed=99)

    print(
        json.dumps(
            {
                "photos": str(photos),
                "orthos": [str(aug), str(sep)],
                "ortho_origin": [E0, N0],
                "ortho_epsg": 32633,
                "cloud": str(cloud),
                "cloud_origin": [float(v) for v in ORIGIN],
                "attachment": str(attachment),
                "image_size": [width, height],
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
