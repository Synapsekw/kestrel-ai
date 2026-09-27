"""Unit C-C0: the `pointcloud_profile` job type is registered, and the two new startup sweep steps run
on project open.

Generic 501 and EXPECTED_STUBS checks for every C stub live in `test_pointcloud_stubs.py`, which
reads `app.pointclouds.router.STUBS` and needs no change."""

import inspect
import logging

import pytest

from app.jobs.registry import get_job_type
from app.main import project_opened
from app.pointclouds import startup


class _Runner:
    def is_live(self, job_id):
        return False


def test_the_profile_job_type_is_registered(app):
    """`app` builds the FastAPI app, which imports `app.pointclouds.router` and, through it,
    `jobs_profile`, registering the type; run alone this file never otherwise imports it."""
    assert callable(get_job_type("pointcloud_profile"))


def test_the_profile_job_fails_readably_until_c_b2_lands(app, handle, project_id, wait_job):
    if 'raise JobFailure("not implemented")' not in inspect.getsource(get_job_type("pointcloud_profile")):
        pytest.skip("pointcloud_profile is built; C-B2's tests cover it")
    job = app.state.jobs.submit(handle, "pointcloud_profile", {})
    done = wait_job(project_id, job.id, timeout=30)
    assert (done["state"], done["error"], done["type"]) == ("failed", "not implemented", "pointcloud_profile")


def test_the_two_sweeps_find_nothing_on_a_fresh_project(handle):
    assert startup.sweep_profiles(handle, _Runner()) == []
    assert startup.sweep_views(handle) == 0


def test_project_opened_runs_both_c_sweeps_even_when_one_fails(handle, monkeypatch, caplog):
    called: list[str] = []

    def profiles(h, runner):
        assert h is handle
        called.append("profiles")
        raise RuntimeError("boom")

    def views(h):
        assert h is handle
        called.append("views")
        return 0

    monkeypatch.setattr("app.pointclouds.startup.sweep_profiles", profiles)
    monkeypatch.setattr("app.pointclouds.startup.sweep_views", views)
    with caplog.at_level(logging.ERROR, logger="app.main"):
        project_opened(handle, _Runner())
    assert called == ["profiles", "views"]
    assert "interrupted cloud profile sweep failed" in caplog.text
