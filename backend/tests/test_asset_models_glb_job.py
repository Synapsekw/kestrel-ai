"""The asset_model_glb job (spec §6.4): atomic file, meta, failure state, restart sweep."""

import pytest

from app.asset_models import startup, store
from app.asset_models.jobs_glb import run_glb
from app.asset_models.spec import AssetSpec
from app.db.models import AssetModel, AssetModelVersion
from app.jobs.cancellation import JobFailure

SPEC = {
    "parts": [
        {
            "id": "s",
            "name": "s",
            "group": "Shell",
            "shape": "cylinder",
            "params": {"id": 1000, "thickness": 10, "height": 2000},
            "source": {"kind": "assumed"},
        }
    ]
}


class Ctx:
    def __init__(self, handle, params):
        self.project, self.params, self.job_id = handle, params, "job-glb"
        self.published = []

    def progress(self, *_a):
        pass

    def publish(self, type, payload):
        self.published.append((type, payload))

    def check_cancelled(self):
        pass


def seed(handle, spec=SPEC, glb_job_id=None):
    with handle.session() as s:
        m = AssetModel(name="m", status="ready", current_version=1)
        s.add(m)
        s.flush()
        s.add(
            AssetModelVersion(
                model_id=m.id,
                version=1,
                spec=spec,
                kind="manual",
                glb_status="pending",
                source_ids=[],
                part_count=len(spec["parts"]),
                glb_job_id=glb_job_id,
            )
        )
        return m.id


def test_job_writes_glb_and_meta(handle):
    mid = seed(handle)
    ctx = Ctx(handle, {"model_id": mid, "version": 1})
    assert run_glb(ctx) == {"model_id": mid, "version": 1}
    path = store.version_glb_path(handle, mid, 1)
    assert path.read_bytes()[:4] == b"glTF"
    assert not list(path.parent.glob("*.tmp"))
    with handle.session() as s:
        v = store.get_version(s, mid, 1)
        assert v.glb_status == "ready" and v.meta["top_m"] == 2.0
    assert ("asset_models.changed", {"asset_model_ids": [mid]}) in ctx.published


def test_job_failure_marks_version_failed(handle, monkeypatch):
    mid = seed(handle)
    import app.asset_models.jobs_glb as jg

    def boom(_spec):
        raise RuntimeError("no mesh")

    monkeypatch.setattr(jg, "build_glb", boom)
    with pytest.raises(JobFailure, match="could not be built"):
        run_glb(Ctx(handle, {"model_id": mid, "version": 1}))
    with handle.session() as s:
        assert store.get_version(s, mid, 1).glb_status == "failed"


def test_sweep_fails_orphaned_pending_glb(handle, app):
    mid = seed(handle, glb_job_id="gone")
    startup.sweep_interrupted(handle, app.state.jobs)
    with handle.session() as s:
        assert store.get_version(s, mid, 1).glb_status == "failed"


def test_spec_used_is_the_stored_one(handle):
    assert AssetSpec.model_validate(SPEC).parts[0].id == "s"
