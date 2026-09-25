"""Header-only inspection of a LAS/LAZ file (spec §4.1 op 3, §6.1): the header and VLRs, ≤ 1 MiB."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import BinaryIO

import laspy

from app.jobs.cancellation import JobFailure
from app.pointclouds.crs import CrsInfo, crs_from_header

SUFFIXES = {".las", ".laz"}
RGB_FORMATS = {2, 3, 5, 7, 8, 10}


class UnsupportedCloud(JobFailure):
    """The file is not a LAS/LAZ laspy can read: 422 `unsupported_point_cloud` on the API."""


@dataclass(frozen=True)
class HeaderInfo:
    path: Path
    size: int
    compressed: bool
    las_version: str
    point_format: int
    point_count: int
    record_len: int
    has_rgb: bool
    header_bounds: list[float]
    scale: list[float]
    offsets: list[float]
    crs: CrsInfo
    captured_on: date | None
    vlrs: list[str]


def header_info(fileobj: BinaryIO, path: Path, size: int) -> HeaderInfo:
    try:
        with laspy.open(fileobj, closefd=False) as r:
            h = r.header
            try:
                captured_on = h.creation_date
            except (ValueError, OverflowError):  # day 0 / year 0 written by some exporters
                captured_on = None
            fmt = h.point_format
            return HeaderInfo(
                path=path,
                size=size,
                compressed=bool(h.are_points_compressed),
                las_version=f"{h.version.major}.{h.version.minor}",
                point_format=int(fmt.id),
                point_count=int(h.point_count),
                record_len=int(fmt.size),
                has_rgb=int(fmt.id) in RGB_FORMATS,
                header_bounds=[*map(float, h.mins), *map(float, h.maxs)],
                scale=[*map(float, h.scales)],
                offsets=[*map(float, h.offsets)],
                crs=crs_from_header(h),
                captured_on=captured_on,
                vlrs=[type(v).__name__ for v in h.vlrs],
            )
    except UnsupportedCloud:
        raise
    except Exception as e:
        raise UnsupportedCloud(f"this is not a readable LAS or LAZ file: {type(e).__name__}: {e}") from None


def inspect_file(path: Path) -> HeaderInfo:
    if path.suffix.lower() not in SUFFIXES:
        raise UnsupportedCloud(f"only .las and .laz point clouds can be imported (got {path.suffix.lower()})")
    size = path.stat().st_size
    with open(path, "rb") as f:
        return header_info(f, path, size)
