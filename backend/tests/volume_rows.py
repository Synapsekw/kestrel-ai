"""Database rows for the volume tests: maps with detection runs (Task 7), clouds and surfaces
(Task 9). Rows are inserted directly; no map raster or octree is needed for masking or volumes."""

from __future__ import annotations

from datetime import UTC, datetime

from pyproj import CRS

from app.db.models import GeoMap, Job, MapDetection, MapRun


def add_map_run(
    handle,
    *,
    crs_wkt: str,
    geotransform: list[float],
    boxes: list[tuple[float, float, float, float]],
    width: int = 4000,
    height: int = 4000,
    class_id: str = "c-excavator",
    confidences: list[float] | None = None,
    conf: float = 0.25,
    state: str = "succeeded",
    name: str = "ortho",
) -> tuple[str, str, list[str]]:
    """A ready map, one run whose job is in `state`, and one detection per pixel box (x, y, w, h).
    Returns (map_id, run_id, detection_ids)."""
    confidences = confidences or [0.9] * len(boxes)
    with handle.session() as s:
        gmap = GeoMap(
            name=name,
            status="ready",
            source_path="D:/orthos/site.tif",
            source_size=1,
            width=width,
            height=height,
            band_count=3,
            dtype="uint8",
            crs_wkt=crs_wkt,
            epsg=CRS.from_user_input(crs_wkt).to_epsg(),
            geotransform=geotransform,
        )
        s.add(gmap)
        s.flush()
        job = Job(
            type="map_detect", state=state, finished_at=datetime.now(UTC) if state == "succeeded" else None
        )
        s.add(job)
        s.flush()
        run = MapRun(map_id=gmap.id, kind="local_model", model_name="machinery-v3", conf=conf, job_id=job.id)
        s.add(run)
        s.flush()
        ids = []
        for (x, y, w, h), c in zip(boxes, confidences, strict=True):
            d = MapDetection(run_id=run.id, class_id=class_id, confidence=c, x=x, y=y, w=w, h=h)
            s.add(d)
            s.flush()
            ids.append(d.id)
        return gmap.id, run.id, ids
