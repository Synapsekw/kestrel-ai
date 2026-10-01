"""Opening a project file with its default application (plan R1 Task 6; spec §14 `POST /open`).
The `app` fixture no-ops `app.reports.open_file.start`; these tests replace it with a recorder, so
nothing is ever opened for real."""

import pytest

URL = "/api/v1/projects/{pid}/open"


@pytest.fixture
def opened(monkeypatch):
    seen = []
    monkeypatch.setattr("app.reports.open_file.start", lambda path: seen.append(path))
    return seen


def _post(client, pid, path):
    return client.post(URL.format(pid=pid), json={"path": path})


def test_opens_a_pdf_inside_the_project(client, project_id, handle, opened):
    pdf = handle.folder / "reports" / "r1" / "v001" / "site-a-v001.pdf"
    pdf.parent.mkdir(parents=True)
    pdf.write_bytes(b"%PDF-1.4")
    r = _post(client, project_id, "reports/r1/v001/site-a-v001.pdf")
    assert r.status_code == 204, r.text
    assert opened == [pdf.resolve()]


@pytest.mark.parametrize("path", ["../outside.pdf", "C:outside.pdf", r"\\server\share\x.pdf"])
def test_refuses_paths_outside_the_project(client, project_id, opened, path):
    r = _post(client, project_id, path)
    assert (r.status_code, r.json()["error"]["code"]) == (409, "conflict") and opened == []


def test_refuses_an_absolute_path(client, project_id, handle, opened):
    r = _post(client, project_id, str(handle.folder / "x.pdf"))
    assert r.status_code == 409 and opened == []


@pytest.mark.parametrize("name", ["tool.exe", "run.bat", "script.ps1", "link.lnk", "noext"])
def test_refuses_a_program(client, project_id, handle, opened, name):
    (handle.folder / name).write_bytes(b"MZ")
    r = _post(client, project_id, name)
    assert (r.status_code, r.json()["error"]["code"]) == (409, "conflict") and opened == []


def test_refuses_a_folder(client, project_id, handle, opened):
    (handle.folder / "reports").mkdir(exist_ok=True)
    r = _post(client, project_id, "reports")
    assert r.status_code == 409 and opened == []


def test_missing_file_is_404(client, project_id, opened):
    r = _post(client, project_id, "reports/nope.pdf")
    assert r.status_code == 404 and opened == []


def test_unknown_project_is_404(client, opened):
    assert _post(client, "nope", "x.pdf").status_code == 404


def test_no_app_for_the_file_is_409_not_500(client, project_id, handle, monkeypatch):
    def no_app(path):
        raise OSError(1155, "No application is associated with the specified file")

    monkeypatch.setattr("app.reports.open_file.start", no_app)
    (handle.folder / "notes.txt").write_text("x")
    r = _post(client, project_id, "notes.txt")
    assert (r.status_code, r.json()["error"]["code"]) == (409, "conflict")
    assert "notes.txt" in r.json()["error"]["message"]
