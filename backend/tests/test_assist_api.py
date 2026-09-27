"""The assist routes (spec §14 segment/prepare, segment, assist-models; §16 SAM rows; rulings
BS1-BS3, BS8)."""

import subprocess
import sys
import threading

import pytest
from assist_fakes import FakeFactory, fake_sam_spec, install_weights
from library_helpers import wait_library_job

from app.assist import service as assist_service
from app.assist.service import SegmentService

LIB = "/api/v1/library/assist-models"
CROP = {"x": 700, "y": 500, "w": 600, "h": 600}


@pytest.fixture
def library_folder(client):
    return client.app.state.library.folder


@pytest.fixture
def fake_sam(app):
    factory = FakeFactory(radius=60)
    app.state.segment_service = SegmentService(backend_factory=factory, cuda_available=lambda: False)
    return factory


@pytest.fixture
def frame(client, project, import_source, tmp_path, make_jpeg):
    folder = tmp_path / "frames"
    make_jpeg(folder / "DJI_0001.jpg", 2000, 1500, seed=1)
    import_source(project["id"], folder)
    image = client.get(f"/api/v1/projects/{project['id']}/images").json()["items"][0]
    return project["id"], image["id"]


def _seg(pid, iid, tail=""):
    return f"/api/v1/projects/{pid}/images/{iid}/segment{tail}"


def _click(x, y, positive=True):
    return {"x": x, "y": y, "positive": positive}


def test_the_catalogue_lists_sam_as_missing_then_ready(client, library_folder, monkeypatch, fake_sam):
    fake_sam_spec(monkeypatch, b"fake sam 2.1 tiny weights")
    body = client.get(LIB).json()
    assert body["next_cursor"] is None and [m["key"] for m in body["items"]] == ["sam2.1_t"]
    item = body["items"][0]
    assert set(item) == {"key", "name", "description", "size_mb", "sha256", "state", "reason", "job_id"}
    assert item["state"] == "missing" and item["reason"] and item["job_id"] is None
    install_weights(library_folder, monkeypatch)
    ready = client.get(LIB).json()["items"][0]
    assert ready["state"] == "ready" and ready["reason"] is None


def test_acquire_runs_the_library_job(client, monkeypatch):
    content = b"downloaded sam bytes"
    fake_sam_spec(monkeypatch, content)
    monkeypatch.setattr(
        "app.training.starter_download.download_weights", lambda ctx, target: target.write_bytes(content)
    )
    r = client.post(f"{LIB}/sam2.1_t/acquire")
    assert r.status_code == 202, r.text
    job = wait_library_job(client, r.json()["job"]["id"])
    assert (
        job["state"] == "succeeded"
        and job["type"] == "assist_acquire"
        and job["result"] == {"key": "sam2.1_t"}
    )
    assert client.get(LIB).json()["items"][0]["state"] == "ready"


def test_a_second_acquire_while_one_is_live_is_job_running(client, monkeypatch):
    content = b"slow sam bytes"
    fake_sam_spec(monkeypatch, content)
    release = threading.Event()

    def slow_download(ctx, target):
        release.wait(10)
        target.write_bytes(content)

    monkeypatch.setattr("app.training.starter_download.download_weights", slow_download)
    first = client.post(f"{LIB}/sam2.1_t/acquire").json()["job"]["id"]
    try:
        again = client.post(f"{LIB}/sam2.1_t/acquire")
        assert again.status_code == 409
        assert again.json()["error"]["code"] == "job_running"
        assert again.json()["error"]["details"] == {"job_id": first}
        assert client.get(LIB).json()["items"][0]["job_id"] == first
    finally:
        release.set()
    assert wait_library_job(client, first)["state"] == "succeeded"
    assert client.get(LIB).json()["items"][0]["job_id"] is None


def test_import_runs_the_library_job(client, monkeypatch, tmp_path):
    content = b"imported sam bytes"
    fake_sam_spec(monkeypatch, content)
    source = tmp_path / "sam2.1_t.pt"
    source.write_bytes(content)
    r = client.post(f"{LIB}/sam2.1_t/import", json={"path": str(source)})
    assert r.status_code == 202, r.text
    job = wait_library_job(client, r.json()["job"]["id"])
    assert job["state"] == "succeeded" and job["params"]["path"] == str(source)


@pytest.mark.parametrize("path", ["relative/sam.pt", "C:/nowhere/sam.pt", "C:/Windows/win.ini"])
def test_import_refuses_an_unusable_path(client, path):
    r = client.post(f"{LIB}/sam2.1_t/import", json={"path": path})
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_unknown_assist_model_is_not_found(client):
    assert client.post(f"{LIB}/sam3/acquire").status_code == 404


def test_segment_without_weights_is_assist_model_missing(client, frame, monkeypatch, fake_sam):
    fake_sam_spec(monkeypatch, b"fake sam 2.1 tiny weights")
    pid, iid = frame
    r = client.post(_seg(pid, iid, "/prepare"), json={"crop": CROP})
    assert r.status_code == 409
    err = r.json()["error"]
    assert err["code"] == "assist_model_missing" and err["details"] == {"key": "sam2.1_t", "state": "missing"}


def test_prepare_then_click(client, library_folder, frame, monkeypatch, fake_sam):
    install_weights(library_folder, monkeypatch)
    pid, iid = frame
    first = client.post(_seg(pid, iid, "/prepare"), json={"crop": CROP})
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["crop"] == {"x": 640, "y": 448, "w": 704, "h": 704}
    assert body["device"] == "cpu" and body["cached"] is False
    assert client.post(_seg(pid, iid, "/prepare"), json={"crop": CROP}).json()["cached"] is True
    r = client.post(
        _seg(pid, iid), json={"crop": CROP, "points": [_click(1000, 800), _click(1100, 850, False)]}
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["device"] == "cpu" and out["encode_ms"] == 0 and out["score"] == pytest.approx(0.9)
    assert out["crop"] == body["crop"] and 3 <= len(out["polygon"]) <= 256
    assert all(640 <= x <= 1344 and 448 <= y <= 1152 for x, y in out["polygon"])
    assert fake_sam.made[0].encodes == 1
    assert fake_sam.made[0].decoded[-1][1] == [1, 0]  # positive: false is label 0


def test_an_empty_mask_is_a_200_with_no_polygon(client, library_folder, frame, monkeypatch, app):
    app.state.segment_service = SegmentService(
        backend_factory=FakeFactory(radius=0), cuda_available=lambda: False
    )
    install_weights(library_folder, monkeypatch)
    pid, iid = frame
    r = client.post(_seg(pid, iid), json={"crop": CROP, "points": [_click(1000, 800)]})
    assert r.status_code == 200 and r.json()["polygon"] is None and r.json()["score"] == 0.0


def test_a_point_outside_the_crop_is_refused(client, library_folder, frame, monkeypatch, fake_sam):
    install_weights(library_folder, monkeypatch)
    pid, iid = frame
    r = client.post(_seg(pid, iid), json={"crop": CROP, "points": [_click(10, 10)]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "points_outside_crop"


def test_an_unknown_image_is_not_found(client, library_folder, project, monkeypatch, fake_sam):
    install_weights(library_folder, monkeypatch)
    r = client.post(_seg(project["id"], "no-such-image", "/prepare"), json={"crop": CROP})
    assert r.status_code == 404


def test_missing_sam_modules_mark_the_tool_unavailable_and_the_app_keeps_working(
    client, library_folder, frame, monkeypatch, app
):
    monkeypatch.setattr(assist_service, "BACKEND_MODULE", "app.assist.no_such_backend")
    app.state.segment_service = SegmentService(cuda_available=lambda: False)  # the real factory
    install_weights(library_folder, monkeypatch)
    pid, iid = frame
    r = client.post(_seg(pid, iid, "/prepare"), json={"crop": CROP})
    assert r.status_code == 409
    err = r.json()["error"]
    assert err["details"]["state"] == "unavailable" and "no_such_backend" in err["message"]
    again = client.post(_seg(pid, iid), json={"crop": CROP, "points": [_click(1000, 800)]})
    assert again.status_code == 409 and again.json()["error"]["details"]["state"] == "unavailable"
    item = client.get(LIB).json()["items"][0]
    assert item["state"] == "unavailable" and "no_such_backend" in item["reason"]
    assert client.get("/api/v1/health").status_code == 200
    assert client.get(f"/api/v1/projects/{pid}/images").status_code == 200


def test_importing_the_assist_router_does_not_import_torch(backend_dir):
    probe = (
        "import sys, app.assist.router, app.assist.service, app.assist.jobs_acquire; "
        "print('torch' in sys.modules, 'ultralytics' in sys.modules)"
    )
    out = subprocess.run(
        [sys.executable, "-c", probe], cwd=backend_dir, capture_output=True, text=True, timeout=120
    )
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "False False"
