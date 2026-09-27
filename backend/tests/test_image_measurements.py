"""Image length measurements (spec 2026-09-26-image-inspection sections 8.1, 9.3, 14; R-BA3, R-BA7)."""

import math

import pytest
from sqlalchemy import func, select

from app.db.models import ImageMeasurement
from app.imagery import camera, measurements

API = "/api/v1"


@pytest.fixture
def ctx(client, project, import_source, tmp_path, make_jpeg) -> dict:
    folder = tmp_path / "frames"
    make_jpeg(folder / "S_0001_0001.jpg", 320, 240, seed=1)
    import_source(project["id"], folder)
    base = f"{API}/projects/{project['id']}"
    image_id = client.get(f"{base}/images").json()["items"][0]["id"]
    return {"base": base, "image_id": image_id, "url": f"{base}/images/{image_id}/measurements"}


def _code(r) -> str:
    return r.json()["error"]["code"]


def test_create_list_delete_without_a_distance(client, ctx):
    r = client.post(ctx["url"], json={"x1": 0, "y1": 0, "x2": 30, "y2": 40, "label": "crack width"})
    assert r.status_code == 201, r.text
    m = r.json()
    assert (m["image_id"], m["length_px"], m["label"], m["length_mm"], m["sigma_mm"]) == (
        ctx["image_id"],
        50.0,
        "crack width",
        None,
        None,
    )
    assert [x["id"] for x in client.get(ctx["url"]).json()["items"]] == [m["id"]]
    assert client.delete(f"{ctx['base']}/image-measurements/{m['id']}").status_code == 204
    assert client.get(ctx["url"]).json()["items"] == []


def test_label_defaults_to_empty(client, ctx):
    assert client.post(ctx["url"], json={"x1": 0, "y1": 0, "x2": 3, "y2": 4}).json()["label"] == ""


def test_mm_and_sigma_from_the_camera_scale(client, ctx, monkeypatch):
    s = camera.Scale(distance_m=38.4, distance_sigma_m=1.0, distance_source="rel_alt", gsd_mm=1.8)
    monkeypatch.setattr(camera, "scale", lambda image: s)
    m = client.post(ctx["url"], json={"x1": 0, "y1": 0, "x2": 30, "y2": 40}).json()
    length_mm = 50 * 1.8
    assert m["length_mm"] == pytest.approx(length_mm, abs=0.01)
    assert m["sigma_mm"] == pytest.approx(length_mm * 1.0 / 38.4 + math.sqrt(2) * 1.8, abs=0.01)
    [listed] = client.get(ctx["url"]).json()["items"]
    assert listed["length_mm"] == m["length_mm"]


def test_headline_is_null_without_a_scale():
    assert measurements.headline(50.0, None) == (None, None)


def test_ends_must_be_inside(client, ctx):
    for body in ({"x1": -1, "y1": 0, "x2": 5, "y2": 5}, {"x1": 0, "y1": 0, "x2": 321, "y2": 5}):
        r = client.post(ctx["url"], json=body)
        assert r.status_code == 422 and _code(r) == "out_of_bounds", body


def test_non_finite_ends_are_validation_error(client, ctx):
    for bad in ("NaN", "Infinity", "-Infinity"):
        for body in (
            {"x1": bad, "y1": 0, "x2": 5, "y2": 5},
            {"x1": 0, "y1": bad, "x2": 5, "y2": 5},
            {"x1": 0, "y1": 0, "x2": bad, "y2": 5},
            {"x1": 0, "y1": 0, "x2": 5, "y2": bad},
        ):
            r = client.post(ctx["url"], json=body)
            assert r.status_code == 422 and _code(r) == "validation_error", body


def test_cap_per_image(client, ctx, monkeypatch):
    assert measurements.PER_IMAGE_MEASUREMENTS == 500
    monkeypatch.setattr(measurements, "PER_IMAGE_MEASUREMENTS", 1)
    assert client.post(ctx["url"], json={"x1": 0, "y1": 0, "x2": 9, "y2": 0}).status_code == 201
    r = client.post(ctx["url"], json={"x1": 0, "y1": 0, "x2": 9, "y2": 0})
    assert r.status_code == 422 and _code(r) == "too_many_measurements"


def test_unknown_ids_are_404(client, ctx):
    assert client.get(f"{ctx['base']}/images/nope/measurements").status_code == 404
    assert client.delete(f"{ctx['base']}/image-measurements/nope").status_code == 404


def test_image_delete_cascades(client, ctx, handle):
    client.post(ctx["url"], json={"x1": 0, "y1": 0, "x2": 9, "y2": 0})
    r = client.post(f"{ctx['base']}/images/bulk-delete", json={"image_ids": [ctx["image_id"]]})
    assert r.status_code == 200, r.text
    assert client.get(ctx["url"]).status_code == 404
    with handle.session() as s:
        assert s.scalar(select(func.count()).select_from(ImageMeasurement)) == 0
