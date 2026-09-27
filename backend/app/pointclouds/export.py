"""The LAZ export writer (spec §11): built from the source file, never from the octree.

Streamed through laspy + lazrs in 2 M-point chunks. The header bounds are the scanned true bounds
widened one scale step, so the export never carries the Pix4D bbox defect.
"""

from __future__ import annotations

import copy
import csv
import json
import re
from collections.abc import Callable, Iterable
from pathlib import Path

import laspy
from pyproj import CRS

from app.jobs.cancellation import JobFailure
from app.pointclouds import measure
from app.pointclouds.lasbounds import widen, write_header_bounds

CHUNK = 2_000_000
S1_CSV_COLUMNS = [
    "id",
    "name",
    "kind",
    "note",
    "x1",
    "y1",
    "z1",
    "u1",
    "x2",
    "y2",
    "z2",
    "u2",
    *measure.FIELDS,
]
NEW_RESULT_COLUMNS = [*measure.AREA_FIELDS, *measure.RING_FIELDS, *measure.PROFILE_FIELDS]
# The S1 columns keep their order; the workspace columns only append (spec 2026-09-26 section 5).
CSV_COLUMNS = [*S1_CSV_COLUMNS, "vertex_count", "geometry_wkt", *NEW_RESULT_COLUMNS]


def slug(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").lower() or "cloud"


def check_source(cloud) -> Path:
    src = Path(cloud.source_path)
    try:
        st = src.stat()
    except OSError:
        raise JobFailure(f"the source file is not reachable: {src}") from None
    if st.st_size != cloud.source_size or abs(st.st_mtime - float(cloud.source_mtime or 0)) > 1e-3:
        raise JobFailure("the source file changed since import; import it again")
    return src


def write_laz(
    source: Path,
    dst: Path,
    *,
    bounds: list[float],
    scale: list[float],
    assign_epsg: int | None,
    progress: Callable[[int, int], None],
    check_cancelled: Callable[[], None],
) -> int:
    written = 0
    with laspy.open(source) as r:
        header = copy.deepcopy(r.header)
        if assign_epsg is not None:
            header.add_crs(CRS.from_epsg(assign_epsg))
        total = int(r.header.point_count)
        with laspy.open(
            dst, mode="w", header=header, do_compress=True, laz_backend=laspy.LazBackend.LazrsParallel
        ) as w:
            for pts in r.chunk_iterator(CHUNK):
                check_cancelled()
                w.write_points(pts)
                written += len(pts)
                progress(written, total)
    write_header_bounds(dst, widen(bounds, scale))
    return written


def _horizontal_epsg(crs: CRS | None) -> int | None:
    """The horizontal sub-CRS's EPSG (R12): a compound CRS's own `to_epsg()` is always None, so a
    compound CRS is resolved to its horizontal part first, exactly as `crs.py`'s `crs_info` does."""
    if crs is None:
        return None
    if crs.is_compound:
        subs = crs.sub_crs_list
        crs = next((c for c in subs if c.is_projected or c.is_geographic), subs[0])
    return crs.to_epsg()


def verify_laz(path: Path, *, point_count: int, epsg: int | None) -> None:
    with laspy.open(path) as r:
        count = int(r.header.point_count)
        crs = r.header.parse_crs()
    problems = []
    if count != point_count:
        problems.append(f"{count} points, expected {point_count}")
    got = _horizontal_epsg(crs)
    if epsg is not None and got != epsg:
        problems.append(f"EPSG {got}, expected {epsg}")
    if problems:
        raise JobFailure("the exported LAZ failed its checks: " + "; ".join(problems))


def _wkt_xyz(p: dict) -> str:
    return f"{float(p['x'])!r} {float(p['y'])!r} {float(p['z'])!r}"


def geometry_wkt(kind: str, points: list[dict], params: dict | None) -> str:
    """POINT Z, POLYGON Z (closed), or LINESTRING Z (a rings check: the axis between the fitted centres)."""
    if kind == "point":
        return f"POINT Z ({_wkt_xyz(points[0])})"
    if kind == "area":
        return "POLYGON Z ((" + ", ".join(_wkt_xyz(p) for p in [*points, points[0]]) + "))"
    if kind == "vertical" and measure.method_of(params) == "rings":
        try:
            lower, upper = measure.ring_axis(points)
        except measure.Refusal:
            return ""  # a stored row the formulas now refuse: no geometry rather than a failed export
        return f"LINESTRING Z ({_wkt_xyz(lower)}, {_wkt_xyz(upper)})"
    return "LINESTRING Z (" + ", ".join(_wkt_xyz(p) for p in points) + ")"


def _cell(value) -> object:
    return "" if value is None else value


def write_measurements_csv(path: Path, measurements: Iterable) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(CSV_COLUMNS)
        for m in measurements:
            points = list(m.points)
            pair = points if len(points) <= 2 else []  # x1..u2 only for the 1-2-point kinds
            pair = pair + [{}] * (2 - len(pair))
            coords = [pair[i].get(k, "") for i in range(2) for k in ("x", "y", "z", "uncertainty_m")]
            results = m.results or {}
            params = getattr(m, "params", None)
            w.writerow(
                [
                    m.id,
                    m.name,
                    m.kind,
                    m.note or "",
                    *coords,
                    *[_cell(results.get(k)) for k in measure.FIELDS],
                    len(points),
                    geometry_wkt(m.kind, points, params),
                    *[_cell(results.get(k)) for k in NEW_RESULT_COLUMNS],
                ]
            )


def write_cloud_json(path: Path, cloud, app_version: str) -> None:
    body = {
        "name": cloud.name,
        "crs_wkt": cloud.crs_wkt,
        "epsg": cloud.epsg,
        "vertical_crs": cloud.vertical_crs,
        "point_count": cloud.point_count,
        "bounds_native": cloud.bounds_native,
        "bounds_wgs84": cloud.bounds_wgs84,
        "source": {"path": cloud.source_path, "sha256": cloud.source_sha256},
        "app_version": app_version,
    }
    path.write_text(json.dumps(body, indent=2), "utf-8")
