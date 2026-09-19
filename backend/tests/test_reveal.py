"""Revealing a project path in Windows Explorer (G2, plan Task 4). The `app` fixture already no-ops
`subprocess.Popen`, so every test here re-patches it to a recorder and never starts real Explorer.
"""

import pytest

BASE = "/api/v1/projects"


@pytest.fixture
def project_id(client, project_dir) -> str:
    body = {
        "name": "T",
        "folder": str(project_dir),
        "classes": [{"name": "excavator", "colour": "#ff0000"}],
    }
    r = client.post("/api/v1/projects", json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.fixture
def calls(monkeypatch):
    seen = []
    monkeypatch.setattr("app.exports.reveal.subprocess.Popen", lambda args, **kw: seen.append(args))
    return seen


def test_reveals_a_file_inside_the_project(client, project_id, project_dir, calls):
    (project_dir / "exports").mkdir()
    (project_dir / "exports" / "detections.csv").write_text("x", "utf-8")
    r = client.post(f"{BASE}/{project_id}/reveal", json={"path": "exports/detections.csv"})
    assert r.status_code == 204, r.text
    assert len(calls) == 1
    args = calls[0]
    assert args[0] == "explorer.exe"
    assert args[1] == f"/select,{(project_dir / 'exports' / 'detections.csv').resolve()}"


def test_reveals_a_folder_inside_the_project(client, project_id, project_dir, calls):
    (project_dir / "exports" / "2026-09-19_101500").mkdir(parents=True)
    r = client.post(f"{BASE}/{project_id}/reveal", json={"path": "exports/2026-09-19_101500"})
    assert r.status_code == 204, r.text
    assert calls == [["explorer.exe", str((project_dir / "exports" / "2026-09-19_101500").resolve())]]


def test_dot_dot_is_refused_without_calling_explorer(client, project_id, calls):
    r = client.post(f"{BASE}/{project_id}/reveal", json={"path": "../outside"})
    assert r.status_code == 422, r.text
    assert calls == []


def test_an_absolute_path_is_refused(client, project_id, project_dir, calls):
    r = client.post(f"{BASE}/{project_id}/reveal", json={"path": str(project_dir / "exports")})
    assert r.status_code == 422, r.text
    assert calls == []


def test_a_unc_path_is_refused(client, project_id, calls):
    r = client.post(f"{BASE}/{project_id}/reveal", json={"path": r"\\server\share\file.txt"})
    assert r.status_code == 422, r.text
    assert calls == []


def test_a_drive_relative_path_is_refused(client, project_id, calls):
    r = client.post(f"{BASE}/{project_id}/reveal", json={"path": "C:exports"})
    assert r.status_code == 422, r.text
    assert calls == []


def test_a_missing_path_is_404(client, project_id, calls):
    r = client.post(f"{BASE}/{project_id}/reveal", json={"path": "exports/nope.csv"})
    assert r.status_code == 404, r.text
    assert calls == []
