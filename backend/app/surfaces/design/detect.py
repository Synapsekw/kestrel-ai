"""Which reader a file needs, and the DWG refusal (spec §2 DWG, §8.1, §12)."""

from __future__ import annotations

from pathlib import Path

from app.errors import AppError, not_found

EXTENSIONS = {".tif": "geotiff", ".tiff": "geotiff", ".xml": "landxml", ".landxml": "landxml", ".dxf": "dxf"}
DWG_MESSAGE = (
    "DWG files can't be read. Open the drawing in your CAD program (or the free ODA File Converter) "
    "and save it as DXF, then import the DXF."
)


def _dwg() -> AppError:
    return AppError("validation_error", DWG_MESSAGE, 422, {"reason": "dwg"})


def classify(path: Path) -> str:
    """The format of `path`. Order matters: a .dwg always gets the fix message (even when missing);
    a missing file is 404, not 422 (the contract's positive-data check forbids 422 on a valid body).
    A relative path would resolve against the sidecar's working folder, so it is treated as missing."""
    ext = path.suffix.lower()
    if ext == ".dwg":
        raise _dwg()
    if not path.is_absolute() or not path.is_file():
        raise not_found("design file", str(path))
    if ext not in EXTENSIONS:
        raise AppError(
            "validation_error",
            f"{path.name}: choose a DEM GeoTIFF (.tif, .tiff), a LandXML file (.xml, .landxml) or a DXF",
            422,
            {"reason": "extension"},
        )
    if ext == ".dxf":
        with path.open("rb") as f:
            if f.read(4) == b"AC10":
                raise _dwg()
    return EXTENSIONS[ext]
