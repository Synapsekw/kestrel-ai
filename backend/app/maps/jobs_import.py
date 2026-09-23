"""The `map_import` job (spec section 4): inspect, stretch, write the display raster, preview."""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import rasterio

from app.db.models import GeoMap
from app.jobs.cancellation import JobCancelled, JobFailure
from app.jobs.registry import register_job_type
from app.jobs.runner import JobContext
from app.maps import raster
from app.maps.georef import Georef
from app.maps.startup import map_dir, map_raster_path
from app.maps.tiles import TILE_CACHE

HASH_CHUNK = 64 * 1024 * 1024
HASH_SHARE = 0.05  # of the progress bar; the display raster takes the rest


def _sha256(ctx: JobContext, path: Path) -> str:
    digest, size, done = hashlib.sha256(), path.stat().st_size, 0
    with path.open("rb") as f:
        while chunk := f.read(HASH_CHUNK):
            ctx.check_cancelled()
            digest.update(chunk)
            done += len(chunk)
            ctx.progress(HASH_SHARE * done / max(size, 1), "reading the file")
    return digest.hexdigest()


def _fail(ctx: JobContext, map_id: str, message: str) -> None:
    with ctx.project.session() as s:
        row = s.get(GeoMap, map_id)
        if row is not None:
            row.status, row.error = "failed", message
    shutil.rmtree(map_dir(ctx.project, map_id), ignore_errors=True)
    ctx.publish("maps.changed", {"map_ids": [map_id]})


@register_job_type("map_import")
def run_map_import(ctx: JobContext) -> dict:
    map_id = ctx.params["map_id"]
    with ctx.project.session() as s:
        source = Path(s.get(GeoMap, map_id).source_path)
    folder = map_dir(ctx.project, map_id)
    try:
        info = raster.inspect_raster(source)
        sha = _sha256(ctx, source)
        with rasterio.open(source) as src:
            stretch = raster.compute_stretch(src)
        folder.mkdir(parents=True, exist_ok=True)
        dst = map_raster_path(ctx.project, map_id)
        raster.write_display_raster(
            source,
            dst,
            stretch,
            progress=lambda f, m: ctx.progress(HASH_SHARE + (0.97 - HASH_SHARE) * f, m),
            check_cancelled=ctx.check_cancelled,
        )
        with rasterio.open(dst) as d:
            raster.write_preview(d, folder / "preview.jpg")
        geo = Georef(info.geotransform, info.crs_wkt) if info.crs_wkt else None
        source_record = {
            "path": str(source),
            "size": source.stat().st_size,
            "sha256": sha,
            "info": info.__dict__,
        }
        (folder / "source.json").write_text(json.dumps(source_record, indent=2), "utf-8")
    except JobCancelled:
        _fail(ctx, map_id, "import cancelled")
        raise
    except raster.RasterError as e:
        _fail(ctx, map_id, str(e))
        raise JobFailure(str(e)) from None
    except Exception as e:
        _fail(ctx, map_id, f"import failed: {type(e).__name__}: {e}")
        raise
    with ctx.project.session() as s:
        row = s.get(GeoMap, map_id)
        row.width, row.height = info.width, info.height
        row.band_count, row.dtype = info.band_count, info.dtype
        row.crs_wkt, row.epsg, row.proj4 = info.crs_wkt, info.epsg, info.proj4
        row.geotransform = list(info.geotransform) if info.geotransform else None
        row.bounds_native = geo.bounds_native(info.width, info.height) if geo else None
        row.bounds_wgs84 = geo.bounds_wgs84(info.width, info.height) if geo else None
        row.gsd_cm = geo.gsd_cm(info.width, info.height) if geo else None
        row.source_sha256, row.stretch = sha, stretch.to_dict()
        row.status, row.error = "ready", None
    TILE_CACHE.drop_map(map_id)
    ctx.publish("maps.changed", {"map_ids": [map_id]})
    ctx.progress(1.0, f"{info.width} x {info.height} px ready")
    return {"map_id": map_id, "width": info.width, "height": info.height, "epsg": info.epsg}
