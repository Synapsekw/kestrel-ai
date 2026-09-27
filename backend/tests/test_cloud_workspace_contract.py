"""Unit C-C0: contract/openapi.yaml carries every change of the point-cloud workspace spec section 12,
the pydantic models mirror it, and the existing measurement operations still answer it."""

from pathlib import Path

import jsonschema_rs
import pytest
import yaml
from pointclouds import insert_cloud

from app.db.models import CloudMeasurement
from app.pointclouds import schemas

SPEC = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"
METHODS = ("get", "post", "put", "patch", "delete")
P = "/api/v1/projects/{projectId}"
CLOUD = P + "/pointclouds/{cloudId}"
MEAS = CLOUD + "/measurements/{cloudMeasurementId}"

NEW_RESULTS = [
    "area_m2",
    "area_surface_m2",
    "area_plan_m2",
    "perimeter_m",
    "plane_rms_m",
    "plane_tilt_deg",
    "plane_azimuth_deg",
    "uncertainty_m2",
    "ring_radius_lower_m",
    "ring_radius_upper_m",
    "ring_rms_lower_m",
    "ring_rms_upper_m",
    "profile_length_m",
    "profile_z_min",
    "profile_z_max",
    "profile_width_max_m",
    "profile_point_count",
]

# contract schema -> the pydantic model that must carry exactly its properties (Ruling 9).
# CloudMeasurementCreate / CloudMeasurementUpdate are B1's to widen, so they are not mirrored here.
MIRRORS = {
    "CloudMeasurementPoint": schemas.CloudMeasurementPoint,
    "CloudMeasurementParams": schemas.CloudMeasurementParams,
    "CloudMeasurementResults": schemas.CloudMeasurementResults,
    "CloudMeasurementOut": schemas.CloudMeasurementOut,
    "CloudMeasurementWithJob": schemas.CloudMeasurementWithJob,
    "CloudViewPose": schemas.CloudViewPose,
    "CloudClipBox": schemas.CloudClipBox,
    "CloudViewRender": schemas.CloudViewRender,
    "CloudViewOut": schemas.CloudViewOut,
}

# Response schemas the Prism mock serves: each carries its own example.
EXAMPLED = ["CloudViewOut"]


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


def _validator(spec: dict, name: str):
    return jsonschema_rs.Draft202012Validator(
        {"$ref": f"#/components/schemas/{name}", "components": spec["components"]}
    )


def _errors(spec: dict, name: str, instance) -> list[str]:
    return [e.message for e in _validator(spec, name).iter_errors(instance)]


# ------------------------------------------------------------------------------ Task 2


def test_the_measurement_kinds_and_statuses(spec):
    s = _schemas(spec)
    assert s["CloudMeasurementKind"]["enum"] == ["point", "distance", "height", "vertical", "area", "profile"]
    assert s["CloudMeasurementStatus"]["enum"] == ["ready", "computing", "failed"]


def test_a_measurement_point_may_carry_a_ring_group(spec):
    point = _schemas(spec)["CloudMeasurementPoint"]
    assert point["required"] == ["x", "y", "z", "uncertainty_m"]
    assert point["properties"]["group"] == {
        "type": ["integer", "null"],
        "minimum": 0,
        "maximum": 1,
        "description": point["properties"]["group"]["description"],
    }


def test_create_takes_up_to_200_points_params_and_a_finding(spec):
    create = _schemas(spec)["CloudMeasurementCreate"]
    assert create["required"] == ["kind", "points"]
    assert (create["properties"]["points"]["minItems"], create["properties"]["points"]["maxItems"]) == (
        1,
        200,
    )
    assert {"params", "finding_id"} <= set(create["properties"])
    params = _schemas(spec)["CloudMeasurementParams"]
    assert set(params["properties"]) == {"mode", "method", "thickness_m", "max_points", "view_dir"}
    assert params["properties"]["max_points"]["maximum"] == 500000
    for name, prop in params["properties"].items():
        assert "null" in prop["type"], name  # Ruling 4: pydantic answers an unset key as null


def test_update_links_or_unlinks_a_finding(spec):
    update = _schemas(spec)["CloudMeasurementUpdate"]
    assert update["additionalProperties"] is False
    assert update["properties"]["finding_id"]["type"] == ["string", "null"]


def test_the_results_carry_every_new_quantity_as_required_and_nullable(spec):
    results = _schemas(spec)["CloudMeasurementResults"]
    for name in NEW_RESULTS:
        assert name in results["required"], name
        assert "null" in results["properties"][name]["type"], name


def test_a_measurement_answers_its_status_params_finding_and_view(spec):
    out = _schemas(spec)["CloudMeasurementOut"]
    assert {"params", "status", "error", "job_id", "finding_id", "view"} <= set(out["required"])
    assert out["properties"]["points"]["maxItems"] == 200
    refs = [branch.get("$ref") for branch in out["properties"]["view"]["oneOf"]]
    assert "#/components/schemas/CloudViewOut" in refs


def test_a_profile_create_answers_202_with_its_job(spec):
    _, _, op = _operations(spec)["createCloudMeasurement"]
    body = op["responses"]["202"]["content"]["application/json"]["schema"]
    assert body == {"$ref": "#/components/schemas/CloudMeasurementWithJob"}
    assert "201" in op["responses"]
    for code in ("self_intersecting", "degenerate_polygon", "ring_needs_three_points", "collinear_ring"):
        assert code in op["responses"]["422"]["description"], code
    assert "profile_out_of_range" in op["responses"]["422"]["description"]


def test_delete_point_cloud_takes_delete_findings(spec):
    _, _, op = _operations(spec)["deletePointCloud"]
    params = {p["name"]: p for p in op.get("parameters", [])}
    assert params["delete_findings"]["in"] == "query"
    assert params["delete_findings"]["schema"] == {"type": "boolean"}
    assert "default" not in params["delete_findings"]["schema"]  # the default lives in the description
    assert "cloud_has_findings" in op["responses"]["409"]["description"]


def test_a_view_names_its_subject_kind_as_r_does(spec):
    assert _schemas(spec)["CloudViewSubjectKind"]["enum"] == ["finding", "cloud_measurement"]
    assert _schemas(spec)["CloudViewRender"]["properties"]["colour_mode"]["enum"] == [
        "rgb",
        "elevation",
        "intensity",
        "classification",
    ]


def test_the_new_error_codes_are_documented(spec):
    text = _schemas(spec)["Error"]["properties"]["error"]["properties"]["code"]["description"]
    for code in (
        "self_intersecting",
        "degenerate_polygon",
        "ring_needs_three_points",
        "collinear_ring",
        "profile_out_of_range",
        "invalid_finding",
        "not_retryable",
        "needs_coordinates",
        "cloud_has_findings",
        "not_a_cloud_finding",
        "bad_view_image",
        "no_view",
    ):
        assert code in text, code


# ------------------------------------------------------------------------------ every task


@pytest.mark.parametrize("name", sorted(MIRRORS))
def test_the_pydantic_model_mirrors_the_contract_schema(spec, name):
    contract = set(_schemas(spec)[name]["properties"])
    assert set(MIRRORS[name].model_fields) == contract, name


@pytest.mark.parametrize("name", EXAMPLED)
def test_the_mock_has_an_example_that_validates(spec, name):
    example = _schemas(spec)[name].get("example")
    assert example is not None, name
    assert _errors(spec, name, example) == [], name


# ------------------------------------------------------------------------------ live answers


def _url(project_id: str, cloud_id: str) -> str:
    return f"/api/v1/projects/{project_id}/pointclouds/{cloud_id}/measurements"


def test_a_saved_measurement_answers_the_new_fields_and_validates(spec, client, project_id, handle):
    cloud_id = insert_cloud(handle)
    pts = [
        {"x": 243500, "y": 3178000, "z": 0, "uncertainty_m": 0.01},
        {"x": 243503, "y": 3178004, "z": 12, "uncertainty_m": 0.01},
    ]
    r = client.post(_url(project_id, cloud_id), json={"kind": "distance", "points": pts})
    assert r.status_code == 201, r.text
    m = r.json()
    assert (m["status"], m["params"], m["error"], m["job_id"], m["finding_id"], m["view"]) == (
        "ready",
        None,
        None,
        None,
        None,
        None,
    )
    assert all(m["results"][name] is None for name in NEW_RESULTS)
    assert _errors(spec, "CloudMeasurementOut", m) == []
    assert _errors(spec, "CloudMeasurementList", client.get(_url(project_id, cloud_id)).json()) == []


def test_a_legacy_row_still_lists_and_validates(spec, client, project_id, handle):
    """A row written before 0013: points without `group`, results with only the 15 old keys."""
    cloud_id = insert_cloud(handle)
    with handle.session() as s:
        s.add(
            CloudMeasurement(
                point_cloud_id=cloud_id,
                kind="point",
                name="Point 1",
                points=[{"x": 243522.1, "y": 3178252.4, "z": -44.3, "uncertainty_m": 0.02}],
                results={"lon": 48.37, "lat": 28.70, "uncertainty_m": 0.02},
            )
        )
    listed = client.get(_url(project_id, cloud_id)).json()
    assert [(i["status"], i["points"][0]["group"]) for i in listed["items"]] == [("ready", None)]
    assert _errors(spec, "CloudMeasurementList", listed) == []
