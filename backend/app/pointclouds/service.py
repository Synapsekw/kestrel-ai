"""Point clouds: rows, inspect, create, patch (link rules, assigned CRS), delete (spec §4, §6, §10)."""

from __future__ import annotations

import shutil
from collections.abc import Callable
from pathlib import Path

from sqlalchemy import select

from app.db.models import GeoMap, Job, PointCloud
from app.errors import AppError, not_found
from app.pointclouds import admission, converter_path, rows
from app.pointclouds.crs import bounds_wgs84, crs_from_epsg
from app.pointclouds.lasfile import HeaderInfo, UnsupportedCloud, inspect_file
from app.pointclouds.schemas import (
    PointCloudAdmission,
    PointCloudCreate,
    PointCloudFileInfo,
    PointCloudPatch,
)
from app.projects.service import ProjectHandle

LIVE = ("queued", "running")


def converter_installed() -> bool:
    return converter_path.converter_exe() is not None


def _file(path_text: str) -> Path:
    path = Path(path_text)
    if not path.is_file():
        # 404, not 422: a well-formed path that is not a file is a missing resource, and the
        # contract's positive-data-acceptance check forbids a 422 for a schema-valid body.
        raise not_found("point cloud file", str(path))
    return path


def _header(path: Path) -> HeaderInfo:
    try:
        return inspect_file(path)
    except UnsupportedCloud as e:
        raise AppError("unsupported_point_cloud", str(e), 422) from None


def _assess(handle: ProjectHandle, info: HeaderInfo) -> admission.Admission:
    return admission.assess(info.point_count, info.size, info.record_len, handle.pointclouds_dir)


def list_clouds(handle: ProjectHandle) -> list[PointCloud]:
    with handle.session() as s:
        items = list(s.execute(select(PointCloud).order_by(PointCloud.created_at.desc())).scalars())
        for c in items:
            s.expunge(c)
    return items


def inspect(handle: ProjectHandle, path_text: str) -> PointCloudFileInfo:
    path = _file(path_text)
    info = _header(path)
    adm = _assess(handle, info).as_dict()
    if not converter_installed():
        adm.update(ok=False, reason=converter_path.NOT_INSTALLED)
    return PointCloudFileInfo(
        path=str(path),
        size=info.size,
        compressed=info.compressed,
        las_version=info.las_version,
        point_format=info.point_format,
        point_count=info.point_count,
        has_rgb=info.has_rgb,
        header_bounds=info.header_bounds,
        crs_wkt=info.crs.crs_wkt,
        epsg=info.crs.epsg,
        captured_on=info.captured_on,
        admission=PointCloudAdmission(**adm),
    )


def overlaps(a: list[float], b: list[float]) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _map_for_link(s, map_id: str) -> GeoMap:
    gmap = s.get(GeoMap, map_id)
    if gmap is None:
        raise not_found("map", map_id)
    if gmap.status != "ready":
        # Cross-plan rule: a resource whose import has not finished or failed is 409 not_ready.
        raise AppError("not_ready", f"map {gmap.name} is {gmap.status}, not ready", 409)
    return gmap


def _check_link(gmap: GeoMap, cloud_crs_wkt: str | None, cloud_wgs84: list[float] | None) -> None:
    if not cloud_crs_wkt or not cloud_wgs84 or not gmap.crs_wkt or not gmap.bounds_wgs84:
        raise AppError(
            "link_needs_coordinates", "linking needs coordinates on both the cloud and the map", 422
        )
    if not overlaps(cloud_wgs84, gmap.bounds_wgs84):
        raise AppError("no_overlap", f"the map {gmap.name} does not overlap this cloud", 422)


def create_cloud(handle: ProjectHandle, body: PointCloudCreate) -> PointCloud:
    path = _file(body.path)
    info = _header(path)
    adm = _assess(handle, info)
    if not adm.ok:
        raise AppError(adm.code, adm.reason, 422)
    with handle.session() as s:
        if body.map_id:
            gmap = _map_for_link(s, body.map_id)
            header_wgs84 = bounds_wgs84(info.header_bounds, info.crs.crs_wkt) if info.crs.crs_wkt else None
            _check_link(gmap, info.crs.crs_wkt, header_wgs84)
        st = path.stat()
        row = PointCloud(
            name=body.name or path.stem,
            status="importing",
            source_path=str(path.resolve()),
            source_size=st.st_size,
            source_sha256="",
            source_mtime=st.st_mtime,
            las_version=info.las_version,
            point_format=info.point_format,
            point_count=info.point_count,
            has_rgb=info.has_rgb,
            scale=info.scale,
            map_id=body.map_id,
        )
        s.add(row)
        s.flush()
        s.expunge(row)
    return row


def set_job(handle: ProjectHandle, cloud_id: str, job_id: str) -> PointCloud:
    with handle.session() as s:
        row = s.get(PointCloud, cloud_id)
        row.job_id = job_id
        s.flush()
        s.expunge(row)
    return row


def patch_cloud(handle: ProjectHandle, cloud_id: str, body: PointCloudPatch) -> PointCloud:
    fields = body.model_fields_set
    with handle.session() as s:
        row = s.get(PointCloud, cloud_id)
        if row is None:
            raise not_found("point cloud", cloud_id)
        gmap = _map_for_link(s, body.map_id) if "map_id" in fields and body.map_id else None  # 404 first
        crs_wkt, wgs84 = row.crs_wkt, row.bounds_wgs84
        assigned = None
        if "assign_epsg" in fields and body.assign_epsg is not None:
            if row.crs_wkt:
                raise AppError(
                    "crs_already_set", "this cloud already has a coordinate system from its file", 422
                )
            try:
                assigned = crs_from_epsg(body.assign_epsg)
            except ValueError as e:
                raise AppError("invalid_epsg", str(e), 422) from None
            crs_wkt = assigned.crs_wkt
            wgs84 = bounds_wgs84(row.bounds_native, crs_wkt) if row.bounds_native else None
        if gmap is not None:
            _check_link(gmap, crs_wkt, wgs84)
        if assigned is not None:
            row.crs_wkt, row.epsg, row.proj4 = assigned.crs_wkt, assigned.epsg, assigned.proj4
            row.vertical_crs, row.crs_source, row.bounds_wgs84 = None, "assigned", wgs84
        if "map_id" in fields:
            row.map_id = body.map_id
        if "name" in fields and body.name:
            row.name = body.name
        if "captured_on" in fields:
            row.captured_on = body.captured_on
        s.flush()
        s.expunge(row)
    return row


def delete_cloud(handle: ProjectHandle, cloud_id: str, is_live: Callable[[str], bool]) -> None:
    with handle.session() as s:
        row = s.get(PointCloud, cloud_id)
        if row is None:
            raise not_found("point cloud", cloud_id)
        exports = s.execute(
            select(Job.id, Job.params).where(Job.type == "pointcloud_export", Job.state.in_(LIVE))
        ).all()
        job_ids = [row.job_id, *(j for j, params in exports if (params or {}).get("cloud_id") == cloud_id)]
        if any(j and is_live(j) for j in job_ids):
            raise AppError(
                "job_running", "the point cloud has an import or export running; cancel it first", 409
            )
        s.delete(row)  # measurements go with it (ON DELETE CASCADE)
    shutil.rmtree(rows.cloud_dir(handle, cloud_id), ignore_errors=True)
