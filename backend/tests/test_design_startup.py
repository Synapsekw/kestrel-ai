"""The design-inspection sweep on project open (spec §4.4)."""

import os
import time
from datetime import UTC, datetime, timedelta

from app.surfaces.design import store
from app.surfaces.design.startup import sweep_interrupted


class Runner:
    def __init__(self, live=()):
        self.live = set(live)

    def is_live(self, job_id):
        return job_id in self.live


def make(handle, *, age_h, jobs=None, state="ready", preview_state=None):
    src = handle.folder / "src.xml"
    src.write_text("<LandXML/>")
    d = store.create_inspection(handle, store.new_id(), src, "landxml")
    created = (datetime.now(UTC) - timedelta(hours=age_h)).isoformat()
    store.patch_json(d / "request.json", created_at=created, **(jobs or {}))
    store.patch_json(d / "inspection.json", state=state)
    if preview_state:
        p = store.preview_dir(d, store.new_id())
        p.mkdir(parents=True)
        store.write_json(p / "preview.json", {"state": preview_state, "error": None})
    return d


def test_no_cache_folder_is_fine(handle):
    assert sweep_interrupted(handle, Runner()) == []


def test_old_inspections_without_live_jobs_are_removed(handle):
    old, fresh = make(handle, age_h=25), make(handle, age_h=1)
    assert sweep_interrupted(handle, Runner()) == [old.name]
    assert not old.exists() and fresh.exists()


def test_live_jobs_keep_even_old_inspections(handle):
    d = make(handle, age_h=48, jobs={"preview_job_ids": ["p1"]})
    assert sweep_interrupted(handle, Runner({"p1"})) == []
    assert d.exists()


def test_sweep_fails_interrupted_inspections_and_previews(handle):
    d = make(handle, age_h=1, state="inspecting", preview_state="running")
    sweep_interrupted(handle, Runner())
    insp = store.read_json(d / "inspection.json")
    assert insp["state"] == "failed" and insp["error"].startswith("interrupted by application restart")
    (preview,) = (d / "previews").iterdir()
    p = store.read_json(preview / "preview.json")
    assert p["state"] == "failed" and p["error"].startswith("interrupted by application restart")


def test_a_corrupt_request_json_falls_back_to_the_folder_age(handle):
    d = make(handle, age_h=1)
    (d / "request.json").write_text("{", "utf-8")
    old = time.time() - 30 * 3600
    os.utime(d, (old, old))
    assert sweep_interrupted(handle, Runner()) == [d.name]


def test_corrupt_folders_do_not_abort_the_rest_of_the_sweep(handle):
    """Fix round 1, finding 2: a non-dict request.json and a naive (tz-less) created_at each used
    to raise out of sweep_interrupted entirely, so one bad folder skipped every folder after it."""
    naive = make(handle, age_h=25)
    store.patch_json(naive / "request.json", created_at="2020-01-01T00:00:00")  # no tzinfo
    not_a_dict = make(handle, age_h=25)
    store.write_json(not_a_dict / "request.json", ["oops"])  # replaces created_at too: age via mtime
    old = time.time() - 30 * 3600
    os.utime(not_a_dict, (old, old))
    good = make(handle, age_h=25)
    result = sweep_interrupted(handle, Runner())
    assert set(result) == {naive.name, not_a_dict.name, good.name}
    assert not naive.exists() and not not_a_dict.exists() and not good.exists()
