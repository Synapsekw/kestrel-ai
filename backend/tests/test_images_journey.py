"""Images flows 1-5 on the real backend (plan 2026-09-27-images-e, Task 9, ruling E1).

The e2e flows drive the UI against route fakes; this drives the same steps through the real API,
with the offline seams the backend tests already use: I-BS's FakeFactory for SAM and the
`local_yolo._load` monkeypatch for detection.
"""

import math

import pytest
from assist_fakes import FakeFactory, install_weights
from imagery_camera_helpers import dji_jpeg
from library_helpers import add_library_model

from app.assist.service import SegmentService

API = "/api/v1"


class _Row:
    def __init__(self, xyxy, cls, conf):
        self.xyxy = [xyxy]
        self.cls = [cls]
        self.conf = [conf]


class _Result:
    def __init__(self, rows):
        self.boxes = rows
        self.obb = None
        self.masks = None


class _Yolo:
    names = {0: "crack"}

    def predict(self, source, **kwargs):
        return [_Result([_Row([500, 300, 590, 350], 0.0, 0.91)])]


@pytest.fixture
def flight(client, project, crack, import_source, tmp_path):
    folder = tmp_path / "flight"
    for n, lat in enumerate((25.26412, 25.26430, 25.26448), start=1):
        dji_jpeg(folder / f"DJI_000{n}.jpg", seed=n, lat=lat, lon=55.29218)
    import_source(project["id"], folder)
    items = client.get(f"{API}/projects/{project['id']}/images", params={"limit": 10}).json()["items"]
    return project["id"], sorted(items, key=lambda i: i["file_name"])


def test_flow1_a_dji_flight_has_geo_points_a_footprint_and_a_gsd(client, flight):
    pid, images = flight
    index = client.get(f"{API}/projects/{pid}/images/index", params={"fields": "geo"}).json()
    assert index["total"] == 3
    assert all(f & 4 for f in index["flags"])  # has GPS
    assert all(v is not None for v in index["lat"] + index["lon"])
    d = client.get(f"{API}/projects/{pid}/images/{images[0]['id']}").json()
    assert d["footprint_kind"] == "trapezoid" and d["footprint"]["type"] == "Polygon"
    assert d["camera"]["distance_source"] == "rel_alt"
    assert math.isclose(d["camera"]["gsd_mm"], 69.12, rel_tol=1e-3)


def test_flow2_four_shapes_make_four_findings_and_a_grade_sticks(client, flight, crack):
    pid, images = flight
    iid = images[0]["id"]
    bodies = [
        {"class_id": crack["id"], "x": 100, "y": 100, "w": 80, "h": 60},
        {"class_id": crack["id"], "shape": "rbox", "x": 300, "y": 100, "w": 120, "h": 40, "angle": 30},
        {
            "class_id": crack["id"],
            "shape": "polygon",
            "points": [[100, 300], [200, 300], [220, 380], [120, 400]],
        },
        {"class_id": crack["id"], "shape": "point", "x": 600, "y": 400},
    ]
    made = []
    for b in bodies:
        r = client.post(f"{API}/projects/{pid}/images/{iid}/boxes", json=b)
        assert r.status_code == 201, r.text
        made.append(r.json())
    assert [m["shape"] for m in made] == ["box", "rbox", "polygon", "point"]
    assert all(m["finding_id"] for m in made)
    r = client.patch(f"{API}/projects/{pid}/findings/{made[0]['finding_id']}", json={"severity": 3})
    assert r.status_code == 200, r.text
    listed = client.get(f"{API}/projects/{pid}/findings", params={"image_id": iid}).json()["items"]
    assert len(listed) == 4
    assert [f["severity"] for f in listed if f["id"] == made[0]["finding_id"]] == [3]
    boxes = client.get(f"{API}/projects/{pid}/images/{iid}/boxes").json()["items"]
    assert sorted(b["shape"] for b in boxes) == ["box", "point", "polygon", "rbox"]


def test_flow3_detect_accept_makes_a_finding_and_clears_the_pending_flag(
    app, client, flight, crack, tmp_path, monkeypatch
):
    pid, images = flight
    iid = images[1]["id"]
    monkeypatch.setattr("app.providers.local_yolo._load", lambda weights, device: _Yolo())
    monkeypatch.setattr("app.providers.local_yolo.cuda_available", lambda: False)
    model = add_library_model(app, tmp_path, name="crack-v1", class_names=["crack"])
    r = client.put(f"{API}/library/models/{model.id}/class-map", json={"mapping": {"crack": crack["id"]}})
    assert r.status_code == 200, r.text
    r = client.post(f"{API}/projects/{pid}/images/{iid}/detect", json={"model_id": model.id, "conf": 0.25})
    assert r.status_code == 200, r.text
    result = r.json()
    assert result["new"] == 1 and result["suggestions"][0]["review_state"] == "unreviewed"
    index = client.get(f"{API}/projects/{pid}/images/index").json()
    assert index["flags"][index["ids"].index(iid)] & 2  # pending suggestions
    r = client.post(
        f"{API}/projects/{pid}/boxes/review",
        json={"box_ids": [result["suggestions"][0]["id"]], "action": "accept"},
    )
    assert r.status_code == 200, r.text
    assert len(r.json()["finding_ids_created"]) == 1
    index = client.get(f"{API}/projects/{pid}/images/index").json()
    assert not index["flags"][index["ids"].index(iid)] & 2


def test_flow4_smart_polygon_with_the_fake_backend_creates_a_sam_polygon(
    app, client, flight, crack, monkeypatch
):
    pid, images = flight
    iid = images[0]["id"]
    install_weights(client.app.state.library.folder, monkeypatch)
    app.state.segment_service = SegmentService(
        backend_factory=FakeFactory(radius=60), cuda_available=lambda: False
    )
    crop = {"x": 0, "y": 0, "w": 800, "h": 600}
    r = client.post(f"{API}/projects/{pid}/images/{iid}/segment/prepare", json={"crop": crop})
    assert r.status_code == 200, r.text
    r = client.post(
        f"{API}/projects/{pid}/images/{iid}/segment",
        json={"crop": crop, "points": [{"x": 400, "y": 300, "positive": True}]},
    )
    assert r.status_code == 200, r.text
    seg = r.json()
    assert seg["device"] == "cpu" and 3 <= len(seg["polygon"]) <= 256
    r = client.post(
        f"{API}/projects/{pid}/images/{iid}/boxes",
        json={"class_id": crack["id"], "shape": "polygon", "points": seg["polygon"], "assist": "sam"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["assist"] == "sam" and r.json()["finding_id"]


def test_flow5_a_length_has_mm_and_sigma_from_the_nadir_distance(client, flight):
    pid, images = flight
    iid = images[0]["id"]
    r = client.post(
        f"{API}/projects/{pid}/images/{iid}/measurements", json={"x1": 100, "y1": 500, "x2": 200, "y2": 500}
    )
    assert r.status_code == 201, r.text
    m = r.json()
    cam = client.get(f"{API}/projects/{pid}/images/{iid}").json()["camera"]
    assert m["length_px"] == pytest.approx(100.0)
    # length_mm/sigma_mm are rounded to 2 dp on the wire (app/imagery/measurements.py `headline`),
    # so compare against the unrounded formula with a tolerance matching that rounding.
    assert m["length_mm"] == pytest.approx(100 * cam["gsd_mm"], abs=0.01)
    expected_sigma = (
        m["length_mm"] * cam["distance_sigma_m"] / cam["distance_m"] + math.sqrt(2) * cam["gsd_mm"]
    )
    assert m["sigma_mm"] == pytest.approx(expected_sigma, abs=0.01)
