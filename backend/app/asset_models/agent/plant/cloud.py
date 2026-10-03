# backend/app/asset_models/agent/plant/cloud.py
"""The cloud check stage (spec §8.2.4). Until C1's module is consumed (Task 16) it only records, as a
run note, why no check ran."""

from __future__ import annotations


def _note(rc, text: str) -> None:
    with rc.lock:
        if text not in rc.state.notes:
            rc.state.notes.append(text)
    rc.save()


def cloud_stage(rc) -> None:
    if not any(x["type"] == "point_cloud" for x in rc.sources):
        _note(rc, "No cloud check: no point cloud among the run's sources.")
        return
    _note(rc, "No cloud check: the cloud check is not part of this build yet.")
