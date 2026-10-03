# backend/tests/test_asset_models_glbwriter.py
"""The plant GLB writer (plan 2026-10-03-plant-model-a1, task 2): node tree, extras, meshes,
materials and EXT_mesh_gpu_instancing, readable by trimesh."""

import io

import numpy as np
import pytest
import trimesh
from plant_helpers import accessor, parse
from scipy.spatial.transform import Rotation

from app.asset_models.glbwriter import INSTANCING, GlbWriter, trs

MATS = [{"name": "A", "pbrMetallicRoughness": {"baseColorFactor": [1.0, 0.0, 0.0, 1.0]}}]


def test_node_tree_extras_and_translation():
    w = GlbWriter(MATS)
    root = w.add_node("root", extras={"site": 1})
    grp = w.add_node("Area_10", parent=root)
    item = w.add_node("T-1", parent=grp, translation=(5.0, 1.0, 7.0))
    mesh = w.add_mesh(trimesh.creation.box((2.0, 2.0, 2.0)), 0)
    w.add_node("T-1/body", parent=item, mesh=mesh)
    w.set_extras(item, {"node": "T-1", "plant_E": 7.0})
    doc, _ = parse(w.to_glb())
    assert doc["scenes"][0]["nodes"] == [root]
    assert [n["name"] for n in doc["nodes"]] == ["root", "Area_10", "T-1", "T-1/body"]
    assert doc["nodes"][root]["children"] == [grp] and doc["nodes"][grp]["children"] == [item]
    assert doc["nodes"][item]["translation"] == [5.0, 1.0, 7.0]
    assert doc["nodes"][item]["extras"] == {"node": "T-1", "plant_E": 7.0}
    assert doc["nodes"][root]["extras"] == {"site": 1}
    assert doc["materials"] == MATS
    assert w.triangles == 12 and w.node_count == 4
    assert "extensionsUsed" not in doc


def test_box_is_faceted_with_bounds():
    w = GlbWriter(MATS)
    root = w.add_node("r")
    w.add_node("b", parent=root, mesh=w.add_mesh(trimesh.creation.box((2.0, 4.0, 6.0)), 0))
    doc, binary = parse(w.to_glb())
    prim = doc["meshes"][0]["primitives"][0]
    pos = doc["accessors"][prim["attributes"]["POSITION"]]
    assert pos["count"] == 24 and pos["min"] == [-1, -2, -3] and pos["max"] == [1, 2, 3]
    normals = accessor(doc, binary, prim["attributes"]["NORMAL"])
    np.testing.assert_allclose(np.abs(normals).max(axis=1), 1.0, atol=1e-6)
    assert doc["accessors"][prim["indices"]]["count"] == 36 and prim["material"] == 0


def test_cylinder_is_smooth_shaded():
    w = GlbWriter(MATS)
    cyl = trimesh.creation.cylinder(radius=5.0, height=2.0, sections=64)
    w.add_node("c", mesh=w.add_mesh(cyl, 0))
    doc, _ = parse(w.to_glb())
    prim = doc["meshes"][0]["primitives"][0]
    assert doc["accessors"][prim["attributes"]["POSITION"]]["count"] < 3 * len(cyl.faces)


def test_instancing_writes_trs_accessors():
    xf = np.repeat(np.eye(4)[None], 3, axis=0)
    xf[:, 0, 3] = [0.0, 10.0, 20.0]
    xf[2, :3, :3] = trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0])[:3, :3] * 2.0
    w = GlbWriter(MATS)
    root = w.add_node("r")
    node = w.add_node("piles", parent=root, mesh=w.add_mesh(trimesh.creation.box((1, 1, 1)), 0), instances=xf)
    doc, binary = parse(w.to_glb())
    assert doc["extensionsUsed"] == [INSTANCING]
    attrs = doc["nodes"][node]["extensions"][INSTANCING]["attributes"]
    assert accessor(doc, binary, attrs["TRANSLATION"])[:, 0].tolist() == [0.0, 10.0, 20.0]
    np.testing.assert_allclose(accessor(doc, binary, attrs["SCALE"])[2], [2, 2, 2], atol=1e-6)
    q = accessor(doc, binary, attrs["ROTATION"])[2]
    np.testing.assert_allclose(np.abs(q), [0, np.sqrt(0.5), 0, np.sqrt(0.5)], atol=1e-6)
    assert w.triangles == 36 and w.instanced_nodes == 1 and w.instances == 3


def test_trs_keeps_a_mirrored_instance():
    m = np.eye(4)
    m[0, 0] = -1.0
    m[:3, 3] = [1.0, 2.0, 3.0]
    t, q, s = trs(m[None])
    np.testing.assert_allclose(t[0], [1, 2, 3])
    np.testing.assert_allclose(Rotation.from_quat(q[0]).as_matrix() * s[0], m[:3, :3], atol=1e-6)


def test_empty_or_non_finite_mesh_is_skipped():
    w = GlbWriter(MATS)
    assert w.add_mesh(trimesh.Trimesh(), 0) is None
    box = trimesh.creation.box((1, 1, 1))
    bad = trimesh.Trimesh(vertices=np.full((8, 3), np.nan), faces=box.faces, process=False)
    assert w.add_mesh(bad, 0) is None


def test_nan_in_extras_refuses_to_write():
    w = GlbWriter(MATS)
    w.add_node("x", extras={"v": float("nan")})
    with pytest.raises(ValueError):
        w.to_glb()


def test_trimesh_reads_the_file():
    w = GlbWriter(MATS)
    root = w.add_node("root")
    item = w.add_node("T-1", parent=root, translation=(1.0, 0.0, 0.0))
    w.add_node("T-1/body", parent=item, mesh=w.add_mesh(trimesh.creation.box((1, 1, 1)), 0))
    scene = trimesh.load(io.BytesIO(w.to_glb()), file_type="glb")
    assert len(scene.geometry) == 1 and "T-1/body" in scene.graph.nodes


def test_no_nodes_still_a_valid_file():
    doc, binary = parse(GlbWriter(MATS).to_glb())
    assert binary == b"" and "buffers" not in doc and "nodes" not in doc
