"""R3 x R0: the renderers read R0's SnapshotSpec models, every parity vector is a valid spec in its
canonical form, and snapshot_ref fills SnapshotRef (index "SnapshotSpec kinds")."""

import json

from report_snapshot_helpers import add_image
from report_snapshot_vectors import FIXTURE

from app.reports.schemas import SnapshotRef
from app.reports.snapshots.image_crop import ring_of
from app.reports.snapshots.keys import canonical_json, decode_spec, encode_spec
from app.reports.snapshots.render import parse_spec, render_result, snapshot_ref


def _vectors():
    return json.loads(FIXTURE.read_text("utf-8"))["cases"]


def test_every_vector_parses_as_r0s_model_and_keeps_its_canonical_form():
    for v in _vectors():
        spec = parse_spec(v["spec"])
        assert spec.kind == v["spec"]["kind"], v["name"]
        assert canonical_json(spec) == v["canonical"], v["name"]


def test_a_spec_survives_the_wire_unchanged():
    for v in _vectors():
        once = parse_spec(v["spec"])
        twice = parse_spec(decode_spec(encode_spec(once)))
        assert canonical_json(twice) == canonical_json(once), v["name"]


def test_snapshot_ref_carries_key_size_and_missing_reason(handle):
    spec = parse_spec(
        {
            "kind": "image_crop",
            "image_id": "gone",
            "ring": [[1.0, 1.0]],
            "colour": "#ff5a4f",
            "label": "F-0001 · Crack",
            "context": 3.0,
            "out": [1200, 900],
            "inset": False,
        }
    )
    ref = snapshot_ref(handle, spec)
    assert isinstance(ref, SnapshotRef)
    assert (ref.width_px, ref.height_px) == (1200, 900)
    assert ref.missing_reason == "The image was deleted" and len(ref.key) == 32


def test_the_renderers_read_r0s_models(handle):
    image_id = add_image(handle, "r0.jpg", (2000, 1500))
    spec = parse_spec(
        {
            "kind": "image_crop",
            "image_id": image_id,
            "ring": ring_of("box", 900, 700, 200, 100),
            "colour": "#ff5a4f",
            "label": "F-0001 · Crack",
            "context": 3.0,
            "out": [1200, 900],
            "inset": False,
        }
    )
    result = render_result(handle, spec)
    assert result.missing_reason is None and result.path.is_file()
    assert snapshot_ref(handle, spec).key == result.key
