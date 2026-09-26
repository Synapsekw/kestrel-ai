"""DEM GeoTIFF inspection (spec §6 Inspect): one band, georeferenced, nodata or sentinel, thumbnail."""

from __future__ import annotations

import math
import warnings
from pathlib import Path

import numpy as np
from pyproj import CRS

from app.jobs.cancellation import JobFailure
from app.surfaces import grid
from app.surfaces.design import codes, store, thumbs
from app.surfaces.design.inspection import Candidate, Detected, InspectResult
from app.surfaces.design.placement import raster_envelope
from app.surfaces.design.units import FEET, horizontal_crs, unit_from_factor

SENTINELS = (-9999.0, -32767.0, -32768.0, -3.4028235e38)
DECIMATED_SIDE = 1024
MESSAGE = "Reading design file"


def _sentinel(values: np.ndarray) -> float | None:
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return None
    low = float(finite.min())
    for s in SENTINELS:
        if math.isclose(low, s, rel_tol=1e-7, abs_tol=1e-9):
            return s
    return None


def _vertical_unit(crs: CRS | None) -> tuple[str, str]:
    """Spec §5 defaults: the vertical CRS unit if compound, else a foot horizontal unit, else metre."""
    if crs is None:
        return "metre", "none"
    if crs.is_compound and len(crs.sub_crs_list) > 1:
        u = unit_from_factor(crs.sub_crs_list[1].axis_info[0].unit_conversion_factor)
        return (u.value if u else "metre"), "vertical CRS unit"
    h = horizontal_crs(crs)
    if h.is_projected:
        u = unit_from_factor(h.axis_info[0].unit_conversion_factor)
        if u in FEET:
            return u.value, "CRS axis unit (foot)"
    return "metre", "CRS axis unit"


def inspect_file(path: Path, idir: Path, *, progress, check_cancelled) -> InspectResult:
    import rasterio
    from rasterio.enums import MaskFlags, Resampling
    from rasterio.errors import NotGeoreferencedWarning, RasterioIOError

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", NotGeoreferencedWarning)
            src = rasterio.open(path)
    except RasterioIOError as e:
        raise JobFailure(f"{path.name} is not a readable raster ({e})") from None
    with src:
        if src.count != 1:
            if src.dtypes[0] == "uint8" and src.count in (3, 4):
                raise JobFailure(
                    "this is an image (an orthomosaic?), not a height model — import it under Maps"
                )
            raise JobFailure(f"{path.name} has {src.count} bands; a height model has exactly one")
        t = src.transform
        if t.is_identity:
            raise JobFailure(f"{path.name} has no georeferencing (no geotransform); a design DEM needs one")
        declared = src.nodata
        has_mask = MaskFlags.per_dataset in src.mask_flag_enums[0]
        scale = float(src.scales[0] or 1.0)
        offset = float(src.offsets[0] or 0.0)
        factor = min(1.0, DECIMATED_SIDE / max(src.width, src.height))
        h, w = max(1, round(src.height * factor)), max(1, round(src.width * factor))
        check_cancelled()
        raw = src.read(1, out_shape=(h, w), resampling=Resampling.nearest, masked=True)
        data = raw.astype(np.float64).filled(np.nan)
        notes, sentinel = [], None
        if declared is None and not has_mask:
            sentinel = _sentinel(data)
            if sentinel is not None:
                notes.append(
                    codes.warn(
                        "sentinel_nodata", f"cells at {sentinel:g} look like 'no data' and are left out"
                    )
                )
                data[np.isclose(data, sentinel, rtol=1e-7, atol=1e-9)] = np.nan
            else:
                notes.append(
                    codes.info(
                        "nodata_unknown",
                        "the file declares no 'no data' value: every cell counts as a height",
                    )
                )
        z = data * scale + offset
        cell_x, cell_y = math.hypot(t.a, t.d), math.hypot(t.b, t.e)
        shade = grid.hillshade(z.astype(np.float32), cell_x * src.width / w, cell_y * src.height / h)
        thumbs.shade_thumbnail(shade, store.thumb_path(idir, "c0"))
        # Each level below the inspection dir is created with parents=False (spec §3 store.py note,
        # mirrored by CandidateWriter and thumbs.py): a reader still running after the inspection
        # was deleted must raise FileNotFoundError, not silently recreate the folder the delete
        # just removed.
        cdir = store.candidate_dir(idir, "c0")
        cdir.parent.mkdir(parents=False, exist_ok=True)
        cdir.mkdir(parents=False, exist_ok=True)
        store.write_json(cdir / "meta.json", {"geometry": "raster"})
        crs = CRS.from_wkt(src.crs.to_wkt()) if src.crs else None
        valid = z[np.isfinite(z)]
        # A declared NaN nodata (a float surface) needs no value: masked reads already give NaN, and
        # NaN must never reach a JSON response (Starlette refuses non-finite floats).
        nodata = float(declared) if declared is not None and not math.isnan(declared) else sentinel
        candidate = Candidate(
            id="c0",
            kind="dem",
            name="band 1",
            geometry="raster",
            bounds_file=list(raster_envelope(t, src.width, src.height)),
            z_min=float(valid.min()) if valid.size else None,
            z_max=float(valid.max()) if valid.size else None,
            point_count=0,
            face_count=0,
            entity_counts={},
            default_selected=True,
            notes=notes,
            raster={
                "width": src.width,
                "height": src.height,
                "cell_x": cell_x,
                "cell_y": cell_y,
                "dtype": src.dtypes[0],
                "nodata": nodata,
                "band_count": 1,
            },
        )
        rotated = t.b != 0 or t.d != 0
    vertical, source = _vertical_unit(crs)
    detected = Detected(
        None,
        vertical,
        source,
        crs_wkt=crs.to_wkt() if crs else None,
        epsg=crs.to_epsg() if crs else None,
        crs_source="GeoTIFF CRS" if crs else None,
    )
    progress(1.0, MESSAGE)
    internal = {
        "nodata": nodata,
        "sentinel": sentinel is not None,
        "mask": has_mask,
        "scale": scale,
        "offset": offset,
        "rotated": rotated,
    }
    return InspectResult(detected, [candidate], internal)
