"""LandXML linework (spec §8.2 LandXML): a streamed iterparse that keeps linework only.

Breaklines (PntList3D/2D), PlanFeature and Alignment CoordGeom Line/Curve/Spiral/IrregularLine,
and each surface's outer boundary (<Boundary>, else the convex hull of its points; plan Ruling 10).
Every coordinate list is NORTHING FIRST (x = E = the second value). Curves are chorded at 0.05 m;
spirals are the chord Start -> PI -> End (Ruling 11). Surfaces themselves import as elevation via
S3. Memory stays flat: an element is cleared at its end unless its parent is a CoordGeom primitive
still to be read (Start/End/Center/PI/PntList are read at the primitive's own end), P/F containers
are cleared every 10 000 rows (as S3's reader does), and the hull keeps only its vertices.
"""

from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np

from app.drawings import runs, store
from app.drawings.inspected import Inspected
from app.jobs.cancellation import JobFailure
from app.surfaces.design.landxml import _detected, _local
from app.surfaces.design.units import LANDXML_UNITS, unit_to_m

MESSAGE = "Reading drawing"
SAGITTA_M = 0.05
HULL_BATCH = 200_000
CLEAR_EVERY = 10_000
CHECK_EVERY = 5_000
PRIMITIVES = ("Line", "Curve", "Spiral", "IrregularLine")
LAYER_COLOURS = {"Breaklines": "#f2b134", "Alignments": "#56c1ff", "Plan features": "#9be564"}
BOUNDARY_COLOUR = "#e0e0e0"


def _numbers(text: str | None) -> list[float]:
    try:
        return [float(v) for v in (text or "").split()]
    except ValueError:
        raise JobFailure(f"a coordinate reads '{(text or '').strip()[:60]}', not numbers") from None


def _pairs(text: str | None, dims: int) -> list[tuple[float, float]]:
    vals = _numbers(text)
    return [(vals[i + 1], vals[i]) for i in range(0, len(vals) - dims + 1, dims)]


def _point(el) -> tuple[float, float] | None:
    if el is None or len((el.text or "").split()) < 2:
        return None
    n, e = _numbers(el.text)[:2]
    return (e, n)


def _child(el, name: str):
    return next((c for c in el if _local(c.tag) == name), None)


def _arc(start, centre, end, ccw: bool, sagitta: float) -> list[tuple[float, float]]:
    r = math.hypot(start[0] - centre[0], start[1] - centre[1])
    a0 = math.atan2(start[1] - centre[1], start[0] - centre[0])
    a1 = math.atan2(end[1] - centre[1], end[0] - centre[0])
    sweep = (a1 - a0) % (2 * math.pi) if ccw else -((a0 - a1) % (2 * math.pi))
    if sweep == 0:
        sweep = 2 * math.pi if ccw else -2 * math.pi
    step = 2 * math.acos(1 - sagitta / r) if r > sagitta else math.pi / 2
    n = max(2, math.ceil(abs(sweep) / step))
    pts = [
        (centre[0] + r * math.cos(a0 + sweep * i / n), centre[1] + r * math.sin(a0 + sweep * i / n))
        for i in range(n)
    ]
    return [*pts, end]


class _Hull:
    """The running convex hull of a surface's points, in bounded memory."""

    def __init__(self):
        self.keep = np.zeros((0, 2))
        self.buf: list[tuple[float, float]] = []

    def add(self, p: tuple[float, float]) -> None:
        self.buf.append(p)
        if len(self.buf) >= HULL_BATCH:
            self._fold()

    def _fold(self) -> None:
        from scipy.spatial import ConvexHull, QhullError

        pts = np.vstack([self.keep, np.asarray(self.buf, float).reshape(-1, 2)])
        self.buf = []
        try:
            self.keep = pts[ConvexHull(pts).vertices] if len(pts) >= 3 else pts
        except QhullError:
            self.keep = pts  # collinear or coincident: no ring comes out of these

    def ring(self) -> np.ndarray | None:
        self._fold()
        if len(self.keep) < 3:
            return None
        return np.vstack([self.keep, self.keep[:1]])  # 2-D ConvexHull.vertices are counter-clockwise


class _Reader:
    def __init__(self, writer: runs.RunWriter):
        self.writer = writer
        self.layer_ids: dict[str, int] = {}
        self.counts: dict[str, int] = {}
        self.units: dict = {}
        self.cs: dict = {}
        self.sagitta = SAGITTA_M
        self.surface: str | None = None
        self.hull: _Hull | None = None
        self.has_boundary = False

    def add(self, layer: str, pts) -> None:
        if len(pts) < 2:
            return
        if layer not in self.layer_ids:
            self.layer_ids[layer], self.counts[layer] = len(self.layer_ids), 0
        self.writer.add(pts, self.layer_ids[layer])
        self.counts[layer] += 1

    def start(self, name: str, elem) -> None:
        if name == "Surface":
            self.surface, self.hull, self.has_boundary = elem.get("name") or "Surface", _Hull(), False

    def end(self, name: str, parent: str | None, stack: list[str], elem) -> None:
        if name in ("Metric", "Imperial") and parent == "Units":
            self.units = {"system": name, **elem.attrib}
            unit = LANDXML_UNITS.get(self.units.get("linearUnit", ""))
            if unit is not None:
                self.sagitta = SAGITTA_M / unit_to_m(unit)
        elif name == "CoordinateSystem" and parent == "LandXML":
            self.cs = dict(elem.attrib)
        elif name in ("PntList3D", "PntList2D") and parent in ("Breakline", "Boundary"):
            dims = 3 if name == "PntList3D" else 2
            if parent == "Breakline":
                self.add("Breaklines", _pairs(elem.text, dims))
            elif self.surface is not None:
                self.add(f"{self.surface} boundary", _pairs(elem.text, dims))
                self.has_boundary = True
        elif name == "P" and parent == "Pnts" and self.hull is not None:
            p = _point(elem)
            if p is not None:
                self.hull.add(p)
        elif name in PRIMITIVES and parent == "CoordGeom":
            self._primitive(name, "Alignments" if "Alignment" in stack else "Plan features", elem)
        elif name == "Surface":
            if not self.has_boundary and self.hull is not None:
                ring = self.hull.ring()
                if ring is not None:
                    self.add(f"{self.surface} hull", ring)
            self.surface, self.hull = None, None

    def _primitive(self, name: str, layer: str, elem) -> None:
        start, end = _point(_child(elem, "Start")), _point(_child(elem, "End"))
        if name == "Line" and start and end:
            self.add(layer, [start, end])
        elif name == "Curve" and start and end:
            centre = _point(_child(elem, "Center"))
            if centre is not None:
                self.add(layer, _arc(start, centre, end, elem.get("rot", "ccw") == "ccw", self.sagitta))
        elif name == "Spiral" and start and end:
            pi = _point(_child(elem, "PI"))
            self.add(layer, [start, pi, end] if pi else [start, end])
        elif name == "IrregularLine":
            pl = _child(elem, "PntList2D")
            if pl is None:
                pl = _child(elem, "PntList3D")
            if pl is not None:
                self.add(layer, _pairs(pl.text, 2 if _local(pl.tag) == "PntList2D" else 3))


def inspect_file(path: Path, idir: Path, *, progress, check_cancelled) -> Inspected:
    folder = store.lines_dir(idir)
    writer = runs.RunWriter(folder)
    reader = _Reader(writer)
    names: list[str] = []
    elems: list = []
    size, rows, ends = max(path.stat().st_size, 1), 0, 0
    try:
        with path.open("rb") as f:
            for event, elem in ET.iterparse(f, events=("start", "end")):
                name = _local(elem.tag)
                if event == "start":
                    names.append(name)
                    elems.append(elem)
                    reader.start(name, elem)
                    continue
                names.pop()
                elems.pop()
                parent = names[-1] if names else None
                reader.end(name, parent, names, elem)
                if parent not in PRIMITIVES and name != "LandXML":
                    elem.clear()
                if name in ("P", "F") and parent in ("Pnts", "Faces"):
                    rows += 1
                    if rows % CLEAR_EVERY == 0:
                        elems[-1].clear()  # drop the cleared rows the container still lists
                ends += 1
                if ends % CHECK_EVERY == 0:  # every element kind, not only TIN rows
                    check_cancelled()
                    progress(min(0.9, f.tell() / size), MESSAGE)
    except ET.ParseError as e:
        writer.abort()
        raise JobFailure(f"{path.name} is not valid XML ({e})") from None
    except BaseException:
        writer.abort()
        raise
    layer_names = list(reader.layer_ids)
    meta = writer.close(layers=layer_names)
    store.write_json(folder / "labels.json", [])
    if meta["runs"] == 0:
        raise JobFailure(f"{path.name}: no lines, arcs or text found")
    runs.runs_thumbnail(folder, store.page_thumb(idir, 1))
    detected = _detected(reader.units, reader.cs)
    hints = [f"EPSG:{detected.epsg} (LandXML CoordinateSystem)"] if detected.epsg else []
    if detected.crs_hint:
        hints.append(detected.crs_hint)
    layers = [
        {
            "name": n,
            "colour": LAYER_COLOURS.get(n, BOUNDARY_COLOUR),
            "entity_count": reader.counts[n],
            "visible_default": True,
        }
        for n in layer_names
    ]
    progress(1.0, MESSAGE)
    return Inspected(
        units=detected.horizontal_unit,
        units_source=detected.unit_source,
        crs_hint="; ".join(hints) or None,
        extent_src=meta["extent"],
        layers=layers,
    )
