"""POST /elevations -> elevation_import -> a ready dem surface (map workspace spec §7, §15)."""

import numpy as np
import pytest
import rasterio
from affine import Affine
from design_targets import target_spec, write_dem, write_target
from designs import E0, N0, plane_z
from rasterio.windows import Window
from test_elevation_admission import X0, Y0, plain_dem, tag_date
from test_surfaces_dates import validate

from app.surfaces import grid
from app.surfaces.paths import build_dir, surface_dir, surface_path

BASE = "/api/v1/projects"


def import_file(client, wait_job, project_id, **body):
    r = client.post(f"{BASE}/{project_id}/elevations", json=body)
    assert r.status_code == 202, r.text
    job = wait_job(project_id, r.json()["job"]["id"])
    surface = client.get(f"{BASE}/{project_id}/surfaces/{r.json()['surface']['id']}").json()
    return r.json(), job, surface


def heights(handle, surface_id):
    with rasterio.open(surface_path(handle, surface_id)) as ds:
        spec = grid.GridSpec.from_dataset(ds)
        return spec, ds.read(1)


def test_a_conforming_dsm_is_copied_as_it_is(client, wait_job, project_id, handle, tmp_path):
    src = write_target(tmp_path / "Aug DSM.tif", target_spec(cell=0.5), plane_z)
    created, job, s = import_file(client, wait_job, project_id, path=str(src), role="dsm", name="Aug DSM")
    validate("SurfaceWithJob", created)
    assert created["surface"]["kind"] == "dem" and created["surface"]["status"] == "building"
    assert created["surface"]["name"] == "Aug DSM" and created["job"]["type"] == "elevation_import"
    assert job["state"] == "succeeded", job
    assert (s["status"], s["method"], s["cell_size_m"], s["elevation_role"]) == (
        "ready",
        "dem_copy",
        0.5,
        "dsm",
    )
    assert s["epsg"] == 32639 and s["z_min"] is not None and s["coverage_fraction"] == pytest.approx(1.0)
    with rasterio.open(src) as a, rasterio.open(surface_path(handle, s["id"])) as b:
        assert np.array_equal(a.read(1), b.read(1), equal_nan=True)
    assert grid.convention_problems(surface_path(handle, s["id"])) == []
    assert not build_dir(handle, s["id"]).exists()
    assert (surface_dir(handle, s["id"]) / "source.json").is_file()
    assert job["result"]["method"] == "dem_copy" and job["result"]["aligned_to_surface_id"] is None
    validate("Surface", s)


def test_a_plain_dem_is_regridded_onto_the_ladder(client, wait_job, project_id, handle, tmp_path):
    _, job, s = import_file(
        client, wait_job, project_id, path=str(plain_dem(tmp_path)), role="dtm", name="DTM"
    )
    assert job["state"] == "succeeded", job
    assert (s["method"], s["cell_size_m"], s["elevation_role"]) == ("dem_resample", 0.5, "dtm")
    spec, z = heights(handle, s["id"])
    xs, ys = spec.cell_centres(Window(0, 0, spec.width, spec.height))
    ok = np.isfinite(z)
    assert ok.mean() > 0.9
    assert np.abs(z[ok] - plane_z(xs[ok], ys[ok])).max() < 1e-3
    assert grid.convention_problems(surface_path(handle, s["id"])) == []


def test_an_explicit_cell(client, wait_job, project_id, tmp_path):
    _, _, s = import_file(
        client, wait_job, project_id, path=str(plain_dem(tmp_path)), role="dsm", name="DSM", cell_size_m=0.25
    )
    assert s["cell_size_m"] == 0.25


def test_the_date_comes_from_the_tiff_tag_unless_given(client, wait_job, project_id, tmp_path):
    path = plain_dem(tmp_path)
    tag_date(path, "2026:08:14 10:30:00")
    created, _, s = import_file(client, wait_job, project_id, path=str(path), role="dsm", name="DSM")
    assert created["surface"]["captured_on"] == "2026-08-14" and s["captured_on"] == "2026-08-14"
    _, _, s = import_file(
        client, wait_job, project_id, path=str(path), role="dsm", name="DSM", captured_on="2026-09-01"
    )
    assert s["captured_on"] == "2026-09-01"


def test_an_undeclared_sentinel_becomes_nan(client, wait_job, project_id, handle, tmp_path):
    cols, rows = np.meshgrid(np.arange(400) + 0.5, np.arange(200) + 0.5)
    z = plane_z(X0 + cols * 0.5, Y0 - rows * 0.5).astype(np.float32)
    z[50:150, 100:200] = -9999.0  # a Pix4D hole, no nodata declared
    path = write_dem(tmp_path / "holes.tif", z, x0=X0, y0=Y0, cell=0.5)
    _, job, s = import_file(client, wait_job, project_id, path=str(path), role="dsm", name="Holes")
    assert job["state"] == "succeeded" and s["method"] == "dem_resample"
    assert s["z_min"] > 0
    spec, out = heights(handle, s["id"])
    hole = spec.window_for_bounds((X0 + 60, Y0 - 65, X0 + 90, Y0 - 35))
    r0, c0 = int(hole.row_off), int(hole.col_off)
    assert np.isnan(out[r0 : r0 + int(hole.height), c0 : c0 + int(hole.width)]).all()


def test_a_rotated_dem_is_regridded_within_a_millimetre(client, wait_job, project_id, handle, tmp_path):
    t = Affine.translation(X0, Y0) @ Affine.rotation(10.0) @ Affine.scale(0.3, -0.3)
    cols, rows = np.meshgrid(np.arange(300) + 0.5, np.arange(200) + 0.5)
    xs, ys = t * (cols, rows)
    path = write_dem(
        tmp_path / "rot.tif", plane_z(xs, ys).astype(np.float32), x0=X0, y0=Y0, cell=0.3, rotation=10.0
    )
    _, job, s = import_file(client, wait_job, project_id, path=str(path), role="dsm", name="Rotated")
    assert job["state"] == "succeeded" and s["method"] == "dem_resample"
    spec, z = heights(handle, s["id"])
    cx, cy = spec.cell_centres(Window(0, 0, spec.width, spec.height))
    ok = np.isfinite(z)
    assert ok.sum() > 1000 and np.abs(z[ok] - plane_z(cx[ok], cy[ok])).max() < 1e-3


def test_refusals_through_the_api(client, project_id, tmp_path):
    url = f"{BASE}/{project_id}/elevations"
    r = client.post(url, json={"path": str(plain_dem(tmp_path, crs=None)), "role": "dsm", "name": "No CRS"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_coordinates"
    assert r.json()["error"]["message"] == "this elevation file has no coordinates"
    rgb = write_dem(tmp_path / "o.tif", np.zeros((3, 8, 8)), x0=E0, y0=N0, cell=1.0, dtype="uint8", count=3)
    r = client.post(url, json={"path": str(rgb), "role": "dsm", "name": "RGB"})
    assert r.status_code == 422 and "import it under Maps" in r.json()["error"]["message"]
    r = client.post(url, json={"path": str(plain_dem(tmp_path, name="ok.tif")), "name": "No role"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    assert client.get(f"{BASE}/{project_id}/surfaces").json()["items"] == []


def test_a_dem_is_a_normal_surface_for_tiles_and_samples(client, wait_job, project_id, tmp_path):
    _, _, s = import_file(client, wait_job, project_id, path=str(plain_dem(tmp_path)), role="dsm", name="DSM")
    tile = client.get(f"{BASE}/{project_id}/surfaces/{s['id']}/tiles/0/0/0")
    assert tile.status_code == 200 and tile.headers["content-type"] == "image/png"
    x, y = X0 + 60.0, Y0 - 30.0
    got = client.get(f"{BASE}/{project_id}/surfaces/{s['id']}/sample", params={"x": x, "y": y}).json()
    assert got["z"] == pytest.approx(float(plane_z(x, y)), abs=1e-3)
