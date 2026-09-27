"""Images unit I-C0: contract/openapi.yaml carries spec 2026-09-26-image-inspection §14 and the §11
fields. These tests read only the YAML; test_contract.py checks routing and responses."""

from pathlib import Path

import pytest
import yaml

SPEC = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"
METHODS = ("get", "post", "put", "patch", "delete")
I_TAGS = {"images", "boxes", "image-detect", "assist"}


@pytest.fixture(scope="module")
def spec() -> dict:
    return yaml.safe_load(SPEC.read_text("utf-8"))


def _schemas(spec: dict) -> dict:
    return spec["components"]["schemas"]


def _operations(spec: dict) -> dict[str, tuple[str, str, dict]]:
    return {
        op["operationId"]: (method, path, op)
        for path, ops in spec["paths"].items()
        for method, op in ops.items()
        if method in METHODS
    }


def _props(spec: dict, name: str) -> tuple[set[str], set[str]]:
    """(properties, required) of a schema, following one level of allOf."""
    schema = _schemas(spec)[name]
    parts = schema.get("allOf", [schema])
    props: set[str] = set()
    required: set[str] = set()
    for part in parts:
        if "$ref" in part:
            p, r = _props(spec, part["$ref"].rsplit("/", 1)[1])
        else:
            p, r = set(part.get("properties", {})), set(part.get("required", []))
        props |= p
        required |= r
    return props, required


def test_image_gains_finding_aggregates(spec):
    props, required = _props(spec, "Image")
    assert {"finding_count", "worst_severity", "reviewed"} <= required


def test_image_detail_is_image_plus_camera_and_footprint(spec):
    props, required = _props(spec, "ImageDetail")
    assert {"camera", "footprint", "footprint_kind", "id", "path"} <= required
    camera_required = set(_schemas(spec)["ImageCamera"]["required"])
    assert camera_required == {
        "rel_alt", "gimbal_pitch", "gimbal_yaw", "focal_mm", "focal_px", "sensor_w_mm",
        "lrf_distance_m", "subject_distance_m", "distance_m", "distance_sigma_m",
        "distance_source", "gsd_mm", "camera_model",
    }  # fmt: skip
    ops = _operations(spec)
    for op_id in ("getImage", "updateImage"):
        schema = ops[op_id][2]["responses"]["200"]["content"]["application/json"]["schema"]
        assert schema == {"$ref": "#/components/schemas/ImageDetail"}, op_id


def test_image_update_takes_a_subject_distance_and_requires_nothing(spec):
    update = _schemas(spec)["ImageUpdate"]
    assert set(update["properties"]) == {"marked_empty", "subject_distance_m"}
    assert "required" not in update


def test_box_gains_its_shape_fields(spec):
    _, required = _props(spec, "Box")
    assert {"shape", "points", "assist", "area_px", "updated_at"} <= required
    assert _schemas(spec)["BoxShape"]["enum"] == ["box", "rbox", "polygon", "point"]
    assert _schemas(spec)["BoxCreate"]["required"] == ["class_id"]
    assert {"shape", "points", "assist"} <= set(_schemas(spec)["BoxCreate"]["properties"])
    assert "points" in _schemas(spec)["BoxUpdate"]["properties"]


def test_box_writes_answer_repaired_and_finding_id(spec):
    _, required = _props(spec, "BoxWriteResult")
    assert {"repaired", "finding_id", "id", "shape"} <= required
    ops = _operations(spec)
    create = ops["createBox"][2]["responses"]
    update = ops["updateBox"][2]["responses"]
    assert create["201"]["content"]["application/json"]["schema"]["$ref"].endswith("/BoxWriteResult")
    assert update["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/BoxWriteResult")
    assert "422" in create and "422" in update


def test_review_answers_the_finding_ids(spec):
    required = set(_schemas(spec)["BoxReviewResult"]["required"])
    assert {"updated", "finding_ids_created", "finding_ids_deleted"} <= required
    assert "409" in _operations(spec)["reviewBoxes"][2]["responses"]


def test_list_images_takes_the_browser_filters(spec):
    names = set()
    for p in _operations(spec)["listImages"][2]["parameters"]:
        if "$ref" in p:
            names.add(spec["components"]["parameters"][p["$ref"].rsplit("/", 1)[1]]["name"])
        else:
            names.add(p["name"])
    wanted = {
        "has_findings", "severity", "finding_status", "type_ids", "has_suggestions", "reviewed", "unlabeled",
    }  # fmt: skip
    assert wanted <= names
    sort = next(p for p in _operations(spec)["listImages"][2]["parameters"] if p.get("name") == "sort")
    assert "worst_severity" in sort["schema"]["enum"]


def test_preannotate_is_deprecated_until_its_last_caller_goes(spec):
    op = _operations(spec)["preannotateImage"][2]
    assert op["deprecated"] is True
    assert op["x-retire-with"] == "I-FW"


def test_no_request_property_of_ours_carries_a_default(spec):
    """ADR 2026-09-20: a request `default` makes the generated TypeScript field required."""
    for name in ("BoxCreate", "BoxUpdate", "ImageUpdate"):
        for prop, schema in _schemas(spec)[name]["properties"].items():
            assert "default" not in schema, (name, prop)


# Schemas this unit (or a later images unit building on it) owns; walked below for the YAML
# flow-mapping comma bug. Extended as later images tasks add schemas of their own.
I_SCHEMA_NAMES = {
    "Image", "ImageCamera", "ImageFootprintKind", "ImageDetail", "ImageUpdate",
    "BoxShape", "BoxWriteResult", "BoxReviewResult", "BoxCreate", "BoxUpdate",
}  # fmt: skip


def _phantom_keys(node, path):
    """A YAML flow mapping `{ ..., description: a, b }` with an unquoted comma inside the
    description text splits into a phantom key `b` with value None (yaml.safe_load gives
    `{"description": "a", "b": None}`); every real OpenAPI/JSON Schema key is a single token
    without spaces, so a None-valued key containing a space is always this bug."""
    found = []
    if isinstance(node, dict):
        for k, v in node.items():
            if v is None and isinstance(k, str) and " " in k:
                found.append((path, k))
            found += _phantom_keys(v, path + [k])
    elif isinstance(node, list):
        for i, v in enumerate(node):
            found += _phantom_keys(v, path + [i])
    return found


def test_no_flow_mapping_comma_truncates_a_description(spec):
    schemas = {name: _schemas(spec)[name] for name in I_SCHEMA_NAMES}
    found = _phantom_keys(schemas, [])
    assert found == [], found
