# backend/tests/plant_helpers.py
"""Shared helpers for the plant assembler tests (plan 2026-10-03-plant-model-a1)."""

from __future__ import annotations

import json
import struct

import numpy as np

KIPIC_SITE = {
    "crs": {"epsg": 32639},
    "origin_crs": [244338.089, 3179515.69],
    "plant_north_deg": 17.9991,
    "datum": {"label": "HPFS", "el_m": 100.0},
    "source": {"kind": "assumed"},
}
COWORK_MATERIALS = [
    "Concrete_Tank", "Concrete", "Concrete_Dark", "Steel_Structure", "Steel_Dark", "Grating", "Handrail",
    "Equipment_White", "Equipment_Grey", "Insulation_Clad", "Pump_Blue", "Machine_Green", "Aluminium_Panel",
    "Pipe", "Pipe_Insulated", "Building_Wall", "Building_Roof", "Shelter_Roof", "Glass", "Ground",
    "Ground_Mainland", "Asphalt", "Paving", "Laydown", "Rock_Armour", "Slope", "Water_Pit", "Sea", "Fence",
    "Safety_Red", "Ship_Hull", "Ship_Bottom", "Ship_Deck", "Zone_Line",
]  # fmt: skip


def parse(glb: bytes) -> tuple[dict, bytes]:
    magic, version, total = struct.unpack_from("<4sII", glb, 0)
    assert magic == b"glTF" and version == 2 and total == len(glb)
    clen, ctype = struct.unpack_from("<I4s", glb, 12)
    assert ctype == b"JSON" and clen % 4 == 0
    doc = json.loads(glb[20 : 20 + clen])
    rest = glb[20 + clen :]
    binary = b""
    if rest:
        blen, btype = struct.unpack_from("<I4s", rest, 0)
        assert btype == b"BIN\x00" and blen % 4 == 0
        binary = rest[8 : 8 + blen]
    return doc, binary


def accessor(doc: dict, binary: bytes, index: int) -> np.ndarray:
    acc = doc["accessors"][index]
    view = doc["bufferViews"][acc["bufferView"]]
    dtype = np.float32 if acc["componentType"] == 5126 else np.uint32
    width = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[acc["type"]]
    data = np.frombuffer(binary, dtype, acc["count"] * width, view["byteOffset"])
    return data.reshape(acc["count"], width)


def by_name(doc: dict, name: str) -> dict:
    hits = [n for n in doc["nodes"] if n.get("name") == name]
    assert len(hits) == 1, f"{len(hits)} nodes named {name!r}"
    return hits[0]
