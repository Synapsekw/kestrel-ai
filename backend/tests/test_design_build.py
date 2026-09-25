"""createDesignSurface and the build phase (spec §2 Commit gate, §3, §4, §6, §15.3 API and jobs, §16)."""

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
from app.surfaces import grid
from app.surfaces.design import rasterise, store
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
    iid = inspect(client, project_id, wait_job, site_landxml(tmp_path))
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
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
    # A second commit while the build runs is refused (ruling 1: `conflict`), and leaves no row.
    again = commit(client, project_id, iid, p["id"])
    assert (
        again.status_code == 409
        and code(again) == "conflict"
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
