"""createDesignSurface and the build phase (spec §2 Commit gate, §3, §4, §6, §15.3 API and jobs, §16)."""

import shutil
import threading
import time

import numpy as np
import pytest
import rasterio
from design_dxf import add_contours, add_faces, new_doc, save
from design_landxml import grid_tin, write_landxml
from design_targets import add_target, target_spec, write_dem, write_target
from designs import CONE_CENTRE, E0, N0, cone_contour_runs, cone_z, plane_z, two_triangle_plane
from rasterio.windows import Window

from app.db.models import Surface
from app.jobs.registry import register_job_type
from app.surfaces import grid
from app.surfaces.design import phase_build, rasterise, store
from app.surfaces.paths import surface_dir, surface_path

BASE = "/api/v1/projects"


@pytest.fixture
def project_kind() -> str:
    """Design surfaces are detection work: F0 guards the router with require_kind(("detect",), ANY_KIND)."""
    return "detect"


def url(pid, rest):
    return f"{BASE}/{pid}{rest}"


def inspect(client, pid, wait_job, path) -> str:
    body = client.post(url(pid, "/design-inspections"), json={"path": str(path)}).json()
    assert wait_job(pid, body["job"]["id"])["state"] == "succeeded"
    return body["inspection"]["id"]


def preview(client, pid, wait_job, iid, **kw) -> dict:
    opts = {
        "candidate_ids": ["c0"],
        "source_crs": "EPSG:32639",
        "horizontal_unit": "metre",
        "vertical_unit": "metre",
        **kw,
    }
    body = client.post(url(pid, f"/design-inspections/{iid}/previews"), json=opts).json()
    wait_job(pid, body["job"]["id"])
    return client.get(url(pid, f"/design-inspections/{iid}/previews/{body['preview']['id']}")).json()


def commit(client, pid, iid, prev, **kw):
    return client.post(url(pid, "/design-surfaces"), json={"inspection_id": iid, "preview_id": prev, **kw})


def build(client, pid, wait_job, iid, prev, **kw) -> tuple[dict, dict]:
    r = commit(client, pid, iid, prev, **kw)
    assert r.status_code == 202, r.text
    return r.json(), wait_job(pid, r.json()["job"]["id"])


def row(handle, sid) -> Surface:
    with handle.session() as s:
        r = s.get(Surface, sid)
        s.expunge(r)
        return r


def cells(handle, sid):
    with rasterio.open(surface_path(handle, sid)) as ds:
        spec = grid.GridSpec.from_dataset(ds)
        z = ds.read(1)
    return spec, z, spec.cell_centres(Window(0, 0, spec.width, spec.height))


def changed(events, sid) -> list[dict]:
    """The `surfaces.changed` events that name `sid`."""
    return [e for e in events if e["type"] == "surfaces.changed" and e["payload"] == {"surface_ids": [sid]}]


def code(r) -> str:
    return r.json()["error"]["code"]


def site_landxml(tmp_path, name="s.xml", dz=0.0, **kw):
    pts, faces = grid_tin(161, 61, 1.0, E0 + 20, N0 + 20, lambda e, n: plane_z(e, n) + dz)
    return write_landxml(tmp_path / name, [{"name": "EG", "points": pts, "faces": faces}], **kw)


@pytest.fixture
def target(handle):
    return add_target(handle, target_spec(), plane_z)


@pytest.fixture
def events(app, client):
    seen = []
    real = app.state.events.publish
    app.state.events.publish = lambda e: (seen.append(e), real(e))
    yield seen
    app.state.events.publish = real


def test_a_landxml_design_lands_on_the_target_lattice(
    client, app, project_id, wait_job, tmp_path, handle, target, events
):
    iid = inspect(client, project_id, wait_job, site_landxml(tmp_path, "site-tin.xml", dz=0.3))
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    body, job = build(client, project_id, wait_job, iid, p["id"])
    s = body["surface"]
    assert (s["kind"], s["status"], s["name"], body["job"]["type"]) == (
        "design",
        "building",
        "site-tin — EG",
        "design_import",
    )
    assert s["design_source"]["format"] == "landxml" and s["build_params"] is None and s["stats"] is None
    assert s["job_id"] == body["job"]["id"]
    assert job["state"] == "succeeded", job
    r = row(handle, s["id"])
    assert (r.status, r.method, r.cell_size_m, r.epsg, r.point_cloud_id, r.error) == (
        "ready",
        "tin",
        0.5,
        32639,
        None,
        None,
    )
    spec, z, (x, y) = cells(handle, s["id"])
    assert grid.same_lattice(spec, target_spec())  # S2 reads it with an integer offset (case R1)
    ok = np.isfinite(z)
    assert ok.sum() > 0.95 * 160 * 60 / 0.25
    assert np.abs(z[ok] - (plane_z(x, y)[ok] + 0.3)).max() < 1e-4
    assert r.z_min == pytest.approx(float(np.nanmin(z))) and 0 < r.coverage_fraction <= 1
    assert grid.convention_problems(surface_path(handle, s["id"])) == []
    ds = r.design_source
    assert set(ds) == {
        "path",
        "format",
        "units",
        "vertical_units",
        "sha256",
        "candidates",
        "source_crs_wkt",
        "source_epsg",
        "swap_xy",
        "max_edge_m",
        "aligned_to_surface_id",
        "accepted_warnings",
    }
    assert (ds["units"], ds["candidates"], ds["source_epsg"], ds["aligned_to_surface_id"]) == (
        "metre",
        ["EG"],
        32639,
        target,
    )
    assert (surface_dir(handle, s["id"]) / "source.json").is_file()
    assert not store.inspection_dir(handle, iid).exists()
    # Ruling 3: one on create (the router) and one on success (the job).
    assert len(changed(events, s["id"])) == 2
    got = client.get(url(project_id, f"/surfaces/{s['id']}")).json()
    assert (got["kind"], got["status"], got["tile_grid"] is not None) == ("design", "ready", True)


def test_dxf_faces_rasterise_to_the_plane(client, project_id, wait_job, tmp_path, handle, target):
    doc = new_doc()
    v, t = two_triangle_plane(size=90.0)
    add_faces(doc.modelspace(), v + [10, 5, 0], t, "TIN")
    iid = inspect(client, project_id, wait_job, save(doc, tmp_path / "f.dxf"))
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    body, job = build(client, project_id, wait_job, iid, p["id"])
    assert job["state"] == "succeeded" and row(handle, body["surface"]["id"]).method == "tin"
    _, z, (x, y) = cells(handle, body["surface"]["id"])
    ok = np.isfinite(z)
    assert np.abs(z[ok] - plane_z(x - 10, y - 5)[ok]).max() < 1e-4


def test_contours_build_with_the_previewed_trimming(client, project_id, wait_job, tmp_path, handle, target):
    doc = new_doc()
    add_contours(doc.modelspace(), *cone_contour_runs(128), layer="CONTOURS")
    iid = inspect(client, project_id, wait_job, save(doc, tmp_path / "c.dxf"))
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    pinternal = store.read_json(
        store.preview_dir(store.inspection_dir(handle, iid), p["id"]) / "internal.json"
    )
    body, job = build(client, project_id, wait_job, iid, p["id"])
    r = row(handle, body["surface"]["id"])
    assert job["state"] == "succeeded" and r.method == "delaunay"
    assert r.design_source["max_edge_m"] == pinternal["max_edge_m"]
    _, z, (x, y) = cells(handle, body["surface"]["id"])
    rr = np.hypot(x - CONE_CENTRE[0], y - CONE_CENTRE[1])
    ok = np.isfinite(z) & (rr >= 4) & (rr <= 39)
    assert ok.sum() > 10_000 and np.abs(z[ok] - cone_z(x, y)[ok]).max() < 0.3


def test_a_conforming_dem_is_copied(client, project_id, wait_job, tmp_path, handle, target):
    src = write_target(tmp_path / "dem.tif", target_spec(), lambda x, y: plane_z(x, y) - 1.0)
    iid = inspect(client, project_id, wait_job, src)
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    body, job = build(client, project_id, wait_job, iid, p["id"])
    r = row(handle, body["surface"]["id"])
    assert job["state"] == "succeeded" and r.method == "dem_copy" and r.design_source["units"] is None
    with rasterio.open(src) as a, rasterio.open(surface_path(handle, r.id)) as b:
        assert np.array_equal(a.read(1), b.read(1), equal_nan=True)


def test_an_offset_dem_in_feet_is_regridded_in_metres(client, project_id, wait_job, tmp_path, handle, target):
    spec = target_spec()
    x, y = spec.cell_centres(Window(0, 0, spec.width, spec.height))
    z_ft = (plane_z(x + 0.25, y - 0.25) / 0.3048).astype(np.float32)
    src = write_dem(tmp_path / "ft.tif", z_ft, x0=spec.x0 + 0.25, y0=spec.y0 - 0.25, cell=0.5)
    iid = inspect(client, project_id, wait_job, src)
    p = preview(
        client, project_id, wait_job, iid, target_surface_id=target, vertical_unit="international_foot"
    )
    body, job = build(client, project_id, wait_job, iid, p["id"], accept_warnings=True)
    assert job["state"] == "succeeded" and row(handle, body["surface"]["id"]).method == "dem_resample"
    _, z, (xx, yy) = cells(handle, body["surface"]["id"])
    ok = np.isfinite(z)
    assert ok.mean() > 0.9 and np.abs(z[ok] - plane_z(xx, yy)[ok]).max() < 1e-3


def test_without_a_target_the_design_keeps_its_crs(client, project_id, wait_job, tmp_path, handle):
    pts, faces = grid_tin(21, 11, 1.0)
    iid = inspect(
        client,
        project_id,
        wait_job,
        write_landxml(tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": faces}]),
    )
    p = preview(client, project_id, wait_job, iid, cell_size_m=0.25)
    body, job = build(client, project_id, wait_job, iid, p["id"])
    r = row(handle, body["surface"]["id"])
    assert job["state"] == "succeeded" and (r.cell_size_m, r.epsg) == (0.25, 32639)
    assert r.design_source["aligned_to_surface_id"] is None


def test_the_commit_gate(client, app, project_id, wait_job, tmp_path, handle, target):
    swapped = site_landxml(tmp_path, "enz.xml", dz=0.3, order="ENZ")
    iid = inspect(client, project_id, wait_job, swapped)
    warn = preview(client, project_id, wait_job, iid, target_surface_id=target)
    assert "no_overlap" in {w["code"] for w in warn["warnings"]}
    r = commit(client, project_id, iid, warn["id"])
    assert r.status_code == 409 and code(r) == "conflict" and "accept" in r.json()["error"]["message"]
    newer = preview(client, project_id, wait_job, iid, target_surface_id=target, swap_xy=True)
    r = commit(client, project_id, iid, warn["id"], accept_warnings=True)
    assert r.status_code == 409 and code(r) == "conflict" and "newer" in r.json()["error"]["message"]
    pdir = store.preview_dir(store.inspection_dir(handle, iid), newer["id"])
    store.patch_json(pdir / "preview.json", state="running")
    r = commit(client, project_id, iid, newer["id"])
    assert r.status_code == 409 and code(r) == "not_ready"  # ruling 1
    store.patch_json(
        pdir / "preview.json",
        state="ready",
        warnings=[{"code": "mixed_geometry", "level": "block", "message": "x"}],
    )
    r = commit(client, project_id, iid, newer["id"], accept_warnings=True)
    assert r.status_code == 409 and code(r) == "conflict"  # block
    r = commit(client, project_id, "00000000-0000-4000-8000-000000000000", newer["id"])
    assert r.status_code == 404
    r = commit(client, project_id, iid, "00000000-0000-4000-8000-000000000000")
    assert r.status_code == 404
    with handle.session() as s:
        assert s.query(Surface).filter(Surface.kind == "design").count() == 0  # no refusal leaves a row


def test_accepted_warnings_are_recorded(client, project_id, wait_job, tmp_path, handle, target):
    iid = inspect(client, project_id, wait_job, site_landxml(tmp_path, dz=45.0))
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    body, job = build(client, project_id, wait_job, iid, p["id"], accept_warnings=True)
    assert job["state"] == "succeeded"
    assert row(handle, body["surface"]["id"]).design_source["accepted_warnings"] == ["z_offset"]


@pytest.mark.parametrize("how", ["failed", "missing_tif", "deleted"])
def test_commit_refuses_when_the_target_is_gone(client, project_id, wait_job, tmp_path, handle, target, how):
    # dz=45 raises a `z_offset` warn: a vanished target must still answer not_ready (fix 3), never
    # "accept the warnings".
    iid = inspect(client, project_id, wait_job, site_landxml(tmp_path, dz=45.0))
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    assert "z_offset" in {w["code"] for w in p["warnings"]}
    if how == "failed":
        with handle.session() as s:
            s.get(Surface, target).status = "failed"
    elif how == "missing_tif":
        surface_path(handle, target).unlink()
    else:
        with handle.session() as s:
            s.delete(s.get(Surface, target))
    r = commit(client, project_id, iid, p["id"])
    assert r.status_code == 409 and code(r) == "not_ready"  # ruling 1
    assert "no longer ready" in r.json()["error"]["message"]


def test_dem_changed_after_preview_fails_the_build(
    client, project_id, wait_job, tmp_path, handle, target, events
):
    import os

    src = write_target(tmp_path / "dem.tif", target_spec(), plane_z)
    iid = inspect(client, project_id, wait_job, src)
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    st = src.stat()
    os.utime(src, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    body, job = build(client, project_id, wait_job, iid, p["id"])
    assert job["state"] == "failed" and "changed since it was read" in job["error"]
    r = row(handle, body["surface"]["id"])
    assert r.status == "failed" and "changed since it was read" in r.error
    assert not surface_dir(handle, r.id).exists() and store.inspection_dir(handle, iid).exists()
    assert len(changed(events, r.id)) == 2  # ruling 3: on create and on failure


def test_cancel_leaves_no_partial_and_no_folder(
    client, app, project_id, wait_job, tmp_path, handle, target, monkeypatch, events
):
    """Ruling 4: the real SurfaceWriter writes the `.partial`; the block producer blocks until the
    cancel reaches it, and the cancel path must remove the `.partial` and the folder."""
    started = threading.Event()
    partials: list = []

    def stuck(self, window):
        partials.extend(handle.surfaces_dir.glob("*/*.partial"))
        started.set()
        while True:
            self._check()
            time.sleep(0.01)

    iid = inspect(client, project_id, wait_job, site_landxml(tmp_path))
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    monkeypatch.setattr(rasterise.TinRasteriser, "rasterise_window", stuck)  # the build's, not the preview's
    r = commit(client, project_id, iid, p["id"]).json()
    assert started.wait(30)
    assert [x.name for x in partials] == ["surface.tif.partial"]
    # A second commit while the build runs is refused (`job_running`: its job is live); no row.
    again = commit(client, project_id, iid, p["id"])
    assert (
        again.status_code == 409
        and code(again) == "job_running"
        and "already" in again.json()["error"]["message"]
    )
    client.post(url(project_id, f"/jobs/{r['job']['id']}/cancel"))
    assert wait_job(project_id, r["job"]["id"])["state"] == "cancelled"
    s = row(handle, r["surface"]["id"])
    assert (s.status, s.error) == ("failed", "import cancelled")
    assert not surface_dir(handle, s.id).exists()
    assert list(handle.surfaces_dir.glob("*/*.partial")) == []
    assert store.inspection_dir(handle, iid).exists()  # a retry needs no re-parse
    assert len(changed(events, s.id)) == 2  # ruling 3: on create and on cancel
    with handle.session() as db:
        assert db.query(Surface).filter(Surface.kind == "design").count() == 1


def test_a_build_that_cannot_be_queued_leaves_a_failed_row(
    client, project_id, wait_job, tmp_path, handle, target, monkeypatch, events
):
    """Ruling 5: no orphan `building` row when the job cannot be submitted."""
    iid = inspect(client, project_id, wait_job, site_landxml(tmp_path))
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)

    def boom(*a, **k):
        raise RuntimeError("queue is closed")

    monkeypatch.setattr(client.app.state.jobs, "submit", boom)
    with pytest.raises(RuntimeError):
        commit(client, project_id, iid, p["id"])
    with handle.session() as s:
        (r,) = s.query(Surface).filter(Surface.kind == "design").all()
        assert r.status == "failed" and "could not be queued: queue is closed" in r.error
        sid = r.id
    assert len(changed(events, sid)) == 1


def test_a_training_project_may_not_import_a_design(client, tmp_path):
    body = {"name": "t", "folder": str(tmp_path / "t"), "classes": [], "kind": "train"}
    pid = client.post(BASE, json=body).json()["id"]
    r = commit(client, pid, "00000000-0000-4000-8000-000000000000", "00000000-0000-4000-8000-000000000001")
    assert r.status_code == 409 and r.json()["error"]["code"] == "wrong_project_kind"


def test_read_windows_tile_on_the_rasteriser_blocks():
    spec = target_spec((E0, N0, E0 + 500, N0 + 300), cell=0.1)
    wins = list(grid.read_windows(spec))
    assert all(w.col_off % grid.MAX_READ == 0 and w.row_off % grid.MAX_READ == 0 for w in wins)
    assert all(w.width <= grid.MAX_READ and w.height <= grid.MAX_READ for w in wins)


def _stuck_build(monkeypatch, handle):
    """Make the build's block producer wait for its cancel; returns the event set when it starts."""
    started = threading.Event()

    def stuck(self, window):
        started.set()
        while True:
            self._check()
            time.sleep(0.01)

    monkeypatch.setattr(rasterise.TinRasteriser, "rasterise_window", stuck)
    return started


def test_two_concurrent_commits_start_one_build(
    client, project_id, wait_job, tmp_path, handle, target, monkeypatch
):
    """Fix round 1, finding 1: a double-click. Without store.commit_lock both requests pass the gate
    inside the widened window below and two builds start from one inspection."""
    iid = inspect(client, project_id, wait_job, site_landxml(tmp_path))
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    started = _stuck_build(monkeypatch, handle)
    real_check = phase_build.check_commit

    def slow_check(*a, **k):
        out = real_check(*a, **k)
        time.sleep(0.5)  # both requests would be past the gate here without the lock
        return out

    monkeypatch.setattr(phase_build, "check_commit", slow_check)
    barrier, answers = threading.Barrier(2), []

    def post():
        barrier.wait()
        answers.append(commit(client, project_id, iid, p["id"]))

    threads = [threading.Thread(target=post) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(60)
    assert sorted(r.status_code for r in answers) == [202, 409]
    (refused,) = [r for r in answers if r.status_code == 409]
    assert code(refused) == "job_running" and "already" in refused.json()["error"]["message"]
    with handle.session() as s:
        assert s.query(Surface).filter(Surface.kind == "design").count() == 1
    (ok,) = [r for r in answers if r.status_code == 202]
    assert started.wait(30)
    client.post(url(project_id, f"/jobs/{ok.json()['job']['id']}/cancel"))
    assert wait_job(project_id, ok.json()["job"]["id"])["state"] == "cancelled"


def test_the_build_lock_guards_delete_and_preview(client, project_id, wait_job, tmp_path, handle, target):
    """Finding 1: create_design_preview and delete_design_inspection check build_live under the same
    lock as the commit, so neither can act between a commit's gate and its recorded build."""
    iid = inspect(client, project_id, wait_job, site_landxml(tmp_path))
    preview(client, project_id, wait_job, iid, target_surface_id=target)

    def blocked_while_locked(call):
        held, release, answers = threading.Event(), threading.Event(), []

        def hold():
            with store.commit_lock:
                held.set()
                release.wait(10)

        t = threading.Thread(target=hold)
        t.start()
        assert held.wait(5)
        worker = threading.Thread(target=lambda: answers.append(call()))
        worker.start()
        worker.join(0.5)
        waited = worker.is_alive() and answers == []
        release.set()
        worker.join(30)
        t.join(5)
        return waited, answers[0]

    opts = {
        "candidate_ids": ["c0"],
        "source_crs": "EPSG:32639",
        "horizontal_unit": "metre",
        "vertical_unit": "metre",
        "target_surface_id": target,
    }
    waited, r = blocked_while_locked(
        lambda: client.post(url(project_id, f"/design-inspections/{iid}/previews"), json=opts)
    )
    assert waited and r.status_code == 202
    wait_job(project_id, r.json()["job"]["id"])
    waited, r = blocked_while_locked(lambda: client.delete(url(project_id, f"/design-inspections/{iid}")))
    assert waited and r.status_code == 204


def test_a_build_that_finished_before_its_job_was_recorded_is_still_202(
    client, project_id, wait_job, tmp_path, handle, target, monkeypatch
):
    """Finding 2: recording build_job_id can meet the job's success-path rmtree of the inspection."""
    iid = inspect(client, project_id, wait_job, site_landxml(tmp_path))
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    real = store.patch_json

    def gone(path, **fields):
        if path.name == "request.json" and "build_job_id" in fields:
            raise FileNotFoundError(2, "gone", str(path))
        return real(path, **fields)

    monkeypatch.setattr(store, "patch_json", gone)
    body, job = build(client, project_id, wait_job, iid, p["id"])
    assert job["state"] == "succeeded" and row(handle, body["surface"]["id"]).status == "ready"


def test_a_row_deleted_before_its_job_id_is_recorded(
    client, project_id, wait_job, tmp_path, handle, target, monkeypatch
):
    """Finding 4: a delete between submit and set_job: the caller still gets a 202 with the created
    row, and the job fails readably."""
    iid = inspect(client, project_id, wait_job, site_landxml(tmp_path))
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    runner = client.app.state.jobs
    real_submit = runner.submit

    def submit_after_delete(project, type, params):
        with handle.session() as s:
            s.delete(s.get(Surface, params["surface_id"]))
        return real_submit(project, type, params)

    monkeypatch.setattr(runner, "submit", submit_after_delete)
    r = commit(client, project_id, iid, p["id"])
    assert r.status_code == 202, r.text
    assert r.json()["surface"]["job_id"] == r.json()["job"]["id"]
    job = wait_job(project_id, r.json()["job"]["id"])
    assert job["state"] == "failed" and "deleted before its import started" in job["error"]
    assert not surface_dir(handle, r.json()["surface"]["id"]).exists()


def test_the_row_turns_ready_only_after_its_files(
    client, project_id, wait_job, tmp_path, handle, target, monkeypatch
):
    """Finding 5: source.json is written and the inspection removed while the row is still building."""
    iid = inspect(client, project_id, wait_job, site_landxml(tmp_path))
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    seen = {}
    real_write, real_rmtree = store.write_json, phase_build.shutil.rmtree

    def status(sid):
        with handle.session() as s:
            return s.get(Surface, sid).status

    def write(path, data):
        if path.name == "source.json":
            seen["source.json"] = status(path.parent.name)
        return real_write(path, data)

    def rmtree(path, *a, **k):
        if path == store.inspection_dir(handle, iid):
            with handle.session() as s:
                (r,) = s.query(Surface).filter(Surface.kind == "design").all()
                seen["inspection"] = r.status
        return real_rmtree(path, *a, **k)

    monkeypatch.setattr(store, "write_json", write)
    monkeypatch.setattr(phase_build.shutil, "rmtree", rmtree)
    body, job = build(client, project_id, wait_job, iid, p["id"])
    assert job["state"] == "succeeded"
    assert seen == {"source.json": "building", "inspection": "building"}
    assert row(handle, body["surface"]["id"]).status == "ready"


def test_an_inspection_removed_during_the_commit_is_404_not_500(
    client, project_id, wait_job, tmp_path, handle, target, monkeypatch
):
    """Final review 6: the folder vanishing between the lookup and the gate's reads is a 404."""
    iid = inspect(client, project_id, wait_job, site_landxml(tmp_path))
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    real = store.require_inspection

    def vanishing(h, inspection_id):
        d = real(h, inspection_id)
        shutil.rmtree(d)
        return d

    monkeypatch.setattr(store, "require_inspection", vanishing)
    r = commit(client, project_id, iid, p["id"])
    assert r.status_code == 404 and code(r) == "not_found"
    with handle.session() as s:
        assert s.query(Surface).filter(Surface.kind == "design").count() == 0


# --- follow-up fixes ---------------------------------------------------------------------------

_RELEASE = threading.Event()


@register_job_type("test_hold_a_worker")
def _hold_a_worker(ctx):
    _RELEASE.wait(30)
    return None


def test_a_queued_build_cancelled_before_it_starts_fails_the_row_and_says_so(
    client, app, project_id, wait_job, tmp_path, handle, target, events
):
    """The runner never calls the build for a cancelled queued job; the Volumes list must still hear
    `surfaces.changed` (a cloud build's list reloads on its job ending, a design import's does not)."""
    iid = inspect(client, project_id, wait_job, site_landxml(tmp_path))
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    _RELEASE.clear()
    holders = [
        app.state.jobs.submit(handle, "test_hold_a_worker", {}) for _ in range(app.state.jobs._workers)
    ]
    try:
        r = commit(client, project_id, iid, p["id"])
        assert r.status_code == 202, r.text
        sid, job_id = r.json()["surface"]["id"], r.json()["job"]["id"]
        assert client.post(url(project_id, f"/jobs/{job_id}/cancel")).status_code == 200
    finally:
        _RELEASE.set()
    assert wait_job(project_id, job_id)["state"] == "cancelled"
    for h in holders:
        wait_job(project_id, h.id)
    s = row(handle, sid)
    assert (s.status, s.error) == ("failed", "import cancelled")
    assert len(changed(events, sid)) == 2  # on create and on the cancel
    assert not surface_dir(handle, sid).exists() and store.inspection_dir(handle, iid).exists()


def test_a_preview_while_a_build_is_live_is_409_job_running(
    client, app, project_id, wait_job, tmp_path, handle, target, monkeypatch
):
    iid = inspect(client, project_id, wait_job, site_landxml(tmp_path))
    store.patch_json(store.inspection_dir(handle, iid) / "request.json", build_job_id="build-1")
    monkeypatch.setattr(app.state.jobs, "is_live", lambda job_id: job_id == "build-1")
    opts = {
        "candidate_ids": ["c0"],
        "source_crs": "EPSG:32639",
        "horizontal_unit": "metre",
        "vertical_unit": "metre",
        "target_surface_id": target,
    }
    r = client.post(url(project_id, f"/design-inspections/{iid}/previews"), json=opts)
    assert r.status_code == 409 and code(r) == "job_running"


@pytest.mark.parametrize("what", ["inspection", "preview"])
def test_an_inspection_deleted_while_it_is_read_is_404_not_500(
    client, project_id, wait_job, tmp_path, handle, target, monkeypatch, what
):
    """A dialog polls the preview while its close deletes the inspection: the read after the lookup
    finds no file."""
    iid = inspect(client, project_id, wait_job, site_landxml(tmp_path))
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    name = f"require_{what}"
    real = getattr(store, name)

    def racing(*args):
        found = real(*args)
        shutil.rmtree(store.inspection_dir(handle, iid))
        return found

    monkeypatch.setattr(store, name, racing)
    path = f"/design-inspections/{iid}" + (f"/previews/{p['id']}" if what == "preview" else "")
    r = client.get(url(project_id, path))
    assert r.status_code == 404, r.text
