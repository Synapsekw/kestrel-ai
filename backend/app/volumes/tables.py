"""CSV and XLSX of volume measurements (spec 2026-09-23-volumes §10).

One row per measurement with the exact §10 columns, in the dialect of `app.maps.geo_out.write_csv`
(csv.DictWriter, UTF-8, "\\n" newlines). The XLSX is written in openpyxl's write-only mode with typed
cells: `#,##0.0` for m³ and m², `0.000` for metres, a frozen header.
"""

from __future__ import annotations

import csv
from pathlib import Path

from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from pyproj import CRS, Transformer

from app.volumes.items import ExportItem

CSV_COLUMNS = [
    "measurement_id",
    "name",
    "status",
    "computed_at",
    "base_kind",
    "base_detail",
    "top_surface",
    "top_surface_date",
    "base_surface",
    "base_surface_date",
    "epsg",
    "cell_size_m",
    "method",
    "fill_m3",
    "cut_m3",
    "net_m3",
    "uncertainty_m3",
    "uncertainty_complete",
    "area_m2",
    "polygon_area_m2",
    "measured_area_m2",
    "masked_area_m2",
    "excluded_area_m2",
    "nodata_area_m2",
    "shift_applied_m",
    "align_median_dz_m",
    "align_mad_m",
    "align_n_cells",
    "align_tilt_mm_per_m",
    "base_fit_rms_m",
    "areal_scale_factor",
    "warnings",
    "centroid_x",
    "centroid_y",
    "centroid_lon",
    "centroid_lat",
]
VOLUME_FORMAT = "#,##0.0"
METRE_FORMAT = "0.000"
VOLUME_COLUMNS = {c for c in CSV_COLUMNS if c.endswith(("_m3", "_m2"))}
METRE_COLUMNS = {"cell_size_m", "shift_applied_m", "align_median_dz_m", "align_mad_m", "base_fit_rms_m"}


def row_for(item: ExportItem) -> dict:
    r = item.results
    top, base = r["top_surface"], r.get("base_surface") or {}
    align = r.get("alignment") or {}
    fit = r.get("base_fit") or {}
    cx, cy = item.centroid
    lon = lat = None
    if item.crs_wkt:
        lon, lat = Transformer.from_crs(CRS.from_user_input(item.crs_wkt), 4326, always_xy=True).transform(
            cx, cy
        )
    return {
        "measurement_id": item.id,
        "name": item.name,
        "status": item.status,
        "computed_at": r["computed_at"],
        "base_kind": item.base["kind"],
        "base_detail": item.base_detail,
        "top_surface": top["name"],
        "top_surface_date": top.get("captured_on"),
        "base_surface": base.get("name"),
        "base_surface_date": base.get("captured_on"),
        "epsg": item.epsg,
        "cell_size_m": r["cell_size_m"],
        "method": top.get("method"),
        "fill_m3": r["fill_m3"],
        "cut_m3": r["cut_m3"],
        "net_m3": r["net_m3"],
        "uncertainty_m3": r["uncertainty"]["total_m3"],
        "uncertainty_complete": r["uncertainty"]["complete"],
        "area_m2": r["area_m2"],
        "polygon_area_m2": r["polygon_area_m2"],
        "measured_area_m2": r["measured_area_m2"],
        "masked_area_m2": r["masked_area_m2"],
        "excluded_area_m2": r["excluded_area_m2"],
        "nodata_area_m2": r["nodata_area_m2"],
        "shift_applied_m": r["shift_applied_m"],
        "align_median_dz_m": align.get("median_dz"),
        "align_mad_m": align.get("mad"),
        "align_n_cells": align.get("n_cells"),
        "align_tilt_mm_per_m": align.get("tilt_mm_per_m"),
        "base_fit_rms_m": fit.get("rms_m"),
        "areal_scale_factor": r["areal_scale_factor"],
        "warnings": ";".join(w["code"] for w in r["warnings"]),
        "centroid_x": cx,
        "centroid_y": cy,
        "centroid_lon": lon,
        "centroid_lat": lat,
    }


def write_csv(path: Path, items: list[ExportItem]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for item in items:
            writer.writerow({k: "" if v is None else v for k, v in row_for(item).items()})


def method_rows(item: ExportItem) -> list[tuple[str, object]]:
    r, m = item.results, item.masks
    return [
        ("measurement", item.name),
        ("top surface", r["top_surface"]["name"]),
        ("top cloud file", r["top_surface"].get("cloud_file")),
        ("top cloud sha256", r["top_surface"].get("cloud_sha256")),
        ("base", item.base_detail),
        ("per-cell statistic", r["top_surface"].get("method")),
        ("cell size (m)", r["cell_size_m"]),
        ("EPSG", item.epsg),
        ("mask runs", ", ".join(m.get("detection_run_ids", [])) or "none"),
        ("mask buffer (m)", m.get("buffer_m")),
        ("exclusions", len(m.get("exclusion_polygons", []))),
        ("stable area", "drawn" if item.alignment.get("stable_polygon") else "none"),
        ("shift applied (m)", r["shift_applied_m"]),
        ("engine version", r["engine_version"]),
        ("inputs fingerprint", r["inputs_fingerprint"]),
    ]


def _cell(ws, column: str, value):
    cell = WriteOnlyCell(ws, value=value)
    if column in VOLUME_COLUMNS:
        cell.number_format = VOLUME_FORMAT
    elif column in METRE_COLUMNS:
        cell.number_format = METRE_FORMAT
    return cell


def write_xlsx(path: Path, items: list[ExportItem]) -> None:
    wb = Workbook(write_only=True)
    volumes = wb.create_sheet("Volumes")
    volumes.freeze_panes = "A2"
    volumes.append(CSV_COLUMNS)
    for item in items:
        row = row_for(item)
        volumes.append([_cell(volumes, c, row[c]) for c in CSV_COLUMNS])
    method = wb.create_sheet("Method")
    method.append(["measurement", "key", "value"])
    for item in items:
        for key, value in method_rows(item):
            method.append([item.name, key, value])
    warnings = wb.create_sheet("Warnings")
    warnings.append(["measurement", "code", "severity", "message"])
    for item in items:
        for w in item.results["warnings"]:
            warnings.append([item.name, w["code"], w["severity"], w["message"]])
    wb.save(path)
