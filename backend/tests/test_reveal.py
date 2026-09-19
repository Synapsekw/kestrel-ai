"""Revealing a project path in Windows Explorer (G2, fix round 1). The `app` fixture already
no-ops the `launch` seam, so every test here restores the real `launch` and patches
`subprocess.Popen` instead, to assert on the exact command without ever starting real Explorer.
"""

import pytest

from app.exports.reveal import EXPLORER
from app.exports.reveal import launch as REAL_LAUNCH

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
    monkeypatch.setattr("app.exports.reveal.launch", REAL_LAUNCH)  # undo the app fixture's no-op
    monkeypatch.setattr("app.exports.reveal.subprocess.Popen", lambda command, **kw: seen.append(command))
    return seen


def test_reveals_a_file_inside_the_project(client, project_id, project_dir, calls):
    (project_dir / "exports").mkdir()
    (project_dir / "exports" / "detections.csv").write_text("x", "utf-8")
    r = client.post(f"{BASE}/{project_id}/reveal", json={"path": "exports/detections.csv"})
    assert r.status_code == 204, r.text
    assert calls == [f'"{EXPLORER}" /select,"{(project_dir / "exports" / "detections.csv").resolve()}"']


def test_reveals_a_folder_inside_the_project(client, project_id, project_dir, calls):
    (project_dir / "exports" / "2026-09-19_101500").mkdir(parents=True)
    r = client.post(f"{BASE}/{project_id}/reveal", json={"path": "exports/2026-09-19_101500"})
    assert r.status_code == 204, r.text
    assert calls == [f'"{EXPLORER}" "{(project_dir / "exports" / "2026-09-19_101500").resolve()}"']


def test_the_command_quotes_a_path_with_a_comma_and_a_space(client, project_id, project_dir, calls):
    folder = project_dir / "exports"
    folder.mkdir()
    (folder / "a, report (final).csv").write_text("x", "utf-8")
    r = client.post(f"{BASE}/{project_id}/reveal", json={"path": "exports/a, report (final).csv"})
    assert r.status_code == 204, r.text
    target = (folder / "a, report (final).csv").resolve()
    assert calls == [f'"{EXPLORER}" /select,"{target}"']


def test_dot_dot_is_refused_without_calling_explorer(client, project_id, calls):
    r = client.post(f"{BASE}/{project_id}/reveal", json={"path": "../outside"})
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "conflict"
    assert calls == []


def test_an_absolute_path_is_refused(client, project_id, project_dir, calls):
    r = client.post(f"{BASE}/{project_id}/reveal", json={"path": str(project_dir / "exports")})
    assert r.status_code == 409, r.text
    assert calls == []


def test_a_unc_path_is_refused(client, project_id, calls):
    r = client.post(f"{BASE}/{project_id}/reveal", json={"path": r"\\server\share\file.txt"})
    assert r.status_code == 409, r.text
    assert calls == []


def test_a_drive_relative_path_is_refused(client, project_id, calls):
    r = client.post(f"{BASE}/{project_id}/reveal", json={"path": "C:exports"})
    assert r.status_code == 409, r.text
    assert calls == []


def test_a_missing_path_is_404(client, project_id, calls):
    r = client.post(f"{BASE}/{project_id}/reveal", json={"path": "exports/nope.csv"})
    assert r.status_code == 404, r.text
    assert calls == []


def test_a_reserved_device_name_is_404_not_a_crash(client, project_id, calls):
    r = client.post(f"{BASE}/{project_id}/reveal", json={"path": "NUL"})
    assert r.status_code == 404, r.text
    assert calls == []
