"""M-C0: the drawing import sweep, the `dem` build sweep and `drawings_dir` (spec
2026-09-26-map-workspace §12). Each sweep logs and continues; a failing one never stops an open."""

from app.db.models import Drawing, Surface
from app.drawings import startup as drawings_startup
from app.surfaces import startup as surfaces_startup


class _Runner:
    def __init__(self, live=()):
        self.live = set(live)

    def is_live(self, job_id: str) -> bool:
        return job_id in self.live


def _drawing(handle, status: str = "importing", job_id: str | None = None) -> str:
    with handle.session() as s:
        row = Drawing(
            name="Plan",
            format="pdf",
            status=status,
            job_id=job_id,
            source_path="C:/plans/p.pdf",
            source_size=1,
        )
        s.add(row)
        s.flush()
        return row.id


def test_an_interrupted_drawing_import_is_marked_failed(handle):
    stuck = _drawing(handle, job_id="gone")
    orphan = _drawing(handle)
    ready = _drawing(handle, status="ready")
    assert sorted(drawings_startup.sweep_interrupted(handle, _Runner())) == sorted([stuck, orphan])
    with handle.session() as s:
        assert (s.get(Drawing, stuck).status, s.get(Drawing, stuck).error) == (
            "failed",
            drawings_startup.INTERRUPTED,
        )
        assert s.get(Drawing, orphan).status == "failed"
        assert s.get(Drawing, ready).status == "ready"


def test_a_live_drawing_import_is_left_alone(handle):
    live = _drawing(handle, job_id="j1")
    assert drawings_startup.sweep_interrupted(handle, _Runner(live={"j1"})) == []
    with handle.session() as s:
        assert s.get(Drawing, live).status == "importing"


def test_a_building_dem_is_swept_by_the_surface_sweep(handle):
    with handle.session() as s:
        row = Surface(name="DSM", kind="dem", status="building", elevation_role="dsm", job_id="gone")
        s.add(row)
        s.flush()
        surface_id = row.id
    assert surface_id in surfaces_startup.sweep_interrupted(handle, _Runner())
    with handle.session() as s:
        assert s.get(Surface, surface_id).status == "failed"


def test_project_opened_runs_the_drawing_sweep(app, handle):
    from app.main import project_opened

    stuck = _drawing(handle, job_id="gone")
    project_opened(handle, app.state.jobs)
    with handle.session() as s:
        assert s.get(Drawing, stuck).status == "failed"


def test_a_failing_drawing_sweep_never_stops_the_open(app, handle, monkeypatch, caplog):
    from app.main import project_opened

    def broken(handle, runner):
        raise RuntimeError("broken sweep")

    monkeypatch.setattr(drawings_startup, "sweep_interrupted", broken)

    # A step after the drawing sweep (project type snapshot refresh) must still run despite the
    # broken one, and the failed step must be named in the log rather than silently swallowed.
    import app.catalogue.project_types as project_types

    real_refresh = project_types.refresh_handle
    ran_later_step = []

    def spy_refresh(h):
        ran_later_step.append(h.id)
        return real_refresh(h)

    monkeypatch.setattr(project_types, "refresh_handle", spy_refresh)

    with caplog.at_level("ERROR"):
        project_opened(handle, app.state.jobs)  # logs and continues; must not raise

    assert ran_later_step == [handle.id]
    assert "interrupted drawing import sweep" in caplog.text


def test_drawings_dir_is_in_the_project_and_made_lazily(handle):
    assert handle.drawings_dir == handle.folder / "drawings"
    assert not handle.drawings_dir.exists()
