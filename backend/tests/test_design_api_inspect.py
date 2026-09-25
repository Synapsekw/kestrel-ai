"""createDesignInspection, getDesignInspection, deleteDesignInspection, the thumbnail (spec §12, §4.2)."""

import hashlib
import time

import fake_design_reader
import pytest

from app.surfaces.design import store

BASE = "/api/v1/projects"


@pytest.fixture
def project_kind() -> str:
    """Design surfaces are detection work: F0 guards the router with require_kind(("detect",), ANY_KIND)."""
    return "detect"


@pytest.fixture
def fake_reader(monkeypatch):
    from app.surfaces.design import phase_inspect

    monkeypatch.setitem(phase_inspect.READERS, "landxml", "fake_design_reader")
    monkeypatch.setitem(phase_inspect.READERS, "dxf", "fake_design_reader")
    yield fake_design_reader
    fake_design_reader.HOLD.clear()
    fake_design_reader.FAIL.clear()
    fake_design_reader.LATE_WRITE.clear()


def post(client, project_id, path):
    return client.post(f"{BASE}/{project_id}/design-inspections", json={"path": str(path)})


def url(project_id, iid, rest=""):
    return f"{BASE}/{project_id}/design-inspections/{iid}{rest}"


def wait_state(client, project_id, job_id, state, timeout=10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if client.get(f"{BASE}/{project_id}/jobs/{job_id}").json()["state"] == state:
            return
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} never reached {state}")


def test_inspect_flow(client, project_id, wait_job, fake_reader, tmp_path, handle):
    src = tmp_path / "site.xml"
    src.write_bytes(b"<LandXML/>")
    r = post(client, project_id, src)
    assert r.status_code == 202, r.text
    body = r.json()
    insp = body["inspection"]
    assert insp["state"] == "inspecting" and insp["format"] == "landxml"
    assert insp["job_id"] == body["job"]["id"] and body["job"]["type"] == "design_import"
    job = wait_job(project_id, body["job"]["id"])
    assert job["state"] == "succeeded", job
    assert job["result"] == {"inspection_id": insp["id"], "candidate_count": 1}
    got = client.get(url(project_id, insp["id"])).json()
    assert got["state"] == "ready" and got["error"] is None
    assert got["sha256"] == hashlib.sha256(b"<LandXML/>").hexdigest()
    assert got["detected"]["unit_source"] == "fake"
    assert [c["id"] for c in got["candidates"]] == ["c0"] and got["candidates"][0]["face_count"] == 1
    assert got["default_target_surface_id"] is None
    t = client.get(url(project_id, insp["id"], "/candidates/c0/thumbnail"))
    assert t.status_code == 200 and t.headers["content-type"] == "image/png"
    assert client.get(url(project_id, insp["id"], "/candidates/c7/thumbnail")).status_code == 404
    folder = handle.folder / "cache" / "design-inspections" / insp["id"]
    internal = store.read_json(folder / "internal.json")
    assert internal["reader"] == "fake" and internal["file_size"] == 10 and internal["mtime_ns"] > 0
    assert client.delete(url(project_id, insp["id"])).status_code == 204
    assert not folder.exists()
    assert client.get(url(project_id, insp["id"])).status_code == 404


def test_dwg_is_refused_with_the_fix(client, project_id, tmp_path):
    (tmp_path / "a.dwg").write_bytes(b"AC1032\x00\x00\x00")
    (tmp_path / "b.dxf").write_bytes(b"AC1027\x00\x00\x00")
    for p in (tmp_path / "a.dwg", tmp_path / "b.dxf", tmp_path / "not-there.dwg"):
        r = post(client, project_id, p)
        assert r.status_code == 422, r.text
        err = r.json()["error"]
        assert err["code"] == "validation_error" and err["details"] == {"reason": "dwg"}
        assert "save it as DXF" in err["message"] and "ODA File Converter" in err["message"]


def test_missing_and_unknown_files(client, project_id, tmp_path):
    assert post(client, project_id, tmp_path / "nope.xml").status_code == 404
    (tmp_path / "x.png").write_bytes(b"x")
    r = post(client, project_id, tmp_path / "x.png")
    assert r.status_code == 422 and r.json()["error"]["details"] == {"reason": "extension"}


def test_a_training_project_may_read_but_not_inspect(client, tmp_path):
    body = {"name": "t", "folder": str(tmp_path / "t"), "classes": [], "kind": "train"}
    pid = client.post(BASE, json=body).json()["id"]
    src = tmp_path / "s.xml"
    src.write_text("<LandXML/>")
    r = post(client, pid, src)
    assert r.status_code == 409 and r.json()["error"]["code"] == "wrong_project_kind"
    assert client.get(url(pid, store.new_id())).status_code == 404  # reads pass the guard


def test_contract_positive_cases_never_meet_a_422(client, project_id, tmp_path):
    """Deviation 1: a schema-valid body whose file does not exist is 404, never 422."""
    assert post(client, project_id, tmp_path / "missing.landxml").status_code == 404
    assert post(client, project_id, "relative/name.xml").status_code == 404


def test_inspection_ids_are_uuids_only(client, project_id, handle):
    victim = handle.folder / "keep.txt"
    victim.write_text("x")
    # one path segment each: a literal ".." segment would be resolved by the HTTP client first
    for bad in ("x%5C..%5C..%5Ckeep.txt", "not-a-uuid", "0" * 36):
        assert client.get(url(project_id, bad)).status_code == 404
        assert client.delete(url(project_id, bad)).status_code == 404
        assert client.get(url(project_id, bad, "/candidates/c0/thumbnail")).status_code == 404
    assert victim.is_file()


def test_reader_failure_marks_the_inspection_failed(client, project_id, wait_job, fake_reader, tmp_path):
    fake_reader.FAIL.append("surface 'Ground': face refers to missing point 9")
    src = tmp_path / "bad.xml"
    src.write_text("<LandXML/>")
    body = post(client, project_id, src).json()
    job = wait_job(project_id, body["job"]["id"])
    assert job["state"] == "failed" and job["error"] == "surface 'Ground': face refers to missing point 9"
    got = client.get(url(project_id, body["inspection"]["id"])).json()
    assert got["state"] == "failed" and got["error"] == "surface 'Ground': face refers to missing point 9"


def test_delete_cancels_a_running_inspection(client, project_id, wait_job, fake_reader, tmp_path, handle):
    fake_reader.HOLD.set()
    src = tmp_path / "slow.dxf"
    src.write_text("0\nEOF\n")
    body = post(client, project_id, src).json()
    jid, iid = body["job"]["id"], body["inspection"]["id"]
    wait_state(client, project_id, jid, "running")
    assert client.delete(url(project_id, iid)).status_code == 204
    assert wait_job(project_id, jid)["state"] == "cancelled"
    assert not (handle.folder / "cache" / "design-inspections" / iid).exists()


def test_delete_is_refused_while_a_build_holds_the_inspection(
    client, app, project_id, wait_job, fake_reader, tmp_path, handle, monkeypatch
):
    src = tmp_path / "site.xml"
    src.write_text("<LandXML/>")
    body = post(client, project_id, src).json()
    wait_job(project_id, body["job"]["id"])
    d = store.inspection_dir(handle, body["inspection"]["id"])
    store.patch_json(d / "request.json", build_job_id="build-1")
    monkeypatch.setattr(app.state.jobs, "is_live", lambda job_id: job_id == "build-1")
    r = client.delete(url(project_id, body["inspection"]["id"]))
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    assert d.exists()


def test_a_write_after_cancellation_ends_the_job_cancelled_not_failed(
    client, project_id, wait_job, fake_reader, tmp_path, handle
):
    """Fix round 1, finding 1: a reader whose last check_cancelled() passed before the delete
    cancelled the job and removed the folder must not turn that late write's FileNotFoundError
    into a `failed` job — it is the cancellation."""
    fake_reader.HOLD.set()
    fake_reader.LATE_WRITE.set()
    src = tmp_path / "slow.dxf"
    src.write_text("0\nEOF\n")
    body = post(client, project_id, src).json()
    jid, iid = body["job"]["id"], body["inspection"]["id"]
    wait_state(client, project_id, jid, "running")
    assert client.delete(url(project_id, iid)).status_code == 204
    fake_reader.HOLD.clear()  # let the reader past the loop and into its (now doomed) writes
    job = wait_job(project_id, jid)
    assert job["state"] == "cancelled", job
    assert not (handle.folder / "cache" / "design-inspections" / iid).exists()


def test_thumbnail_of_a_failed_inspection_is_404(client, project_id, wait_job, fake_reader, tmp_path):
    """Fix round 1, finding 4: a `failed` inspection has no real candidates; 204 is only for a
    genuinely still-running one whose thumbnail has not been written yet."""
    fake_reader.FAIL.append("surface 'Ground': face refers to missing point 9")
    src = tmp_path / "bad.xml"
    src.write_text("<LandXML/>")
    body = post(client, project_id, src).json()
    wait_job(project_id, body["job"]["id"])
    r = client.get(url(project_id, body["inspection"]["id"], "/candidates/c0/thumbnail"))
    assert r.status_code == 404


def test_a_training_project_may_not_delete_a_design_inspection(client, tmp_path):
    """Fix round 1, finding 5."""
    body = {"name": "t2", "folder": str(tmp_path / "t2"), "classes": [], "kind": "train"}
    pid = client.post(BASE, json=body).json()["id"]
    r = client.delete(url(pid, store.new_id()))
    assert r.status_code == 409 and r.json()["error"]["code"] == "wrong_project_kind"
