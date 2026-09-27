"""M-C0: contract/openapi.yaml carries the map-workspace API (spec 2026-09-26-map-workspace §12).

These tests read only the YAML; `test_contract.py` checks that the backend routes it and
`pnpm -C contract check` lints it. Every operation is listed with the unit that replaces its stub.
"""

from pathlib import Path

import pytest
import yaml

SPEC = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"
METHODS = ("get", "post", "put", "patch", "delete")
P = "/api/v1/projects/{projectId}"

# operationId -> (method, path, the unit that replaces its 501 stub)
WORKSPACE_OPERATIONS: dict[str, tuple[str, str, str]] = {
    # M-B1: frame, state, surveys, layers, site tiles, anchors, findings in view, sample (Task 1)
    "getMapWorkspace": ("get", P + "/map-workspace", "M-B1"),
    "putMapWorkspace": ("put", P + "/map-workspace", "M-B1"),
    "setSiteFrame": ("put", P + "/map-workspace/frame", "M-B1"),
    "listWorkspaceSurveys": ("get", P + "/map-workspace/surveys", "M-B1"),
    "listWorkspaceLayers": ("get", P + "/map-workspace/layers", "M-B1"),
    "convertAnchor": ("post", P + "/map-workspace/anchor", "M-B1"),
    "listMapFindingsInView": ("get", P + "/map-workspace/findings", "M-B1"),
    "sampleInFrame": ("post", P + "/map-workspace/sample", "M-B1"),
    "getSiteTile": ("get", P + "/site-tiles/{kind}/{layerId}/{z}/{x}/{y}", "M-B1"),
}


@pytest.fixture(scope="module")
def spec() -> dict:
    return yaml.safe_load(SPEC.read_text("utf-8"))


def _schemas(spec: dict) -> dict:
    return spec["components"]["schemas"]


@pytest.mark.parametrize("op_id", sorted(WORKSPACE_OPERATIONS))
def test_each_operation_is_in_the_contract_under_the_workspace_tag(spec, op_id):
    method, path, _ = WORKSPACE_OPERATIONS[op_id]
    op = spec["paths"][path][method]
    assert op["operationId"] == op_id
    assert op["tags"] == ["workspace"]
    assert op["responses"]["default"] == {"$ref": "#/components/responses/Error"}


def test_the_workspace_tag_is_declared(spec):
    assert {"name": "workspace"} in spec["tags"]


def test_every_workspace_tagged_operation_is_listed(spec):
    tagged = {
        op["operationId"]
        for ops in spec["paths"].values()
        for m, op in ops.items()
        if m in METHODS and "workspace" in op.get("tags", [])
    }
    assert tagged == set(WORKSPACE_OPERATIONS)


def test_site_tiles_take_negative_columns_and_z_up_to_20(spec):
    params = spec["components"]["parameters"]
    assert params["siteZ"]["schema"] == {"type": "integer", "minimum": 0, "maximum": 20}
    assert "minimum" not in params["siteX"]["schema"]
    assert "minimum" not in params["siteY"]["schema"]
    assert params["siteTileKind"]["name"] == "kind"
    assert (params["tilePreview"]["name"], params["frameKey"]["name"]) == ("t", "frame_key")
    tile_params = spec["paths"][P + "/site-tiles/{kind}/{layerId}/{z}/{x}/{y}"]["get"]["parameters"]
    assert {"$ref": "#/components/parameters/tilePreview"} in tile_params
    assert {"$ref": "#/components/parameters/frameKey"} in tile_params
    assert _schemas(spec)["SiteTileKind"]["enum"] == ["map", "surface", "volume_diff", "drawing_raster"]


def test_the_frame_and_the_findings_in_view_use_the_foundation_names(spec):
    s = _schemas(spec)
    assert set(s["SiteFrame"]["required"]) == {"kind", "crs_wkt", "epsg", "proj4", "name"}
    assert set(s["MapFindingPin"]["required"]) == {
        "id",
        "number",
        "type_id",
        "severity",
        "status",
        "created_by",
        "map_id",
        "geometry_site",
    }
    assert s["MapFindingsInView"]["properties"]["items"]["maxItems"] == 5000
    assert s["ElevationRole"]["enum"] == ["dsm", "dtm"]
    assert s["DrawingFormat"]["enum"] == ["dxf", "pdf", "png", "jpg", "tif", "landxml"]
