"""The build phase for raster drawings and the drawing CRUD (spec §8.1, §8.2; plan Task 5)."""

import time

import numpy as np
import pytest
import rasterio
from drawings_helpers import BASE, build_drawing, inspect_ready, seed_frame, write_png, write_world_file
from geotiffs import make_geotiff
from PIL import Image
from rasterio.enums import ColorInterp

from app.drawings import raster_io, store


def test_png_builds_an_rgba_tiled_plan_with_overviews(client, project_id, wait_job, handle, tmp_path):
    src = write_png(tmp_path / "plan.png", 1100, 700)
    insp = inspect_ready(client, project_id, wait_job, src)
    d = build_drawing(client, project_id, wait_job, insp["id"], name="Foundation plan")
    assert d["status"] == "ready" and d["kind"] == "raster" and (d["width"], d["height"]) == (1100, 700)
    assert d["extent_src"] == [0.0, -700.0, 1100.0, 0.0] and d["georef"] is None and d["georef_version"] == 0
    assert d["layer_state"] == {"hidden_layers": [], "knockout_white": False} and d["bounds_site"] is None
    plan = store.plan_path(handle, d["id"])
    with rasterio.open(plan) as p:
        assert p.count == 4 and p.dtypes[0] == "uint8" and p.block_shapes[0] == (512, 512)
        assert p.compression.name.lower() == "deflate" and p.colorinterp[3] == ColorInterp.alpha
        assert p.overviews(1) == [2, 4]
        got = np.moveaxis(p.read([1, 2, 3]), 0, -1)
    assert np.array_equal(got, np.asarray(Image.open(src)))
    r = client.get(f"{BASE}/{project_id}/drawings/{d['id']}/thumbnail")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert [x["id"] for x in client.get(f"{BASE}/{project_id}/drawings").json()["items"]] == [d["id"]]
    assert not (plan.parent / "plan.tif.partial").exists()


@pytest.mark.parametrize("mode", ["L", "LA", "P", "RGBA", "I;16"])
def test_each_band_layout_becomes_rgba(client, project_id, wait_job, handle, tmp_path, mode):
    src = write_png(tmp_path / f"m{mode.replace(';', '')}.png", 40, 30, mode=mode)
    d = build_drawing(client, project_id, wait_job, inspect_ready(client, project_id, wait_job, src)["id"])
    with rasterio.open(store.plan_path(handle, d["id"])) as p:
        got = np.moveaxis(p.read(), 0, -1)
    img = Image.open(src)
    if mode == "I;16":
        grey = (np.asarray(img).astype(np.uint16) >> 8).astype(np.uint8)
        want = np.dstack([grey, grey, grey, np.full_like(grey, 255)])
    else:
        want = np.asarray(img.convert("RGBA"))
    assert np.array_equal(got, want), mode


def test_geotiff_embedded_placement(client, project_id, wait_job, handle, tmp_path):
    seed_frame(handle, 32633)
    insp = inspect_ready(client, project_id, wait_job, make_geotiff(tmp_path / "plan.tif", 64, 48))
    d = build_drawing(client, project_id, wait_job, insp["id"], placement={"method": "embedded"})
    g = d["georef"]
    assert g["method"] == "embedded" and g["epsg"] == 32633 and g["dst_crs_wkt"] == g["crs_wkt"]
    assert g["points"] == [] and g["rmse_m"] is None and g["model"] is None and d["georef_version"] == 1
    assert g["transform"] == [0.03, 0.0, 500000.0, 0.0, 0.03, 4983000.0]
    assert d["bounds_site"] == pytest.approx([500000.0, 4983000.0 - 1.44, 500001.92, 4983000.0])
    with rasterio.open(store.plan_path(handle, d["id"])) as p:
        assert p.crs.to_epsg() == 32633
        assert tuple(p.transform)[:6] == pytest.approx((0.03, 0.0, 500000.0, 0.0, -0.03, 4983000.0))
    seed_frame(handle, None)  # a local frame: the drawing is not in it
    assert client.get(f"{BASE}/{project_id}/drawings/{d['id']}").json()["bounds_site"] is None


def test_world_file_needs_a_crs(client, project_id, wait_job, tmp_path):
    src = write_png(tmp_path / "scan.png", 50, 40)
    write_world_file(src, pixel=0.5, top_left=(1000.0, 2000.0))
    insp = inspect_ready(client, project_id, wait_job, src)
    body = {"inspection_id": insp["id"], "name": "Scan", "placement": {"method": "embedded"}}
    r = client.post(f"{BASE}/{project_id}/drawings", json=body)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_placement"
    d = build_drawing(
        client, project_id, wait_job, insp["id"], placement={"method": "embedded", "crs": "EPSG:32633"}
    )
    assert d["georef"]["transform"] == [0.5, 0.0, 1000.0, 0.0, 0.5, 2000.0] and d["georef"]["epsg"] == 32633


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"placement": {"method": "crs", "crs": "EPSG:32633", "units": "metre"}}, "invalid_placement"),
        ({"placement": {"method": "embedded"}}, "invalid_placement"),
        ({"placement": {"method": "none"}, "layers": ["0"]}, "validation_error"),
        ({"placement": {"method": "none"}, "page": 2}, "validation_error"),
    ],
)
def test_create_refusals(client, project_id, wait_job, tmp_path, body, code):
    insp = inspect_ready(client, project_id, wait_job, write_png(tmp_path / "p.png", 20, 20))
    r = client.post(f"{BASE}/{project_id}/drawings", json={"inspection_id": insp["id"], "name": "P", **body})
    assert r.status_code == 422 and r.json()["error"]["code"] == code, r.text


def test_an_inspection_still_reading_is_409(client, project_id, handle, tmp_path):
    iid = store.new_id()
    store.create_inspection(handle, iid, write_png(tmp_path / "p.png", 20, 20), "png")  # "inspecting", no job
    body = {"inspection_id": iid, "name": "P", "placement": {"method": "none"}}
    r = client.post(f"{BASE}/{project_id}/drawings", json=body)
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_ready"
    uid = "00000000-0000-4000-8000-000000000000"
    assert (
        client.post(f"{BASE}/{project_id}/drawings", json={**body, "inspection_id": uid}).status_code == 404
    )


def test_a_source_changed_after_inspection_fails_the_build(client, project_id, wait_job, tmp_path):
    src = write_png(tmp_path / "p.png", 20, 20)
    insp = inspect_ready(client, project_id, wait_job, src)
    write_png(src, 30, 30, seed=9)
    created = build_drawing(client, project_id, wait_job, insp["id"], wait=False)
    assert wait_job(project_id, created["job"]["id"])["state"] == "failed"
    d = client.get(f"{BASE}/{project_id}/drawings/{created['drawing']['id']}").json()
    assert d["status"] == "failed" and "changed since it was read" in d["error"]


def _blocking_copy(monkeypatch):
    def copy(src, dst, *, progress, check_cancelled, **_):
        while True:
            check_cancelled()
            time.sleep(0.01)

    monkeypatch.setattr(raster_io, "copy_to_plan", copy)


def test_one_build_per_inspection_at_a_time(client, project_id, wait_job, tmp_path, monkeypatch):
    insp = inspect_ready(client, project_id, wait_job, write_png(tmp_path / "p.png", 20, 20))
    _blocking_copy(monkeypatch)
    created = build_drawing(client, project_id, wait_job, insp["id"], wait=False)
    r = client.post(
        f"{BASE}/{project_id}/drawings",
        json={"inspection_id": insp["id"], "name": "Again", "placement": {"method": "none"}},
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "job_running"
    client.post(f"{BASE}/{project_id}/jobs/{created['job']['id']}/cancel")
    wait_job(project_id, created["job"]["id"])


def test_delete_while_importing_is_409(client, project_id, wait_job, tmp_path, monkeypatch):
    insp = inspect_ready(client, project_id, wait_job, write_png(tmp_path / "p.png", 20, 20))
    _blocking_copy(monkeypatch)
    created = build_drawing(client, project_id, wait_job, insp["id"], wait=False)
    r = client.delete(f"{BASE}/{project_id}/drawings/{created['drawing']['id']}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "job_running"
    client.post(f"{BASE}/{project_id}/jobs/{created['job']['id']}/cancel")
    wait_job(project_id, created["job"]["id"])
    assert client.delete(f"{BASE}/{project_id}/drawings/{created['drawing']['id']}").status_code == 204
    assert client.get(f"{BASE}/{project_id}/drawings/{created['drawing']['id']}").status_code == 404


def test_cancel_marks_the_drawing_failed(client, project_id, wait_job, handle, tmp_path, monkeypatch):
    insp = inspect_ready(client, project_id, wait_job, write_png(tmp_path / "p.png", 20, 20))
    _blocking_copy(monkeypatch)
    created = build_drawing(client, project_id, wait_job, insp["id"], wait=False)
    client.post(f"{BASE}/{project_id}/jobs/{created['job']['id']}/cancel")
    assert wait_job(project_id, created["job"]["id"])["state"] == "cancelled"
    d = client.get(f"{BASE}/{project_id}/drawings/{created['drawing']['id']}").json()
    assert d["status"] == "failed" and d["error"] == "import cancelled"
    assert not store.drawing_dir(handle, d["id"]).exists()


def test_patch_delete_and_unknown_ids(client, project_id, wait_job, handle, tmp_path):
    insp = inspect_ready(client, project_id, wait_job, write_png(tmp_path / "p.png", 20, 20))
    d = build_drawing(client, project_id, wait_job, insp["id"], captured_on="2026-09-01")
    url = f"{BASE}/{project_id}/drawings/{d['id']}"
    r = client.patch(
        url, json={"name": "Rev C", "layer_state": {"hidden_layers": [], "knockout_white": True}}
    )
    assert r.status_code == 200 and r.json()["name"] == "Rev C" and r.json()["layer_state"]["knockout_white"]
    assert r.json()["captured_on"] == "2026-09-01"
    assert client.patch(url, json={"captured_on": None}).json()["captured_on"] is None
    assert client.delete(url).status_code == 204 and not store.drawing_dir(handle, d["id"]).exists()
    uid = "00000000-0000-4000-8000-000000000000"
    for method in ("get", "delete"):
        assert getattr(client, method)(f"{BASE}/{project_id}/drawings/{uid}").status_code == 404
    assert client.get(f"{BASE}/{project_id}/drawings/{uid}/thumbnail").status_code == 404


def test_the_thumbnail_is_204_unless_the_drawing_is_ready(client, project_id, wait_job, handle, tmp_path):
    """A rebuild or an interrupted import may leave a thumb.png behind; only a ready drawing serves it."""
    from app.db.models import Drawing

    src = write_png(tmp_path / "plan.png", 30, 20)
    d = build_drawing(client, project_id, wait_job, inspect_ready(client, project_id, wait_job, src)["id"])
    url = f"{BASE}/{project_id}/drawings/{d['id']}/thumbnail"
    assert store.thumb_path(handle, d["id"]).is_file() and client.get(url).status_code == 200
    for status in ("importing", "failed"):
        with handle.session() as s:
            s.get(Drawing, d["id"]).status = status
        assert client.get(url).status_code == 204, status
