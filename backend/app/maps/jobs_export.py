"""The `map_export` job (spec section 9): boxes with coordinates into `exports/<stamp>/`."""

from __future__ import annotations

import re
import shutil

from pyproj import CRS
from sqlalchemy import select

from app.db.models import MapDetection, MapRun, SiteArea
from app.detect.areas import areas_for_map
from app.exports.job import _now_local, _promote, _reserve_partial_folder
from app.inference.service import class_ids_by_name
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.maps import geo_out, gpkg, service
from app.maps.geo_out import ExportBox
from app.maps.georef import Georef, box_corners


def _slug(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").lower() or "map"


def _boxes(ctx: JobContext, gmap, content: str, run_id: str | None) -> tuple[list[ExportBox], dict | None]:
    with ctx.project.session() as s:
        names = {v: k for k, v in class_ids_by_name(ctx.project, s).items()}
    score = service.score_run(ctx.project, run_id, 0.5) if content == "run_score" else None
    match = {(m["kind"], m["id"]): m["match"] for m in (score or {}).get("matches", [])}
    out: list[ExportBox] = []
    if content in ("run", "run_score"):
        with ctx.project.session() as s:
            conf = s.get(MapRun, run_id).conf
            for d in s.execute(
                select(MapDetection).where(MapDetection.run_id == run_id, MapDetection.confidence >= conf)
            ).scalars():
                out.append(
                    ExportBox(
                        "detection",
                        d.id,
                        names.get(d.class_id, d.class_id),
                        d.confidence,
                        match.get(("detection", d.id), ""),
                        "",
                        d.x,
                        d.y,
                        d.w,
                        d.h,
                        d.angle,
                        review_state=d.review_state,
                        class_id=d.class_id,
                    )
                )
    if content in ("labels", "run_score"):
        for lab in service.list_labels(ctx.project, gmap.id):
            out.append(
                ExportBox(
                    "label",
                    lab.id,
                    names.get(lab.class_id, lab.class_id),
                    None,
                    match.get(("label", lab.id), ""),
                    lab.source,
                    lab.x,
                    lab.y,
                    lab.w,
                    lab.h,
                    lab.angle,
                    class_id=lab.class_id,
                )
            )
    return out, score


@register_job_type("map_export")
def run_map_export(ctx: JobContext) -> dict:
    p = ctx.params
    gmap = service.get_map(ctx.project, p["map_id"])
    boxes, score = _boxes(ctx, gmap, p["content"], p.get("run_id"))
    georef = Georef(gmap.geotransform, gmap.crs_wkt) if gmap.crs_wkt else None
    zones = [(z.id, z.name, z.polygon) for z in service.list_zones(ctx.project, gmap.id)]
    site_areas = _site_areas(ctx, gmap) if georef is not None else []
    stem = f"map-{_slug(gmap.name)}"
    part = {"run": "detections", "labels": "labels", "run_score": "scored"}[p["content"]]
    base = ctx.project.exports_dir
    base.mkdir(parents=True, exist_ok=True)
    now = _now_local()
    partial, stamp, n = _reserve_partial_folder(base, now)
    files: list[str] = []
    try:
        for i, fmt in enumerate(p["formats"]):
            ctx.check_cancelled()
            if fmt == "csv":
                name = f"{stem}-{part}.csv"
                geo_out.write_csv(partial / name, boxes, georef, gmap.epsg)
            elif fmt == "geojson":
                name = f"{stem}-{part}.geojson"
                geo_out.write_geojson(partial / name, boxes, zones, georef)
            else:
                name = f"{stem}-{part}.gpkg"
                _write_gpkg(partial / name, boxes, zones, georef, gmap, site_areas)
            files.append(name)
            ctx.progress((i + 1) / (len(p["formats"]) + 1), f"{name} written")
        counts: dict[str, int] = {}
        for b in boxes:
            counts[b.class_name] = counts.get(b.class_name, 0) + 1
        summary_name = f"{stem}-summary.json"
        geo_out.write_summary(
            partial / summary_name,
            {
                "exported_at": now.isoformat(),
                "map": {
                    k: getattr(gmap, k)
                    for k in (
                        "id",
                        "name",
                        "source_path",
                        "width",
                        "height",
                        "epsg",
                        "gsd_cm",
                        "bounds_wgs84",
                    )
                },
                "content": p["content"],
                "run_id": p.get("run_id"),
                "counts": counts,
                "score": {k: score[k] for k in ("iou", "overall", "per_class", "per_zone")}
                if score
                else None,
            },
        )
        files.append(summary_name)
        final = _promote(base, partial, stamp, n)
    except BaseException:
        shutil.rmtree(partial, ignore_errors=True)
        raise
    folder = "/".join(final.relative_to(ctx.project.folder).parts)
    return {"folder": folder, "files": files, "box_count": len(boxes)}


def _site_areas(ctx: JobContext, gmap) -> list[tuple[str, str, bool, list[tuple[float, float]]]]:
    """The project's site areas that lie on this map: (id, name, partly on the map, pixel ring)."""
    with ctx.project.session() as s:
        names = dict(s.execute(select(SiteArea.id, SiteArea.name)).all())
        return [
            (a.area_id, names.get(a.area_id, ""), a.partial, a.polygon_px) for a in areas_for_map(s, gmap)
        ]


def _write_gpkg(path, boxes, zones, georef: Georef, gmap, site_areas=()) -> None:
    def ring(b: ExportBox):
        return [georef.pixel_to_native(px, py) for px, py in box_corners(b.x, b.y, b.w, b.h, b.angle)]

    def props(b: ExportBox) -> dict:
        return {
            "box_id": b.id,
            "class": b.class_name,
            "confidence": b.confidence,
            "match": b.match,
            "source": b.source,
            "class_id": b.class_id,
            "review_state": b.review_state,
        }

    cols = [
        ("box_id", "TEXT"),
        ("class", "TEXT"),
        ("confidence", "REAL"),
        ("match", "TEXT"),
        ("source", "TEXT"),
        ("class_id", "TEXT"),
        ("review_state", "TEXT"),
    ]
    layers = [
        gpkg.Layer("detections", cols, [(ring(b), props(b)) for b in boxes if b.kind == "detection"]),
        gpkg.Layer("labels", cols, [(ring(b), props(b)) for b in boxes if b.kind == "label"]),
        gpkg.Layer(
            "zones",
            [("zone_id", "TEXT"), ("name", "TEXT")],
            [
                ([georef.pixel_to_native(x, y) for x, y in poly], {"zone_id": zid, "name": name})
                for zid, name, poly in zones
            ],
        ),
        # Project-wide site areas (plan 2 unit E), never clipped: the whole polygon, in
        # the map's CRS, with `partial` = 1 when part of it lies off this map.
        gpkg.Layer(
            "site_areas",
            [("area_id", "TEXT"), ("name", "TEXT"), ("partial", "INTEGER")],
            [
                (
                    [georef.pixel_to_native(x, y) for x, y in ring],
                    {"area_id": aid, "name": name, "partial": int(partial)},
                )
                for aid, name, partial, ring in site_areas
            ],
        ),
    ]
    layers = [layer for layer in layers if layer.features]
    crs = CRS.from_wkt(gmap.crs_wkt)
    srs_id = gmap.epsg or 100000
    gpkg.write_gpkg(
        path,
        layers,
        srs_id=srs_id,
        srs_name=crs.name,
        organization="EPSG" if gmap.epsg else "kestrel",
        organization_id=srs_id,
        wkt=crs.to_wkt("WKT1_GDAL"),
    )
