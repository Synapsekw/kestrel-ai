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


# --- Task 9: clouds and surfaces ---------------------------------------------------------------


def add_cloud(
    handle, path, *, crs_wkt=None, status="ready", name="site", map_id=None, captured_on=None
) -> str:
    """A PointCloud row for a LAS written by `surfaces.write_cloud`, with the header's true bounds.
    Sets every column S2 reads; F0's other columns keep their defaults."""
    import laspy

    from app.db.models import PointCloud

    with laspy.open(path) as r:
        h = r.header
        mins, maxs, n = h.mins, h.maxs, h.point_count
    with handle.session() as s:
        row = PointCloud(
            name=name,
            status=status,
            source_path=str(path),
            source_size=path.stat().st_size,
            source_sha256="ab" * 32,
            las_version="1.2",
            point_format=3,
            point_count=int(n),
            has_rgb=False,
            crs_wkt=crs_wkt,
            epsg=CRS.from_user_input(crs_wkt).to_epsg() if crs_wkt else None,
            bounds_native=[
                float(mins[0]),
                float(mins[1]),
                float(mins[2]),
                float(maxs[0]),
                float(maxs[1]),
                float(maxs[2]),
            ],
            captured_on=captured_on,
            map_id=map_id,
        )
        s.add(row)
        s.flush()
        return row.id


def add_surface(handle, spec, fn, *, name="survey", cloud_id=None, kind="cloud_dsm", method="median") -> str:
    """A ready Surface row whose surface.tif is `fn(X, Y)` written through SurfaceWriter."""
    from surfaces import write_surface

    from app.db.models import Surface
    from app.surfaces.paths import surface_path

    with handle.session() as s:
        row = Surface(name=name, kind=kind, status="building", point_cloud_id=cloud_id)
        s.add(row)
        s.flush()
        surface_id = row.id
    stats = write_surface(surface_path(handle, surface_id), spec, fn)
    with handle.session() as s:
        row = s.get(Surface, surface_id)
        row.status = "ready"
        row.crs_wkt, row.epsg, row.cell_size_m = spec.crs_wkt, spec.epsg, spec.cell_size
        row.width, row.height = spec.width, spec.height
        row.geotransform, row.bounds_native = list(spec.geotransform), list(spec.bounds)
        row.z_min, row.z_max, row.coverage_fraction = stats.z_min, stats.z_max, stats.coverage_fraction
        row.method = method
        if kind == "cloud_dsm":
            row.build_params = {
                "point_cloud_id": cloud_id or "",
                "name": name,
                "method": method,
                "cell_size_m": spec.cell_size,
                "auto_cell": False,
                "hole_fill_max_gap_m": 1.0,
                "despike_m": 1.0,
                "z_clip": None,
                "drop_noise_classes": True,
                "assume_metres": False,
            }
    return surface_id
