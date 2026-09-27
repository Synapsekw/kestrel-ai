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
DR = P + "/drawings/{drawingId}"
MM = P + "/map-measurements/{mapMeasurementId}"

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
    # M-B2: plain DSM/DTM import (Task 3)
    "importElevation": ("post", P + "/elevations", "M-B2"),
    # M-B3: drawings (Task 3)
    "createDrawingInspection": ("post", P + "/drawing-inspections", "M-B3"),
    "getDrawingInspection": ("get", P + "/drawing-inspections/{inspectionId}", "M-B3"),
    "getDrawingPageThumbnail": (
        "get",
        P + "/drawing-inspections/{inspectionId}/pages/{page}/thumbnail",
        "M-B3",
    ),
    "listDrawings": ("get", P + "/drawings", "M-B3"),
    "createDrawing": ("post", P + "/drawings", "M-B3"),
    "fitDrawingGeoref": ("post", P + "/drawings/georef-fit", "M-B3"),
    "getDrawing": ("get", DR, "M-B3"),
    "patchDrawing": ("patch", DR, "M-B3"),
    "deleteDrawing": ("delete", DR, "M-B3"),
    "putDrawingGeoref": ("put", DR + "/georef", "M-B3"),
    "clearDrawingGeoref": ("delete", DR + "/georef", "M-B3"),
    "getDrawingVectorTile": ("get", DR + "/vtiles/{z}/{x}/{y}", "M-B3"),
    "getDrawingThumbnail": ("get", DR + "/thumbnail", "M-B3"),
    # M-B4: map measurements and the measurements union (Task 4)
    "listMeasurements": ("get", P + "/measurements", "M-B4"),
    "listMapMeasurements": ("get", P + "/map-measurements", "M-B4"),
    "createMapMeasurement": ("post", P + "/map-measurements", "M-B4"),
    "getMapMeasurement": ("get", MM, "M-B4"),
    "patchMapMeasurement": ("patch", MM, "M-B4"),
    "deleteMapMeasurement": ("delete", MM, "M-B4"),
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


def test_imports_are_background_jobs(spec):
    for op_id, schema in (
        ("importElevation", "SurfaceWithJob"),
        ("createDrawingInspection", "DrawingInspectionWithJob"),
        ("createDrawing", "DrawingWithJob"),
    ):
        method, path, _ = WORKSPACE_OPERATIONS[op_id]
        answer = spec["paths"][path][method]["responses"]["202"]
        assert answer["content"]["application/json"]["schema"] == {"$ref": f"#/components/schemas/{schema}"}
    assert _schemas(spec)["ElevationImportRequest"]["required"] == ["path", "name", "role"]


def test_a_georeference_carries_its_fit_and_its_quality(spec):
    s = _schemas(spec)
    georef = s["DrawingGeoref"]
    assert set(georef["required"]) == {
        "method",
        "crs_wkt",
        "epsg",
        "model",
        "points",
        "dst_crs_wkt",
        "transform",
        "rmse_m",
        "residuals_m",
        "warnings",
    }
    assert georef["properties"]["transform"]["minItems"] == georef["properties"]["transform"]["maxItems"] == 6
    points = s["DrawingGeorefPut"]["properties"]["points"]
    assert (points["minItems"], points["maxItems"]) == (2, 12)
    assert s["GeorefModel"]["enum"] == ["similarity", "affine"]
    assert s["GeorefWarning"]["properties"]["code"]["enum"] == ["rmse_high", "scale_mismatch", "shear"]
    assert s["DrawingPlacementInput"]["properties"]["method"]["enum"] == ["crs", "embedded", "none"]


def test_a_vector_tile_is_bounded(spec):
    tile = _schemas(spec)["DrawingVectorTile"]
    assert set(tile["required"]) == {"layers", "labels", "truncated"}
    assert "20 000" in tile["properties"]["truncated"]["description"]
    label = _schemas(spec)["DrawingLabel"]
    assert "layer" in label["properties"] and "layer" not in label["required"]
    op = spec["paths"][DR + "/vtiles/{z}/{x}/{y}"]["get"]
    assert {"$ref": "#/components/parameters/tilePreview"} in op["parameters"]
    assert {"$ref": "#/components/parameters/frameKey"} in op["parameters"]
    assert "no_coordinates" in op["responses"]["422"]["description"]
    assert "invalid_preview" in op["responses"]["422"]["description"]


def test_the_union_item_carries_what_the_tab_and_the_clouds_need(spec):
    s = _schemas(spec)
    assert set(s["MeasurementItem"]["required"]) == {
        "kind",
        "sub_kind",
        "id",
        "name",
        "headline",
        "unit",
        "data_type",
        "data_id",
        "status",
        "created_at",
        "updated_at",
    }
    assert s["MeasurementKind"]["enum"] == ["cloud", "volume", "map"]
    assert s["MeasurementSubKind"]["enum"] == [
        "point",
        "distance",
        "height",
        "vertical",
        "area",
        "profile",
        "volume",
    ]
    assert s["MeasurementStatus"]["enum"] == ["ready", "computing", "stale", "failed"]
    params = spec["paths"][P + "/measurements"]["get"]["parameters"]
    assert {p.get("name") for p in params} >= {"kind", "sub_kind"}
    assert {"$ref": "#/components/parameters/cursor"} in params
    assert {"$ref": "#/components/parameters/limit"} in params


def test_every_workspace_page_example_ends(spec):
    for name in ("MeasurementPage", "MapMeasurementPage"):
        schema = _schemas(spec)[name]
        assert set(schema["required"]) == {"items", "next_cursor"}
        assert schema["example"]["next_cursor"] is None, name


def test_map_measurements_are_bounded(spec):
    s = _schemas(spec)
    vertices = s["MapMeasurementCreate"]["properties"]["vertices"]
    assert (vertices["minItems"], vertices["maxItems"]) == (2, 5000)
    profile = s["MapProfileResults"]["properties"]
    assert profile["stations_m"]["maxItems"] == 2000
    assert profile["series"]["maxItems"] == 3
    assert s["MapMeasurementKind"]["enum"] == ["distance", "area", "profile"]
    create = spec["paths"][P + "/map-measurements"]["post"]["responses"]
    for code in ("invalid_surfaces", "surface_not_in_frame", "measurement_limit"):
        assert code in create["422"]["description"], code
    assert "no_site_frame" in create["409"]["description"]
    assert "not_in_site_frame" in spec["paths"][MM]["get"]["responses"]["409"]["description"]


def test_the_additive_edits_on_existing_schemas(spec):
    s = _schemas(spec)
    assert s["SurfaceKind"]["enum"] == ["cloud_dsm", "design", "dem"]
    assert "elevation_role" in s["Surface"]["required"]
    assert s["VolumeBaseKind"]["enum"] == ["toe_plane", "toe_surface", "flat", "surface", "toe_lowest"]
    assert "z" in s["BaseFit"]["properties"] and "z" not in s["BaseFit"]["required"]
    assert "material" in s["VolumeMeasurement"]["required"]
    create = s["VolumeMeasurementCreate"]
    assert create["required"] == ["name", "top_surface_id", "base"]
    assert {"polygon_native", "polygon_site", "material"} <= set(create["properties"])
    assert {"polygon_site", "material"} <= set(s["VolumeMeasurementPatch"]["properties"])
    assert s["RunCreate"]["properties"]["region"] == {"$ref": "#/components/schemas/RunRegion"}
    assert {"scope", "region_px"} <= set(s["MapRun"]["required"])
    assert s["MapRunScope"]["enum"] == ["map", "region"]
    assert "scope" in s["RunSummary"]["properties"] and "scope" not in s["RunSummary"]["required"]
    assert "category" in s["SiteArea"]["required"]
    assert s["SiteAreaCategory"]["enum"] == ["general", "laydown", "exclusion", "excavation", "other"]
    for name in ("SiteAreaCreate", "SiteAreaPatch"):
        assert "category" in s[name]["properties"]
    assert {"elevation_role", "format", "placed", "rmse_m"} <= set(s["DataItemSummary"]["properties"])
    assert "corners_site" in s["MapDetection"]["properties"]
    assert "center_site" in s["MapDensityCell"]["properties"]
    assert "ring_site" in s["VolumeFootprint"]["properties"]
    assert "polygon_site" in s["SiteArea"]["properties"]
    assert "polygon_site" in s["VolumeMeasurement"]["properties"]
    assert {"name", "captured_on", "elevation_role"} == set(s["SurfacePatch"]["properties"])
    patch_surface = spec["paths"][P + "/surfaces/{surfaceId}"]["patch"]
    assert "invalid_patch" in patch_surface["responses"]["422"]["description"]


FRAME_SITE = {
    "listMapDetections": ("get", P + "/map-runs/{runId}/detections"),
    "getMapDensity": ("get", P + "/map-runs/{runId}/density"),
    "listSiteAreas": ("get", P + "/site-areas"),
    "getVolumeFootprints": ("get", P + "/volumes/{measurementId}/footprints"),
    "getVolumeMeasurement": ("get", P + "/volumes/{measurementId}"),
    "nextUnreviewedMapDetection": ("get", P + "/map-runs/{runId}/next-unreviewed"),
}


@pytest.mark.parametrize("op_id", sorted(FRAME_SITE))
def test_the_vector_reads_take_frame_site(spec, op_id):
    method, path = FRAME_SITE[op_id]
    op = spec["paths"][path][method]
    assert op["operationId"] == op_id
    assert {"$ref": "#/components/parameters/siteFrame"} in op["parameters"]


def test_reviewing_an_accepted_defect_asks_for_confirmation(spec):
    op = spec["paths"][P + "/map-runs/{runId}/review"]["post"]
    assert "confirm_finding_delete" in {p.get("name") for p in op["parameters"]}
    assert "finding_would_be_deleted" in op["responses"]["409"]["description"]
