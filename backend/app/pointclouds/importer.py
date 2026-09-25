"""The point-cloud import pipeline (spec §6), with no database.

copy + hash (0-30 %) -> scan (30-45 %) -> CRS -> header repair -> admission re-check ->
convert (45-97 %) -> validate (97-99 %) -> octree/ + source.json. Both the `pointcloud_import`
job and `pointcloud-selftest` call `import_cloud`, so the selftest exercises the real path.
"""

from __future__ import annotations

import json
import os
import shutil
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import laspy

from app.jobs.cancellation import JobFailure
from app.pointclouds import admission
from app.pointclouds.crs import CrsInfo, bounds_wgs84, crs_from_header
from app.pointclouds.lasfile import inspect_file
from app.pointclouds.scan import scan
from app.pointclouds.validate import validate_octree
from app.pointclouds.workcopy import copy_and_hash, repair_header

COPY_END, SCAN_END, CONVERT_END, VALIDATE_END = 0.30, 0.45, 0.97, 0.99


@dataclass
class ImportResult:
    point_count: int
    header_count: int
    las_version: str
    point_format: int
    has_rgb: bool
    scale: list[float]
    crs: CrsInfo
    bounds_native: list[float]
    bounds_repaired: bool
    bounds_wgs84: list[float] | None
    z_stats: dict
    class_counts: dict[str, int]
    octree_spacing_m: float
    octree_bytes: int
    encoding: str
    source_sha256: str
    source_size: int
    source_mtime: float
    captured_on: date | None
    seconds: float
    timings: dict[str, float] = field(default_factory=dict)
    log_tail: list[str] = field(default_factory=list)  # the converter's last lines, for the job log


def _gb(n: int) -> str:
    return f"{n / 1e9:.1f}"


def _mpts(n: int) -> str:
    return f"{n / 1e6:.0f} M" if n >= 10_000_000 else f"{n / 1e6:.1f} M"


def import_cloud(
    source: Path,
    cloud_dir: Path,
    *,
    progress: Callable[[float, str], None],
    check_cancelled: Callable[[], None],
    converter: Callable | None = None,
) -> ImportResult:
    if converter is None:
        from app.pointclouds import converter as converter_module

        converter = converter_module.run_converter  # looked up now: the test seam patches the module
    started = time.monotonic()
    timings: dict[str, float] = {}
    work, octree = cloud_dir / ".work", cloud_dir / "octree"

    def lap(name: str, t: float) -> float:
        now = time.monotonic()
        timings[name] = round(now - t, 3)
        return now

    try:
        try:
            st = source.stat()
        except OSError as e:
            raise JobFailure(f"could not read the source file: {source} ({e.strerror or e})") from None
        info = inspect_file(source)
        admission.require(admission.assess(info.point_count, st.st_size, info.record_len, cloud_dir.parent))
        shutil.rmtree(work, ignore_errors=True)
        work.mkdir(parents=True)
        t = time.monotonic()
        copy = work / f"input{source.suffix.lower()}"
        sha = copy_and_hash(
            source,
            copy,
            progress=lambda d, n: progress(COPY_END * d / max(n, 1), f"copying {_gb(d)} / {_gb(n)} GB"),
            check_cancelled=check_cancelled,
        )
        t = lap("copy_s", t)
        scanned = scan(
            copy,
            progress=lambda d, n: progress(
                COPY_END + (SCAN_END - COPY_END) * min(d / max(n, 1), 1.0),
                f"scanning {_mpts(d)} / {_mpts(n)} points",
            ),
            check_cancelled=check_cancelled,
        )
        t = lap("scan_s", t)
        with laspy.open(copy) as r:
            crs = crs_from_header(r.header)
        wgs84 = bounds_wgs84(scanned.bounds, crs.crs_wkt) if crs.crs_wkt else None
        repaired = repair_header(copy, scanned.bounds, info.scale)
        t = lap("crs_repair_s", t)
        check_cancelled()
        admission.require(admission.assess(scanned.count, st.st_size, info.record_len, cloud_dir.parent))
        out = work / "octree"
        result = converter(
            copy,
            out,
            progress=lambda f, m: progress(SCAN_END + (CONVERT_END - SCAN_END) * f, m),
            check_cancelled=check_cancelled,
        )
        t = lap("convert_s", t)
        progress(CONVERT_END, "checking the 3D view copy")
        meta = validate_octree(out, points=scanned.count, bounds=scanned.bounds, encoding=result.encoding)
        shutil.rmtree(octree, ignore_errors=True)
        os.replace(out, octree)  # same volume: atomic
        octree_bytes = sum(f.stat().st_size for f in octree.iterdir() if f.is_file())
        lap("validate_s", t)
        record = {
            "path": str(source),
            "size": st.st_size,
            "mtime": st.st_mtime,
            "sha256": sha,
            "header": {
                "las_version": info.las_version,
                "point_format": info.point_format,
                "point_count": info.point_count,
                "scales": info.scale,
                "offsets": info.offsets,
                "bounds": info.header_bounds,
            },
            "scanned_point_count": scanned.count,
            "point_count_mismatch": scanned.count != scanned.header_count,
            "true_bounds": scanned.bounds,
            "bounds_repaired": repaired,
            "vlrs": info.vlrs,
            "crs_wkt": crs.crs_wkt,
            "crs_warning": crs.warning,
            "converter": {
                "version": result.version,
                "command": result.command,
                "encoding": result.encoding,
                "log_tail": result.log_tail,
            },
            "timings": timings,
        }
        (cloud_dir / "source.json").write_text(json.dumps(record, indent=2, default=str), "utf-8")
        progress(VALIDATE_END, "3D view copy ready")
    except BaseException:
        shutil.rmtree(octree, ignore_errors=True)
        raise
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return ImportResult(
        point_count=scanned.count,
        header_count=scanned.header_count,
        las_version=info.las_version,
        point_format=info.point_format,
        has_rgb=info.has_rgb,
        scale=info.scale,
        crs=crs,
        bounds_native=scanned.bounds,
        bounds_repaired=repaired,
        bounds_wgs84=wgs84,
        z_stats=scanned.z_stats,
        class_counts=scanned.class_counts,
        octree_spacing_m=float(meta["spacing"]),
        octree_bytes=octree_bytes,
        encoding=result.encoding,
        source_sha256=sha,
        source_size=st.st_size,
        source_mtime=st.st_mtime,
        captured_on=info.captured_on,
        seconds=round(time.monotonic() - started, 3),
        timings=timings,
        log_tail=list(result.log_tail),
    )
