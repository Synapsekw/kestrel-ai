"""Synthetic stand-ins for the map-workspace acceptance (spec 2026-09-26-map-workspace section 15):
two dated orthos and DSMs of a cone stockpile on a tilted plane (analytic volume), a bare-ground
DTM, a DXF site plan in the site CRS, and a PDF of the same plan at 1:500 rotated 3 degrees with
four known control points. Rasters are written in 256-row windows (bounded memory).

Usage: python scripts/make_maps_acceptance_data.py <out-dir>   -> writes <out-dir>/manifest.json
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import ezdxf
import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.windows import Window
from reportlab.lib.pagesizes import A3, landscape
from reportlab.pdfgen import canvas

EPSG = 32633
E0, N0 = 500000.0, 4983000.0  # top-left of every raster
W_M, H_M = 200.0, 180.0
PE, PN, R = E0 + 100.0, N0 - 90.0, 20.0  # pile centre and toe radius
PAD = [(E0 + 40, N0 - 50), (E0 + 160, N0 - 50), (E0 + 160, N0 - 130), (E0 + 40, N0 - 130)]
BLOCK = 256
DPI = 150


def ground(e: np.ndarray, n: np.ndarray) -> np.ndarray:
    return 600.0 + 0.01 * (e - E0) + 0.005 * (n - N0)


def pile(e: np.ndarray, n: np.ndarray, h: float) -> np.ndarray:
    return np.clip(h * (1.0 - np.hypot(e - PE, n - PN) / R), 0.0, None)


def write_raster(path: Path, cell: float, count: int, dtype: str, fill) -> None:
    width, height = int(W_M / cell), int(H_M / cell)
    profile = dict(
        driver="GTiff",
        width=width,
        height=height,
        count=count,
        dtype=dtype,
        crs=f"EPSG:{EPSG}",
        transform=from_origin(E0, N0, cell, cell),
        tiled=True,
        blockxsize=BLOCK,
        blockysize=BLOCK,
    )
    if dtype == "float32":
        profile["nodata"] = -9999.0
    cols = E0 + (np.arange(width) + 0.5) * cell
    with rasterio.open(path, "w", **profile) as dst:
        for row in range(0, height, BLOCK):
            h = min(BLOCK, height - row)
            rows = N0 - (np.arange(row, row + h) + 0.5) * cell
            e, n = np.meshgrid(cols, rows)
            dst.write(fill(e, n), window=Window(0, row, width, h))


def dsm(h: float):
    return lambda e, n: (ground(e, n) + pile(e, n, h)).astype("float32")[None]


def ortho(h: float, seed: int):
    rng = np.random.default_rng(seed)

    def fill(e, n):
        k = (60.0 * pile(e, n, h) / max(h, 1e-9)).astype("float32")
        noise = rng.integers(0, 25, size=(3, *e.shape))
        base = np.stack([120 + k, 110 + k, 90 + k]) + noise
        return np.clip(base, 0, 255).astype("uint8")

    return fill


def site_to_page(e: float, n: float, page_w: float, page_h: float) -> tuple[float, float]:
    """1:500 (1 m = 2 mm = 5.6693 pt), rotated 3 degrees about the pad centre, centred on the page."""
    s = 72.0 / 25.4 * 2.0
    th = math.radians(3.0)
    ce, cn = E0 + 100.0, N0 - 90.0
    dx, dy = e - ce, n - cn
    return (
        page_w / 2 + s * (math.cos(th) * dx - math.sin(th) * dy),
        page_h / 2 + s * (math.sin(th) * dx + math.cos(th) * dy),
    )


def main(argv: list[str]) -> int:
    out = Path(argv[1])
    out.mkdir(parents=True, exist_ok=True)
    files = {}
    for date, h, seed in (("2026-08-14", 6.0, 1), ("2026-09-14", 8.0, 2)):
        files[f"ortho-{date}"] = out / f"ortho-{date}.tif"
        write_raster(files[f"ortho-{date}"], 0.05, 3, "uint8", ortho(h, seed))
        files[f"dsm-{date}"] = out / f"dsm-{date}.tif"
        write_raster(files[f"dsm-{date}"], 0.1, 1, "float32", dsm(h))
    files["dtm"] = out / "dtm-bare.tif"
    write_raster(files["dtm"], 0.1, 1, "float32", lambda e, n: ground(e, n).astype("float32")[None])

    doc = ezdxf.new()
    doc.header["$INSUNITS"] = 6  # metres
    msp = doc.modelspace()
    msp.add_lwpolyline(PAD, close=True, dxfattribs={"layer": "PAD"})
    msp.add_circle((PE, PN), R, dxfattribs={"layer": "PILE"})
    files["dxf"] = out / "site-plan.dxf"
    doc.saveas(files["dxf"])

    page_w, page_h = landscape(A3)
    files["pdf"] = out / "foundation-plan.pdf"
    c = canvas.Canvas(str(files["pdf"]), pagesize=(page_w, page_h))
    pts = [site_to_page(e, n, page_w, page_h) for e, n in PAD]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1], strict=True):
        c.line(x0, y0, x1, y1)
    cx, cy = site_to_page(PE, PN, page_w, page_h)
    c.circle(cx, cy, R * 72.0 / 25.4 * 2.0)
    c.save()
    # Raster georef source space is (col, -row) of plan.tif at DPI (spec section 8.3).
    control = [
        {"src": [x * DPI / 72.0, -((page_h - y) * DPI / 72.0)], "dst": [e, n]}
        for (x, y), (e, n) in zip(pts, PAD, strict=True)
    ]
    cone = math.pi * R * R * 8.0 / 3.0  # Sep pile above the plane

    manifest = {
        "mode": "synthetic",
        "epsg": EPSG,
        "orthos": [
            {"path": str(files["ortho-2026-08-14"]), "date": "2026-08-14"},
            {"path": str(files["ortho-2026-09-14"]), "date": "2026-09-14"},
        ],
        "dsms": [
            {"path": str(files["dsm-2026-08-14"]), "date": "2026-08-14", "role": "dsm"},
            {"path": str(files["dsm-2026-09-14"]), "date": "2026-09-14", "role": "dsm"},
            {"path": str(files["dtm"]), "date": None, "role": "dtm", "as_design": True},
        ],
        "dxf": {
            "path": str(files["dxf"]),
            "epsg": EPSG,
            "check_points": [list(p) for p in PAD] + [[PE + R, PN], [PE, PN + R]],
        },
        "pdf": {"path": str(files["pdf"]), "dpi": DPI, "control_points": control},
        "stockpile": [[PE - 25, PN + 25], [PE + 25, PN + 25], [PE + 25, PN - 25], [PE - 25, PN - 25]],
        "distance": [[PE - 30, PN], [PE + 30, PN]],
        "area": [[PE - 10, PN + 5], [PE + 10, PN + 5], [PE + 10, PN - 5], [PE - 10, PN - 5]],
        "profile": [[PE - 40, PN], [PE + 40, PN]],
        "expected": {"sep_cone_m3": cone},
        "cloud_dsm_surface_id": None,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(out / "manifest.json")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
