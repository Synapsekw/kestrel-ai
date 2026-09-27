"""DXF drawings (spec §8.2 DXF): ezdxf `recover` (S3 §8.1 rules), INSERTs exploded through
virtual_entities() with layer-0 inheritance, every linear entity flattened by `ezdxf.path` at a sagitta
of 1 cm in metres, HATCH boundaries as outlines, TEXT/MTEXT as label points. Everything is in WCS
drawing coordinates, streamed into runs.RunWriter. The document is held in memory only between
readfile() and the end of the walk, and that load is admitted first (S3's DXF_RAM_FACTOR x file size).
"""

from __future__ import annotations

import math
from pathlib import Path

from app.drawings import runs, store
from app.drawings.inspected import Inspected, warning
from app.jobs.cancellation import JobFailure
from app.surfaces.design import admission
from app.surfaces.design.dxf import BINARY_SIGNATURE, DXF_RAM_FACTOR, _geodata_hint, _layer_of
from app.surfaces.design.units import INSUNITS, unit_to_m

MESSAGE = "Reading drawing"
SAGITTA_M = 0.01
CHECK_EVERY = 5_000
LINEAR = frozenset({"LINE", "LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE", "ELLIPSE", "SPLINE", "HATCH"})
TEXT = frozenset({"TEXT", "MTEXT", "ATTRIB"})


def _load(path: Path):
    import ezdxf
    from ezdxf import recover

    try:
        admission.admit(
            DXF_RAM_FACTOR * path.stat().st_size,
            f"Reading {path.name}",
            "Save only the layers you need to a new DXF (WBLOCK) and import that.",
        )
        with path.open("rb") as f:
            binary = f.read(len(BINARY_SIGNATURE)) == BINARY_SIGNATURE
        if binary:  # recover.readfile rejects binary DXF (S3 R5)
            doc = ezdxf.readfile(str(path))
            doc.audit()
            return doc
        doc, _ = recover.readfile(str(path))
        return doc
    except ezdxf.DXFStructureError as e:
        raise JobFailure(f"{path.name} can't be read as DXF: {e}") from None
    except OSError as e:
        raise JobFailure(f"{path.name} can't be opened ({e})") from None


def _hex(rgb) -> str:
    return "#{:02x}{:02x}{:02x}".format(*tuple(rgb)[:3])


def _layer_table(doc) -> dict[str, tuple[str, bool]]:
    from ezdxf.colors import aci2rgb, int2rgb

    table: dict[str, tuple[str, bool]] = {}
    for layer in doc.layers:
        try:
            tc = layer.dxf.get("true_color")
            aci = abs(int(layer.dxf.get("color", 7))) or 7
            colour = _hex(int2rgb(tc)) if tc is not None else _hex(aci2rgb(aci if aci <= 255 else 7))
            table[layer.dxf.name] = (colour, not (layer.is_off() or layer.is_frozen()))
        except Exception:
            table[layer.dxf.name] = ("#ffffff", True)
    return table


def _units(insunits: int) -> tuple[str | None, str, list[dict]]:
    if insunits == 0:
        return (
            "metre",
            "DXF $INSUNITS=0 (unitless; metres assumed)",
            [warning("units_assumed", "The drawing has no units; metres are assumed")],
        )
    unit = INSUNITS.get(insunits)
    if unit is None:
        return (
            None,
            f"DXF $INSUNITS={insunits} (not supported; choose the unit)",
            [warning("units_unknown", "The drawing's units are not supported; choose them when placing it")],
        )
    return unit.value, f"DXF $INSUNITS={insunits}", []


class _Flattener:
    def __init__(self, writer: runs.RunWriter, sagitta: float, check_cancelled):
        self.w, self.sagitta, self._check = writer, sagitta, check_cancelled
        self.layer_ids: dict[str, int] = {}
        self.counts: dict[str, int] = {}
        self.labels: list[dict] = []
        self.labels_dropped = self.unsupported = self._n = 0

    def _layer(self, name: str) -> int:
        if name not in self.layer_ids:
            self.layer_ids[name] = len(self.layer_ids)
            self.counts[name] = 0
        return self.layer_ids[name]

    def walk(self, entities, inherited: str | None = None) -> None:
        import ezdxf

        for e in entities:
            self._n += 1
            if self._n % CHECK_EVERY == 0:
                self._check()
            layer = _layer_of(e)
            if inherited is not None and layer == "0":
                layer = inherited
            kind = e.dxftype()
            try:
                if kind == "INSERT":
                    for ins in e.multi_insert() if e.mcount > 1 else (e,):
                        self.walk(ins.virtual_entities(), layer)
                    for attrib in e.attribs:
                        self._label(attrib, "ATTRIB", layer)
                elif kind in LINEAR:
                    self._lines(e, kind, layer)
                elif kind in TEXT:
                    self._label(e, kind, layer)
                else:
                    self.unsupported += 1
            except (ezdxf.DXFError, ValueError, TypeError, IndexError, ZeroDivisionError):
                self.unsupported += 1  # one broken entity is counted, not fatal

    def _lines(self, e, kind: str, layer: str) -> None:
        idx, drew = self._layer(layer), False
        for pts in self._runs_of(e, kind):
            if len(pts) >= 2:
                self.w.add(pts, idx)
                drew = True
        if drew:
            self.counts[layer] += 1

    def _runs_of(self, e, kind: str):
        """Vertex lists in WCS. Arcs, circles and bulges are chorded on the true circle (ezdxf.path
        would chord its cubic-Bezier approximation, which is off the circle by ~3e-4 r); everything
        else goes through ezdxf.path."""
        from ezdxf import path

        if kind in ("ARC", "CIRCLE"):
            return [[(v.x, v.y) for v in e.flattening(self.sagitta)]]
        bulged = _bulged_vertices(e, kind)
        if bulged is not None:
            return [self._bulge_run(e, *bulged)]
        paths = list(path.from_hatch(e)) if kind == "HATCH" else [path.make_path(e)]
        return [
            [(v.x, v.y) for v in sub.flattening(self.sagitta)]
            for p in paths
            for sub in (p.sub_paths() if p.has_sub_paths else (p,))
        ]

    def _bulge_run(self, e, pts: list[tuple[float, float, float]], closed: bool, elevation: float):
        from ezdxf.math import Vec3

        if closed and len(pts) > 1:
            pts = [*pts, pts[0]]
        out: list[tuple[float, float]] = [(pts[0][0], pts[0][1])]
        for (x1, y1, b), (x2, y2, _) in zip(pts[:-1], pts[1:], strict=True):
            out.extend(_bulge_segment((x1, y1), (x2, y2), b, self.sagitta))
        ocs = e.ocs()
        if not ocs.transform:
            return out
        return [(v.x, v.y) for v in ocs.points_to_wcs(Vec3(x, y, elevation) for x, y in out)]

    def _label(self, e, kind: str, layer: str) -> None:
        from ezdxf.math import Vec3

        if len(self.labels) >= runs.LABEL_CAP:
            self.labels_dropped += 1
            return
        if kind == "MTEXT":
            text, insert = e.plain_text(split=False), Vec3(e.dxf.insert)
            height, rotation = float(e.dxf.get("char_height", 1.0)), float(e.get_rotation())
        else:
            text, insert = e.plain_text(), e.ocs().to_wcs(Vec3(e.dxf.insert))
            height, rotation = float(e.dxf.get("height", 1.0)), float(e.dxf.get("rotation", 0.0))
        text = text.strip()
        if not text:
            return
        self._layer(layer)
        self.counts[layer] += 1
        self.labels.append(
            {
                "text": text[:200],
                "x": float(insert.x),
                "y": float(insert.y),
                "height": height,
                "rotation": rotation,
                "layer": layer,
            }
        )


def _bulged_vertices(e, kind: str):
    """(OCS (x, y, bulge) list, closed, elevation) for a 2D polyline with any bulge, else None."""
    if kind == "LWPOLYLINE":
        pts = [(float(x), float(y), float(b)) for x, y, b in e.get_points("xyb")]
        closed, elevation = e.closed, float(e.dxf.get("elevation", 0.0))
    elif kind == "POLYLINE" and e.get_mode() == "AcDb2dPolyline":
        pts = [(float(v.dxf.location.x), float(v.dxf.location.y), float(v.dxf.bulge)) for v in e.vertices]
        closed, elevation = e.is_closed, float(e.dxf.elevation.z)
    else:
        return None
    if not any(b for _, _, b in pts):
        return None
    return pts, closed, elevation


def _bulge_segment(p1, p2, bulge: float, sagitta: float) -> list[tuple[float, float]]:
    """The vertices after p1 of the segment p1 -> p2: a chord for bulge 0, else the arc of included
    angle 4 atan(bulge) (positive = counter-clockwise) chorded so no chord is further than `sagitta`
    from the arc."""
    if not bulge or p1 == p2:
        return [p2]
    from ezdxf.math import bulge_center, bulge_radius

    c, r = bulge_center(p1, p2, bulge), bulge_radius(p1, p2, bulge)
    sweep = 4.0 * math.atan(bulge)
    step = 2.0 * math.acos(1.0 - sagitta / r) if sagitta < r else math.pi
    n = max(1, math.ceil(abs(sweep) / step))
    a0 = math.atan2(p1[1] - c.y, p1[0] - c.x)
    arc = [
        (c.x + r * math.cos(a0 + sweep * k / n), c.y + r * math.sin(a0 + sweep * k / n)) for k in range(1, n)
    ]
    return [*arc, p2]


def _progressing(entities, total: int, progress):
    for i, e in enumerate(entities):
        if i % CHECK_EVERY == 0:
            progress(0.1 + 0.75 * i / total, MESSAGE)
        yield e


def inspect_file(path: Path, idir: Path, *, progress, check_cancelled) -> Inspected:
    doc = _load(path)
    check_cancelled()
    progress(0.1, MESSAGE)
    units, units_source, warns = _units(int(doc.header.get("$INSUNITS", 0) or 0))
    msp = doc.modelspace()
    hint, table = _geodata_hint(msp), _layer_table(doc)
    folder = store.lines_dir(idir)
    writer = runs.RunWriter(folder)
    flat = _Flattener(writer, SAGITTA_M / unit_to_m(units or "metre"), check_cancelled)
    try:
        flat.walk(_progressing(msp, max(len(msp), 1), progress))
    except RecursionError:
        writer.abort()
        raise JobFailure(f"{path.name} has a circular block reference and can't be read") from None
    except BaseException:
        writer.abort()
        raise
    del doc, msp
    names = list(flat.layer_ids)  # index order == runlayer values
    meta = writer.close(layers=names)
    store.write_json(folder / "labels.json", flat.labels)
    if meta["runs"] == 0 and not flat.labels:
        raise JobFailure(f"{path.name}: no lines, arcs or text found")
    extent = runs.extent_with_labels(meta["extent"], flat.labels)
    if extent[0] == extent[2] and extent[1] == extent[3]:
        raise JobFailure(f"{path.name} is an empty drawing (everything sits at one point)")
    if meta["runs"]:
        runs.runs_thumbnail(folder, store.page_thumb(idir, 1))
    if flat.unsupported:
        warns.append(
            warning(
                "unsupported_entities", f"{flat.unsupported} entities are not lines or text and were skipped"
            )
        )
    if flat.labels_dropped:
        warns.append(
            warning(
                "labels_capped", f"{flat.labels_dropped} texts past the first {runs.LABEL_CAP} were dropped"
            )
        )
    if hint:
        warns.append(
            warning("geodata_unverified", f"{hint}: a coordinate system name the file carries, not verified")
        )
    layers = [
        {
            "name": n,
            "colour": table.get(n, ("#ffffff", True))[0],
            "entity_count": flat.counts[n],
            "visible_default": table.get(n, ("#ffffff", True))[1],
        }
        for n in names
    ]
    progress(1.0, MESSAGE)
    return Inspected(
        units=units,
        units_source=units_source,
        crs_hint=hint,
        extent_src=extent,
        layers=layers,
        warnings=warns,
    )
