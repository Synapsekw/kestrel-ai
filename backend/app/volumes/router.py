"""Volume measurements: cut/fill, diff tiles, footprints, exports (spec 2026-09-23-volumes s11.1, 9-17).

Foundation F0 routes every operation as a 501 stub; each S2 unit that lands one removes it from
STUBS (and from `tests/test_contract.py::EXPECTED_STUBS`).
"""

from fastapi import APIRouter

from app.stubs import add_stubs
from app.volumes.jobs_calc import run_volume_calc  # noqa: F401 - registers `volume_calc`
from app.volumes.jobs_export import run_volume_export  # noqa: F401 - registers `volume_export`

router = APIRouter(prefix="/projects/{projectId}", tags=["volumes"])

STUBS: list[tuple[str, str, str]] = [
    ("GET", "/volumes", "listVolumeMeasurements"),
    ("POST", "/volumes", "createVolumeMeasurement"),
    ("GET", "/volumes/{measurementId}", "getVolumeMeasurement"),
    ("PATCH", "/volumes/{measurementId}", "patchVolumeMeasurement"),
    ("DELETE", "/volumes/{measurementId}", "deleteVolumeMeasurement"),
    ("POST", "/volumes/{measurementId}/calculate", "calculateVolumeMeasurement"),
    ("GET", "/volumes/{measurementId}/diff-tiles/{z}/{x}/{y}", "getVolumeDiffTile"),
    ("GET", "/volumes/{measurementId}/footprints", "getVolumeFootprints"),
    ("POST", "/volume-exports", "createVolumeExport"),
]

add_stubs(router, STUBS)
