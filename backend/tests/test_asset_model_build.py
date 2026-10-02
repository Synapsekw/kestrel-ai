"""Spec -> meshes (metres) -> GLB with per-node extras (spec §6.4)."""

import io
import json
import struct

import pytest
import trimesh

from app.asset_models.build import SpecInvalid, build_glb, build_meshes, inject_node_extras
from app.asset_models.spec import AssetSpec

SPEC = AssetSpec.model_validate(
    {
        "asset": {"tag": "T-1"},
        "parts": [
            {
                "id": "shell",
                "name": "Shell",
                "group": "Shell",
                "shape": "cylinder",
                "material": "paint",
                "params": {"id": 4000, "thickness": 8, "height": 8000},
                "source": {"kind": "drawing", "id": "d"},
            },
            {
                "id": "N7",
                "name": "Nozzle N7",
                "group": "Nozzle",
                "shape": "nozzle",
                "material": "steel",
                "params": {"dn": 80, "od": 88.9, "projection": 200, "flange_od": 200, "flange_t": 20},
                "placement": {"host": "shell", "bearing_deg": 270, "elevation_mm": 7780},
                "source": {"kind": "drawing", "id": "d"},
            },
        ],
    }
)


def glb_json(glb: bytes) -> dict:
    magic, _version, _length = struct.unpack_from("<4sII", glb, 0)
    assert magic == b"glTF"
    clen, ctype = struct.unpack_from("<I4s", glb, 12)
    assert ctype == b"JSON"
    return json.loads(glb[20 : 20 + clen])


def test_meshes_are_in_metres_in_the_asset_frame():
    meshes = build_meshes(SPEC)
    assert list(meshes) == ["shell", "N7"]
    assert meshes["shell"].bounds[1][1] == pytest.approx(8.0)
    n7 = meshes["N7"].bounds
    assert n7[0][2] == pytest.approx(-2.208, abs=1e-3)  # bearing 270 = -Z (plant west)
    assert n7[1][1] == pytest.approx(7.78 + 0.1, abs=1e-3)


def test_invalid_spec_raises_with_the_report():
    bad = SPEC.model_copy(update={"parts": [SPEC.parts[1]]})  # nozzle without its host
    with pytest.raises(SpecInvalid) as e:
        build_meshes(bad)
    assert e.value.report.errors[0].code == "host_missing"


def test_glb_has_one_named_node_per_part_with_extras():
    glb, meta = build_glb(SPEC)
    doc = glb_json(glb)
    nodes = {n["name"]: n for n in doc["nodes"] if "name" in n}
    assert set(nodes) >= {"shell", "N7"}
    assert nodes["N7"]["extras"] == {
        "name": "Nozzle N7",
        "group": "Nozzle",
        "shape": "nozzle",
        "params": SPEC.parts[1].params,
    }
    assert meta["top_m"] == pytest.approx(8.0)
    assert [p["id"] for p in meta["parts"]] == ["shell", "N7"]
    assert meta["triangles"] == sum(p["triangles"] for p in meta["parts"])


def test_glb_loads_back_in_trimesh():
    glb, _ = build_glb(SPEC)
    scene = trimesh.load(io.BytesIO(glb), file_type="glb")
    assert len(scene.geometry) == 2


def test_build_is_deterministic():
    assert build_glb(SPEC)[0] == build_glb(SPEC)[0]


def test_inject_keeps_the_binary_chunk_and_4_byte_alignment():
    glb, _ = build_glb(SPEC)
    out = inject_node_extras(glb, {"shell": {"k": "v" * 7}})
    assert len(out) % 4 == 0
    assert struct.unpack_from("<I", out, 8)[0] == len(out)
    shell = next(n for n in glb_json(out)["nodes"] if n.get("name") == "shell")
    assert shell["extras"] == {"k": "v" * 7}
    assert out.endswith(glb[-64:])  # the BIN chunk's tail is untouched
