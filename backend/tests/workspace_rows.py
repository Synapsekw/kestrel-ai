"""Rows and rasters for the workspace tests (plan 2026-09-27-maps-b1)."""

from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from PIL import Image as PILImage
from pyproj import CRS
from rasterio.enums import ColorInterp, Resampling
from sqlalchemy import delete

from app.db.models import GeoMap, MapWorkspace
from app.maps.georef import Georef
from app.maps.startup import map_raster_path

BASE = "/api/v1/projects"


def add_map(
    handle,
    *,
    crs_wkt,
    geotransform,
    width: int,
    height: int,
    gsd_cm: float | None = None,
    captured_on=None,
    name: str = "ortho",
    status: str = "ready",
    raster: np.ndarray | None = None,
    mask_left: int = 0,
) -> str:
    """A GeoMap row; with `raster` ((3, h, w) uint8) also its display raster `map.tif`, with an
    internal mask (the left `mask_left` columns masked) and overviews 2 and 4, like map_import."""
    with handle.session() as s:
        row = GeoMap(
            name=name,
            status=status,
            source_path="D:/orthos/x.tif",
            source_size=1_400_000_000,
            width=width,
            height=height,
            band_count=3,
            dtype="uint8",
            crs_wkt=crs_wkt,
            epsg=CRS.from_user_input(crs_wkt).to_epsg() if crs_wkt else None,
            geotransform=list(geotransform) if geotransform else None,
            gsd_cm=gsd_cm,
            captured_on=captured_on,
        )
        if crs_wkt and geotransform:
            g = Georef(geotransform, crs_wkt)
            row.bounds_native = g.bounds_native(width, height)
            row.bounds_wgs84 = g.bounds_wgs84(width, height)
        s.add(row)
        s.flush()
        map_id = row.id
    if raster is not None:
        path = map_raster_path(handle, map_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        with rasterio.open(
            path,
            "w",
            driver="GTiff",
            width=width,
            height=height,
            count=3,
            dtype="uint8",
            crs=crs_wkt,
            transform=Affine.from_gdal(*geotransform),
            tiled=True,
            blockxsize=256,
            blockysize=256,
        ) as ds:
            ds.write(raster)
            mask = np.full((height, width), 255, np.uint8)
            mask[:, :mask_left] = 0
            ds.write_mask(mask)
            ds.build_overviews([2, 4], Resampling.average)
    return map_id


def add_local_surface(handle, spec, fn, **kw) -> str:
    """A ready CRS-less surface (`spec.crs_wkt` must be None)."""
    from volume_rows import add_surface

    assert spec.crs_wkt is None
    return add_surface(handle, spec, fn, **kw)


def set_frame(client, project_id: str, epsg: int) -> dict:
    r = client.put(f"{BASE}/{project_id}/map-workspace/frame", json={"kind": "crs", "epsg": epsg})
    assert r.status_code == 200, r.text
    return r.json()


def rgba(body: bytes) -> np.ndarray:
    """A PNG tile body as a (h, w, 4) uint8 array."""
    return np.asarray(PILImage.open(io.BytesIO(body)).convert("RGBA"))


def write_plan_tif(path: Path, data: np.ndarray, *, crs_wkt, transform: Affine) -> Path:
    """An RGBA drawing raster like M-B3's plan.tif: `data` is (4, h, w) uint8, band 4 the alpha."""
    _, height, width = data.shape
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=width,
        height=height,
        count=4,
        dtype="uint8",
        crs=crs_wkt,
        transform=transform,
    ) as ds:
        ds.write(data)
        ds.colorinterp = [ColorInterp.red, ColorInterp.green, ColorInterp.blue, ColorInterp.alpha]
    return path


def set_site_frame(handle, crs_wkt: str | None) -> None:
    """The map workspace's one row (map spec §6) written straight into the project DB: a site frame
    in `crs_wkt`, or the local-metres frame for None (M-B5's tests)."""
    with handle.session() as s:
        s.execute(delete(MapWorkspace))
        s.add(
            MapWorkspace(
                frame_kind="crs" if crs_wkt else "local",
                crs_wkt=crs_wkt,
                epsg=CRS.from_user_input(crs_wkt).to_epsg() if crs_wkt else None,
                state={},
                planned_surveys=[],
            )
        )
