"""Which reader a drawing file needs (spec §8.2), the DWG refusal and the PDFium check (§14).

Codes follow M-C0's contract: 422 `validation_error` with details.reason `dwg` | `extension` (as S3's
design import does), 422 `pdf_unavailable` when PDFium did not load, 404 for a missing file.
"""

from __future__ import annotations

from pathlib import Path

from app.errors import AppError, not_found
from app.surfaces.design.detect import DWG_MESSAGE

# Extension -> format. Tasks 4, 10 and 11 add PDF, DXF and LandXML as their readers land.
FORMATS: dict[str, str] = {
    ".png": "png",
    ".jpg": "jpg",
    ".jpeg": "jpg",
    ".tif": "tif",
    ".tiff": "tif",
    ".dxf": "dxf",
    ".xml": "landxml",
    ".landxml": "landxml",
    ".pdf": "pdf",
}


def _refuse(message: str, reason: str) -> AppError:
    return AppError("validation_error", message, 422, {"reason": reason})


def classify(path: Path) -> str:
    """The format of `path`. A missing (or relative) path is 404 first, whatever its extension (a
    missing file is 404, not 422: the contract's positive-data check forbids 422 on a valid body);
    an existing .dwg always gets the fix message."""
    if not path.is_absolute() or not path.is_file():
        raise not_found("drawing file", str(path))
    ext = path.suffix.lower()
    if ext == ".dwg":
        raise _refuse(DWG_MESSAGE, "dwg")
    if ext not in FORMATS:
        names = ", ".join(sorted({e.lstrip(".") for e in FORMATS}))
        raise _refuse(f"{path.name}: choose a drawing file ({names})", "extension")
    if ext == ".dxf":
        with path.open("rb") as f:
            if f.read(4) == b"AC10":
                raise _refuse(DWG_MESSAGE, "dwg")
    fmt = FORMATS[ext]
    if fmt == "pdf":
        from app.drawings import pdf

        reason = pdf.unavailable_reason()
        if reason is not None:
            raise AppError("pdf_unavailable", f"PDF import is unavailable in this build ({reason}).", 422)
    return fmt
