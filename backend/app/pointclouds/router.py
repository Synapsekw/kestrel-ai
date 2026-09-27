"""Point clouds: import, octree serving, measurements, LAZ export (spec 2026-09-23-point-clouds section 4).

The workspace units (plan 2026-09-27-clouds-*) remove their tuples from STUBS as they land (and
from tests/test_contract.py::EXPECTED_STUBS).
"""

from fastapi import APIRouter

from app.pointclouds.jobs_export import run_pointcloud_export  # noqa: F401 - registers `pointcloud_export`
from app.pointclouds.jobs_import import run_pointcloud_import  # noqa: F401 - registers `pointcloud_import`
from app.pointclouds.jobs_profile import run_pointcloud_profile  # noqa: F401 - registers `pointcloud_profile`
from app.pointclouds.routes_cameras import sub as camera_routes
from app.pointclouds.routes_clouds import sub as cloud_routes
from app.pointclouds.routes_export import sub as export_routes
from app.pointclouds.routes_measurements import sub as measurement_routes
from app.pointclouds.routes_octree import sub as octree_routes
from app.pointclouds.routes_profile import sub as profile_routes
from app.pointclouds.routes_views import sub as view_routes
from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}", tags=["pointclouds"])

# Point cloud workspace (spec 2026-09-26-point-cloud-workspace section 12), unit C-C0. Each C unit
# deletes its own tuples here and in tests/test_contract.py::EXPECTED_STUBS.
STUBS: list[tuple[str, str, str]] = []

add_stubs(router, STUBS)

# S1 units land their operations as sub-routers (plan 2026-09-24-point-clouds): each one removes
# its tuples from STUBS above and adds its router here. They inherit this router's prefix, tag and
# project-kind guard.
SUB_ROUTERS: tuple[APIRouter, ...] = (
    cloud_routes,
    octree_routes,
    measurement_routes,
    export_routes,
    camera_routes,
    view_routes,
    profile_routes,
)

for _sub in SUB_ROUTERS:
    router.include_router(_sub)
