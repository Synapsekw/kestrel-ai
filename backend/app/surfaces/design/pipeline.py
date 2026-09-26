"""The pipeline shared by the preview and the build (spec §4.1: they differ only in the grid)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.jobs.cancellation import JobFailure
from app.surfaces.design import admission, codes, store, triangulate
from app.surfaces.design import placement as placing
from app.surfaces.design.codes import DesignNote

SAMPLE_POINTS = 20_000


class Blocked(Exception):
    """Block-level warnings found before rasterising; the preview reports them, the build refuses."""

    def __init__(self, notes: list[DesignNote]):
        super().__init__("; ".join(n.message for n in notes))
        self.notes = notes


@dataclass(frozen=True)
class Selection:
    fmt: str
    geometry: str  # faces | points | raster
    candidates: list[dict]


@dataclass
class Tin:
    vertices: np.ndarray
    triangles: np.ndarray
    counts: dict
    method: str  # tin | delaunay


def select(inspection: dict, candidate_ids: list[str]) -> Selection:
    by_id = {c["id"]: c for c in inspection["candidates"]}
    cands = [by_id[c] for c in candidate_ids]
    blocks = [DesignNote.from_json(n) for c in cands for n in c["notes"] if n["level"] == "block"]
    if blocks:
        raise Blocked(blocks)
    if inspection["format"] == "geotiff":
        return Selection("geotiff", "raster", cands)
    kinds = {c["geometry"] for c in cands}
    if kinds in ({"faces"}, {"points"}):
        return Selection(inspection["format"], kinds.pop(), cands)
    raise Blocked(
        [
            codes.block(
                "mixed_geometry",
                "the selection mixes 3D faces with lines or points; import them as two surfaces",
            )
        ]
    )


def load_geometry(idir: Path, sel: Selection, p: placing.Placement, *, check_cancelled):
    """Placed vertices of every selected candidate, with faces (offset per candidate) or run offsets."""
    arrays = [store.read_candidate(store.candidate_dir(idir, c["id"])) for c in sel.candidates]
    n_pts = sum(len(a.points) for a in arrays)
    n_faces = sum(len(a.faces) for a in arrays if a.faces is not None)
    admission.admit(
        admission.tin_bytes(n_pts, n_faces) + admission.RASTERISE_BYTES,
        f"The design's {n_pts:,} points and {n_faces:,} triangles",
        "Select fewer layers, or split the design into smaller files.",
    )
    if n_pts > np.iinfo(np.int32).max:
        raise JobFailure(
            f"The design has {n_pts:,} points, more than a triangle index can address. "
            "Select fewer layers, or split the design into smaller files."
        )
    # Faces are built in int32 straight into one preallocated array (12 B per face, as admitted),
    # never through an int64 copy per candidate plus a concatenate plus a cast.
    faces = np.empty((n_faces, 3), np.int32) if sel.geometry == "faces" else None
    verts, runs, base, f0 = [], [np.zeros(1, np.int64)], 0, 0
    for a in arrays:
        verts.append(placing.place_vertices(a.points, p, check_cancelled=check_cancelled))
        if faces is not None:
            f1 = f0 + len(a.faces)
            faces[f0:f1] = a.faces
            faces[f0:f1] += np.int32(base)
            f0 = f1
        else:
            runs.append(np.asarray(a.runs[1:], dtype=np.int64) + base)
        base += len(a.points)
    del arrays  # release the memory maps
    v = np.concatenate(verts) if verts else np.zeros((0, 3))
    if faces is not None:
        return v, faces, None
    return v, None, np.concatenate(runs)


def triangulate_points(v, runs, *, grid_cell: float, out_cell: float, max_edge_m, check_cancelled) -> Tin:
    try:
        t = triangulate.triangulate(
            v,
            runs,
            spacing=2 * grid_cell,
            max_edge_m=max_edge_m,
            auto_floor=10 * out_cell,
            check_cancelled=check_cancelled,
        )
    except triangulate.NothingToTriangulate as e:
        raise Blocked([codes.block("nothing_to_triangulate", str(e))]) from None
    counts = {
        "long_edges_removed": int(t.long_edges_removed),
        "max_edge_m": float(t.max_edge_m),
        "duplicate_points": int(t.duplicate_positions),
    }
    return Tin(t.vertices, t.triangles, counts, "delaunay")


def file_samples(idir: Path, sel: Selection) -> np.ndarray | None:
    """At most 20 000 cached vertices in file units, for the placement hypotheses (spec §10)."""
    if sel.geometry == "raster" or not sel.candidates:
        return None
    budget = max(1, SAMPLE_POINTS // len(sel.candidates))  # per candidate, so the total stays <= 20 000
    parts = []
    for c in sel.candidates:
        pts = store.read_candidate(store.candidate_dir(idir, c["id"])).points
        step = max(1, -(-len(pts) // budget))  # ceil: ceil(len / step) <= budget
        parts.append(np.array(pts[::step], dtype=np.float64))
        del pts
    return np.concatenate(parts)


def file_bounds(sel: Selection) -> tuple[float, float, float, float]:
    b = np.array([c["bounds_file"] for c in sel.candidates], dtype=np.float64)
    return float(b[:, 0].min()), float(b[:, 1].min()), float(b[:, 2].max()), float(b[:, 3].max())
