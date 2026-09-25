"""DXF reader (spec §8.1): ezdxf `recover`, one candidate per layer, faces or vertex runs.

INSERTs are expanded recursively through virtual_entities() with their transformation; an entity
on layer 0 inside a block counts on the INSERT's layer (the AutoCAD rule). The whole document is
held in memory, so the load is admitted first at DXF_RAM_FACTOR x the file size.
"""

from __future__ import annotations

import re
from array import array
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from app.jobs.cancellation import JobFailure
from app.surfaces.design import admission, codes, store, thumbs
from app.surfaces.design.inspection import Candidate, Detected, InspectResult, candidate_from_meta
from app.surfaces.design.units import INSUNITS

DXF_RAM_FACTOR = 12  # asserted by test_the_ram_factor_holds_on_a_20_mb_dxf
ENTITY_KEYS = (
    "3dface",
    "mesh",
    "polyface",
    "polymesh",
    "polyline_3d",
    "polyline_2d",
    "lwpolyline",
    "line",
    "point",
    "unsupported",
)
CHECK_EVERY = 5_000
MESSAGE = "Reading design file"
# R5: recover.readfile rejects this signature; ezdxf.readfile handles it.
BINARY_SIGNATURE = b"AutoCAD Binary DXF\r\n\x1a\x00"


@dataclass
class _Layer:
    counts: dict = field(default_factory=lambda: dict.fromkeys(ENTITY_KEYS, 0))
    face_pts: array = field(default_factory=lambda: array("d"))
    face_idx: array = field(default_factory=lambda: array("q"))
    run_pts: array = field(default_factory=lambda: array("d"))
    run_len: array = field(default_factory=lambda: array("q"))
    aecc: int = 0
    chorded: int = 0

    def add_faces(self, verts, tris) -> None:
        base = len(self.face_pts) // 3
        for v in verts:
            self.face_pts.extend((float(v[0]), float(v[1]), float(v[2])))
        for a, b, c in tris:
            self.face_idx.extend((base + a, base + b, base + c))

    def add_run(self, verts) -> None:
        for v in verts:
            self.run_pts.extend((float(v[0]), float(v[1]), float(v[2])))
        self.run_len.append(len(verts))


def _fan(face) -> list[tuple[int, int, int]]:
    face = list(face)
    return [(face[0], face[i], face[i + 1]) for i in range(1, len(face) - 1)]


def _quad(v) -> list[tuple[int, int, int]]:
    """A quad split along its shorter 3D diagonal (spec §8.1 table)."""
    return [(0, 1, 2), (0, 2, 3)] if v[0].distance(v[2]) <= v[1].distance(v[3]) else [(0, 1, 3), (1, 2, 3)]


def _to_wcs(e, pts: list) -> list:
    from ezdxf.math import Vec3

    if Vec3(e.dxf.get("extrusion", (0, 0, 1))).isclose(Vec3(0, 0, 1)):
        return pts
    return list(e.ocs().points_to_wcs(pts))


def _layer_of(e) -> str:
    """R6: a Civil 3D AECC_* object loads as DXFTagStorage; e.dxf.get("layer", ...) raises
    DXFAttributeError outside any try. Fall back to the raw AcDbEntity subclass tag (group code 8)."""
    try:
        return e.dxf.get("layer", "0")
    except Exception:
        try:
            return e.xtags.get_subclass("AcDbEntity").get_first_value(8, "0")
        except Exception:
            return "0"


class _Walker:
    def __init__(self, check_cancelled):
        self.layers: dict[str, _Layer] = defaultdict(_Layer)
        self._check = check_cancelled
        self._n = 0

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
                    self.walk(e.virtual_entities(), layer)
                else:
                    self._one(e, kind, self.layers[layer])
            except (ezdxf.DXFError, ValueError, IndexError, ZeroDivisionError):
                self.layers[layer].counts["unsupported"] += 1  # one broken entity is counted, not fatal

    def _one(self, e, kind: str, acc: _Layer) -> None:
        from ezdxf.math import Vec3
        from ezdxf.render import MeshBuilder

        if kind == "3DFACE":
            vs = [Vec3(e.dxf.vtx0), Vec3(e.dxf.vtx1), Vec3(e.dxf.vtx2), Vec3(e.dxf.vtx3)]
            if vs[3].isclose(vs[2]):
                acc.add_faces(vs[:3], [(0, 1, 2)])
            else:
                acc.add_faces(vs, _quad(vs))
            acc.counts["3dface"] += 1
        elif kind == "MESH":
            acc.add_faces([Vec3(v) for v in e.vertices], [t for f in e.faces for t in _fan(f)])
            acc.counts["mesh"] += 1
        elif kind == "POLYLINE" and e.is_poly_face_mesh:
            mb = MeshBuilder.from_polyface(e)
            acc.add_faces(mb.vertices, [t for f in mb.faces for t in _fan(f)])
            acc.counts["polyface"] += 1
        elif kind == "POLYLINE" and e.is_polygon_mesh:
            m, n = e.dxf.m_count, e.dxf.n_count
            vs = [Vec3(e.get_mesh_vertex((i, j)).dxf.location) for i in range(m) for j in range(n)]
            tris = []
            for i in range(m - 1):
                for j in range(n - 1):
                    q = [i * n + j, (i + 1) * n + j, (i + 1) * n + j + 1, i * n + j + 1]
                    tris += [tuple(q[k] for k in t) for t in _quad([vs[k] for k in q])]
            acc.add_faces(vs, tris)
            acc.counts["polymesh"] += 1
        elif kind == "POLYLINE" and e.is_3d_polyline:
            pts = [Vec3(v.dxf.location) for v in e.vertices]
            if e.is_closed and pts:
                pts.append(pts[0])
            acc.add_run(pts)
            acc.counts["polyline_3d"] += 1
        elif kind == "POLYLINE":
            elev = Vec3(e.dxf.elevation).z
            pts = [Vec3(v.dxf.location.x, v.dxf.location.y, elev) for v in e.vertices]
            acc.chorded += sum(1 for v in e.vertices if v.dxf.get("bulge", 0))
            if e.is_closed and pts:
                pts.append(pts[0])
            acc.add_run(_to_wcs(e, pts))
            acc.counts["polyline_2d"] += 1
        elif kind == "LWPOLYLINE":
            elev = float(e.dxf.get("elevation", 0.0))
            xyb = list(e.get_points("xyb"))
            pts = [Vec3(x, y, elev) for x, y, _ in xyb]
            acc.chorded += sum(1 for *_, b in xyb if b)
            if e.closed and pts:
                pts.append(pts[0])
            acc.add_run(_to_wcs(e, pts))
            acc.counts["lwpolyline"] += 1
        elif kind == "LINE":
            acc.add_run([Vec3(e.dxf.start), Vec3(e.dxf.end)])
            acc.counts["line"] += 1
        elif kind == "POINT":
            acc.add_run([Vec3(e.dxf.location)])
            acc.counts["point"] += 1
        else:
            acc.counts["unsupported"] += 1
            if kind.startswith("AECC") or kind == "ACAD_PROXY_ENTITY":
                acc.aecc += 1


def _geodata_hint(msp) -> str | None:
    try:
        geo = msp.get_geodata()
    except Exception:  # a malformed GEODATA object is only a missing hint
        return None
    xml = (geo.coordinate_system_definition or "") if geo is not None else ""
    m = re.search(r'<Alias[^>]*\bid="([^"]+)"', xml) or re.search(r'\bid="([^"]+)"', xml)
    return f"GEODATA: {m.group(1)}" if m else None


def _detected(insunits: int, measurement, hint: str | None) -> Detected:
    unit = INSUNITS.get(insunits)
    if insunits == 0:
        h, source = "metre", "DXF $INSUNITS=0 (unitless; metres assumed)"
    elif unit is not None:
        h, source = unit.value, f"DXF $INSUNITS={insunits}"
    else:
        h, source = None, f"DXF $INSUNITS={insunits} (not supported; choose the unit)"
    if measurement is not None:
        source += f"; $MEASUREMENT={int(measurement)} ({'metric' if int(measurement) == 1 else 'imperial'})"
    return Detected(h, h, source, crs_hint=hint)


def _notes(acc: _Layer, geometry: str, has_faces: bool, has_points: bool, meta: dict) -> list:
    notes = []
    if geometry == "none":
        notes.append(codes.block("empty_result", "nothing on this layer can be used as a surface"))
    elif meta["z_min"] == 0 and meta["z_max"] == 0:
        notes.append(codes.warn("no_heights", "all elevations are 0 — 2D linework?"))
    if acc.aecc:
        notes.append(
            codes.warn(
                "unsupported_entities",
                f"{acc.aecc} Civil 3D objects (AECC) can't be read — export the surface to LandXML, "
                "or explode it to 3D faces",
            )
        )
    if acc.chorded:
        notes.append(codes.info("chorded_arcs", f"{acc.chorded} arcs were chorded"))
    if has_faces and has_points:
        notes.append(codes.info("mixed_geometry", "this layer has 3D faces and lines; the lines are ignored"))
    return notes


def _usable(c: Candidate) -> bool:
    return not any(n.level == "block" or n.code == "no_heights" for n in c.notes)


def _candidates(layers: dict[str, _Layer], idir: Path, check_cancelled) -> list[Candidate]:
    out = []
    for i, name in enumerate(sorted(layers)):
        check_cancelled()
        acc = layers.pop(name)
        cid = f"c{i}"
        has_faces, has_points = len(acc.face_idx) > 0, len(acc.run_len) > 0
        geometry = "faces" if has_faces else "points" if has_points else "none"
        cdir = store.candidate_dir(idir, cid)
        w = store.CandidateWriter(cdir, "faces" if has_faces else "points")
        if has_faces:
            w.add_points(np.frombuffer(acc.face_pts, dtype=np.float64).reshape(-1, 3))
            w.add_faces(np.frombuffer(acc.face_idx, dtype=np.int64).reshape(-1, 3))
        elif has_points:
            w.add_runs(
                np.frombuffer(acc.run_pts, dtype=np.float64).reshape(-1, 3),
                np.frombuffer(acc.run_len, dtype=np.int64),
            )
        meta = w.close()
        out.append(
            candidate_from_meta(
                cid,
                "dxf_layer",
                name,
                meta,
                geometry=geometry,
                entity_counts=dict(acc.counts),
                notes=_notes(acc, geometry, has_faces, has_points, meta),
            )
        )
        points = store.read_candidate(cdir).points
        thumbs.plan_thumbnail(points, store.thumb_path(idir, cid))
        del points, acc
    faces = [c for c in out if c.geometry == "faces" and _usable(c)]
    for c in faces or [c for c in out if c.geometry == "points" and _usable(c) and c.z_max > c.z_min]:
        c.default_selected = True
    return out


def _progressing(entities, total: int, progress):
    for i, e in enumerate(entities):
        if i % CHECK_EVERY == 0:
            progress(0.1 + 0.7 * i / total, MESSAGE)
        yield e


def inspect_file(path: Path, idir: Path, *, progress, check_cancelled) -> InspectResult:
    import ezdxf
    from ezdxf import recover

    admission.admit(
        DXF_RAM_FACTOR * path.stat().st_size,
        f"Reading {path.name}",
        "Save only the surface layers to a new DXF (WBLOCK) and import that.",
    )
    progress(0.05, MESSAGE)
    try:
        with path.open("rb") as f:
            is_binary = f.read(len(BINARY_SIGNATURE)) == BINARY_SIGNATURE
        # R5: ezdxf 1.4.4's recover.readfile rejects binary DXF (DXFStructureError: invalid group
        # code "AutoCAD Binary DXF"); ezdxf.readfile handles the binary tag stream directly.
        if is_binary:
            doc = ezdxf.readfile(str(path))
        else:
            doc, _auditor = recover.readfile(str(path))
    except ezdxf.DXFStructureError as e:
        raise JobFailure(f"{path.name} can't be read as DXF: {e}") from None
    except OSError as e:
        raise JobFailure(f"{path.name} can't be opened ({e})") from None
    check_cancelled()
    msp = doc.modelspace()
    insunits = int(doc.header.get("$INSUNITS", 0) or 0)
    detected = _detected(insunits, doc.header.get("$MEASUREMENT"), _geodata_hint(msp))
    walker = _Walker(check_cancelled)
    walker.walk(_progressing(msp, max(len(msp), 1), progress))
    del doc, msp  # release the document before the candidates are written
    candidates = _candidates(walker.layers, idir, check_cancelled)
    progress(1.0, MESSAGE)
    return InspectResult(detected, candidates, internal={"insunits": insunits})
