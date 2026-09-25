"""createDesignPreview, getDesignPreview, getDesignPreviewImage and the preview phase (spec §4, §10, §12)."""

import time

import pytest
from design_dxf import add_contours, add_faces, new_doc, save
from design_landxml import grid_tin, write_landxml
from design_targets import add_target, target_spec, write_target
from designs import E0, N0, cone_contour_runs, plane_z, two_triangle_plane

from app.db.models import Surface
from app.surfaces import grid
from app.surfaces.design import phase_preview, store
from app.surfaces.paths import surface_path

BASE = "/api/v1/projects"


@pytest.fixture
def project_kind() -> str:
    """Design surfaces are detection work: F0 guards the router with require_kind(("detect",), ANY_KIND)."""
    return "detect"


def url(pid, iid, rest=""):
    return f"{BASE}/{pid}/design-inspections/{iid}{rest}"


def inspect(client, pid, wait_job, path) -> str:
    body = client.post(f"{BASE}/{pid}/design-inspections", json={"path": str(path)}).json()
    assert wait_job(pid, body["job"]["id"])["state"] == "succeeded"
    return body["inspection"]["id"]


def options(**kw):
    return {
        "candidate_ids": ["c0"],
        "source_crs": "EPSG:32639",
        "horizontal_unit": "metre",
        "vertical_unit": "metre",
        **kw,
    }


def preview(client, pid, wait_job, iid, **kw) -> dict:
    r = client.post(url(pid, iid, "/previews"), json=options(**kw))
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["preview"]["state"] == "running" and body["job"]["type"] == "design_import"
    wait_job(pid, body["job"]["id"])
    return client.get(url(pid, iid, f"/previews/{body['preview']['id']}")).json()


def codes_of(p):
    return {w["code"]: w for w in p["warnings"]}


@pytest.fixture
def target(handle):
    return add_target(handle, target_spec(), plane_z)


def site_tin(dz=0.3, **kw):
    return grid_tin(161, 61, 1.0, E0 + 20, N0 + 20, lambda e, n: plane_z(e, n) + dz)


def test_a_landxml_on_its_site(client, project_id, wait_job, tmp_path, target, handle):
    pts, faces = site_tin()
    iid = inspect(
        client,
        project_id,
        wait_job,
        write_landxml(tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": faces}]),
    )
    assert client.get(url(project_id, iid)).json()["default_target_surface_id"] == target
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    assert p["state"] == "ready" and p["error"] is None
    assert p["overlap_fraction"] >= 0.99 and p["z_check"]["median_dz_m"] == pytest.approx(0.3, abs=0.01)
    assert (p["output"]["epsg"], p["output"]["cell_size_m"]) == (32639, 0.5) and p["triangle_count"] == len(
        faces
    )
    assert "crs_from_file" in codes_of(p) and not [w for w in p["warnings"] if w["level"] != "info"]
    img = client.get(url(project_id, iid, f"/previews/{p['id']}/image"))
    assert img.status_code == 200 and img.headers["content-type"] == "image/png"
    internal = store.read_json(
        store.preview_dir(store.inspection_dir(handle, iid), p["id"]) / "internal.json"
    )
    with grid.open_surface(surface_path(handle, target)) as r:
        assert grid.same_lattice(grid.GridSpec.from_json(internal["output_spec"]), r.spec)
    req = store.read_json(store.inspection_dir(handle, iid) / "request.json")
    assert req["latest_preview_id"] == p["id"] and req["preview_job_ids"] == [req["latest_preview_job_id"]]


def test_an_east_north_file_gets_no_overlap_and_the_swap_fixes_it(
    client, project_id, wait_job, tmp_path, target
):
    pts, faces = site_tin()
    src = write_landxml(tmp_path / "enz.xml", [{"name": "EG", "points": pts, "faces": faces}], order="ENZ")
    iid = inspect(client, project_id, wait_job, src)
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    assert codes_of(p)["no_overlap"]["level"] == "warn"
    (s,) = [s for s in p["suggestions"] if s["code"] == "swap_xy"]
    assert s["overlap_fraction"] >= 0.9 and s["options_patch"] == {"swap_xy": True}
    fixed = preview(client, project_id, wait_job, iid, target_surface_id=target, **s["options_patch"])
    assert fixed["overlap_fraction"] >= 0.99 and "no_overlap" not in codes_of(fixed)


def test_metres_read_as_feet_get_a_unit_suggestion(client, project_id, wait_job, tmp_path, target):
    pts, faces = site_tin()
    iid = inspect(
        client,
        project_id,
        wait_job,
        write_landxml(tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": faces}]),
    )
    p = preview(
        client, project_id, wait_job, iid, target_surface_id=target, horizontal_unit="international_foot"
    )
    assert [s["options_patch"] for s in p["suggestions"] if s["code"] == "horizontal_unit"] == [
        {"horizontal_unit": "metre"}
    ]
    assert "foot_ambiguity" in codes_of(p)


def test_dxf_contours_are_triangulated_and_trimmed(client, project_id, wait_job, tmp_path, target, handle):
    doc = new_doc()
    add_contours(doc.modelspace(), *cone_contour_runs(128), layer="CONTOURS")
    iid = inspect(client, project_id, wait_job, save(doc, tmp_path / "c.dxf"))
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    assert p["state"] == "ready" and p["triangle_count"] > 1000
    assert codes_of(p)["long_edges_removed"]["level"] == "info"
    internal = store.read_json(
        store.preview_dir(store.inspection_dir(handle, iid), p["id"]) / "internal.json"
    )
    assert internal["max_edge_m"] >= 10 * 0.5


def test_a_mixed_selection_is_blocked(client, project_id, wait_job, tmp_path, target):
    doc = new_doc()
    add_faces(doc.modelspace(), *two_triangle_plane(), "TIN")
    add_contours(doc.modelspace(), *cone_contour_runs(32), layer="CONTOURS")
    iid = inspect(client, project_id, wait_job, save(doc, tmp_path / "m.dxf"))
    p = preview(client, project_id, wait_job, iid, target_surface_id=target, candidate_ids=["c0", "c1"])
    assert p["state"] == "ready" and codes_of(p)["mixed_geometry"]["level"] == "block" and p["output"] is None
    assert client.get(url(project_id, iid, f"/previews/{p['id']}/image")).status_code == 204


def test_a_dem_preview(client, project_id, wait_job, tmp_path, target):
    src = write_target(tmp_path / "dem.tif", target_spec(), lambda x, y: plane_z(x, y) + 0.5)
    iid = inspect(client, project_id, wait_job, src)
    p = preview(client, project_id, wait_job, iid, target_surface_id=target)
    assert p["overlap_fraction"] >= 0.99 and p["triangle_count"] is None
    assert p["z_check"]["median_dz_m"] == pytest.approx(0.5, abs=0.01)


def test_no_target_uses_the_cell_size(client, project_id, wait_job, tmp_path):
    pts, faces = site_tin()
    iid = inspect(
        client,
        project_id,
        wait_job,
        write_landxml(tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": faces}]),
    )
    p = preview(client, project_id, wait_job, iid, cell_size_m=0.25)
    assert p["output"]["cell_size_m"] == 0.25 and "no_target" in codes_of(p) and p["overlap_fraction"] is None


def test_refusals(client, project_id, wait_job, tmp_path, target, handle):
    two = [
        {"name": "A", "points": site_tin()[0], "faces": site_tin()[1]},
        {"name": "B", "points": site_tin()[0], "faces": site_tin()[1]},
    ]
    iid = inspect(client, project_id, wait_job, write_landxml(tmp_path / "s.xml", two))
    post = lambda **kw: client.post(url(project_id, iid, "/previews"), json=options(**kw))  # noqa: E731
    assert post(candidate_ids=["c9"], target_surface_id=target).status_code == 422
    assert post(candidate_ids=["c0", "c0"], target_surface_id=target).status_code == 422
    assert post(candidate_ids=["c0", "c1"], target_surface_id=target).status_code == 422
    assert post(source_crs="EPSG:999999", target_surface_id=target).status_code == 422
    assert post(target_surface_id="not-a-surface").status_code == 422
    assert post().status_code == 422  # neither a target nor a cell size
    # Ruling 1: an inspection that is not ready yet is 409 not_ready, not conflict.
    store.patch_json(store.inspection_dir(handle, iid) / "inspection.json", state="inspecting")
    r = post(target_surface_id=target)
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_ready"
    assert (
        client.get(url(project_id, iid, "/previews/00000000-0000-4000-8000-000000000000")).status_code == 404
    )


def test_a_target_that_is_not_ready_is_409_not_ready(client, project_id, wait_job, tmp_path, target, handle):
    pts, faces = site_tin()
    iid = inspect(
        client,
        project_id,
        wait_job,
        write_landxml(tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": faces}]),
    )
    post = lambda **kw: client.post(url(project_id, iid, "/previews"), json=options(**kw))  # noqa: E731
    with handle.session() as s:
        building = Surface(name="Building DSM", kind="cloud_dsm", status="building")
        design = Surface(name="A design", kind="design", status="ready")
        s.add_all([building, design])
        s.flush()
        building_id, design_id = building.id, design.id
    r = post(target_surface_id=building_id)
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_ready", r.text
    r = post(target_surface_id=design_id)  # not a cloud surface at all: still a validation error
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    surface_path(handle, target).unlink()  # a ready row whose surface.tif is missing
    r = post(target_surface_id=target)
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_ready"


def test_a_new_preview_cancels_the_running_one(client, project_id, wait_job, tmp_path, target, monkeypatch):
    pts, faces = site_tin()
    iid = inspect(
        client,
        project_id,
        wait_job,
        write_landxml(tmp_path / "s.xml", [{"name": "EG", "points": pts, "faces": faces}]),
    )
    calls, real = [], phase_preview.compute

    def slow_first(handle, idir, pdir, opts, *, progress, check_cancelled):
        calls.append(pdir.name)
        while len(calls) == 1:
            check_cancelled()
            time.sleep(0.01)
        return real(handle, idir, pdir, opts, progress=progress, check_cancelled=check_cancelled)

    monkeypatch.setattr(phase_preview, "compute", slow_first)
    first = client.post(url(project_id, iid, "/previews"), json=options(target_surface_id=target)).json()
    deadline = time.time() + 10
    while not calls and time.time() < deadline:
        time.sleep(0.01)
    second = client.post(
        url(project_id, iid, "/previews"), json=options(target_surface_id=target, swap_xy=True)
    ).json()
    assert wait_job(project_id, first["job"]["id"])["state"] == "cancelled"
    old = client.get(url(project_id, iid, f"/previews/{first['preview']['id']}")).json()
    assert old["state"] == "failed" and old["error"] == "preview cancelled"
    assert wait_job(project_id, second["job"]["id"])["state"] == "succeeded"
