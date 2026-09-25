"""Acceptance files for the design-surface import (spec 2026-09-23-design-surfaces §15.4, §16.11).

From the real chimney DSM (a surface.tif S2 built from the imported cloud) this writes a synthetic
design of the same site in every format the importer reads, plus a 1 M-point LandXML for the timing
criterion. Run from backend/ with the overlay interpreter:
    .venv\\Scripts\\python.exe scripts\\design_acceptance.py --dsm <surface.tif> --out <folder>
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import contourpy
import ezdxf
import numpy as np
import rasterio
from pyproj import CRS
from rasterio.warp import Resampling, calculate_default_transform, reproject
from rasterio.windows import Window

# Run as a file (`python scripts\design_acceptance.py`), Python puts scripts/ on the path, not backend/.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.surfaces import grid  # noqa: E402

TIN_STEP_M = 2.0
DEM_CELL_M = 1.0


def sample(dsm: Path, step: float) -> tuple[np.ndarray, np.ndarray, np.ndarray, grid.GridSpec]:
    """Cell-centre X, Y and Z of the DSM on a `step`-metre lattice (one overview read, <= 2048)."""
    with grid.open_surface(dsm) as r:
        spec = r.spec
        w = min(2048, max(2, math.ceil(spec.width * spec.cell_size / step)))
        h = min(2048, max(2, math.ceil(spec.height * spec.cell_size / step)))
        z = r.read(Window(0, 0, spec.width, spec.height), out_shape=(h, w))
    cx, cy = spec.width * spec.cell_size / w, spec.height * spec.cell_size / h
    xx, yy = np.meshgrid(spec.x0 + (np.arange(w) + 0.5) * cx, spec.y0 - (np.arange(h) + 0.5) * cy)
    return xx, yy, z.astype(np.float64), spec


def grid_faces(valid: np.ndarray) -> np.ndarray:
    """Two triangles per grid square whose four corners are valid, as flat vertex indices."""
    h, w = valid.shape
    i, j = np.meshgrid(np.arange(w - 1), np.arange(h - 1))
    a = (j * w + i).ravel()
    ok = (valid[:-1, :-1] & valid[:-1, 1:] & valid[1:, :-1] & valid[1:, 1:]).ravel()
    a = a[ok]
    return np.vstack([np.column_stack([a, a + 1, a + w + 1]), np.column_stack([a, a + w + 1, a + w])])


def write_landxml(path: Path, x, y, z, faces, *, order: str, epsg: int = 32639) -> None:
    """Streams a LandXML 1.2 TIN; `order` is "NEZ" (the rule) or "ENZ" (the exporter mistake)."""
    with path.open("w", encoding="utf-8", newline="\n") as f:
        f.write(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2">\n'
        )
        f.write(
            '<Units><Metric linearUnit="meter" elevationUnit="meter"/></Units>\n'
            f'<CoordinateSystem epsgCode="{epsg}"/>\n'
        )
        f.write('<Surfaces><Surface name="Design"><Definition surfType="TIN"><Pnts>\n')
        for k, (e, n, h) in enumerate(zip(x, y, z, strict=True), start=1):
            a, b = (n, e) if order == "NEZ" else (e, n)
            f.write(f'<P id="{k}">{a:.3f} {b:.3f} {h:.3f}</P>\n')
        f.write("</Pnts><Faces>\n")
        for t in faces + 1:
            f.write(f"<F>{t[0]} {t[1]} {t[2]}</F>\n")
        f.write("</Faces></Definition></Surface></Surfaces>\n</LandXML>\n")


def write_3dface_dxf(path: Path, v: np.ndarray, faces: np.ndarray) -> None:
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 6
    msp = doc.modelspace()
    for t in faces:
        msp.add_3dface([tuple(v[i]) for i in t], dxfattribs={"layer": "DESIGN_TIN"})
    doc.saveas(path)


def write_contour_dxf(path: Path, x, y, z, interval: float = 1.0) -> int:
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = 6
    msp = doc.modelspace()
    gen = contourpy.contour_generator(x, y, np.ma.masked_invalid(z))
    lines = 0
    for level in np.arange(math.floor(np.nanmin(z)), math.ceil(np.nanmax(z)) + interval, interval):
        for line in gen.lines(level):
            if len(line) >= 2:
                msp.add_polyline3d(
                    [(px, py, float(level)) for px, py in line], dxfattribs={"layer": "CONTOURS"}
                )
                lines += 1
    doc.saveas(path)
    return lines


def write_dem_32638(path: Path, x, y, z, spec: grid.GridSpec) -> None:
    src_transform = rasterio.transform.from_origin(
        x[0, 0] - (x[0, 1] - x[0, 0]) / 2,
        y[0, 0] + (y[0, 0] - y[1, 0]) / 2,
        x[0, 1] - x[0, 0],
        y[0, 0] - y[1, 0],
    )
    src_crs, dst_crs = CRS.from_wkt(spec.crs_wkt).to_wkt(), CRS.from_epsg(32638).to_wkt()
    h, w = z.shape
    transform, width, height = calculate_default_transform(
        src_crs, dst_crs, w, h, *rasterio.transform.array_bounds(h, w, src_transform), resolution=DEM_CELL_M
    )
    out = np.full((height, width), np.nan, np.float32)
    reproject(
        z.astype(np.float32),
        out,
        src_transform=src_transform,
        src_crs=src_crs,
        dst_transform=transform,
        dst_crs=dst_crs,
        src_nodata=np.nan,
        dst_nodata=np.nan,
        resampling=Resampling.bilinear,
    )
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=width,
        height=height,
        count=1,
        dtype="float32",
        crs=dst_crs,
        transform=transform,
        nodata=np.nan,
    ) as dst:
        dst.write(out, 1)


def write_perf(path: Path, spec: grid.GridSpec) -> None:
    """1 M points / 2 M faces over 1 x 1 km at the site, for the §16.11 timing."""
    g = np.arange(1000, dtype=np.float64)
    xx, yy = np.meshgrid(spec.x0 + g, spec.y0 - 1000 + g)
    zz = -45.0 + 0.01 * (xx - spec.x0) + 0.005 * (yy - spec.y0)
    faces = grid_faces(np.ones(xx.shape, bool))
    write_landxml(path, xx.ravel(), yy.ravel(), zz.ravel(), faces, order="NEZ", epsg=spec.epsg or 32639)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dsm", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    x, y, z, spec = sample(args.dsm, TIN_STEP_M)
    valid = np.isfinite(z)
    faces = grid_faces(valid)
    v = np.column_stack([x.ravel(), y.ravel(), np.nan_to_num(z.ravel())])
    for order, name in (("NEZ", "site-nez.xml"), ("ENZ", "site-enz.xml")):
        write_landxml(args.out / name, v[:, 0], v[:, 1], v[:, 2], faces, order=order, epsg=spec.epsg or 32639)
    write_3dface_dxf(args.out / "site-3dface.dxf", v, faces)
    lines = write_contour_dxf(args.out / "site-contours.dxf", x, y, z)
    dx, dy, dz, _ = sample(args.dsm, DEM_CELL_M)
    write_dem_32638(args.out / "site-dem-32638.tif", dx, dy, dz, spec)
    write_perf(args.out / "perf-1m.xml", spec)
    print(f"{len(faces):,} TIN faces, {lines:,} contour lines")
    for p in sorted(args.out.iterdir()):
        print(p)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
