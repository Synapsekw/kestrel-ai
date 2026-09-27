"""The image_metadata backfill (spec 2026-09-26-image-inspection §7.3 "Backfill", §15)."""

import pytest
from imagery_camera_helpers import dji_jpeg, h20t_xmp
from sqlalchemy import select, update

from app.db.models import Image, Job
from app.errors import AppError
from app.imagery import jobs_metadata

CLEARED = dict(
    original_name=None,
    rel_alt=None,
    gimbal_pitch=None,
    gimbal_yaw=None,
    gimbal_roll=None,
    flight_yaw=None,
    lrf_distance_m=None,
    focal_px=None,
    focal_mm=None,
    sensor_w_mm=None,
    orig_w=None,
    orig_h=None,
    camera_model=None,
    footprint=None,
    footprint_kind="none",
    metadata_version=0,  # C0's non-null default: what every pre-0011 row carries
)


def _flight(tmp_path):
    folder = tmp_path / "flight"
    dji_jpeg(folder / "UNIQUE.jpg", seed=1)
    dji_jpeg(folder / "a" / "DUP.jpg", seed=2)
    dji_jpeg(folder / "b" / "DUP.jpg", seed=3, xmp=h20t_xmp())
    return folder


def _by_path(handle):
    with handle.session() as s:
        rows = {r.path.rsplit("/", 1)[-1]: r for r in s.execute(select(Image)).scalars()}
        for r in rows.values():
            s.expunge(r)
    return rows


def _pre_0011(handle):
    """Make every row look like it predates migration 0011."""
    with handle.session() as s:
        s.execute(update(Image).values(**CLEARED))


def test_backfill_matches_a_unique_stem_and_skips_ambiguous(
    app, project_id, handle, import_source, wait_job, tmp_path
):
    import_source(project_id, _flight(tmp_path))
    _pre_0011(handle)
    for p in handle.thumbs_dir.glob("*.jpg"):
        p.unlink()
    job = jobs_metadata.submit_if_pending(handle, app.state.jobs)
    done = wait_job(project_id, job.id)
    assert done["state"] == "succeeded", done
    assert done["result"] == {"images": 3, "updated": 1, "skipped": 2}
    rows = _by_path(handle)
    unique, dup, dup1 = rows["UNIQUE.jpg"], rows["DUP.jpg"], rows["DUP_1.jpg"]
    assert unique.original_name == "UNIQUE.jpg" and unique.rel_alt == 38.40
    assert unique.footprint_kind == "trapezoid"
    for row in (dup, dup1):  # DUP matches two originals; DUP_1 matches none
        assert row.original_name is None and row.rel_alt is None
        assert abs(row.focal_mm - 12.29) < 1e-6 and row.orig_w == 5280  # EXIF from the prepared copy
        assert row.footprint_kind == "point"
    assert all(r.metadata_version == 1 for r in rows.values())
    assert len(list(handle.thumbs_dir.glob("*.jpg"))) == 3


def test_backfill_uses_original_name_when_present(app, project_id, handle, import_source, wait_job, tmp_path):
    import_source(project_id, _flight(tmp_path))
    _pre_0011(handle)
    with handle.session() as s:
        s.execute(update(Image).where(Image.path.like("%DUP_1.jpg")).values(original_name="b/DUP.jpg"))
    job = jobs_metadata.submit(handle, app.state.jobs, force=False)
    assert wait_job(project_id, job.id)["result"]["updated"] == 2
    assert _by_path(handle)["DUP_1.jpg"].lrf_distance_m == 87.512


def test_backfill_keeps_xmp_columns_when_the_original_is_gone(
    app, project_id, handle, import_source, wait_job, tmp_path
):
    folder = _flight(tmp_path)
    import_source(project_id, folder)
    folder.rename(tmp_path / "moved")
    job = jobs_metadata.submit(handle, app.state.jobs, force=True)
    assert wait_job(project_id, job.id)["result"] == {"images": 3, "updated": 0, "skipped": 3}
    assert _by_path(handle)["UNIQUE.jpg"].rel_alt == 38.40  # kept, not nulled (ruling 2)


def test_backfill_is_idempotent_and_survives_a_missing_folder(
    app, project_id, handle, import_source, wait_job, tmp_path
):
    folder = _flight(tmp_path)
    import_source(project_id, folder)
    assert jobs_metadata.submit_if_pending(handle, app.state.jobs) is None  # the import wrote version 1
    _pre_0011(handle)
    folder.rename(tmp_path / "gone")
    job = jobs_metadata.submit_if_pending(handle, app.state.jobs)
    assert wait_job(project_id, job.id)["state"] == "succeeded"
    assert jobs_metadata.submit_if_pending(handle, app.state.jobs) is None


def test_submit_refuses_while_a_job_is_live(app, handle, project_id, import_source, tmp_path):
    import_source(project_id, _flight(tmp_path))
    _pre_0011(handle)
    with handle.session() as s:
        live = Job(type=jobs_metadata.JOB_TYPE, params={}, state="queued", log_path="runs/x/job.log")
        s.add(live)
        s.flush()
        live_id = live.id
    with pytest.raises(AppError) as err:
        jobs_metadata.submit(handle, app.state.jobs, force=True)
    assert err.value.status == 409 and err.value.code == "job_running"
    assert err.value.details == {"job_id": live_id}
    assert jobs_metadata.submit_if_pending(handle, app.state.jobs) is None  # on open: skip, never raise


def test_project_opened_submits_when_rows_are_pending(
    app, project_id, handle, import_source, wait_job, tmp_path, monkeypatch
):
    from app.main import project_opened

    import_source(project_id, _flight(tmp_path))
    _pre_0011(handle)
    seen = []
    monkeypatch.setattr(jobs_metadata, "submit", lambda h, r, *, force: seen.append(force))
    project_opened(handle, app.state.jobs)
    assert seen == [False]
