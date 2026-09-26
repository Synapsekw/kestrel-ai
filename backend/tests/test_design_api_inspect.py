"""createDesignInspection, getDesignInspection, deleteDesignInspection, the thumbnail (spec §12, §4.2)."""

import hashlib
import logging
import shutil
import time

import fake_design_reader
import pytest

from app.db.models import Job
from app.jobs.cancellation import JobCancelled
from app.jobs.runner import JobContext
from app.surfaces.design import phase_inspect, store

BASE = "/api/v1/projects"


@pytest.fixture
def project_kind() -> str:
    """Design surfaces are detection work: F0 guards the router with require_kind(("detect",), ANY_KIND)."""
    return "detect"


@pytest.fixture
def fake_reader(monkeypatch):
    monkeypatch.setitem(phase_inspect.READERS, "landxml", "fake_design_reader")
    monkeypatch.setitem(phase_inspect.READERS, "dxf", "fake_design_reader")
    yield fake_design_reader
    fake_design_reader.HOLD.clear()
    fake_design_reader.FAIL.clear()


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
    assert r.status_code == 409 and r.json()["error"]["code"] == "job_running"
    assert d.exists()


def test_a_late_write_after_cancellation_ends_the_job_cancelled_not_failed(
    app, handle, tmp_path, monkeypatch
):
    """Fix round 1, finding 1: a reader whose last check_cancelled() passed before the delete
    cancelled the job and removed the folder must not turn that late write's FileNotFoundError
    into a `failed` job — it is the cancellation.

    Fix round 2: this used to drive the race through the real HTTP DELETE endpoint (a fake reader's
    HOLD loop, held until the test released it after calling delete()). Once
    delete_design_inspection started waiting for a live job to actually stop before removing the
    folder (fix round 2's own fix, for a real flake in that endpoint - see router.py), a reader that
    never responds to cancellation until released by the test can no longer be driven through that
    endpoint without either deadlocking on the wait or eating its full timeout every run. Calling
    phase_inspect.run directly, with a fake reader that does the cancel-and-delete itself at the
    exact instant needed, makes the race deterministic instead of depending on real thread timing
    or a 5 s wait."""
    src = tmp_path / "slow.dxf"
    src.write_text("0\nEOF\n")
    iid = store.new_id()
    idir = store.create_inspection(handle, iid, src, "dxf")
    with handle.session() as s:
        job = Job(type="design_import", params={})
        s.add(job)
        s.flush()
        job_id = job.id
    ctx = JobContext(
        app.state.jobs,
        handle,
        job_id,
        {"phase": "inspect", "inspection_id": iid, "path": str(src)},
        logging.getLogger("test.design_import"),
    )

    class _LateWriteReader:
        @staticmethod
        def inspect_file(path, idir, *, progress, check_cancelled):
            # Simulate delete_design_inspection landing between this reader's last
            # check_cancelled() and its next write: cancel the job and remove the folder right
            # here, then try to write anyway, exactly as a reader that does not check again would.
            ctx.cancelled.set()
            shutil.rmtree(idir)
            store.CandidateWriter(store.candidate_dir(idir, "c0"), "faces")  # -> FileNotFoundError
            raise AssertionError("unreachable: CandidateWriter should have raised FileNotFoundError")

    import sys

    monkeypatch.setitem(sys.modules, "late_write_fake_reader", _LateWriteReader)
    monkeypatch.setitem(phase_inspect.READERS, "dxf", "late_write_fake_reader")

    with pytest.raises(JobCancelled):
        phase_inspect.run(ctx)
    assert not idir.exists()


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


def test_a_relative_path_is_refused_as_missing(client, project_id, tmp_path, monkeypatch, fake_reader):
    """Final review 7: a relative path would resolve against the sidecar's working folder; it is a
    404 even when a file of that name exists there (Deviation 1: never a 422)."""
    (tmp_path / "site.xml").write_text("<LandXML/>")
    monkeypatch.chdir(tmp_path)
    r = post(client, project_id, "site.xml")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
