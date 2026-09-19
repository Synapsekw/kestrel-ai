"""Shared helper for publishing a websocket domain event keyed by a list of image ids.

`images.changed` (bulk delete, mark empty) and `boxes.changed` (promote, unpromote, mark empty)
are both just "these images changed; go refetch them" — same envelope, same skip-when-empty rule.
"""

from __future__ import annotations

from fastapi import Request

from app.projects.service import ProjectHandle


def publish_image_ids_event(
    request: Request, handle: ProjectHandle, event_type: str, image_ids: list[str]
) -> None:
    if not image_ids:
        return
    request.app.state.events.publish(
        {
            "type": event_type,
            "project_id": handle.id,
            "job_id": None,
            "progress": None,
            "message": "",
            "payload": {"image_ids": image_ids},
        }
    )
