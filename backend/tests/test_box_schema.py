"""The JSON schema cloud providers are constrained to, and parsing their payloads (spec section 8)."""

import pytest

from app.providers.base import ProviderError, Tile
from app.providers.schema import box_list_schema, parse_boxes, prompt_for

CLASSES = ["excavator", "dump_truck"]
TILE = Tile(index=1, x=1024, y=0, w=1280, h=1280)


def box(**over):
    return {"label": "dump_truck", "x": 0.5, "y": 0.5, "w": 0.1, "h": 0.2, "confidence": 0.8, **over}


def test_schema_constrains_labels_to_the_project_classes():
    item = box_list_schema(CLASSES)["properties"]["boxes"]["items"]
    assert item["properties"]["label"]["enum"] == CLASSES
    assert item["additionalProperties"] is False
    assert sorted(item["required"]) == ["confidence", "h", "label", "w", "x", "y"]


def test_schema_is_a_closed_object_with_a_boxes_array():
    schema = box_list_schema(CLASSES)
    assert schema["type"] == "object"
    assert schema["required"] == ["boxes"]
    assert schema["additionalProperties"] is False
    assert schema["properties"]["boxes"]["type"] == "array"


def test_normalised_coordinates_become_full_image_pixels():
    (det,) = parse_boxes({"boxes": [box()]}, TILE, CLASSES, "runs/j/tiles/i/1.json")
    assert (det.x, det.y, det.w, det.h) == (1664, 640, 128, 256)
    assert det.label == "dump_truck"
    assert det.confidence == 0.8
    assert det.raw_ref == "runs/j/tiles/i/1.json"


def test_out_of_range_coordinates_are_clamped_to_the_tile():
    (det,) = parse_boxes({"boxes": [box(x=-0.5, y=0.9, w=2.0, h=0.5)]}, TILE, CLASSES, "r")
    assert (det.x, det.y) == (1024, 1152)
    assert (det.w, det.h) == (1280, 128)


def test_confidence_is_clamped_to_the_unit_interval():
    (det,) = parse_boxes({"boxes": [box(confidence=1.7)]}, TILE, CLASSES, "r")
    assert det.confidence == 1.0


def test_unknown_labels_and_zero_area_boxes_are_dropped():
    payload = {"boxes": [box(label="ufo"), box(w=0.0), box(h=-0.1), box()]}
    assert len(parse_boxes(payload, TILE, CLASSES, "r")) == 1


def test_an_empty_result_parses_to_no_detections():
    assert parse_boxes({"boxes": []}, TILE, CLASSES, "r") == []


@pytest.mark.parametrize(
    "payload",
    [
        {"detections": []},
        {"boxes": "none"},
        {"boxes": [{"label": "dump_truck", "x": "left", "y": 0.1, "w": 0.1, "h": 0.1, "confidence": 0.5}]},
        {"boxes": [{"label": "dump_truck"}]},
        [],
    ],
)
def test_a_malformed_payload_is_a_permanent_provider_error(payload):
    with pytest.raises(ProviderError) as e:
        parse_boxes(payload, TILE, CLASSES, "r")
    assert e.value.retryable is False


def test_the_prompt_names_the_query_and_every_class():
    text = prompt_for("dump trucks", CLASSES)
    assert "dump trucks" in text
    assert all(c in text for c in CLASSES)
    assert '{"boxes": []}' in text
