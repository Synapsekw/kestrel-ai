"""EXT_mesh_gpu_instancing for trimesh's GLB exporter (plan 2026-10-03-plant-model-f0 Task 7).

trimesh 4.12 writes no instancing extension. Its `export_glb(buffer_postprocessor=...)` hands over
the buffer items and the glTF tree after the meshes are written and before the buffer views are
laid out, so the post-processor here appends one TRANSLATION, ROTATION and SCALE accessor per
instanced node and marks the node with the extension. The node keeps its mesh: a loader without the
extension (trimesh itself) still draws the prototype once, at the node. M1's `inject_node_extras`
rewrites only the JSON chunk, so it can run on the result afterwards.
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
import trimesh
from trimesh.transformations import quaternion_from_matrix

INSTANCING = "EXT_mesh_gpu_instancing"
_FLOAT = 5126  # glTF componentType FLOAT


def decompose(transforms) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(N, 4, 4) -> translation (N, 3), rotation quaternion xyzw (N, 4), scale (N, 3), float32.

    Raises ValueError for a non-finite, mirrored, flat or sheared transform: none of them can be
    written as translation, rotation and scale."""
    t = np.asarray(transforms, dtype=np.float64)
    if t.ndim != 3 or t.shape[1:] != (4, 4) or len(t) == 0 or not np.isfinite(t).all():
        raise ValueError("instancing needs (N, 4, 4) finite transforms")
    m = t[:, :3, :3]
    scale = np.linalg.norm(m, axis=1)  # column lengths
    if (scale <= 1e-12).any() or (np.linalg.det(m) <= 0).any():
        raise ValueError("an instance transform is mirrored or flat")
    rot = m / scale[:, None, :]
    if not np.allclose(np.einsum("nji,njk->nik", rot, rot), np.eye(3), atol=1e-5):
        raise ValueError("a sheared transform cannot be instanced")
    quats = np.empty((len(t), 4))
    for i, r in enumerate(rot):
        r4 = np.eye(4)
        r4[:3, :3] = r
        w, x, y, z = quaternion_from_matrix(r4)
        q = np.array([x, y, z, w])
        q /= np.linalg.norm(q)
        quats[i] = -q if q[3] < 0 else q
    return t[:, :3, 3].astype("<f4"), quats.astype("<f4"), scale.astype("<f4")


def instancing_postprocessor(instances: dict[str, np.ndarray]) -> Callable[[dict, dict], None]:
    """A `buffer_postprocessor` that instances each named node at its (N, 4, 4) transforms."""
    decomposed = {name: decompose(xf) for name, xf in instances.items()}

    def post(buffer_items, tree) -> None:
        nodes = {n.get("name"): n for n in tree.get("nodes", [])}
        missing = sorted(set(decomposed) - set(nodes))
        if missing:
            raise ValueError(f"no node named {missing[0]!r} to instance")
        accessors = tree["accessors"]  # an OrderedDict until trimesh flattens it after this hook
        for name, (trans, quat, scale) in decomposed.items():
            attributes = {}
            for key, arr in (("TRANSLATION", trans), ("ROTATION", quat), ("SCALE", scale)):
                data = np.ascontiguousarray(arr).tobytes()
                buffer_key = f"{INSTANCING}:{name}:{key}"
                buffer_items[buffer_key] = data + b"\0" * (-len(data) % 4)
                accessor = {
                    "bufferView": len(buffer_items) - 1,
                    "componentType": _FLOAT,
                    "count": int(len(arr)),
                    "type": "VEC4" if key == "ROTATION" else "VEC3",
                }
                if key == "TRANSLATION":
                    accessor["min"] = arr.min(axis=0).tolist()
                    accessor["max"] = arr.max(axis=0).tolist()
                accessors[buffer_key] = accessor
                attributes[key] = list(accessors.keys()).index(buffer_key)
            nodes[name].setdefault("extensions", {})[INSTANCING] = {"attributes": attributes}
        if decomposed:
            tree["extensionsUsed"] = sorted(set(tree.get("extensionsUsed", [])) | {INSTANCING})

    return post


def export_glb_instanced(scene: trimesh.Scene, instances: dict[str, np.ndarray]) -> bytes:
    """`scene` as GLB bytes, with each node named in `instances` drawn at its transforms."""
    from trimesh.exchange.gltf import export_glb

    return export_glb(scene, buffer_postprocessor=instancing_postprocessor(instances) if instances else None)
