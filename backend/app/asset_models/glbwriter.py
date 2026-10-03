# backend/app/asset_models/glbwriter.py
"""A minimal glTF 2.0 binary writer for plant models (spec 2026-10-03-plant-model-generator §7, plan
A1 task 2): a node tree with extras, one mesh per node, the palette materials and
EXT_mesh_gpu_instancing. trimesh's exporter writes neither node extras nor instancing, so the plant
GLB is written here; M1's `build_glb` keeps trimesh. Pure: numpy, json and struct.
"""

from __future__ import annotations

import json
import struct
from collections.abc import Sequence

import numpy as np
import trimesh
from scipy.spatial.transform import Rotation

from app.asset_models.gltf_instancing import INSTANCING  # noqa: F401 - re-exported

GENERATOR = "kestrel plant assembler"
ARRAY_BUFFER = 34962
ELEMENT_ARRAY_BUFFER = 34963
FLOAT = 5126
UINT32 = 5125
SMOOTH_ANGLE = float(np.radians(30.0))


def _pad(data: bytes, fill: bytes) -> bytes:
    return data + fill * (-len(data) % 4)


def _faceted(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    vertices = np.asarray(mesh.vertices)[np.asarray(mesh.faces)].reshape(-1, 3)
    out = trimesh.Trimesh(vertices, np.arange(len(vertices)).reshape(-1, 3), process=False)
    out.vertex_normals = np.repeat(np.asarray(mesh.face_normals), 3, axis=0)
    return out


def _shade(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Split vertices at creases over 30 degrees: boxes come out faceted, cylinders smooth."""
    try:
        out = trimesh.graph.smooth_shade(mesh, angle=SMOOTH_ANGLE, facet_minarea=None)
        if len(out.faces) == len(mesh.faces):
            return out
    except Exception:
        pass
    return _faceted(mesh)


def trs(transforms: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(N, 4, 4) affine transforms -> translation (N, 3), rotation quaternion xyzw (N, 4), scale (N, 3).
    A mirror becomes a negative x scale. Shear is not representable and is dropped."""
    m = np.asarray(transforms, dtype=np.float64).reshape(-1, 4, 4)
    t = m[:, :3, 3]
    basis = m[:, :3, :3]
    s = np.linalg.norm(basis, axis=1)  # column norms
    s = np.where(s > 1e-12, s, 1.0)
    rot = basis / s[:, None, :]
    flip = np.linalg.det(rot) < 0
    s[flip, 0] *= -1.0
    rot[flip, :, 0] *= -1.0
    q = Rotation.from_matrix(rot).as_quat()
    return t.astype(np.float32), q.astype(np.float32), s.astype(np.float32)


class GlbWriter:
    def __init__(self, materials: list[dict]) -> None:
        self._materials = materials
        self._nodes: list[dict] = []
        self._roots: list[int] = []
        self._meshes: list[dict] = []
        self._mesh_faces: list[int] = []
        self._accessors: list[dict] = []
        self._views: list[dict] = []
        self._chunks: list[bytes] = []
        self._offset = 0
        self.triangles = 0
        self.instanced_nodes = 0
        self.instances = 0

    @property
    def node_count(self) -> int:
        return len(self._nodes)

    def _view(self, data: bytes, target: int | None) -> int:
        view = {"buffer": 0, "byteOffset": self._offset, "byteLength": len(data)}
        if target is not None:
            view["target"] = target
        self._views.append(view)
        self._chunks.append(data)
        self._offset += len(data)  # every element here is 4 bytes wide, so offsets stay aligned
        return len(self._views) - 1

    def _accessor(
        self, arr: np.ndarray, kind: str, target: int | None = None, *, minmax: bool = False
    ) -> int:
        arr = np.ascontiguousarray(arr)
        acc = {
            "bufferView": self._view(arr.tobytes(), target),
            "componentType": UINT32 if arr.dtype == np.uint32 else FLOAT,
            "count": int(arr.shape[0]),
            "type": kind,
        }
        if minmax:
            acc["min"] = [float(v) for v in arr.min(axis=0)]
            acc["max"] = [float(v) for v in arr.max(axis=0)]
        self._accessors.append(acc)
        return len(self._accessors) - 1

    def add_mesh(self, mesh: trimesh.Trimesh, material: int) -> int | None:
        if mesh is None or len(mesh.faces) == 0 or not np.isfinite(np.asarray(mesh.vertices)).all():
            return None
        shaded = _shade(mesh)
        pos = np.asarray(shaded.vertices, dtype=np.float32)
        nrm = np.asarray(shaded.vertex_normals, dtype=np.float32)
        idx = np.asarray(shaded.faces, dtype=np.uint32).reshape(-1)
        if not (np.isfinite(pos).all() and np.isfinite(nrm).all()):
            return None
        prim = {
            "attributes": {
                "POSITION": self._accessor(pos, "VEC3", ARRAY_BUFFER, minmax=True),
                "NORMAL": self._accessor(nrm, "VEC3", ARRAY_BUFFER),
            },
            "indices": self._accessor(idx, "SCALAR", ELEMENT_ARRAY_BUFFER),
            "material": int(material),
        }
        self._meshes.append({"primitives": [prim]})
        self._mesh_faces.append(len(idx) // 3)
        return len(self._meshes) - 1

    def add_node(
        self,
        name: str,
        *,
        parent: int | None = None,
        translation: Sequence[float] | None = None,
        extras: dict | None = None,
        mesh: int | None = None,
        instances: np.ndarray | None = None,
    ) -> int:
        node: dict = {"name": name}
        if translation is not None:
            node["translation"] = [float(v) for v in translation]
        if extras:
            node["extras"] = extras
        if mesh is not None:
            node["mesh"] = mesh
            faces = self._mesh_faces[mesh]
            if instances is not None:
                t, r, s = trs(instances)
                node["extensions"] = {
                    INSTANCING: {
                        "attributes": {
                            "TRANSLATION": self._accessor(t, "VEC3"),
                            "ROTATION": self._accessor(r, "VEC4"),
                            "SCALE": self._accessor(s, "VEC3"),
                        }
                    }
                }
                self.instanced_nodes += 1
                self.instances += len(t)
                self.triangles += faces * len(t)
            else:
                self.triangles += faces
        self._nodes.append(node)
        index = len(self._nodes) - 1
        if parent is None:
            self._roots.append(index)
        else:
            self._nodes[parent].setdefault("children", []).append(index)
        return index

    def set_extras(self, node: int, extras: dict) -> None:
        self._nodes[node]["extras"] = extras

    def to_glb(self) -> bytes:
        doc: dict = {
            "asset": {"version": "2.0", "generator": GENERATOR},
            "scene": 0,
            "scenes": [{"nodes": self._roots}] if self._roots else [{}],
        }
        for key, value in (
            ("nodes", self._nodes),
            ("meshes", self._meshes),
            ("materials", self._materials),
            ("accessors", self._accessors),
            ("bufferViews", self._views),
        ):
            if value:  # glTF arrays, when present, must not be empty
                doc[key] = value
        binary = b"".join(self._chunks)
        if binary:
            doc["buffers"] = [{"byteLength": len(binary)}]
        if self.instanced_nodes:
            doc["extensionsUsed"] = [INSTANCING]
        body = _pad(json.dumps(doc, separators=(",", ":"), allow_nan=False).encode("utf-8"), b" ")
        parts = [struct.pack("<I4s", len(body), b"JSON"), body]
        if binary:
            padded = _pad(binary, b"\x00")
            parts += [struct.pack("<I4s", len(padded), b"BIN\x00"), padded]
        payload = b"".join(parts)
        return struct.pack("<4sII", b"glTF", 2, 12 + len(payload)) + payload
