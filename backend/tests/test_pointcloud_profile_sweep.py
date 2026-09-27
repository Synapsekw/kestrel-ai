"""C-B2 Task 5: profiles a restart cut short (spec 2026-09-26-point-cloud-workspace section 8.4 step 5)."""

import logging

from pointclouds import insert_cloud
from profile_helpers import insert_profile

from app.db.models import CloudMeasurement
from app.pointclouds import profile, startup


class _Runner:
    def __init__(self, live=()):
        self.live = set(live)

    def is_live(self, job_id):
        return job_id in self.live


def _status(handle, mid):
    with handle.session() as s:
        row = s.get(CloudMeasurement, mid)
        return row.status, row.error


def test_an_interrupted_profile_fails_and_a_live_one_is_left(handle):
    cloud_id = insert_cloud(handle)
    dead = insert_profile(handle, cloud_id, job_id="gone")
    no_job = insert_profile(handle, cloud_id, job_id=None)
    live = insert_profile(handle, cloud_id, job_id="running")
    ready = insert_profile(handle, cloud_id, status="ready")
    swept = startup.sweep_profiles(handle, _Runner(live={"running"}))
    assert sorted(swept) == sorted([dead, no_job])
    assert _status(handle, dead) == ("failed", profile.INTERRUPTED)
    assert _status(handle, no_job) == ("failed", profile.INTERRUPTED)
    assert _status(handle, live) == ("computing", None)
    assert _status(handle, ready) == ("ready", None)


def test_partial_and_orphan_files_go_and_a_ready_profile_stays(handle):
    cloud_id = insert_cloud(handle)
    ready = insert_profile(handle, cloud_id, status="ready")
    live = insert_profile(handle, cloud_id, job_id="running")
    folder = profile.profiles_dir(handle, cloud_id)
    folder.mkdir(parents=True)
    kept = folder / f"{ready}.json"
    kept.write_text("{}", "utf-8")
    live_partial = folder / f"{live}.partial"
    live_partial.write_text("{", "utf-8")
    (folder / f"{ready}.partial").write_text("{", "utf-8")
    (folder / "deleted-measurement.json").write_text("{}", "utf-8")
    startup.sweep_profiles(handle, _Runner(live={"running"}))
    assert sorted(p.name for p in folder.iterdir()) == sorted([kept.name, live_partial.name])


def test_a_db_failure_logs_and_touches_no_file(handle, monkeypatch, caplog):
    cloud_id = insert_cloud(handle)
    folder = profile.profiles_dir(handle, cloud_id)
    folder.mkdir(parents=True)
    (folder / "x.partial").write_text("{", "utf-8")

    def broken():
        raise RuntimeError("db is gone")

    monkeypatch.setattr(handle, "session", broken)
    with caplog.at_level(logging.ERROR):
        assert startup.sweep_profiles(handle, _Runner()) == []
    assert (folder / "x.partial").exists()
    assert "could not mark interrupted cloud profiles" in caplog.text


def test_a_fresh_project_has_nothing_to_sweep(handle):
    assert startup.sweep_profiles(handle, _Runner()) == []
