# backend/tests/plant_helpers.py
"""Shared helpers for the plant assembler tests (plan 2026-10-03-plant-model-a1)."""

from __future__ import annotations

import csv
import json
import struct

import numpy as np

from app.db.models import AssetModel, AssetModelVersion
from app.jobs.cancellation import JobCancelled

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


class Ctx:
    """A stand-in job context; `cancel_after` makes the n+1-th cancel check raise."""

    def __init__(self, handle, params, cancel_after: int | None = None):
        self.project, self.params, self.job_id = handle, params, "job-glb"
        self.published: list = []
        self.messages: list = []
        self._checks = 0
        self._cancel_after = cancel_after

    def progress(self, fraction, message=""):
        self.messages.append((fraction, message))

    def publish(self, type_, payload):
        self.published.append((type_, payload))

    def check_cancelled(self):
        self._checks += 1
        if self._cancel_after is not None and self._checks > self._cancel_after:
            raise JobCancelled()


def seed_version(
    handle, spec: dict, *, model_id: str | None = None, version: int = 1, glb_status="pending"
) -> str:
    with handle.session() as s:
        if model_id is None:
            model = AssetModel(name="Plant", status="ready", current_version=version)
            s.add(model)
            s.flush()
            model_id = model.id
        s.add(
            AssetModelVersion(
                model_id=model_id,
                version=version,
                spec=spec,
                kind="manual",
                glb_status=glb_status,
                source_ids=[],
                part_count=len(spec.get("parts", [])),
            )
        )
    return model_id


def read_csv(path) -> list[dict]:
    with open(path, encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))
