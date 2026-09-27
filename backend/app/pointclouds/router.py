"""Point clouds: import, octree serving, measurements, LAZ export (spec 2026-09-23-point-clouds section 4).

The workspace units (plan 2026-09-27-clouds-*) remove their tuples from STUBS as they land (and
from tests/test_contract.py::EXPECTED_STUBS).
"""

from fastapi import APIRouter, Depends

from app.errors import not_implemented
from app.pointclouds.jobs_export import run_pointcloud_export  # noqa: F401 - registers `pointcloud_export`
from app.pointclouds.jobs_import import run_pointcloud_import  # noqa: F401 - registers `pointcloud_import`
from app.pointclouds.jobs_profile import run_pointcloud_profile  # noqa: F401 - registers `pointcloud_profile`
from app.pointclouds.routes_clouds import sub as cloud_routes
from app.pointclouds.routes_export import sub as export_routes
from app.pointclouds.routes_measurements import sub as measurement_routes
from app.pointclouds.routes_octree import sub as octree_routes
from app.pointclouds.routes_profile import sub as profile_routes
from app.projects.service import ProjectHandle, get_project
from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}", tags=["pointclouds"])

# Point cloud workspace (spec 2026-09-26-point-cloud-workspace section 12), unit C-C0. Each C unit
# deletes its own tuples here and in tests/test_contract.py::EXPECTED_STUBS.
STUBS: list[tuple[str, str, str]] = [
    # C-B3: the cameras
    ("GET", "/pointclouds/{cloudId}/cameras", "getCloudCameras"),
    ("PUT", "/pointclouds/{cloudId}/cameras/offsets/{sourceId}", "setCloudCameraOffset"),
    # C-B4: the report views
    ("PUT", "/findings/{findingId}/view3d", "putFindingView3d"),
    ("GET", "/findings/{findingId}/view3d", "getFindingView3d"),
    ("PUT", "/pointclouds/{cloudId}/measurements/{cloudMeasurementId}/view3d", "putCloudMeasurementView3d"),
    ("GET", "/pointclouds/{cloudId}/measurements/{cloudMeasurementId}/view3d", "getCloudMeasurementView3d"),
    ("GET", "/pointclouds/{cloudId}/views", "listCloudViews"),
]

# The two report-view uploads are multipart: the shared stub's JSON `Body` would answer a multipart
# request 422 `validation_error` before it could answer 501. C-B4 deletes this set, the helper and
# the loop below together with its stubs.
UPLOAD_STUBS = {"putFindingView3d", "putCloudMeasurementView3d"}


def _upload_stub(name: str):
    def stub(handle: ProjectHandle = Depends(get_project)):
        raise not_implemented(name)

    stub.__name__ = "stub_" + name
    return stub


add_stubs(router, [s for s in STUBS if s[2] not in UPLOAD_STUBS])
for _method, _path, _name in STUBS:
    if _name in UPLOAD_STUBS:
        router.add_api_route(_path, _upload_stub(_name), methods=[_method], name=_name)

# S1 units land their operations as sub-routers (plan 2026-09-24-point-clouds): each one removes
# its tuples from STUBS above and adds its router here. They inherit this router's prefix, tag and
# project-kind guard.
SUB_ROUTERS: tuple[APIRouter, ...] = (
    cloud_routes,
    octree_routes,
    measurement_routes,
    export_routes,
    profile_routes,
)

for _sub in SUB_ROUTERS:
    router.include_router(_sub)
