"""S1-U3 job layer: registration, the template lookup (built-in, user, missing, catalogue down),
cancel, and the offline seam the shared `app` fixture installs."""

import logging
from types import SimpleNamespace

import pytest
from setup_inspect_helpers import CountingReader, dji_names, touch_files

from app.jobs.cancellation import JobCancelled
from app.jobs.registry import get_job_type
from app.setup import inspect_job
from app.setup.builtins import BUILTIN_TEMPLATES
from app.setup.schemas import InspectResult


class FakeCtx:
    """A JobContext stand-in: records progress, cancels on the `cancel_at`-th check."""

    def __init__(self, params: dict, *, catalogue=None, cancel_at: int | None = None):
        self.params, self.job_id = params, "job-test"
        self.runner = SimpleNamespace(catalogue=catalogue)
        self.values: list[float] = []
        self.checks, self.cancel_at = 0, cancel_at
        self.log = logging.getLogger("test.setup_inspect")

    def progress(self, fraction: float, message: str = "") -> None:
        self.values.append(fraction)

    def check_cancelled(self) -> None:
        self.checks += 1
        if self.cancel_at is not None and self.checks >= self.cancel_at:
            raise JobCancelled()


@pytest.fixture
def counting(monkeypatch):
    reader = CountingReader()
    monkeypatch.setattr(inspect_job, "reader_factory", lambda: reader)
    return reader


@pytest.fixture
def photos(tmp_path):
    touch_files(tmp_path, dji_names(3, "V") + dji_names(2, "T", start=10))
    return tmp_path


def builtin(template_id: str) -> dict:
    return next(t for t in BUILTIN_TEMPLATES if t["id"] == template_id)


def test_setup_inspect_is_registered_and_goes_through_the_seam(monkeypatch):
    assert get_job_type("setup_inspect") is inspect_job.run_setup_inspect
    monkeypatch.setattr(inspect_job, "run_pipeline", lambda ctx: {"seam": ctx.params})
    assert inspect_job.run_setup_inspect(FakeCtx({"a": 1})) == {"seam": {"a": 1}}


def test_a_builtin_template_assigns_slots_without_the_catalogue(counting, photos):
    ctx = FakeCtx({"paths": [str(photos)], "template_id": "builtin-vertical"}, catalogue=None)
    result = InspectResult.model_validate(inspect_job._run_pipeline(ctx))
    slots = builtin("builtin-vertical")["config"]["slots"]
    thermal_slot = next(s["key"] for s in slots if (s.get("match") or {}).get("thermal") is True)
    by_thermal = {b.match.thermal: b.slot_key for b in result.buckets}
    assert by_thermal[True] == thermal_slot
    assert by_thermal[False] not in (None, thermal_slot)
    assert ctx.values[-1] == 1.0


def test_no_template_leaves_slots_unassigned(counting, photos):
    result = inspect_job._run_pipeline(FakeCtx({"paths": [str(photos)], "template_id": None}))
    assert {b["slot_key"] for b in result["buckets"]} == {None}


def test_an_unknown_template_with_no_catalogue_leaves_slots_unassigned(counting, photos):
    result = inspect_job._run_pipeline(FakeCtx({"paths": [str(photos)], "template_id": "nope"}))
    assert {b["slot_key"] for b in result["buckets"]} == {None}


def test_a_failing_catalogue_leaves_slots_unassigned(counting, photos):
    class Broken:
        def session(self):
            raise RuntimeError("catalogue.db is locked")

    ctx = FakeCtx({"paths": [str(photos)], "template_id": "user-template"}, catalogue=Broken())
    result = inspect_job._run_pipeline(ctx)
    assert {b["slot_key"] for b in result["buckets"]} == {None}


def test_a_user_template_is_read_from_the_catalogue(app, client, counting, photos):
    from app.catalogue.db import ProjectTemplate

    config = {
        "config_version": 1,
        "slots": [
            {
                "key": "pics",
                "label": "Pictures",
                "route": "images",
                "required": True,
                "accepts": ["jpg"],
                "match": None,
            }
        ],
        "types": [],
    }
    with app.state.catalogue.session() as s:
        s.add(
            ProjectTemplate(
                id="tpl-user-1",
                name="Tower pics",
                name_key="tower pics",
                description="",
                builtin=False,
                config=config,
            )
        )
    ctx = FakeCtx({"paths": [str(photos)], "template_id": "tpl-user-1"}, catalogue=app.state.catalogue)
    result = inspect_job._run_pipeline(ctx)
    assert {b["slot_key"] for b in result["buckets"]} == {"pics"}


def test_cancel_raises_and_returns_nothing(counting, photos):
    with pytest.raises(JobCancelled):
        inspect_job._run_pipeline(FakeCtx({"paths": [str(photos)]}, cancel_at=2))


def test_the_app_fixture_disables_real_walks(app):
    assert inspect_job.run_pipeline is not inspect_job._run_pipeline
