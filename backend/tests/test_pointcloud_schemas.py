"""S1 scaffold: the pydantic models mirror the contract, and the row helpers answer 404/409."""

from pathlib import Path

import pytest
import yaml
from pointclouds import insert_cloud

from app.errors import AppError
from app.pointclouds import rows, schemas

SPEC = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"
NAMES = [
    "PointCloudOut",
    "PointCloudZStats",
    "PointCloudList",
    "PointCloudCreate",
    "PointCloudWithJob",
    "PointCloudPatch",
    "PointCloudInspectRequest",
    "PointCloudFileInfo",
    "PointCloudAdmission",
    "CloudMeasurementPoint",
    "CloudMeasurementCreate",
    "CloudMeasurementUpdate",
    "CloudMeasurementResults",
    "CloudMeasurementOut",
    "CloudMeasurementList",
    "PointCloudExportRequest",
]


@pytest.mark.parametrize("name", NAMES)
def test_every_schema_has_exactly_the_contract_fields(name):
    contract = yaml.safe_load(SPEC.read_text("utf-8"))["components"]["schemas"][name]
    assert set(getattr(schemas, name).model_fields) == set(contract.get("properties", {}))


def test_point_cloud_out_from_row(handle):
    cloud_id = insert_cloud(handle, name="Chimney", point_count=21_697_184)
    out = schemas.PointCloudOut.from_row(rows.get_cloud(handle, cloud_id))
    assert out.name == "Chimney" and out.point_count == 21_697_184
    assert out.z_stats is not None and out.z_stats.p50 == pytest.approx(12.0)
    assert out.crs_source == "file" and out.scale == [0.001, 0.001, 0.001]


def test_unknown_cloud_is_404(handle):
    with pytest.raises(AppError) as e:
        rows.get_cloud(handle, "nope")
    assert e.value.status == 404 and e.value.code == "not_found"


def test_importing_cloud_is_not_ready(handle):
    cloud_id = insert_cloud(handle, status="importing")
    with pytest.raises(AppError) as e:
        rows.require_ready(handle, cloud_id)
    assert (e.value.status, e.value.code) == (409, "not_ready")


def test_cloud_folders(handle):
    assert rows.cloud_dir(handle, "c1") == handle.folder / "pointclouds" / "c1"
    assert rows.octree_dir(handle, "c1").name == "octree"
    assert rows.work_dir(handle, "c1").name == ".work"
