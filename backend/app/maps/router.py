"""GeoTIFF maps: import, tiles, runs, zones, labels, scoring, export (spec 2026-09-22-geotiff-maps).

Operations not built yet are 501 stubs; each task that lands one removes it from STUBS.
"""

from fastapi import APIRouter

from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}", tags=["maps"])

STUBS: list[tuple[str, str, str]] = [
    ("GET", "/maps", "listMaps"),
    ("POST", "/maps", "createMap"),
    ("GET", "/maps/{mapId}", "getMap"),
    ("DELETE", "/maps/{mapId}", "deleteMap"),
    ("GET", "/maps/{mapId}/preview", "getMapPreview"),
    ("GET", "/maps/{mapId}/tiles/{z}/{x}/{y}", "getMapTile"),
    ("GET", "/maps/{mapId}/runs", "listMapRuns"),
    ("POST", "/map-runs/estimate", "estimateMapRun"),
    ("POST", "/map-runs", "createMapRun"),
    ("GET", "/map-runs/{runId}", "getMapRun"),
    ("DELETE", "/map-runs/{runId}", "deleteMapRun"),
    ("POST", "/map-runs/{runId}/resume", "resumeMapRun"),
    ("GET", "/map-runs/{runId}/detections", "listMapDetections"),
    ("GET", "/map-runs/{runId}/density", "getMapDensity"),
    ("GET", "/map-runs/{runId}/score", "getMapRunScore"),
    ("GET", "/maps/{mapId}/zones", "listMapZones"),
    ("POST", "/maps/{mapId}/zones", "createMapZone"),
    ("PATCH", "/maps/{mapId}/zones/{zoneId}", "updateMapZone"),
    ("DELETE", "/maps/{mapId}/zones/{zoneId}", "deleteMapZone"),
    ("GET", "/maps/{mapId}/labels", "listMapLabels"),
    ("POST", "/maps/{mapId}/labels", "createMapLabel"),
    ("POST", "/maps/{mapId}/labels/seed", "seedMapLabels"),
    ("PATCH", "/maps/{mapId}/labels/{labelId}", "updateMapLabel"),
    ("DELETE", "/maps/{mapId}/labels/{labelId}", "deleteMapLabel"),
    ("POST", "/map-exports", "createMapExport"),
]

add_stubs(router, STUBS)
