"""createDrawingInspection, getDrawingInspection, getDrawingPageThumbnail (spec §8.2 inspect; plan
Task 3). Formats arrive task by task: this file covers PNG/JPG/TIF and the refusals."""

import io

from drawings_helpers import BASE, inspect_ready, write_png, write_world_file
from geotiffs import make_geotiff
from PIL import Image

from app.jobs.registry import get_job_type


def inspect(client, project_id, path):
    return client.post(f"{BASE}/{project_id}/drawing-inspections", json={"path": str(path)})


def thumb(client, project_id, iid, page):
    return client.get(f"{BASE}/{project_id}/drawing-inspections/{iid}/pages/{page}/thumbnail")


def test_the_job_type_is_registered():
    import app.drawings.jobs  # noqa: F401

    assert callable(get_job_type("drawing_import"))


def test_png_inspection(client, project_id, wait_job, tmp_path):
    insp = inspect_ready(client, project_id, wait_job, write_png(tmp_path / "plan.png", 300, 200))
    assert insp["format"] == "png" and (insp["width"], insp["height"]) == (300, 200)
    assert insp["extent_src"] == [0.0, -200.0, 300.0, 0.0] and insp["sha256"]
    assert insp["embedded"] is None and insp["layers"] == [] and insp["pages"] == []
    assert insp["page_count"] is None
    assert insp["units"] is None and insp["warnings"] == []
    r = thumb(client, project_id, insp["id"], 1)
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert max(Image.open(io.BytesIO(r.content)).size) == 160
    assert thumb(client, project_id, insp["id"], 2).status_code == 204
    assert thumb(client, project_id, insp["id"], 51).status_code == 422  # the contract's maximum is 50


def test_world_file_offers_embedded_placement_that_needs_a_crs(client, project_id, wait_job, tmp_path):
    src = write_png(tmp_path / "scan.png", 100, 80)
    write_world_file(src, pixel=0.5, top_left=(1000.0, 2000.0))
    insp = inspect_ready(client, project_id, wait_job, src)
    assert insp["embedded"] == {
        "source": "world_file",
        "crs_wkt": None,
        "epsg": None,
        "transform": [0.5, 0.0, 1000.0, 0.0, 0.5, 2000.0],  # (col, -row) -> (E, N)
        "needs_crs": True,
    }
    assert [w["code"] for w in insp["warnings"]] == ["world_file_needs_crs"]


def test_geotiff_offers_embedded_placement_with_its_crs(client, project_id, wait_job, tmp_path):
    insp = inspect_ready(client, project_id, wait_job, make_geotiff(tmp_path / "plan.tif", 64, 48))
    emb = insp["embedded"]
    assert insp["format"] == "tif" and emb["source"] == "geotiff" and emb["epsg"] == 32633
    assert not emb["needs_crs"]
    assert emb["transform"] == [0.03, 0.0, 500000.0, 0.0, 0.03, 4983000.0]


def test_refusals(client, project_id, tmp_path):
    dwg = tmp_path / "site.dwg"
    dwg.write_bytes(b"AC1032")
    r = inspect(client, project_id, dwg)
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    assert r.json()["error"]["details"] == {"reason": "dwg"}
    assert "save it as DXF" in r.json()["error"]["message"]
    assert inspect(client, project_id, tmp_path / "missing.png").status_code == 404
    assert inspect(client, project_id, tmp_path / "missing.dwg").status_code == 404  # F8: 404 first
    assert inspect(client, project_id, "relative.png").status_code == 404
    txt = tmp_path / "notes.txt"
    txt.write_text("x")
    r = inspect(client, project_id, txt)
    assert r.status_code == 422 and r.json()["error"]["details"] == {"reason": "extension"}


def test_a_broken_file_fails_readably(client, project_id, wait_job, tmp_path):
    bad = tmp_path / "broken.png"
    bad.write_bytes(b"this is not a png")
    body = inspect(client, project_id, bad).json()
    assert wait_job(project_id, body["job"]["id"])["state"] == "failed"
    got = client.get(f"{BASE}/{project_id}/drawing-inspections/{body['inspection']['id']}").json()
    assert got["state"] == "failed" and got["error"].startswith("reading the drawing failed")
    assert thumb(client, project_id, got["id"], 1).status_code == 204


def test_unknown_inspection_is_404(client, project_id):
    assert client.get(f"{BASE}/{project_id}/drawing-inspections/nope").status_code == 404
    uid = "00000000-0000-4000-8000-000000000000"
    assert client.get(f"{BASE}/{project_id}/drawing-inspections/{uid}").status_code == 404
    assert thumb(client, project_id, uid, 1).status_code == 404
