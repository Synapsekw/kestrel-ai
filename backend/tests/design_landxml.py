"""Tiny LandXML files written from string templates at test time (spec §15.3 LandXML)."""

from __future__ import annotations

from pathlib import Path
from xml.sax.saxutils import quoteattr

import numpy as np
from designs import E0, N0, plane_z

NAMESPACES = {
    "1.0": "http://www.landxml.org/schema/LandXML-1.0",
    "1.1": "http://www.landxml.org/schema/LandXML-1.1",
    "1.2": "http://www.landxml.org/schema/LandXML-1.2",
    "2.0": "http://www.landxml.org/schema/LandXML-2.0",
}


def grid_tin(nx: int, ny: int, spacing: float = 1.0, e0: float = E0, n0: float = N0, z=plane_z):
    """(points as E, N, Z; faces as 0-based index triples) of a regular grid TIN."""
    e, n = np.meshgrid(e0 + np.arange(nx) * spacing, n0 + np.arange(ny) * spacing)
    pts = np.column_stack([e.ravel(), n.ravel(), z(e.ravel(), n.ravel())])
    i, j = np.meshgrid(np.arange(nx - 1), np.arange(ny - 1))
    a = (j * nx + i).ravel()
    faces = np.vstack([np.column_stack([a, a + 1, a + nx + 1]), np.column_stack([a, a + nx + 1, a + nx])])
    return pts, faces


def write_landxml(
    path: Path,
    surfaces: list[dict],
    *,
    version: str | None = "1.2",
    units: tuple[str, str, str | None] | None = ("Metric", "meter", None),
    crs: dict | None = None,
    order: str = "NEZ",
    units_after_crs: bool = False,
    bom: bool = False,
    crlf: bool = False,
) -> Path:
    """surfaces: [{"name", "points" (N x 3, E N Z), "faces" (M x 3, 0-based), optional "ids"
    (list, or "none" to omit the id attribute), "invisible" (face indices), "surf_type", "raw_points"
    (strings used verbatim as P texts)}]. `crs` defaults to {"epsgCode": "32639"}; pass {} for none."""
    crs = {"epsgCode": "32639"} if crs is None else crs
    xmlns = f' xmlns="{NAMESPACES[version]}"' if version else ""
    out = ['<?xml version="1.0" encoding="UTF-8"?>', f'<LandXML{xmlns} version="{version or "1.2"}">']
    unit_xml = ""
    if units:
        elev = f" elevationUnit={quoteattr(units[2])}" if units[2] else ""
        unit_xml = f"<Units><{units[0]} linearUnit={quoteattr(units[1])}{elev}/></Units>"
    crs_xml = (
        "<CoordinateSystem " + " ".join(f"{k}={quoteattr(v)}" for k, v in crs.items()) + "/>" if crs else ""
    )
    out += [crs_xml, unit_xml] if units_after_crs else [unit_xml, crs_xml]
    out.append("<Surfaces>")
    for s in surfaces:
        out.append(
            f'<Surface name={quoteattr(s["name"])}><Definition surfType="{s.get("surf_type", "TIN")}"><Pnts>'
        )
        pts = np.asarray(s.get("points", np.zeros((0, 3))))
        ids = s.get("ids") or list(range(1, len(pts) + 1))
        if "raw_points" in s:
            out += [f'<P id="{k + 1}">{t}</P>' for k, t in enumerate(s["raw_points"])]
        for k, (e, n, z) in enumerate(pts):
            a, b = (n, e) if order == "NEZ" else (e, n)
            attr = "" if ids == "none" else f' id="{ids[k]}"'
            out.append(f"<P{attr}>{a:.4f} {b:.4f} {z:.4f}</P>")
        out.append("</Pnts><Faces>")
        seq = list(range(1, len(pts) + 1)) if ids == "none" else ids
        for k, f in enumerate(s.get("faces", [])):
            flag = ' i="1"' if k in set(s.get("invisible", ())) else ""
            out.append(f"<F{flag}>{seq[f[0]]} {seq[f[1]]} {seq[f[2]]}</F>")
        out.append("</Faces></Definition></Surface>")
    out += ["</Surfaces>", "</LandXML>"]
    data = ("\r\n" if crlf else "\n").join(out).encode("utf-8")
    path.write_bytes((b"\xef\xbb\xbf" if bom else b"") + data)
    return path
