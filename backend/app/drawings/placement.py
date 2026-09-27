"""createDrawing's checks and the georef a `crs` or `embedded` placement produces (spec §8.2
"Placement at build time"; M-C0 `DrawingPlacementInput`, codes invalid_placement / validation_error)."""

from __future__ import annotations

from pathlib import Path

from pyproj import CRS
from pyproj.exceptions import CRSError

from app.drawings import store
from app.errors import AppError
from app.surfaces.design.units import UnsupportedCrsUnit, xy_scale

VECTOR = ("dxf", "landxml")
RASTER = ("png", "jpg", "tif")


def _placement(message: str) -> AppError:
    return AppError("invalid_placement", message, 422)


def _crs(text: str) -> CRS:
    try:
        return CRS.from_user_input(text)
    except CRSError:
        raise _placement(f"{text} is not a coordinate system this app knows") from None


def check(insp: dict, body, idir: Path) -> dict:
    fmt = insp["format"]
    page = dpi = None
    if fmt == "pdf":
        from app.drawings.pdf import DEFAULT_DPI, effective_dpi  # Task 4's module (preflight F1)

        page = body.page or 1
        sizes = store.read_json(idir / "pages.json")["pages"]
        if page > len(sizes):
            raise AppError("validation_error", f"this PDF has {len(sizes)} page(s)", 422, {"reason": "page"})
        p = sizes[page - 1]
        dpi = effective_dpi(body.dpi or DEFAULT_DPI, p["width_pt"], p["height_pt"])
    elif body.page not in (None, 1):
        raise AppError("validation_error", "only a PDF has pages", 422, {"reason": "page"})
    layers = None
    if body.layers is not None:
        names = {layer["name"] for layer in insp.get("layers", [])}
        unknown = [n for n in body.layers if n not in names]
        if unknown:
            raise AppError(
                "validation_error",
                f"there is no layer {unknown[0]!r} in this file",
                422,
                {"reason": "layers"},
            )
        layers = list(dict.fromkeys(body.layers))
    pl = body.placement
    placement: dict = {"method": pl.method, "crs_wkt": None, "epsg": None, "units": None}
    if pl.method == "crs":
        if fmt not in VECTOR:
            raise _placement("only DXF and LandXML drawings are placed by a coordinate system")
        if not pl.crs:
            raise _placement("choose the drawing's coordinate system")
        crs = _crs(pl.crs)
        if not crs.is_projected:
            raise _placement(f"{crs.name} is not projected; choose a CRS in metres or feet")
        units = pl.units or insp.get("units")
        if units is None:
            raise _placement("choose the drawing's units")
        try:
            xy_scale(units, crs)  # preflight F17: an unsupported axis unit is refused here, not in the job
        except UnsupportedCrsUnit as e:
            raise _placement(str(e)) from None
        placement.update(crs_wkt=crs.to_wkt(), epsg=crs.to_epsg(), units=units)
    elif pl.method == "embedded":
        emb = insp.get("embedded")
        if fmt not in RASTER or emb is None:
            raise _placement("this file carries no placement of its own")
        if pl.crs:
            crs = _crs(pl.crs)
            placement.update(crs_wkt=crs.to_wkt(), epsg=crs.to_epsg())
        elif emb["crs_wkt"] is not None:
            placement.update(crs_wkt=emb["crs_wkt"], epsg=emb["epsg"])
        else:
            raise _placement("a world file has no coordinate system; choose one")
    return {"page": page, "dpi": dpi, "layers": layers, "placement": placement}


def georef_for(placement: dict, insp: dict) -> dict | None:
    """The DrawingGeoref of a crs/embedded placement: the drawing's own CRS is the destination."""
    method = placement["method"]
    if method == "none":
        return None
    if method == "crs":
        s = xy_scale(placement["units"], CRS.from_wkt(placement["crs_wkt"]))
        transform = [s, 0.0, 0.0, 0.0, s, 0.0]
    else:
        transform = [float(v) for v in insp["embedded"]["transform"]]
    return {
        "method": method,
        "crs_wkt": placement["crs_wkt"],
        "epsg": placement["epsg"],
        "model": None,
        "points": [],
        "dst_crs_wkt": placement["crs_wkt"],
        "transform": transform,
        "rmse_m": None,
        "residuals_m": [],
        "warnings": [],
    }
