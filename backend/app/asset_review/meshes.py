# backend/app/asset_review/meshes.py
"""An asset model version as one triangle mesh in the asset frame (spec 2026-10-02-asset-findings
§6.3 "the mesh is held once").

`load_version_mesh` keeps exactly one mesh per process, keyed by the GLB's sha256: J3's placement
loads the model once for a whole job, and a second model evicts the first, so memory stays bounded
to one mesh. trimesh is told to skip materials, so textures are never decoded.
"""

from __future__ import annotations

import hashlib
import threading
from pathlib import Path

import numpy as np
import trimesh

from app.asset_models import store
from app.asset_review import glb
from app.errors import AppError

MAX_PARENT_HOPS = 64

_LOCK = threading.Lock()
_CACHE: dict[str, tuple[trimesh.Trimesh, np.ndarray]] = {}  # at most one entry


def clear_cache() -> None:
    with _LOCK:
        _CACHE.clear()


def scene_to_mesh(scene: trimesh.Scene, node_index: dict[str, int]) -> tuple[trimesh.Trimesh, np.ndarray]:
    """Every geometry node, transformed to world, concatenated in `scene.graph.nodes_geometry` order.
    A node trimesh created for an extra primitive is owned by its nearest named glTF ancestor."""
    parents = scene.graph.transforms.parents
    verts: list[np.ndarray] = []
    faces: list[np.ndarray] = []
    owners: list[np.ndarray] = []
    offset = 0
    for node in scene.graph.nodes_geometry:
        transform, gname = scene.graph[node]
        geom = scene.geometry.get(gname)
        if not isinstance(geom, trimesh.Trimesh) or len(geom.faces) == 0:
            continue
        owner, hops = node, 0
        while owner not in node_index and owner in parents and hops < MAX_PARENT_HOPS:
            owner, hops = parents[owner], hops + 1
        v = trimesh.transformations.transform_points(np.asarray(geom.vertices, dtype=float), transform)
        verts.append(v)
        faces.append(np.asarray(geom.faces, dtype=np.int64) + offset)
        owners.append(np.full(len(geom.faces), node_index.get(owner, -1), dtype=np.int32))
        offset += len(v)
    if not faces:
        raise ValueError("the GLB has no triangles")
    mesh = trimesh.Trimesh(vertices=np.vstack(verts), faces=np.vstack(faces), process=False)
    mesh.metadata["node_names"] = {i: name for name, i in node_index.items()}
    return mesh, np.concatenate(owners)


def load_glb_mesh(path: Path) -> tuple[trimesh.Trimesh, np.ndarray]:
    """(mesh, face_node) for one GLB file. Raises whatever trimesh raises for a broken file."""
    info = glb.parse(path)
    node_index = {
        str(n["name"]): i
        for i, n in enumerate(info.doc.get("nodes", []))
        if isinstance(n, dict) and n.get("name")
    }
    scene = trimesh.load(str(path), file_type="glb", force="scene", skip_materials=True)
    return scene_to_mesh(scene, node_index)


def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(glb.COPY_CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()


def load_version_mesh(handle, asset_model_id: str, version: int) -> tuple[trimesh.Trimesh, np.ndarray]:
    """The version's mesh and per-face node index, from the one-entry process cache."""
    with handle.session() as s:
        row = store.get_version(s, asset_model_id, version)
        ready, sha = row.glb_status == "ready", (row.meta or {}).get("sha256")
    path = store.version_glb_path(handle, asset_model_id, version)
    if not ready or not path.is_file():
        raise AppError("not_ready", "The 3D model for this version is not ready.", 409)
    key = sha or _file_sha256(path)
    with _LOCK:
        hit = _CACHE.get(key)
        if hit is not None:
            return hit
        loaded = load_glb_mesh(path)
        _CACHE.clear()
        _CACHE[key] = loaded
        return loaded


def cached_version_mesh(
    handle, asset_model_id: str, version: int
) -> tuple[trimesh.Trimesh, np.ndarray] | None:
    """The version's mesh when the process cache already holds it, else None. Never loads and never
    waits: a request thread may call it (a held lock counts as a miss). Raises the same AppError as
    `load_version_mesh` when the version is not ready."""
    with handle.session() as s:
        row = store.get_version(s, asset_model_id, version)
        ready, sha = row.glb_status == "ready", (row.meta or {}).get("sha256")
    path = store.version_glb_path(handle, asset_model_id, version)
    if not ready or not path.is_file():
        raise AppError("not_ready", "The 3D model for this version is not ready.", 409)
    key = sha or _file_sha256(path)
    if not _LOCK.acquire(blocking=False):
        return None
    try:
        return _CACHE.get(key)
    finally:
        _LOCK.release()
