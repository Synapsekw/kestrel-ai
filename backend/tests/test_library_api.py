"""The `/library` endpoints, the app's startup with and without a library (spec sections 4, 11, 13)."""

import pytest
from fastapi.testclient import TestClient
from library_helpers import LIB, add_library_model, fake_weights, stub_checkpoint, wait_library_job
from sqlalchemy import select

from app.db.models import Job
from app.library import service
from app.library.handle import open_library

AUTH = {"Authorization": "Bearer test-token"}


@pytest.fixture
def stubbed(monkeypatch):
    stub_checkpoint(monkeypatch)


def import_model(client, path, **body) -> dict:
    r = client.post(f"{LIB}/models/import", json={"name": "client-x", "weights_path": str(path), **body})
    assert r.status_code == 202, r.text
    return r.json()["job"]


# ------------------------------------------------------------------------ import


@pytest.mark.parametrize("weights_path", ["models/x.pt", "C:/definitely/not/here.pt", "C:/"])
def test_import_of_an_unusable_path_is_a_404(client, weights_path):
    r = client.post(f"{LIB}/models/import", json={"name": "x", "weights_path": weights_path})
    assert r.status_code == 404, r.text
    assert r.json()["error"]["code"] == "not_found"
    assert f"no usable weights at {weights_path}:" in r.json()["error"]["message"]


def test_import_of_an_empty_name_or_path_is_a_422(client, tmp_path):
    assert client.post(f"{LIB}/models/import", json={"name": "x", "weights_path": ""}).status_code == 422
    body = {"name": "", "weights_path": str(fake_weights(tmp_path))}
    assert client.post(f"{LIB}/models/import", json=body).status_code == 422


def test_import_runs_as_a_library_job_and_lists_the_model(client, tmp_path, stubbed):
    src = fake_weights(tmp_path)
    job = import_model(client, src, class_aliases={"truck": "dump_truck"}, supplier="Client X")
    assert job["type"] == "library_import"
    assert job["project_id"] == "library"
    done = wait_library_job(client, job["id"])
    assert done["state"] == "succeeded", done["error"]
    model_id = done["result"]["model_id"]

    items = client.get(f"{LIB}/models").json()["items"]
    assert [m["id"] for m in items] == [model_id]
    m = items[0]
    assert m["state"] == "ready"
    assert m["origin"] == "imported" and m["format"] == "pt" and m["task"] == "detect"
    assert m["name"] == "client-x" and m["supplier"] == "Client X" and m["notes"] == ""
    assert m["class_names"] == ["excavator", "dump_truck"]
    assert m["class_aliases"] == {"truck": "dump_truck"}
    assert m["provenance"]["source_file"] == str(src)
    assert m["metrics"] is None and m["exports"] == {} and m["artifacts"] == {}
    assert src.is_file()  # the source is only read
    assert client.get(f"{LIB}/models/{model_id}").json() == m
    # the job log lives in the library folder
    log = client.get(f"{LIB}/jobs/{job['id']}/log").json()
    assert log["path"] == f"runs/{job['id']}/job.log"


def test_importing_the_same_file_twice_fails_the_second_job_naming_the_model(client, tmp_path, stubbed):
    src = fake_weights(tmp_path)
    first = wait_library_job(client, import_model(client, src)["id"])
    copy = fake_weights(tmp_path / "other", content=src.read_bytes())
    second = wait_library_job(client, import_model(client, copy, name="again")["id"])
    assert second["state"] == "failed"
    assert "client-x" in second["error"]
    assert len(client.get(f"{LIB}/models").json()["items"]) == 1
    assert first["result"]["model_id"] in {m["id"] for m in client.get(f"{LIB}/models").json()["items"]}


def test_an_unloadable_checkpoint_fails_the_job_and_leaves_nothing(client, app, tmp_path, monkeypatch):
    def broken(path):
        raise RuntimeError("pickle data was truncated")

    monkeypatch.setattr(service, "read_checkpoint", broken)
    src = fake_weights(tmp_path)
    done = wait_library_job(client, import_model(client, src)["id"])
    assert done["state"] == "failed"
    assert "is not a loadable YOLO checkpoint" in done["error"]
    assert "pickle data was truncated" in done["error"]
    lib = app.state.library
    assert list(lib.models_dir.iterdir()) == []
    assert not any(p.suffix == ".pt" for p in lib.runs_dir.rglob("*"))


def test_a_non_detection_checkpoint_is_refused(client, app, tmp_path, monkeypatch):
    stub_checkpoint(monkeypatch, task="segment")
    done = wait_library_job(client, import_model(client, fake_weights(tmp_path))["id"])
    assert done["state"] == "failed"
    assert "segment" in done["error"]
    assert client.get(f"{LIB}/models").json()["items"] == []


# ---------------------------------------------------------------- detail and edit


def test_patch_changes_name_notes_and_supplier(client, app, tmp_path):
    m = add_library_model(app, tmp_path)
    r = client.patch(f"{LIB}/models/{m.id}", json={"name": "renamed", "notes": "good", "supplier": "X"})
    assert r.status_code == 200, r.text
    assert (r.json()["name"], r.json()["notes"], r.json()["supplier"]) == ("renamed", "good", "X")
    body = {"supplier": None, "class_aliases": {"truck": "dump_truck"}}
    r = client.patch(f"{LIB}/models/{m.id}", json=body)
    assert r.json()["supplier"] is None and r.json()["name"] == "renamed"
    assert r.json()["class_aliases"] == {"truck": "dump_truck"}


def test_patch_with_an_empty_name_is_a_422(client, app, tmp_path):
    m = add_library_model(app, tmp_path)
    r = client.patch(f"{LIB}/models/{m.id}", json={"name": ""})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"


def test_unknown_models_are_404(client):
    for method, path in (
        ("GET", "/models/nope"),
        ("PATCH", "/models/nope"),
        ("DELETE", "/models/nope"),
        ("GET", "/models/nope/usage"),
        ("GET", "/models/nope/artifacts/results_csv"),
    ):
        r = client.request(method, f"{LIB}{path}", json={} if method == "PATCH" else None)
        assert r.status_code == 404, (method, path, r.text)
        assert r.json()["error"]["code"] == "not_found"
    r = client.post(f"{LIB}/models/nope/export", json={"format": "onnx"})
    assert r.status_code == 404


def test_delete_removes_the_model_and_its_folder(client, app, tmp_path):
    m = add_library_model(app, tmp_path)
    folder = service.model_dir(app.state.library, m)
    assert client.delete(f"{LIB}/models/{m.id}").status_code == 204
    assert not folder.exists()
    assert client.get(f"{LIB}/models/{m.id}").status_code == 404


def test_a_model_whose_weights_are_gone_lists_as_unavailable(client, app, tmp_path):
    m = add_library_model(app, tmp_path)
    service.weights_file(app.state.library, m).unlink()
    assert client.get(f"{LIB}/models/{m.id}").json()["state"] == "unavailable"


def test_list_filters_by_task(client, app, tmp_path):
    add_library_model(app, tmp_path, name="boxes")
    add_library_model(app, tmp_path, name="rotated", task="obb")
    names = [m["name"] for m in client.get(f"{LIB}/models", params={"task": "obb"}).json()["items"]]
    assert names == ["rotated"]


def test_artifacts_are_served_from_the_model_folder(client, app, tmp_path):
    csv = tmp_path / "run" / "results.csv"
    csv.parent.mkdir()
    csv.write_text("epoch,time\n1,2\n", encoding="utf-8")
    png = tmp_path / "run" / "confusion_matrix.png"
    png.write_bytes(b"\x89PNG\r\n\x1a\nfake")
    m = add_library_model(app, tmp_path, artifacts={"results_csv": csv, "confusion_matrix": png})
    r = client.get(f"{LIB}/models/{m.id}/artifacts/results_csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv") and "epoch" in r.text
    r = client.get(f"{LIB}/models/{m.id}/artifacts/confusion_matrix")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert client.get(f"{LIB}/models/{m.id}/artifacts/pr_curve").status_code == 404
    assert client.get(f"{LIB}/models/{m.id}/artifacts/nope").status_code == 422


def test_usage_lists_a_project_whose_preannotation_model_it_is(client, app, tmp_path, project_id):
    m = add_library_model(app, tmp_path)
    assert client.get(f"{LIB}/models/{m.id}/usage").json() == {"projects": []}
    r = client.patch(f"/api/v1/projects/{project_id}", json={"preannotation_model_id": m.id})
    assert r.status_code == 200, r.text
    projects = client.get(f"{LIB}/models/{m.id}/usage").json()["projects"]
    assert len(projects) == 1
    p = projects[0]
    assert p["project_id"] == project_id
    assert (p["preannotation"], p["query_runs"], p["map_runs"]) == (True, 0, 0)


# ------------------------------------------------------------------------- jobs


def test_library_jobs_list_and_cancel(client, tmp_path, stubbed):
    job = import_model(client, fake_weights(tmp_path))
    wait_library_job(client, job["id"])
    page = client.get(f"{LIB}/jobs").json()
    assert [j["id"] for j in page["items"]] == [job["id"]]
    assert page["items"][0]["project_id"] == "library"
    assert client.get(f"{LIB}/jobs", params={"type": "train"}).json()["items"] == []
    assert client.post(f"{LIB}/jobs/{job['id']}/cancel").json()["state"] == "succeeded"
    assert client.get(f"{LIB}/jobs/nope").status_code == 404


# ------------------------------------------------------------ status and startup


def test_status_reports_an_open_library(client, app):
    body = client.get(f"{LIB}/status").json()
    assert body == {"available": True, "root": str(app.state.library.folder), "error": None}


def test_without_a_library_every_library_endpoint_is_a_503(client, app, tmp_path):
    app.state.library = None
    body = client.get(f"{LIB}/status").json()
    assert body["available"] is False
    r = client.get(f"{LIB}/models")
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "library_unavailable"
    assert client.get(f"{LIB}/jobs").status_code == 503
    body = {"name": "x", "weights_path": str(fake_weights(tmp_path))}
    assert client.post(f"{LIB}/models/import", json=body).status_code == 503


def test_the_app_starts_when_the_library_cannot_open(app, monkeypatch):
    def boom(data_dir):
        raise OSError("library.db is corrupt")

    monkeypatch.setattr("app.library.handle.open_library", boom)
    with TestClient(app, headers=AUTH) as c:
        assert c.get("/api/v1/health").status_code == 200
        status = c.get(f"{LIB}/status").json()
        assert status["available"] is False
        assert "library.db is corrupt" in status["error"]
        assert c.get(f"{LIB}/models").status_code == 503


def test_a_library_job_left_running_is_failed_at_startup(app, settings):
    lib = open_library(settings.data_dir)
    with lib.session() as s:
        job = Job(type="library_import", state="running", params={}, log_path="runs/x/job.log")
        s.add(job)
        s.flush()
        job_id = job.id
    lib.engine.dispose()
    with TestClient(app, headers=AUTH) as c:
        j = c.get(f"{LIB}/jobs/{job_id}").json()
        assert j["state"] == "failed"
        assert j["error"] == "interrupted by application restart"
        with app.state.library.session() as s:
            assert s.execute(select(Job.state)).scalar_one() == "failed"
