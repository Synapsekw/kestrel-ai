"""EXT_mesh_gpu_instancing through trimesh's exporter: the ruling A1 builds on (plan pm-f0 Task 7)."""

import io
import json
import struct

import numpy as np
import pytest
import trimesh
from trimesh.transformations import quaternion_matrix

from app.asset_models.build import inject_node_extras
from app.asset_models.builders.geom import cyl, place
from app.asset_models.gltf_instancing import INSTANCING, decompose, export_glb_instanced


def parse(glb: bytes) -> tuple[dict, bytes]:
    (clen,) = struct.unpack_from("<I", glb, 12)
    doc = json.loads(glb[20 : 20 + clen])
    (blen,) = struct.unpack_from("<I", glb, 20 + clen)
    return doc, glb[28 + clen : 28 + clen + blen]


def accessor(doc: dict, binary: bytes, index: int, width: int) -> np.ndarray:
    a = doc["accessors"][index]
    view = doc["bufferViews"][a["bufferView"]]
    raw = binary[view["byteOffset"] : view["byteOffset"] + view["byteLength"]]
    return np.frombuffer(raw, dtype="<f4").reshape(-1, width)[: a["count"]]


def piles_scene() -> trimesh.Scene:
    scene = trimesh.Scene()
    scene.add_geometry(cyl(0.3, 2.0), node_name="piles", geom_name="piles")
    scene.add_geometry(trimesh.creation.box((1, 1, 1)), node_name="deck", geom_name="deck")
    return scene


def test_instanced_nodes_carry_translation_rotation_and_scale():
    xf = np.stack([place(i * 5.0, 0.0, 2.0, yaw_deg=30.0 * i) for i in range(10)])
    xf[3, :3, :3] *= 2.0
    doc, binary = parse(export_glb_instanced(piles_scene(), {"piles": xf}))
    assert INSTANCING in doc["extensionsUsed"]
    node = next(n for n in doc["nodes"] if n.get("name") == "piles")
    att = node["extensions"][INSTANCING]["attributes"]
    t = accessor(doc, binary, att["TRANSLATION"], 3)
    q = accessor(doc, binary, att["ROTATION"], 4)
    s = accessor(doc, binary, att["SCALE"], 3)
    assert np.allclose(t, xf[:, :3, 3]) and doc["accessors"][att["TRANSLATION"]]["max"] == [45.0, 0.0, 2.0]
    for i in range(10):
        x, y, z, w = q[i]
        assert np.allclose(quaternion_matrix([w, x, y, z])[:3, :3] * s[i][None, :], xf[i, :3, :3], atol=1e-5)
    assert "extensions" not in next(n for n in doc["nodes"] if n.get("name") == "deck")


def test_node_extras_and_trimesh_reload_survive_instancing():
    glb = export_glb_instanced(piles_scene(), {"piles": np.stack([place(0, 0, 0), place(5, 0, 0)])})
    glb = inject_node_extras(glb, {"piles": {"id": "p1"}})
    doc, _ = parse(glb)
    node = next(n for n in doc["nodes"] if n.get("name") == "piles")
    assert node["extras"] == {"id": "p1"} and INSTANCING in node["extensions"]
    assert set(trimesh.load(io.BytesIO(glb), file_type="glb").geometry) == {"piles", "deck"}


def test_instancing_is_the_size_lever():
    many = np.stack([place(i * 2.0, 0, 0) for i in range(1000)])
    scene = trimesh.Scene()
    scene.add_geometry(cyl(0.3, 2.0), node_name="p", geom_name="p")
    instanced = len(export_glb_instanced(scene, {"p": many}))
    merged = trimesh.util.concatenate([cyl(0.3, 2.0).apply_transform(m) for m in many])
    assert instanced < 0.2 * len(trimesh.Scene([merged]).export(file_type="glb"))


def test_without_instances_it_is_the_plain_export():
    assert "extensionsUsed" not in parse(export_glb_instanced(piles_scene(), {}))[0]


@pytest.mark.parametrize(
    "xf",
    [
        np.diag([-1.0, 1, 1, 1])[None],  # mirrored
        np.diag([0.0, 1, 1, 1])[None],  # flat
        np.array([[[1, 0.5, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]], float),  # sheared
        np.full((1, 4, 4), np.nan),
        np.zeros((0, 4, 4)),
    ],
)
def test_transforms_that_are_not_trs_are_refused(xf):
    with pytest.raises(ValueError):
        decompose(xf)


def test_an_unknown_node_is_refused():
    with pytest.raises(ValueError, match="no node named 'nope'"):
        export_glb_instanced(piles_scene(), {"nope": np.stack([place(0, 0, 0)])})
