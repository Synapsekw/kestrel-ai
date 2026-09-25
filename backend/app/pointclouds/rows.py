"""Where a point cloud lives on disk, and its row with the 404/409 every route needs (spec §3, §7)."""

from __future__ import annotations

from pathlib import Path

from app.db.models import PointCloud
from app.errors import AppError, not_found
from app.projects.service import ProjectHandle

OCTREE_FILES = ("metadata.json", "hierarchy.bin", "octree.bin")


def cloud_dir(handle: ProjectHandle, cloud_id: str) -> Path:
    return handle.pointclouds_dir / cloud_id


def octree_dir(handle: ProjectHandle, cloud_id: str) -> Path:
    return cloud_dir(handle, cloud_id) / "octree"


def work_dir(handle: ProjectHandle, cloud_id: str) -> Path:
    return cloud_dir(handle, cloud_id) / ".work"


def get_cloud(handle: ProjectHandle, cloud_id: str) -> PointCloud:
    with handle.session() as s:
        row = s.get(PointCloud, cloud_id)
        if row is None:
            raise not_found("point cloud", cloud_id)
        s.expunge(row)
    return row


def require_ready(handle: ProjectHandle, cloud_id: str) -> PointCloud:
    row = get_cloud(handle, cloud_id)
    if row.status != "ready":
        raise AppError("not_ready", f"point cloud {row.name} is {row.status}, not ready", 409)
    return row
