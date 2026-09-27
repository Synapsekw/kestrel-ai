"""Plain DSM/DTM GeoTIFF import, the request side (map workspace spec §7 steps 1-2, §14).

Everything here reads headers only -- the file's and the align-to surface's -- so `POST /elevations`
answers at once and never reads a pixel. The `elevation_import` job (jobs_elevation.py) calls
`read_header` and `plan` again, so a file that changed after the request fails with the same message.
The grid rules are S3's (`design/placement.py`): a projected metre CRS keeps the file's CRS on the
aligned lattice; a target adopts its CRS and cell, so `same_lattice(output, target)` holds.
"""

from __future__ import annotations

import math
import warnings
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from pyproj import CRS

from app.db.models import Surface
from app.errors import AppError
from app.maps.raster import _captured_on as date_from_tags
from app.projects.service import ProjectHandle
from app.surfaces import grid, service
from app.surfaces.build import LADDER
from app.surfaces.design import placement as placing
from app.surfaces.design.placement import PlacementBlocked, raster_envelope
from app.surfaces.paths import surface_path
from app.surfaces.schemas import ElevationImportRequest

NO_COORDINATES = "this elevation file has no coordinates"
IMAGE = "this is an image (an orthomosaic?), not a height model — import it under Maps"
DEGREES = (
    "the file's coordinates are in degrees: choose a surface to align to, so the elevation lands on "
    "a grid in metres"
)
NOT_METRES = (
    "the file's coordinates are not in metres: choose a surface to align to, so the elevation lands "
    "on a grid in metres"
)
NO_OVERLAP = "the file does not overlap the surface to align to; choose another surface, or none"
NO_TRANSFORM = (
    "the file's coordinates cannot be placed on the surface to align to; choose another surface, or none"
)
EXTENSION = "{name}: choose a .tif or .tiff DSM/DTM"
BYTES_PER_OUT_CELL = 4  # the float32 output, uncompressed (an upper bound)
BYTES_PER_SOURCE_CELL = 1  # the re-grid's uint8 validity band, uncompressed


class ElevationRefused(Exception):
    """A file the import cannot use: a 422 in the request, a readable job failure later."""

    def __init__(self, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.code, self.message, self.details = code, message, details or {}


@dataclass(frozen=True)
class Header:
    crs_wkt: str
    width: int
    height: int
    cell: float  # the shorter side of a source cell, in CRS units
    envelope: tuple[float, float, float, float]  # of the (possibly rotated) raster, in its CRS
    captured_on: date | None


@dataclass(frozen=True)
class Plan:
    header: Header
    placement: placing.Placement
    out: grid.GridSpec
    target: grid.GridSpec | None


def read_header(path: Path) -> Header:
    import rasterio
    from rasterio.errors import NotGeoreferencedWarning, RasterioIOError

    if not path.is_absolute() or not path.is_file():
        # A relative path would resolve against the sidecar's working folder, so it is treated as
        # missing even when a file of that name happens to exist there (S3's `design/detect.classify`).
        raise ElevationRefused(
            "source_missing", f"file not found at {path} — reconnect the drive or choose the file again"
        )
    if path.suffix.lower() not in (".tif", ".tiff"):
        raise ElevationRefused("validation_error", EXTENSION.format(name=path.name), {"reason": "extension"})
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", NotGeoreferencedWarning)
            src = rasterio.open(path)
    except RasterioIOError as e:
        raise ElevationRefused("not_elevation", f"{path.name} is not a readable raster ({e})") from None
    with src:
        if src.count != 1:
            if src.dtypes[0] == "uint8" and src.count in (3, 4):
                raise ElevationRefused("not_elevation", IMAGE)
            raise ElevationRefused(
                "not_elevation", f"{path.name} has {src.count} bands; a height model has exactly one"
            )
        t = src.transform
        if src.crs is None or t.is_identity:
            raise ElevationRefused("no_coordinates", NO_COORDINATES)
        return Header(
            crs_wkt=src.crs.to_wkt(),
            width=src.width,
            height=src.height,
            cell=min(math.hypot(t.a, t.d), math.hypot(t.b, t.e)),
            envelope=tuple(raster_envelope(t, src.width, src.height)),
            captured_on=date_from_tags(src.tags()),
        )


def default_cell(source_cell: float) -> float:
    """The smallest S2 ladder cell at least the source cell (a 3.1 cm Pix4D DSM -> 5 cm), so an
    imported DSM shares a lattice with the cloud DSMs; a source coarser than the ladder keeps its own."""
    return next((c for c in LADDER if c >= source_cell * (1 - 1e-9)), source_cell)


def align_target(handle: ProjectHandle, surface_id: str) -> grid.GridSpec:
    """The ready surface the output adopts the CRS and cell of: 404 unknown, 409 not ready (or its
    grid file is gone), 422 when it has no coordinates."""
    row = service.require_ready(handle, surface_id)
    path = surface_path(handle, surface_id)
    if not path.is_file():
        raise AppError("not_ready", f"surface {row.name} has no grid file; build or import it again", 409)
    if row.crs_wkt is None:
        raise AppError(
            "no_coordinates",
            f"surface {row.name} has no coordinates; choose another surface to align to",
            422,
        )
    with grid.open_surface(path) as reader:
        return reader.spec


def _overlaps(header: Header, target: grid.GridSpec) -> bool:
    from rasterio.warp import transform_bounds

    env = header.envelope
    try:
        same_crs = CRS.from_user_input(header.crs_wkt).equals(CRS.from_user_input(target.crs_wkt))
        if not same_crs:
            env = transform_bounds(header.crs_wkt, target.crs_wkt, *env, densify_pts=21)
    except Exception as e:
        # A local/engineering source (or target) CRS has no transformation to the other: GDAL and
        # pyproj raise a mix of internal error types for this, none of them worth naming one by one.
        # Keep it a readable 422, not a 500.
        raise ElevationRefused("no_overlap", NO_TRANSFORM) from e
    x0, y0, x1, y1 = target.bounds
    return env[0] < x1 and env[2] > x0 and env[1] < y1 and env[3] > y0


def _refused(e: PlacementBlocked) -> ElevationRefused:
    text = {"geographic_output": DEGREES, "non_metric_output": NOT_METRES}.get(e.note.code, e.note.message)
    return ElevationRefused(e.note.code, text)


def plan(
    path: Path, cell_size_m: float | None, target: grid.GridSpec | None, vertical_unit: str = "metre"
) -> Plan:
    """Header -> S3 Placement -> the output grid. With a target the cell is the target's."""
    from app.surfaces.design import dem_build

    header = read_header(path)
    if target is not None and not _overlaps(header, target):
        raise ElevationRefused("no_overlap", NO_OVERLAP)
    options = {
        "source_crs": header.crs_wkt,
        "vertical_unit": vertical_unit,
        "cell_size_m": None if target is not None else (cell_size_m or default_cell(header.cell)),
    }
    try:
        p = placing.resolve(options, "geotiff", target)
        out, _notes = placing.output_grid(dem_build.footprint(path, p), p)
    except PlacementBlocked as e:
        raise _refused(e) from None
    return Plan(header, p, out, target)


def create_elevation(
    handle: ProjectHandle,
    body: ElevationImportRequest,
    *,
    disk_free: Callable[[Path], int] | None = None,
) -> tuple[Surface, dict]:
    """The `building` dem row and its job params. Lookups (404/409) run before the file's 422s."""
    target = align_target(handle, body.align_to_surface_id) if body.align_to_surface_id else None
    path = Path(body.path)
    try:
        chosen = plan(path, body.cell_size_m, target)
    except ElevationRefused as e:
        raise AppError(e.code, e.message, 422, e.details) from None
    need = (
        BYTES_PER_OUT_CELL * chosen.out.width * chosen.out.height
        + BYTES_PER_SOURCE_CELL * chosen.header.width * chosen.header.height
    )
    free = (disk_free or service._disk_free)(handle.surfaces_dir)
    if free < need:
        raise AppError(
            "insufficient_disk",
            f"importing this elevation needs {need / 1e9:.1f} GB free on the project's drive; "
            f"{free / 1e9:.1f} GB is free",
            422,
        )
    with handle.session() as s:
        row = Surface(
            name=body.name,
            kind="dem",
            status="building",
            point_cloud_id=None,
            elevation_role=body.role,
            captured_on=body.captured_on or chosen.header.captured_on,
        )
        s.add(row)
        s.flush()
        s.expunge(row)
    params = {
        "surface_id": row.id,
        "path": str(path),
        "cell_size_m": None if target is not None else chosen.placement.cell_size,
        "align_to_surface_id": body.align_to_surface_id,
    }
    return row, params
