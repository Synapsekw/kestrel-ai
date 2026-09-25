"""The `volume_export` job (spec 2026-09-23-volumes §10): PDF, GeoPackage + cut/fill GeoTIFF + QML,
CSV, XLSX and summary.json, written into `exports/<stamp>/` through the same partial-folder
mechanism as every other export (plan deviation 5). Progress per file; cancel between files.

reportlab and openpyxl are imported inside the job, as the detection export does: a broken build
costs the PDF or the workbook, never the backend's start."""

from __future__ import annotations

import re
import shutil

from pyproj import CRS

from app.db.models import Surface, VolumeMeasurement
from app.exports.job import _now_local, _promote, _reserve_partial_folder
from app.jobs.cancellation import JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.maps import geo_out, gpkg
from app.surfaces.grid import open_surface
from app.surfaces.paths import surface_path
from app.volumes import service
from app.volumes.engine import ring_polygon
from app.volumes.footprints import FootprintError, footprints_for, usable_runs
from app.volumes.items import ExportItem
from app.volumes.paths import diff_path
from app.volumes.qml import write_qml

MEASUREMENT_COLUMNS = [
    ("name", "TEXT"),
    ("base_kind", "TEXT"),
    ("base_detail", "TEXT"),
    ("top_surface", "TEXT"),
    ("base_surface", "TEXT"),
    ("fill_m3", "REAL"),
    ("cut_m3", "REAL"),
    ("net_m3", "REAL"),
    ("uncertainty_m3", "REAL"),
    ("area_m2", "REAL"),
    ("measured_area_m2", "REAL"),
    ("masked_area_m2", "REAL"),
    ("excluded_area_m2", "REAL"),
    ("nodata_area_m2", "REAL"),
    ("shift_m", "REAL"),
    ("cell_size_m", "REAL"),
    ("computed_at", "TEXT"),
]


def slug(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").lower() or "measurement"


def _load(ctx: JobContext, measurement_ids: list[str]) -> list[ExportItem]:
    items = []
    for measurement_id in measurement_ids:
        out, _ = service.get_measurement(ctx.project, measurement_id)
        if out.status != "ready" or out.results is None:
            raise JobFailure(f"{out.name} is {out.status}; recalculate it before exporting")
        with ctx.project.session() as s:
            top = s.get(Surface, out.top_surface_id)
            epsg, crs_wkt = top.epsg, top.crs_wkt
            row = s.get(VolumeMeasurement, measurement_id)
            masks, alignment = dict(row.masks), dict(row.alignment or {})
        items.append(
            ExportItem(
                id=out.id,
                name=out.name,
                status=out.status,
                polygon=out.polygon_native,
                base=out.base.model_dump(),
                masks=masks,
                alignment=alignment,
                results=out.results.model_dump(mode="json"),
                epsg=epsg,
                crs_wkt=crs_wkt,
            )
        )
    return items


def _clutter(ctx: JobContext, item: ExportItem) -> list[list[list[float]]]:
    try:
        runs = usable_runs(ctx.project, item.masks.get("detection_run_ids", []))
        found, _ = footprints_for(
            ctx.project,
            runs,
            class_ids=item.masks.get("class_ids"),
            buffer_m=float(item.masks.get("buffer_m", 1.0)),
            bbox=ring_polygon(item.polygon).bounds,
            surface_crs_wkt=item.crs_wkt,
        )
    except FootprintError:
        return []
    return [[list(p) for p in f.polygon.exterior.coords[:-1]] for f in found]


def _plan(ctx: JobContext, item: ExportItem) -> bytes:
    from app.volumes.plan_image import render_plan_image

    exclusions = [e["ring"] for e in item.masks.get("exclusion_polygons", [])]
    with (
        open_surface(surface_path(ctx.project, item.results["top_surface"]["id"])) as top,
        open_surface(diff_path(ctx.project, item.id)) as diff,
    ):
        return render_plan_image(
            top,
            diff,
            item.polygon,
            diff_scale=item.results["diff_scale_m"],
            stable=item.alignment.get("stable_polygon"),
            exclusions=exclusions,
            clutter=item.clutter_rings,
        )


def _unique(stem: str, used: set[str]) -> str:
    """`stem`, or `stem-2`, `stem-3`... when an earlier file already took it."""
    name, k = stem, 1
    while name in used:
        k += 1
        name = f"{stem}-{k}"
    used.add(name)
    return name


def gpkg_groups(items: list[ExportItem]) -> list[tuple[str, list[ExportItem]]]:
    """One GeoPackage per CRS: keyed on the EPSG code when there is one (two WKT spellings of the
    same code share a file), on the WKT only for a CRS without a code. Names never collide."""
    groups: dict[tuple, list[ExportItem]] = {}
    for item in items:
        key = ("epsg", item.epsg) if item.epsg else ("wkt", item.crs_wkt or "")
        groups.setdefault(key, []).append(item)
    if len(groups) == 1:
        return [("volumes.gpkg", next(iter(groups.values())))]
    used: set[str] = set()
    out = []
    for (kind, value), group in groups.items():
        stem = f"volumes-epsg{value}" if kind == "epsg" else "volumes-local"
        out.append((f"{_unique(stem, used)}.gpkg", group))
    return out


def _gpkgs(ctx: JobContext, partial, items: list[ExportItem]) -> list[str]:
    names = []
    for name, group in gpkg_groups(items):
        ctx.check_cancelled()
        epsg = group[0].epsg
        crs_wkt = group[0].crs_wkt
        crs = CRS.from_epsg(epsg) if epsg else CRS.from_user_input(crs_wkt) if crs_wkt else None
        measurements = [
            (
                i.polygon,
                {
                    "name": i.name,
                    "base_kind": i.base["kind"],
                    "base_detail": i.base_detail,
                    "top_surface": i.results["top_surface"]["name"],
                    "base_surface": (i.results.get("base_surface") or {}).get("name"),
                    "fill_m3": i.results["fill_m3"],
                    "cut_m3": i.results["cut_m3"],
                    "net_m3": i.results["net_m3"],
                    "uncertainty_m3": i.results["uncertainty"]["total_m3"],
                    "area_m2": i.results["area_m2"],
                    "measured_area_m2": i.results["measured_area_m2"],
                    "masked_area_m2": i.results["masked_area_m2"],
                    "excluded_area_m2": i.results["excluded_area_m2"],
                    "nodata_area_m2": i.results["nodata_area_m2"],
                    "shift_m": i.results["shift_applied_m"],
                    "cell_size_m": i.results["cell_size_m"],
                    "computed_at": i.results["computed_at"],
                },
            )
            for i in group
        ]
        layers = [
            gpkg.Layer("measurements", MEASUREMENT_COLUMNS, measurements),
            gpkg.Layer(
                "stable_areas",
                [("measurement", "TEXT")],
                [
                    (i.alignment["stable_polygon"], {"measurement": i.name})
                    for i in group
                    if i.alignment.get("stable_polygon")
                ],
            ),
            gpkg.Layer(
                "exclusions",
                [("measurement", "TEXT"), ("mode", "TEXT")],
                [
                    (e["ring"], {"measurement": i.name, "mode": e["mode"]})
                    for i in group
                    for e in i.masks.get("exclusion_polygons", [])
                ],
            ),
            gpkg.Layer(
                "clutter",
                [("measurement", "TEXT")],
                [(ring, {"measurement": i.name}) for i in group for ring in i.clutter_rings],
            ),
        ]
        srs_id = epsg or 100000
        gpkg.write_gpkg(
            partial / name,
            [layer for layer in layers if layer.features],
            srs_id=srs_id,
            srs_name=crs.name if crs else "local metres",
            organization="EPSG" if epsg else "kestrel",
            organization_id=srs_id,
            wkt=crs.to_wkt("WKT1_GDAL") if crs else 'LOCAL_CS["local metres",UNIT["metre",1]]',
        )
        names.append(name)
    used: set[str] = set()
    for item in items:
        ctx.check_cancelled()
        stem = _unique(f"{slug(item.name)}-cutfill", used)
        shutil.copyfile(diff_path(ctx.project, item.id), partial / f"{stem}.tif")
        write_qml(partial / f"{stem}.qml", item.results["diff_scale_m"])
        names += [f"{stem}.tif", f"{stem}.qml"]
    return names


@register_job_type("volume_export")
def run_volume_export(ctx: JobContext) -> dict:
    p = ctx.params
    items = _load(ctx, p["measurement_ids"])
    formats = p["formats"]
    base = ctx.project.exports_dir
    base.mkdir(parents=True, exist_ok=True)
    now = _now_local()
    partial, stamp, n = _reserve_partial_folder(base, now)
    files: list[str] = []
    steps = len(formats) + 1
    try:
        for item in items:
            ctx.check_cancelled()
            item.clutter_rings = _clutter(ctx, item)
        for i, fmt in enumerate(formats):
            ctx.check_cancelled()
            if fmt == "pdf":
                from app.volumes.report_pdf import write_report

                for item in items:
                    ctx.check_cancelled()
                    item.plan_png = _plan(ctx, item)
                with ctx.project.session() as s:
                    project_name = ctx.project.row(s).name
                write_report(
                    partial / "volumes-report.pdf",
                    items,
                    title=p["title"],
                    project_name=project_name,
                    generated_at=now,
                    compress=True,
                )
                files.append("volumes-report.pdf")
            elif fmt == "gpkg":
                files += _gpkgs(ctx, partial, items)
            elif fmt == "csv":
                from app.volumes import tables

                tables.write_csv(partial / "volumes.csv", items)
                files.append("volumes.csv")
            else:
                from app.volumes import tables

                tables.write_xlsx(partial / "volumes.xlsx", items)
                files.append("volumes.xlsx")
            ctx.progress((i + 1) / steps, f"{files[-1]} written")
        geo_out.write_summary(
            partial / "summary.json",
            {
                "exported_at": now.isoformat(),
                "title": p["title"],
                "formats": formats,
                "measurements": [{"id": i.id, "name": i.name, "results": i.results} for i in items],
            },
        )
        files.append("summary.json")
        final = _promote(base, partial, stamp, n)
    except BaseException:
        shutil.rmtree(partial, ignore_errors=True)
        raise
    folder = "/".join(final.relative_to(ctx.project.folder).parts)
    return {"folder": folder, "files": files}
