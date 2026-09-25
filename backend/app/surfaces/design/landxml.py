"""LandXML reader (spec §7.1): a streamed iterparse into the candidate cache.

Elements are matched by local name, so LandXML 1.0/1.1/1.2/2.0 and namespace-less files all read.
`P` holds northing, easting, elevation: each point is cached as (x = E, y = N, z). Memory stays flat:
values accumulate in `array` buffers flushed every 1 M rows, every element is cleared at its end,
and Pnts/Faces are cleared every 10 000 rows so iterparse's tree never holds the parsed children.
Python 3.11's bundled expat refuses entity-expansion attacks; ElementTree never resolves external
entities.
"""

from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from array import array
from pathlib import Path

import numpy as np
from pyproj import CRS
from pyproj.exceptions import CRSError

from app.jobs.cancellation import JobFailure
from app.surfaces.design import codes, store, thumbs
from app.surfaces.design.inspection import Detected, InspectResult, candidate_from_meta
from app.surfaces.design.units import LANDXML_UNITS

FLUSH_ROWS = 1_000_000
CLEAR_EVERY = 10_000
RESOLVE_CHUNK = 65_536  # faces per id-resolution chunk; == the spec's 64 k check_cancelled() cap
MESSAGE = "Reading design file"


def _local(tag) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _id(value: str, surface: str) -> int:
    try:
        return int(value)
    except ValueError:
        try:
            f = float(value)
        except ValueError:
            f = float("nan")
        if f == f and f.is_integer():
            return int(f)
        raise JobFailure(f"surface '{surface}': point id '{value}' is not a number") from None


class _Surface:
    """One <Surface>: points and raw face ids stream to disk; ids are resolved at its end."""

    def __init__(self, idir: Path, cid: str, name: str):
        self.cid, self.name = cid, name
        self.cdir = store.candidate_dir(idir, cid)
        self.writer = store.CandidateWriter(self.cdir, "faces")
        self._ids_f = (self.cdir / "ids.i64").open("wb")
        self._fids_f = (self.cdir / "faces_ids.i64").open("wb")
        self._pts, self._ids, self._fids = array("d"), array("q"), array("q")
        self.seq = 0
        self.invisible = 0
        self.surf_type = "TIN"
        self.containers: list = []
        self.finished = False  # guards close_files() against double-closing after finish()

    def add_point(self, text: str, pid: str | None) -> None:
        vals = text.split()
        if len(vals) < 3:
            raise JobFailure(f"surface '{self.name}' has points without elevations")
        try:
            n, e, z = float(vals[0]), float(vals[1]), float(vals[2])
        except ValueError:
            n = e = z = float("nan")
        if not (math.isfinite(n) and math.isfinite(e) and math.isfinite(z)):
            # The only place this JobFailure is built (ruling d): both the non-numeric text and
            # the not-finite (nan/inf) case land here.
            raise JobFailure(f"surface '{self.name}': a point reads '{text.strip()[:60]}', not three numbers")
        self._pts.extend((e, n, z))
        self.seq += 1
        self._ids.append(self.seq if pid is None else _id(pid, self.name))
        if len(self._ids) >= FLUSH_ROWS:
            self._flush()

    def add_face(self, text: str, invisible: bool) -> None:
        if invisible:
            self.invisible += 1
            return
        vals = text.split()
        if len(vals) < 3:
            raise JobFailure(f"surface '{self.name}': a face lists fewer than three points")
        self._fids.extend((_id(vals[0], self.name), _id(vals[1], self.name), _id(vals[2], self.name)))
        if len(self._fids) >= 3 * FLUSH_ROWS:
            self._flush()

    def clear_containers(self) -> None:
        for el in self.containers:
            el.clear()

    def _flush(self) -> None:
        if self._ids:
            self.writer.add_points(np.frombuffer(self._pts, dtype=np.float64).reshape(-1, 3))
            self._ids_f.write(self._ids.tobytes())
            self._pts, self._ids = array("d"), array("q")
        if self._fids:
            self._fids_f.write(self._fids.tobytes())
            self._fids = array("q")

    def close_files(self) -> None:
        """Close every buffer file this surface opened, however far parsing got (ruling c): a
        JobFailure or cancel raised mid-parse must not leave points.f64/faces.i32/ids.i64/
        faces_ids.i64 open, which would block deleting the inspection folder on Windows."""
        if self.finished:
            return
        self.finished = True
        for f in (self._ids_f, self._fids_f):
            if not f.closed:
                f.close()
        self.writer.close()

    def finish(self, check_cancelled) -> dict:
        self._flush()
        self._ids_f.close()
        self._fids_f.close()
        try:
            self._resolve(check_cancelled)
        finally:
            meta = self.writer.close()
            self.finished = True
            for name in ("ids.i64", "faces_ids.i64"):
                (self.cdir / name).unlink(missing_ok=True)
        return meta

    def _resolve(self, check_cancelled) -> None:
        """Face ids -> vertex indices with argsort + searchsorted (spec §7.1 "Resolving ids")."""
        ids = np.fromfile(self.cdir / "ids.i64", dtype=np.int64)
        order = np.argsort(ids, kind="stable")
        sorted_ids = ids[order]
        del ids
        dup = np.flatnonzero(sorted_ids[1:] == sorted_ids[:-1])
        if dup.size:
            raise JobFailure(f"surface '{self.name}': duplicate point id {int(sorted_ids[dup[0]])}")
        n = len(sorted_ids)
        with (self.cdir / "faces_ids.i64").open("rb") as f:
            while True:
                check_cancelled()
                chunk = np.fromfile(f, dtype=np.int64, count=3 * RESOLVE_CHUNK)
                if chunk.size == 0:
                    return
                pos = np.searchsorted(sorted_ids, chunk)
                pc = np.minimum(pos, max(n - 1, 0))
                bad = np.ones(chunk.size, bool) if n == 0 else (pos >= n) | (sorted_ids[pc] != chunk)
                if bad.any():
                    raise JobFailure(
                        f"surface '{self.name}': face refers to missing point {int(chunk[bad][0])}"
                    )
                self.writer.add_faces(order[pc].reshape(-1, 3))


def _detected(units: dict, cs: dict) -> Detected:
    lin, elev = units.get("linearUnit"), units.get("elevationUnit")
    h = LANDXML_UNITS.get(lin) if lin else None
    v = LANDXML_UNITS.get(elev) if elev else h
    source = f"LandXML <{units['system']} linearUnit={lin}>" if lin else "none"
    crs_wkt = epsg = crs_source = None
    if cs.get("epsgCode"):
        try:
            crs = CRS.from_epsg(int(cs["epsgCode"]))
            crs_wkt, epsg, crs_source = (
                crs.to_wkt(),
                int(cs["epsgCode"]),
                "LandXML <CoordinateSystem epsgCode>",
            )
        except (ValueError, CRSError):
            pass
    if crs_wkt is None and cs.get("ogcWktCode"):
        try:
            crs = CRS.from_wkt(cs["ogcWktCode"])
            crs_wkt, epsg, crs_source = crs.to_wkt(), crs.to_epsg(), "LandXML <CoordinateSystem ogcWktCode>"
        except CRSError:
            pass
    hint = [cs[k] for k in ("name", "horizontalCoordinateSystemName") if cs.get(k)]
    if cs.get("verticalDatum"):
        hint.append(f"vertical datum {cs['verticalDatum']}")
    return Detected(
        h.value if h else None,
        v.value if v else None,
        source,
        crs_wkt=crs_wkt,
        epsg=epsg,
        crs_source=crs_source,
        crs_hint="; ".join(hint) or None,
    )


def inspect_file(path: Path, idir: Path, *, progress, check_cancelled) -> InspectResult:
    size = max(path.stat().st_size, 1)
    units: dict = {}
    cs: dict = {}
    surfaces: list[_Surface] = []
    metas: list[dict] = []
    cur: _Surface | None = None
    stack: list[str] = []
    rows = 0
    try:
        with path.open("rb") as f:
            for event, elem in ET.iterparse(f, events=("start", "end")):
                name = _local(elem.tag)
                if event == "start":
                    parent = stack[-1] if stack else None
                    stack.append(name)
                    if name == "Surface" and parent == "Surfaces":
                        cur = _Surface(
                            idir, f"c{len(surfaces)}", elem.get("name") or f"Surface {len(surfaces) + 1}"
                        )
                        surfaces.append(cur)
                    elif cur is not None and name == "Definition":
                        cur.surf_type = elem.get("surfType", "TIN")
                    elif cur is not None and name in ("Pnts", "Faces"):
                        cur.containers.append(elem)
                    continue
                stack.pop()
                parent = stack[-1] if stack else None
                if cur is not None and name in ("P", "F") and parent in ("Pnts", "Faces"):
                    if name == "P":
                        cur.add_point(elem.text or "", elem.get("id"))
                    else:
                        cur.add_face(elem.text or "", elem.get("i") == "1")
                    elem.clear()
                    rows += 1
                    if rows % CLEAR_EVERY == 0:
                        cur.clear_containers()
                        check_cancelled()
                        progress(min(0.9, f.tell() / size), MESSAGE)
                    continue
                if name in ("Metric", "Imperial") and parent == "Units":
                    units = {"system": name, **elem.attrib}
                elif name == "CoordinateSystem" and parent == "LandXML":
                    cs = dict(elem.attrib)
                elif name == "Surface" and cur is not None and parent == "Surfaces":
                    metas.append(cur.finish(check_cancelled))
                    cur = None
                if name != "LandXML":
                    elem.clear()
    except ET.ParseError as e:
        raise JobFailure(f"{path.name} is not valid XML ({e})") from None
    finally:
        # Ruling (c): whatever stopped the loop above (a JobFailure from a bad point/face, a
        # cancel, malformed XML, ...), every buffer file any surface opened gets closed here.
        # A surface `finish()` already reached closed its own files; this only catches the one
        # still mid-parse when the loop stopped.
        for s in surfaces:
            s.close_files()
    if not surfaces:
        raise JobFailure(f"{path.name} has no <Surface>: there is no TIN to import")
    most = max(
        (m["face_count"] for s, m in zip(surfaces, metas, strict=True) if s.surf_type.upper() == "TIN"),
        default=0,
    )
    candidates, chosen = [], False
    for s, meta in zip(surfaces, metas, strict=True):
        notes = []
        if s.surf_type.upper() != "TIN":
            notes.append(codes.block("not_tin", "grid-type LandXML surfaces aren't supported"))
        elif meta["face_count"] == 0:
            notes.append(codes.block("not_tin", "points only — no triangles"))
        default = not notes and not chosen and meta["face_count"] == most
        chosen = chosen or default
        candidates.append(
            candidate_from_meta(
                s.cid,
                "tin_surface",
                s.name,
                meta,
                geometry="faces" if meta["face_count"] else "points",
                entity_counts={"invisible_faces": s.invisible},
                default_selected=default,
                notes=notes,
            )
        )
        points = store.read_candidate(store.candidate_dir(idir, s.cid)).points
        thumbs.plan_thumbnail(points, store.thumb_path(idir, s.cid))
        del points
    progress(1.0, MESSAGE)
    return InspectResult(_detected(units, cs), candidates, internal={"units": units, "coordinate_system": cs})
