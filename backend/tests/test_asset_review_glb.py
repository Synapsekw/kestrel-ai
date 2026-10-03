"""The GLB container through its JSON chunk only (spec §6.1 steps 1 and 2)."""

import hashlib
import json
import struct

import numpy as np
import pytest
import trimesh
from fixtures.synthetic_tower import make_tower

from app.asset_models.build import inject_node_extras
from app.asset_review import frame_io, glb


def _glb(doc: dict, bin_bytes: bytes = b"") -> bytes:
    body = json.dumps(doc).encode()
    body += b" " * (-len(body) % 4)
    out = struct.pack("<I4s", len(body), b"JSON") + body
    if bin_bytes:
        out += struct.pack("<I4s", len(bin_bytes), b"BIN\x00") + bin_bytes
    return struct.pack("<4sII", b"glTF", 2, 12 + len(out)) + out


def _scene_glb(tmp_path, names=("Leg_000", "Leg_001", "Platform_002")):
    sc = trimesh.Scene()
    for i, name in enumerate(names):
        box = trimesh.creation.box(extents=[1, 1, 1])
        box.apply_translation([i * 2.0, 0.5, 0])
        sc.add_geometry(box, node_name=name, geom_name=f"g{i}")
    data = inject_node_extras(sc.export(file_type="glb"), {"Platform_002": {"group": "Deck", "tag": "P-1"}})
    path = tmp_path / "parts.glb"
    path.write_bytes(data)
    return path


def test_parse_reads_names_groups_and_extras(tmp_path):
    info = glb.parse(_scene_glb(tmp_path))
    by_name = {p.name: p for p in info.parts}
    assert set(by_name) == {"Leg_000", "Leg_001", "Platform_002"}
    assert by_name["Leg_000"].group == "Leg" and by_name["Leg_001"].group == "Leg"
    assert by_name["Platform_002"].group == "Deck" and by_name["Platform_002"].extras["tag"] == "P-1"
    assert all(info.doc["nodes"][p.node]["name"] == p.name for p in info.parts)


def test_parse_bounds_match_trimesh_on_the_tower(tmp_path):
    tower = make_tower(tmp_path, photos=False)
    info = glb.parse(tower.glb_path)
    lo, hi = trimesh.load(str(tower.glb_path), force="scene").bounds
    assert np.allclose(info.bounds[0], lo, atol=1e-3) and np.allclose(info.bounds[1], hi, atol=1e-3)
    assert len(info.parts) > 50 and {"Leg", "Antenna"} <= {p.group for p in info.parts}


def test_parse_never_reads_the_bin_chunk(tmp_path):
    full = _scene_glb(tmp_path).read_bytes()
    _total, clen = struct.unpack_from("<II", full, 8)[0], struct.unpack_from("<I", full, 12)[0]
    cut = tmp_path / "cut.glb"
    cut.write_bytes(full[: 20 + clen])  # the BIN chunk is gone; the header still claims it
    assert len(glb.parse(cut).parts) == 3


@pytest.mark.parametrize(
    "data, message",
    [
        (b"not a glb at all, just text", "not a GLB"),
        (struct.pack("<4sII", b"glTF", 1, 20) + struct.pack("<I4s", 0, b"JSON"), "version 1"),
        (struct.pack("<4sII", b"glTF", 2, 20) + struct.pack("<I4s", 0, b"BIN\x00"), "not JSON"),
        (b"glTF", "too short"),
    ],
)
def test_parse_refuses_what_is_not_a_glb2(tmp_path, data, message):
    p = tmp_path / "bad.glb"
    p.write_bytes(data)
    with pytest.raises(glb.GlbError, match=message):
        glb.parse(p)


def test_parse_refuses_external_buffers_and_bad_json(tmp_path):
    p = tmp_path / "ext.glb"
    p.write_bytes(_glb({"asset": {"version": "2.0"}, "buffers": [{"uri": "mesh.bin", "byteLength": 4}]}))
    with pytest.raises(glb.GlbError, match="external buffer"):
        glb.parse(p)
    body = b"[1, 2]  "
    p.write_bytes(
        struct.pack("<4sII", b"glTF", 2, 20 + len(body)) + struct.pack("<I4s", len(body), b"JSON") + body
    )
    with pytest.raises(glb.GlbError, match="not a glTF document"):
        glb.parse(p)


def test_normalise_names_every_node_uniquely():
    doc = {
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [
            {"name": "world", "children": [1, 2, 3]},
            {"mesh": 0},
            {"name": "A", "mesh": 1},
            {"name": "A", "mesh": 2},
        ],
    }
    out = glb.normalise(doc, None)
    assert [n["name"] for n in out["nodes"]] == ["world_0", "node_1", "A", "A_3"]
    assert out["scenes"] == [{"nodes": [0]}] and doc["nodes"][1] == {"mesh": 0}  # input untouched


def test_normalise_wraps_the_roots_in_the_frame_node():
    doc = {
        "scene": 0,
        "scenes": [{"nodes": [0, 1]}],
        "nodes": [{"name": "a", "mesh": 0}, {"name": "b", "mesh": 1}],
    }
    m = frame_io.CONVERSIONS["x_east_minus_z_north"]
    out = glb.normalise(doc, m)
    root = out["nodes"][-1]
    assert root["name"] == glb.FRAME_NODE_NAME and root["children"] == [0, 1]
    assert out["scenes"][0]["nodes"] == [2]
    assert np.allclose(np.array(root["matrix"]).reshape(4, 4).T, m)  # glTF matrices are column-major
    again = glb.normalise(out, m)  # a second wrap gets its own name
    assert again["nodes"][-1]["name"] == f"{glb.FRAME_NODE_NAME}_3"


def test_write_normalised_copies_the_bin_chunk_and_hashes_both_files(tmp_path):
    src = _scene_glb(tmp_path)
    info = glb.parse(src)
    dest = tmp_path / "stored.glb"
    calls = []
    src_sha, sha, size = glb.write_normalised(
        src,
        dest,
        info,
        frame_io.CONVERSIONS["x_east_minus_z_north"],
        on_chunk=lambda d, t: calls.append((d, t)),
    )
    raw, stored = src.read_bytes(), dest.read_bytes()
    assert src_sha == hashlib.sha256(raw).hexdigest() and sha == hashlib.sha256(stored).hexdigest()
    assert size == len(stored) == struct.unpack_from("<I", stored, 8)[0]
    assert stored[-(len(raw) - 20 - info.json_length) :] == raw[20 + info.json_length :]  # BIN byte for byte
    assert calls and calls[-1][0] == calls[-1][1]
    lo, hi = trimesh.load(str(dest), force="scene").bounds
    expected = trimesh.load(str(src), force="scene")
    expected.apply_transform(frame_io.CONVERSIONS["x_east_minus_z_north"])
    assert np.allclose(lo, expected.bounds[0]) and np.allclose(hi, expected.bounds[1])


def test_write_normalised_refuses_a_short_file(tmp_path):
    full = _scene_glb(tmp_path).read_bytes()
    clen = struct.unpack_from("<I", full, 12)[0]
    cut = tmp_path / "cut.glb"
    cut.write_bytes(full[: 20 + clen + 8])
    with pytest.raises(glb.GlbError, match="ends before"):
        glb.write_normalised(cut, tmp_path / "out.glb", glb.parse(cut), None)


def test_normalise_names_stay_unique_when_a_renamed_name_collides():
    doc = {
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "A"}, {"name": "A_2"}, {"name": "A"}, {"name": "kestrel_frame"}],
    }
    names = [n["name"] for n in glb.normalise(doc, None)["nodes"]]
    assert len(set(names)) == 4 and names[:2] == ["A", "A_2"]
    out = glb.normalise(doc, frame_io.CONVERSIONS["x_east_minus_z_north"])
    all_names = [n["name"] for n in out["nodes"]]
    assert len(set(all_names)) == 5


def test_part_names_match_between_source_and_stored_copy(tmp_path):
    sc = trimesh.Scene()
    for i, name in enumerate(["Leg", "Leg", "world", "Leg_1"]):
        box = trimesh.creation.box(extents=[1, 1, 1])
        sc.add_geometry(box, node_name=name, geom_name=f"g{i}")
    src = tmp_path / "dup.glb"
    src.write_bytes(sc.export(file_type="glb"))
    info = glb.parse(src)
    dest = tmp_path / "stored.glb"
    glb.write_normalised(src, dest, info, frame_io.CONVERSIONS["x_east_minus_z_north"])
    stored = glb.parse(dest)
    src_names = [p.name for p in info.parts]
    assert len(set(src_names)) == len(src_names)
    assert src_names == [p.name for p in stored.parts]
    assert src_names == [stored.doc["nodes"][p.node]["name"] for p in stored.parts]


def test_parse_wraps_malformed_node_data(tmp_path):
    p = tmp_path / "bad.glb"
    p.write_bytes(
        _glb(
            {
                "asset": {"version": "2.0"},
                "scenes": [{"nodes": [0]}],
                "nodes": [{"mesh": 0, "matrix": [1]}],
                "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
                "accessors": [{"min": [0], "max": [1]}],
            }
        )
    )
    with pytest.raises(glb.GlbError, match="malformed"):
        glb.parse(p)


def test_write_normalised_removes_a_partial_dest(tmp_path):
    full = _scene_glb(tmp_path).read_bytes()
    clen = struct.unpack_from("<I", full, 12)[0]
    cut = tmp_path / "cut.glb"
    cut.write_bytes(full[: 20 + clen + 8])
    dest = tmp_path / "out.glb"
    with pytest.raises(glb.GlbError):
        glb.write_normalised(cut, dest, glb.parse(cut), None)
    assert not dest.exists()
