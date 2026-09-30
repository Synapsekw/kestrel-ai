"""R3: the snapshot spec's wire form and key (spec 2026-09-26-reports §9.1, §9.5)."""

import json
from types import SimpleNamespace

import pytest
from report_snapshot_vectors import FIXTURE, VECTORS, build

from app.reports.snapshots import RENDERER_VERSION
from app.reports.snapshots.keys import MAX_SPEC_CHARS, canonical_json, decode_spec, encode_spec, key_of


def test_canonical_json_sorts_escapes_non_ascii_keeps_nulls_and_writes_integral_floats_as_integers():
    assert canonical_json(VECTORS[0]["spec"]) == (
        '{"annotation_id":"box-1","colour":"#ff5a4f","context":3,"image_id":"img-1","inset":false,'
        '"kind":"image_crop","label":"F-0042 \\u00b7 Crack","out":[1200,900],'
        '"ring":[[10.5,20],[110.5,20],[110.5,95.25],[10.5,95.25]]}'
    )
    assert canonical_json(VECTORS[1]["spec"]) == (
        '{"colour":"#e5af64","geometry":{"coordinates":[500012.25,4983010.5],"type":"Point"},'
        '"inset":false,"item_id":"map-1","kind":"map","label":null,"min_extent_m":40,"north":true,'
        '"out":[1200,900],"scale_bar":true}'
    )


def test_negative_zero_is_zero_nulls_stay_and_nan_is_refused():
    assert canonical_json({"a": -0.0, "b": [None, 1.5], "c": None}) == '{"a":0,"b":[null,1.5],"c":null}'
    with pytest.raises(ValueError):
        canonical_json({"a": float("nan")})


def test_a_namespace_spec_canonicalises_like_its_dict():
    spec = VECTORS[2]["spec"]
    as_ns = SimpleNamespace(
        **{k: SimpleNamespace(**v) if isinstance(v, dict) else v for k, v in spec.items()}
    )
    assert canonical_json(as_ns) == canonical_json(spec)


def test_encode_is_unpadded_base64url_and_decodes_back():
    for v in VECTORS:
        text = encode_spec(v["spec"])
        assert "=" not in text and "+" not in text and "/" not in text
        assert canonical_json(decode_spec(text)) == canonical_json(v["spec"])


@pytest.mark.parametrize(
    "bad",
    ["", "!!!", "bnVsbA", "WzFd", "x" * (MAX_SPEC_CHARS + 1)],
    ids=["empty", "not-base64", "decodes-to-null", "decodes-to-a-list", "over-the-char-limit"],
)
def test_decode_refuses_what_is_not_a_spec_object(bad):
    with pytest.raises(ValueError):
        decode_spec(bad)


def test_the_key_depends_on_the_source_and_the_renderer_version(monkeypatch):
    canonical = canonical_json(VECTORS[4]["spec"])
    key = key_of(canonical, "a")
    assert len(key) == 32 and int(key, 16) >= 0
    assert key_of(canonical, "b") != key
    monkeypatch.setattr("app.reports.snapshots.keys.RENDERER_VERSION", "999")
    assert key_of(canonical, "a") != key


def test_the_fixture_matches_the_implementation():
    assert build()["renderer_version"] == RENDERER_VERSION
    msg = "regenerate: see tests/report_snapshot_vectors.py"
    assert json.loads(FIXTURE.read_text("utf-8")) == build(), msg
