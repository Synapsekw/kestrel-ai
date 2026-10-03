"""The GLB container, read and rewritten through its JSON chunk only (spec 2026-10-02-asset-findings §6.1).

A GLB is a 12-byte header, a JSON chunk, then usually one BIN chunk. Import reads the header and the
JSON chunk and never decodes the BIN chunk. It writes the stored copy as a new header, a normalised
JSON chunk (unique node names; optionally one root node carrying the frame conversion), then the
source's remaining bytes streamed through unchanged.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import struct
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import BinaryIO

import numpy as np

MAGIC = b"glTF"
JSON_TYPE = b"JSON"
MAX_JSON_BYTES = 64 * 1024 * 1024
COPY_CHUNK = 1024 * 1024
MAX_NODE_VISITS = 1_000_000  # a cyclic or absurd node graph stops the bounds walk, never hangs it
FRAME_NODE_NAME = "kestrel_frame"
RESERVED_NAMES = frozenset({"world"})  # trimesh names its own base frame "world"
_TRAILING_INDEX = re.compile(r"[_\-. ]*\d+$")


class GlbError(ValueError):
    """The file is not a GLB this importer can take; the message is written for the operator."""


@dataclass
class GlbPart:
    node: int
    name: str
    group: str
    extras: dict = field(default_factory=dict)


@dataclass
class GlbInfo:
    doc: dict
    json_length: int
    total_length: int
    parts: list[GlbPart]
    bounds: tuple[list[float], list[float]] | None


def _group_of(name: str, extras: dict) -> str:
    """`extras.group` when the exporter wrote one, else the node name without a trailing index
    (`Leg_012` -> `Leg`)."""
    g = extras.get("group")
    if isinstance(g, str) and g.strip():
        return g.strip()
    return _TRAILING_INDEX.sub("", name).strip() or name


def read_header(f: BinaryIO) -> tuple[int, int]:
    """(total_length, json_length), after checking the magic, the version and the first chunk."""
    head = f.read(20)
    if len(head) < 20:
        raise GlbError("The file is too short to be a GLB.")
    magic, version, total = struct.unpack_from("<4sII", head, 0)
    if magic != MAGIC:
        raise GlbError("The file is not a GLB (binary glTF).")
    if version != 2:
        raise GlbError(f"Only glTF 2.0 is supported; this file is version {version}.")
    clen, ctype = struct.unpack_from("<I4s", head, 12)
    if ctype != JSON_TYPE:
        raise GlbError("The GLB's first chunk is not JSON.")
    if clen > MAX_JSON_BYTES:
        raise GlbError("The GLB's JSON chunk is larger than 64 MB.")
    return total, clen


def _node_matrix(node: dict) -> np.ndarray:
    if "matrix" in node:
        return np.array(node["matrix"], dtype=float).reshape(4, 4).T  # column-major in glTF
    x, y, z, w = node.get("rotation", [0.0, 0.0, 0.0, 1.0])
    rot = np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )
    m = np.eye(4)
    m[:3, :3] = rot * np.array(node.get("scale", [1.0, 1.0, 1.0]), dtype=float)
    m[:3, 3] = node.get("translation", [0.0, 0.0, 0.0])
    return m


def _bounds(doc: dict) -> tuple[list[float], list[float]] | None:
    """World AABB of the default scene from the POSITION accessors' min/max (required by glTF)."""
    nodes, meshes, accessors = doc.get("nodes", []), doc.get("meshes", []), doc.get("accessors", [])
    scenes = doc.get("scenes") or []
    si = doc.get("scene", 0)
    roots = scenes[si].get("nodes", []) if isinstance(si, int) and 0 <= si < len(scenes) else []
    lo, hi = np.full(3, math.inf), np.full(3, -math.inf)
    stack = [(i, np.eye(4)) for i in roots]
    visits = 0
    while stack and visits < MAX_NODE_VISITS:
        i, parent = stack.pop()
        visits += 1
        if not (isinstance(i, int) and 0 <= i < len(nodes)) or not isinstance(nodes[i], dict):
            continue
        node = nodes[i]
        world = parent @ _node_matrix(node)
        mi = node.get("mesh")
        if isinstance(mi, int) and 0 <= mi < len(meshes):
            for prim in meshes[mi].get("primitives", []):
                ai = prim.get("attributes", {}).get("POSITION")
                acc = accessors[ai] if isinstance(ai, int) and 0 <= ai < len(accessors) else None
                if not acc or "min" not in acc or "max" not in acc:
                    continue
                a, b = acc["min"], acc["max"]
                corners = np.array(
                    [[x, y, z, 1.0] for x in (a[0], b[0]) for y in (a[1], b[1]) for z in (a[2], b[2])]
                )
                pts = (corners @ world.T)[:, :3]
                lo, hi = np.minimum(lo, pts.min(0)), np.maximum(hi, pts.max(0))
        stack.extend((c, world) for c in node.get("children", []))
    if not np.isfinite(lo).all():
        return None
    return [round(float(v), 4) for v in lo], [round(float(v), 4) for v in hi]


def _unique(name: str, index: int, taken: set[str]) -> str:
    """`name` if free and not reserved, else `name_<n>` counting up from `index` until it is free."""
    if name not in taken and name not in RESERVED_NAMES:
        return name
    n = index
    while f"{name}_{n}" in taken or f"{name}_{n}" in RESERVED_NAMES:
        n += 1
    return f"{name}_{n}"


def _node_names(nodes: list) -> list[str | None]:
    """The one naming rule: the name every node has in the stored copy (None for a non-object node).
    Already unique, non-reserved names come back unchanged, so it is the identity on a stored file."""
    taken: set[str] = set()
    out: list[str | None] = []
    for i, node in enumerate(nodes):
        if not isinstance(node, dict):
            out.append(None)
            continue
        name = _unique(str(node.get("name") or f"node_{i}"), i, taken)
        taken.add(name)
        out.append(name)
    return out


def parse(path: Path) -> GlbInfo:
    """The header and JSON chunk of `path`: nodes, names, extras and bounds. The BIN chunk is not read.
    Only the header's declared `total_length` bytes belong to the file; trailing bytes are ignored."""
    with open(path, "rb") as f:
        total, clen = read_header(f)
        raw = f.read(clen)
    if len(raw) < clen:
        raise GlbError("The GLB ends inside its JSON chunk.")
    try:
        doc = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise GlbError("The GLB's JSON chunk is not valid JSON.") from None
    if not isinstance(doc, dict):
        raise GlbError("The GLB's JSON chunk is not a glTF document.")
    for b in doc.get("buffers", []):
        uri = b.get("uri") if isinstance(b, dict) else None
        if isinstance(uri, str) and not uri.startswith("data:"):
            raise GlbError("The GLB points at an external buffer file; export it as a single .glb.")
    try:
        nodes = doc.get("nodes", [])
        names = _node_names(nodes)
        parts = []
        for i, node in enumerate(nodes):
            if isinstance(node, dict) and isinstance(node.get("mesh"), int):
                extras = node.get("extras") if isinstance(node.get("extras"), dict) else {}
                name = names[i]
                parts.append(GlbPart(node=i, name=name, group=_group_of(name, extras), extras=extras))
        bounds = _bounds(doc)
    except (IndexError, TypeError, AttributeError, ValueError, KeyError):
        raise GlbError("The GLB's node data is malformed and could not be read.") from None
    return GlbInfo(doc=doc, json_length=clen, total_length=total, parts=parts, bounds=bounds)


def normalise(doc: dict, matrix: np.ndarray | None) -> dict:
    """A copy of `doc` in which every node has a unique, non-reserved name, and, when `matrix` is
    given, the default scene's roots hang under one new node carrying it (row-major in,
    column-major out). trimesh then names its scene nodes exactly as the glTF does."""
    doc = json.loads(json.dumps(doc))
    nodes = doc.setdefault("nodes", [])
    names = _node_names(nodes)
    for node, name in zip(nodes, names, strict=True):
        if name is not None:
            node["name"] = name
    taken = {n for n in names if n is not None}
    for node in nodes:  # the viewer collects parts by a string `extras.group`; give every mesh node one
        if isinstance(node, dict) and isinstance(node.get("mesh"), int):
            extras = node.get("extras") if isinstance(node.get("extras"), dict) else {}
            if not isinstance(extras.get("group"), str):
                node["extras"] = {**extras, "group": _group_of(node["name"], extras)}
    if matrix is not None:
        scenes = doc.get("scenes") or [{"nodes": []}]
        doc["scenes"] = scenes
        si = doc.get("scene", 0)
        si = si if isinstance(si, int) and 0 <= si < len(scenes) else 0
        doc["scene"] = si
        name = _unique(FRAME_NODE_NAME, len(nodes), taken)
        flat = np.asarray(matrix, dtype=float).T.reshape(-1)
        nodes.append(
            {"name": name, "matrix": [float(v) for v in flat], "children": list(scenes[si].get("nodes", []))}
        )
        scenes[si]["nodes"] = [len(nodes) - 1]
    return doc


def write_normalised(
    src: Path,
    dest: Path,
    info: GlbInfo,
    matrix: np.ndarray | None,
    *,
    on_chunk: Callable[[int, int], None] | None = None,
) -> tuple[str, str, int]:
    """Write the stored copy. Returns (source_sha256, stored_sha256, stored_bytes). `on_chunk(done,
    total)` runs after each streamed MiB, so a job can report progress and check cancellation.
    `source_sha256` covers the header's declared `total_length` bytes; trailing bytes are ignored."""
    rest = info.total_length - 20 - info.json_length
    if rest < 0:
        raise GlbError("The GLB's header length is shorter than its JSON chunk.")
    body = json.dumps(normalise(info.doc, matrix), separators=(",", ":")).encode("utf-8")
    body += b" " * (-len(body) % 4)
    head = struct.pack("<4sII", MAGIC, 2, 20 + len(body) + rest) + struct.pack("<I4s", len(body), JSON_TYPE)
    src_hash, out_hash = hashlib.sha256(), hashlib.sha256()
    written = 0
    try:
        with open(src, "rb") as f, open(dest, "wb") as out:
            src_hash.update(f.read(20 + info.json_length))
            for piece in (head, body):
                out.write(piece)
                out_hash.update(piece)
                written += len(piece)
            done = 0
            while done < rest:
                chunk = f.read(min(COPY_CHUNK, rest - done))
                if not chunk:
                    raise GlbError("The GLB ends before the length its header states.")
                src_hash.update(chunk)
                out_hash.update(chunk)
                out.write(chunk)
                done += len(chunk)
                written += len(chunk)
                if on_chunk is not None:
                    on_chunk(done, rest)
    except BaseException:
        dest.unlink(missing_ok=True)  # never leave a partial stored copy behind
        raise
    return src_hash.hexdigest(), out_hash.hexdigest(), written
