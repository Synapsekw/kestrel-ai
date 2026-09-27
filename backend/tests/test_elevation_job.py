"""The elevation_import job run directly (spec §7, §13 cancel/cleanup, §14): alignment, inputs that
vanish after the 202, an empty file, cancel, cancel before start, the startup sweep."""

import threading
from types import SimpleNamespace

import numpy as np
import pytest
from design_targets import add_target, target_spec, write_dem
from designs import plane_z
from test_elevation_admission import X0, Y0, plain_dem

from app.db.models import Surface
from app.jobs.cancellation import JobCancelled, JobFailure
from app.surfaces import elevation, grid, jobs_elevation
from app.surfaces.paths import build_dir, surface_dir, surface_path
from app.surfaces.schemas import ElevationImportRequest
from app.surfaces.startup import INTERRUPTED, sweep_interrupted


class FakeCtx:
    def __init__(self, handle, params):
        self.project, self.params = handle, params
        self.cancelled = threading.Event()
        self.events: list[tuple[str, dict]] = []
        self.fractions: list[float] = []

    def progress(self, fraction: float, message: str = "") -> None:
        self.fractions.append(fraction)

    def check_cancelled(self) -> None:
        if self.cancelled.is_set():
            raise JobCancelled()

    def publish(self, type: str, payload: dict) -> None:
        self.events.append((type, payload))


def start(handle, path, **body):
    body.setdefault("name", "DSM")
    row, params = elevation.create_elevation(
        handle, ElevationImportRequest(path=str(path), role="dsm", **body)
    )
    return row.id, FakeCtx(handle, params)


def row_of(handle, sid):
    with handle.session() as s:
        row = s.get(Surface, sid)
        if row is not None:
            s.expunge(row)
        return row


def test_align_to_adopts_the_targets_lattice(handle, tmp_path):
    target = add_target(handle, target_spec(cell=0.5), plane_z)
    sid, ctx = start(handle, plain_dem(tmp_path), align_to_surface_id=target)
    result = jobs_elevation.run_elevation_import(ctx)
    assert result["aligned_to_surface_id"] == target and result["method"] == "dem_resample"
    with (
        grid.open_surface(surface_path(handle, sid)) as a,
        grid.open_surface(surface_path(handle, target)) as b,
    ):
        assert grid.same_lattice(a.spec, b.spec)
    assert row_of(handle, sid).status == "ready"
    assert ctx.events[-1] == ("surfaces.changed", {"surface_ids": [sid]})
    assert ctx.fractions == sorted(ctx.fractions)


def test_a_file_removed_after_the_request_fails_readably(handle, tmp_path):
    path = plain_dem(tmp_path)
    sid, ctx = start(handle, path)
    path.unlink()
    with pytest.raises(JobFailure):
        jobs_elevation.run_elevation_import(ctx)
    row = row_of(handle, sid)
    assert row.status == "failed" and row.error.startswith("file not found at")
    assert not surface_dir(handle, sid).exists()


def test_a_target_deleted_before_the_job_fails_readably(handle, tmp_path):
    target = add_target(handle, target_spec(cell=0.5), plane_z)
    sid, ctx = start(handle, plain_dem(tmp_path), align_to_surface_id=target)
    with handle.session() as s:
        s.delete(s.get(Surface, target))
    with pytest.raises(JobFailure):
        jobs_elevation.run_elevation_import(ctx)
    assert row_of(handle, sid).error == jobs_elevation.TARGET_GONE


def test_a_file_with_no_valid_height_fails(handle, tmp_path):
    z = np.full((50, 50), -9999.0, np.float32)
    sid, ctx = start(handle, write_dem(tmp_path / "void.tif", z, x0=X0, y0=Y0, cell=0.5, nodata=-9999.0))
    with pytest.raises(JobFailure):
        jobs_elevation.run_elevation_import(ctx)
    assert row_of(handle, sid).error == jobs_elevation.EMPTY
    assert not surface_dir(handle, sid).exists()


def test_a_cancel_deletes_the_row_and_its_folder(handle, tmp_path):
    sid, ctx = start(handle, plain_dem(tmp_path))
    ctx.cancelled.set()
    with pytest.raises(JobCancelled):
        jobs_elevation.run_elevation_import(ctx)
    assert row_of(handle, sid) is None and not surface_dir(handle, sid).exists()
    assert ("surfaces.changed", {"surface_ids": [sid]}) in ctx.events


def test_a_cancel_before_start_deletes_the_row(handle, tmp_path):
    sid, ctx = start(handle, plain_dem(tmp_path))
    jobs_elevation.cancelled_before_start(ctx)
    assert row_of(handle, sid) is None


def test_the_scratch_folder_is_removed_on_success(handle, tmp_path):
    sid, ctx = start(handle, plain_dem(tmp_path))
    jobs_elevation.run_elevation_import(ctx)
    assert not build_dir(handle, sid).exists()
    assert not surface_path(handle, sid).with_name("surface.tif.partial").exists()


def test_the_startup_sweep_fails_an_interrupted_dem(handle, tmp_path):
    sid, _ = start(handle, plain_dem(tmp_path))
    assert sweep_interrupted(handle, SimpleNamespace(is_live=lambda job_id: False)) == [sid]
    row = row_of(handle, sid)
    assert (row.status, row.error) == ("failed", INTERRUPTED)
