"""Point clouds: import, octree serving, measurements, LAZ export (spec 2026-09-23-point-clouds section 4).

Foundation F0 routes every operation as a 501 stub; each S1 unit that lands one removes it from
STUBS (and from `tests/test_contract.py::EXPECTED_STUBS`). The project-kind guard is added where
`app/api.py` includes this router.
"""

from fastapi import APIRouter

from app.pointclouds.jobs_export import run_pointcloud_export  # noqa: F401 - registers `pointcloud_export`
from app.pointclouds.jobs_import import run_pointcloud_import  # noqa: F401 - registers `pointcloud_import`
from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}", tags=["pointclouds"])

STUBS: list[tuple[str, str, str]] = [
    ("GET", "/pointclouds", "listPointClouds"),
    ("POST", "/pointclouds", "createPointCloud"),
    ("POST", "/pointclouds/inspect", "inspectPointCloudFile"),
    ("GET", "/pointclouds/{cloudId}", "getPointCloud"),
    ("PATCH", "/pointclouds/{cloudId}", "patchPointCloud"),
    ("DELETE", "/pointclouds/{cloudId}", "deletePointCloud"),
    ("GET", "/pointclouds/{cloudId}/octree/{octreeFile}", "getPointCloudOctreeFile"),
    ("GET", "/pointclouds/{cloudId}/measurements", "listCloudMeasurements"),
    ("POST", "/pointclouds/{cloudId}/measurements", "createCloudMeasurement"),
    ("PATCH", "/pointclouds/{cloudId}/measurements/{cloudMeasurementId}", "updateCloudMeasurement"),
    ("DELETE", "/pointclouds/{cloudId}/measurements/{cloudMeasurementId}", "deleteCloudMeasurement"),
    ("POST", "/pointclouds/{cloudId}/exports", "createPointCloudExport"),
]

add_stubs(router, STUBS)

# S1 units land their operations as sub-routers (plan 2026-09-24-point-clouds): each one removes
# its tuples from STUBS above and adds its router here. They inherit this router's prefix, tag and
# project-kind guard.
SUB_ROUTERS: tuple[APIRouter, ...] = ()

for _sub in SUB_ROUTERS:
    router.include_router(_sub)
