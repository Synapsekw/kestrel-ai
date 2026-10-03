# backend/tests/test_asset_review_meshes.py
"""One concatenated mesh per version with a per-face node index; one mesh cached per process."""

import hashlib
import json
import shutil
import struct

import numpy as np
import pytest
import trimesh
from fixtures.synthetic_tower import make_tower

from app.asset_models import store
from app.asset_review import glb, meshes
from app.db.models import AssetModel, AssetModelVersion
from app.errors import AppError


@pytest.fixture(autouse=True)
def _fresh_cache():
    meshes.clear_cache()
    yield
    meshes.clear_cache()


def _two_boxes(path):
    sc = trimesh.Scene()
    for i, name in enumerate(("Leg_000", "Leg_001")):
        b = trimesh.creation.box(extents=[1, 1, 1])
        b.apply_translation([i * 3.0, 0.5, 0])
        sc.add_geometry(b, node_name=name, geom_name=f"g{i}")
    path.write_bytes(sc.export(file_type="glb"))
    return path


def _seed_version(handle, src, *, status="ready", sha=True):
    with handle.session() as s:
        m = AssetModel(name="m", status="ready", current_version=1)
        s.add(m)
        s.flush()
        mid = m.id
    dest = store.version_glb_path(handle, mid, 1)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dest)
    meta = {"sha256": hashlib.sha256(dest.read_bytes()).hexdigest()} if sha else {}
    with handle.session() as s:
        s.add(
            AssetModelVersion(
                model_id=mid,
                version=1,
                spec={},
                kind="imported",
                glb_status=status,
                source_ids=[],
                part_count=0,
                meta=meta,
            )
        )
    return mid


def test_load_glb_mesh_maps_every_face_to_its_node(tmp_path):
    tower = make_tower(tmp_path, photos=False)
    mesh, face_node = meshes.load_glb_mesh(tower.glb_path)
    info = glb.parse(tower.glb_path)
    assert len(face_node) == len(mesh.faces) and face_node.dtype == np.int32
    assert set(np.unique(face_node).tolist()) == {p.node for p in info.parts}
    names = mesh.metadata["node_names"]
    assert {names[p.node] for p in info.parts} == {p.name for p in info.parts}
    lo, hi = trimesh.load(str(tower.glb_path), force="scene").bounds
    assert np.allclose(mesh.bounds, [lo, hi], atol=1e-6)


def test_a_multi_primitive_node_maps_to_that_node(tmp_path):
    src = _two_boxes(tmp_path / "two.glb")
    info = glb.parse(src)
    doc = info.doc
    leg0 = next(p for p in info.parts if p.name == "Leg_000")
    mesh_index = doc["nodes"][leg0.node]["mesh"]
    doc["meshes"][mesh_index]["primitives"].append(dict(doc["meshes"][mesh_index]["primitives"][0]))
    body = json.dumps(doc).encode()
    body += b" " * (-len(body) % 4)
    raw = src.read_bytes()
    rest = raw[20 + info.json_length :]
    multi = tmp_path / "multi.glb"
    multi.write_bytes(
        struct.pack("<4sII", b"glTF", 2, 20 + len(body) + len(rest))
        + struct.pack("<I4s", len(body), b"JSON")
        + body
        + rest
    )
    mesh, face_node = meshes.load_glb_mesh(multi)
    assert int((face_node == leg0.node).sum()) == 24  # two copies of a 12-triangle box
    assert -1 not in face_node.tolist()


def test_a_glb_without_triangles_is_refused(tmp_path):
    p = tmp_path / "empty.glb"
    body = json.dumps({"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": []}]}).encode()
    body += b" " * (-len(body) % 4)
    p.write_bytes(
        struct.pack("<4sII", b"glTF", 2, 20 + len(body)) + struct.pack("<I4s", len(body), b"JSON") + body
    )
    with pytest.raises(ValueError, match="no triangles"):
        meshes.load_glb_mesh(p)


def test_load_version_mesh_holds_exactly_one_mesh(handle, tmp_path):
    a = _seed_version(handle, make_tower(tmp_path, photos=False).glb_path)
    b = _seed_version(handle, _two_boxes(tmp_path / "two.glb"))
    first, _ = meshes.load_version_mesh(handle, a, 1)
    assert meshes.load_version_mesh(handle, a, 1)[0] is first  # cached by sha256
    other, _ = meshes.load_version_mesh(handle, b, 1)
    assert len(other.faces) == 24 and len(meshes._CACHE) == 1
    assert meshes.load_version_mesh(handle, a, 1)[0] is not first  # evicted, loaded again


def test_load_version_mesh_hashes_a_version_without_a_recorded_sha(handle, tmp_path):
    mid = _seed_version(handle, _two_boxes(tmp_path / "two.glb"), sha=False)
    mesh, face_node = meshes.load_version_mesh(handle, mid, 1)
    assert len(mesh.faces) == 24 and len(face_node) == 24


def test_load_version_mesh_not_ready_is_409(handle, tmp_path):
    mid = _seed_version(handle, _two_boxes(tmp_path / "two.glb"), status="pending")
    with pytest.raises(AppError) as e:
        meshes.load_version_mesh(handle, mid, 1)
    assert e.value.code == "not_ready" and e.value.status == 409
