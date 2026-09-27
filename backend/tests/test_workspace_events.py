"""M-C0: the three map-workspace events use the shared "these ids changed" envelope, and an empty
change publishes nothing."""

from types import SimpleNamespace

from app.events_util import (
    publish_drawings_changed,
    publish_map_measurements_changed,
    publish_map_workspace_changed,
)

HANDLE = SimpleNamespace(id="p1")


class _Bus:
    def __init__(self):
        self.events: list[dict] = []

    def publish(self, event: dict) -> None:
        self.events.append(event)


def _request(bus: _Bus):
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(events=bus)))


def test_the_three_events_carry_their_payloads():
    bus = _Bus()
    request = _request(bus)
    publish_drawings_changed(request, HANDLE, ["w1"])
    publish_map_measurements_changed(request, HANDLE, ["mm1", "mm2"])
    publish_map_workspace_changed(request, HANDLE, ["frame"])
    assert [(e["type"], e["project_id"], e["payload"]) for e in bus.events] == [
        ("drawings.changed", "p1", {"drawing_ids": ["w1"]}),
        ("map_measurements.changed", "p1", {"measurement_ids": ["mm1", "mm2"]}),
        ("map_workspace.changed", "p1", {"fields": ["frame"]}),
    ]
    assert all(e["job_id"] is None and e["progress"] is None and e["message"] == "" for e in bus.events)


def test_nothing_is_published_for_nothing():
    bus = _Bus()
    request = _request(bus)
    publish_drawings_changed(request, HANDLE, [])
    publish_map_measurements_changed(request, HANDLE, [])
    publish_map_workspace_changed(request, HANDLE, [])
    assert bus.events == []
