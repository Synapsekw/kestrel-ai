"""Shared helpers for publishing a websocket domain event keyed by a list of changed ids.

`images.changed` (bulk delete, mark empty), `boxes.changed` (promote, unpromote, mark empty),
`pointclouds.changed`, `surfaces.changed` and `volumes.changed` are all just "these rows changed;
go refetch them" — same envelope, same skip-when-empty rule, built on `_publish_ids_changed`.
"""

from __future__ import annotations

from fastapi import Request

from app.projects.service import ProjectHandle


def _publish_ids_changed(
    request: Request, handle: ProjectHandle, event_type: str, key: str, ids: list[str]
) -> None:
    """Publish `{key: ids}` as `event_type`; nothing when `ids` is empty."""
    if not ids:
        return
    request.app.state.events.publish(
        {
            "type": event_type,
            "project_id": handle.id,
            "job_id": None,
            "progress": None,
            "message": "",
            "payload": {key: list(ids)},
        }
    )


def publish_image_ids_event(
    request: Request, handle: ProjectHandle, event_type: str, image_ids: list[str]
) -> None:
    _publish_ids_changed(request, handle, event_type, "image_ids", image_ids)


def publish_map_labels_changed_event(request: Request, handle: ProjectHandle, map_id: str) -> None:
    """A zone or label under `map_id` changed: the UI should refetch it (spec section 8)."""
    request.app.state.events.publish(
        {
            "type": "map_labels.changed",
            "project_id": handle.id,
            "job_id": None,
            "progress": None,
            "message": "",
            "payload": {"map_id": map_id},
        }
    )


def publish_pointclouds_changed(request: Request, handle: ProjectHandle, cloud_ids: list[str]) -> None:
    """`pointclouds.changed {cloud_ids}` (spec 2026-09-23-point-clouds section 4.3)."""
    _publish_ids_changed(request, handle, "pointclouds.changed", "cloud_ids", cloud_ids)


def publish_surfaces_changed(request: Request, handle: ProjectHandle, surface_ids: list[str]) -> None:
    """`surfaces.changed {surface_ids}` (spec 2026-09-23-volumes section 11.3)."""
    _publish_ids_changed(request, handle, "surfaces.changed", "surface_ids", surface_ids)


def publish_volumes_changed(request: Request, handle: ProjectHandle, measurement_ids: list[str]) -> None:
    """`volumes.changed {measurement_ids}` (spec 2026-09-23-volumes section 11.3)."""
    _publish_ids_changed(request, handle, "volumes.changed", "measurement_ids", measurement_ids)
