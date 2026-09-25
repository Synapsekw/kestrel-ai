"""Tiny DXF files written with ezdxf at test time (spec §15.3 DXF)."""

from __future__ import annotations

from pathlib import Path

import ezdxf
import numpy as np


def new_doc(insunits: int = 6, version: str = "R2010"):
    doc = ezdxf.new(version)
    doc.header["$INSUNITS"] = insunits
    return doc


def save(doc, path: Path, *, binary: bool = False) -> Path:
    doc.saveas(path, fmt="bin" if binary else "asc")
    return path


def add_faces(msp, v: np.ndarray, t: np.ndarray, layer: str = "TIN") -> None:
    for tri in t:
        msp.add_3dface([tuple(v[i]) for i in tri], dxfattribs={"layer": layer})


def add_contours(
    msp, pts: np.ndarray, runs: np.ndarray, layer: str = "CONTOURS", kind: str = "polyline3d"
) -> None:
    for a, b in zip(runs[:-1], runs[1:], strict=True):
        ring = pts[a:b]
        if kind == "polyline3d":
            msp.add_polyline3d([tuple(p) for p in ring], dxfattribs={"layer": layer})
        else:
            msp.add_lwpolyline(
                [tuple(p[:2]) for p in ring], dxfattribs={"layer": layer, "elevation": float(ring[0, 2])}
            )


def inject_unknown(path: Path, dxftype: str, layer: str, owner: str, handle: str = "ABCDE") -> Path:
    """Put an entity ezdxf cannot interpret (a Civil 3D object) at the top of the ENTITIES section."""
    text = path.read_text("utf-8")
    marker = "  2\nENTITIES\n"
    i = text.index(marker) + len(marker)
    raw = f"  0\n{dxftype}\n  5\n{handle}\n330\n{owner}\n100\nAcDbEntity\n  8\n{layer}\n"
    path.write_text(text[:i] + raw + text[i:], "utf-8")
    return path
