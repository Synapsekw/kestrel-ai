"""createDrawingPages: every page of a PDF in one drawing_import job (plant-model spec §8.1; I1
Review Focus 1, 2 and 5)."""

import math
import threading
import time
import uuid

from drawings_helpers import BASE, build_drawing, inspect_ready, write_pdf, write_png

from app.db.models import Drawing
from app.drawings import pdf, phase_pages, startup, store
from app.jobs.cancellation import JobFailure


def _pages(client, project_id, inspection_id, **body):
    body = {"name": "Set", "placement": {"method": "none"}, "pages": "all", **body}
    return client.post(f"{BASE}/{project_id}/drawings/pages", json={**body, "inspection_id": inspection_id})


def _spy(monkeypatch, *, fail_page=None, block=False, entered=None):
    calls = []
    real = pdf.render_page_to_plan

    def spy(path, page_n, dpi, dst, *, progress, check_cancelled, **kw):
        calls.append((page_n, dpi))
        if entered is not None:
            entered.set()
        if page_n == fail_page:
            raise JobFailure(f"page {page_n} is broken")
        while block:
            check_cancelled()
            time.sleep(0.01)
        return real(path, page_n, dpi, dst, progress=progress, check_cancelled=check_cancelled, **kw)

    monkeypatch.setattr(pdf, "render_page_to_plan", spy)
    return calls


def _get(client, project_id, did):
    return client.get(f"{BASE}/{project_id}/drawings/{did}").json()


def test_all_pages_build_in_one_job_in_order(client, project_id, wait_job, handle, tmp_path, monkeypatch):
    src = write_pdf(tmp_path / "set.pdf", [(300.0, 200.0), (842.0, 595.0), (200.0, 300.0)])
    insp = inspect_ready(client, project_id, wait_job, src)
    calls = _spy(monkeypatch)
    r = _pages(client, project_id, insp["id"], dpi=100)
    assert r.status_code == 202, r.text
    body = r.json()
    assert [d["name"] for d in body["drawings"]] == ["Set · p1", "Set · p2", "Set · p3"]
    assert [d["page"] for d in body["drawings"]] == [1, 2, 3]
    assert {d["job_id"] for d in body["drawings"]} == {body["job"]["id"]}
    assert all(d["status"] == "importing" for d in body["drawings"])
    job = wait_job(project_id, body["job"]["id"])
    assert job["state"] == "succeeded", job
    assert job["result"] == {"drawing_ids": [d["id"] for d in body["drawings"]], "failed": []}
    assert [c[0] for c in calls] == [1, 2, 3]
    got = [_get(client, project_id, d["id"]) for d in body["drawings"]]
    assert all(d["status"] == "ready" for d in got)
    assert (got[1]["width"], got[1]["height"], got[1]["dpi"]) == (
        math.ceil(842 * 100 / 72),
        math.ceil(595 * 100 / 72),
        100,
    )
    with handle.session() as s:
        shas = {s.get(Drawing, d["id"]).source_sha256 for d in body["drawings"]}
    assert shas == {insp["sha256"]}


def test_explicit_pages_keep_their_order(client, project_id, wait_job, tmp_path, monkeypatch):
    insp = inspect_ready(client, project_id, wait_job, write_pdf(tmp_path / "s.pdf", [(200.0, 200.0)] * 3))
    calls = _spy(monkeypatch)
    body = _pages(client, project_id, insp["id"], pages=[3, 1, 3]).json()
    assert [d["page"] for d in body["drawings"]] == [3, 1]
    wait_job(project_id, body["job"]["id"])
    assert [c[0] for c in calls] == [3, 1]


def test_the_dpi_is_capped_per_page(client, project_id, wait_job, tmp_path, monkeypatch):
    insp = inspect_ready(
        client, project_id, wait_job, write_pdf(tmp_path / "s.pdf", [(14400.0, 1440.0), (300.0, 200.0)])
    )
    _spy(monkeypatch, block=True)
    body = _pages(client, project_id, insp["id"], dpi=300).json()
    assert [d["dpi"] for d in body["drawings"]] == [100, 300]
    client.post(f"{BASE}/{project_id}/jobs/{body['job']['id']}/cancel")
    wait_job(project_id, body["job"]["id"])


def test_a_build_while_pages_run_is_409_both_ways(client, project_id, wait_job, tmp_path, monkeypatch):
    insp = inspect_ready(client, project_id, wait_job, write_pdf(tmp_path / "s.pdf", [(200.0, 200.0)] * 2))
    _spy(monkeypatch, block=True)
    first = _pages(client, project_id, insp["id"]).json()
    again = _pages(client, project_id, insp["id"])
    assert again.status_code == 409 and again.json()["error"]["code"] == "job_running"
    assert again.json()["error"]["details"]["job_id"] == first["job"]["id"]
    one = client.post(
        f"{BASE}/{project_id}/drawings",
        json={"inspection_id": insp["id"], "name": "P", "page": 1, "placement": {"method": "none"}},
    )
    assert one.status_code == 409 and one.json()["error"]["code"] == "job_running"
    client.post(f"{BASE}/{project_id}/jobs/{first['job']['id']}/cancel")
    wait_job(project_id, first["job"]["id"])


def test_cancel_fails_every_page_left(client, project_id, wait_job, handle, tmp_path, monkeypatch):
    insp = inspect_ready(client, project_id, wait_job, write_pdf(tmp_path / "s.pdf", [(200.0, 200.0)] * 3))
    entered = threading.Event()
    _spy(monkeypatch, block=True, entered=entered)
    body = _pages(client, project_id, insp["id"]).json()
    # Cancel only once page 1 is inside the build: the run-path cancel, not cancelled-before-start.
    assert entered.wait(10)
    client.post(f"{BASE}/{project_id}/jobs/{body['job']['id']}/cancel")
    assert wait_job(project_id, body["job"]["id"])["state"] == "cancelled"
    for d in body["drawings"]:
        got = _get(client, project_id, d["id"])
        assert (got["status"], got["error"]) == ("failed", "import cancelled")
        assert not store.drawing_dir(handle, d["id"]).exists()


def test_one_bad_page_does_not_stop_the_rest(client, project_id, wait_job, tmp_path, monkeypatch):
    insp = inspect_ready(client, project_id, wait_job, write_pdf(tmp_path / "s.pdf", [(200.0, 200.0)] * 3))
    _spy(monkeypatch, fail_page=2)
    body = _pages(client, project_id, insp["id"]).json()
    job = wait_job(project_id, body["job"]["id"])
    ids = [d["id"] for d in body["drawings"]]
    assert job["state"] == "succeeded"
    assert job["result"] == {
        "drawing_ids": [ids[0], ids[2]],
        "failed": [{"drawing_id": ids[1], "page": 2, "error": "page 2 is broken"}],
    }
    assert job["message"] == "Imported 2 of 3 pages; 1 failed"
    statuses = [_get(client, project_id, i) for i in ids]
    assert [d["status"] for d in statuses] == ["ready", "failed", "ready"]
    assert statuses[1]["error"] == "page 2 is broken"


def test_every_page_failing_fails_the_job(client, project_id, wait_job, tmp_path, monkeypatch):
    insp = inspect_ready(client, project_id, wait_job, write_pdf(tmp_path / "s.pdf", [(200.0, 200.0)] * 2))
    monkeypatch.setattr(
        pdf, "render_page_to_plan", lambda *a, **k: (_ for _ in ()).throw(JobFailure("unreadable"))
    )
    body = _pages(client, project_id, insp["id"]).json()
    job = wait_job(project_id, body["job"]["id"])
    assert job["state"] == "failed"
    assert job["error"].startswith("none of the 2 pages could be imported")


def test_refusals(client, project_id, wait_job, tmp_path):
    png = inspect_ready(client, project_id, wait_job, write_png(tmp_path / "p.png", 20, 20))
    r = _pages(client, project_id, png["id"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_pages"
    assert r.json()["error"]["details"] == {"reason": "pages"}
    two = inspect_ready(client, project_id, wait_job, write_pdf(tmp_path / "t.pdf", [(100.0, 100.0)] * 2))
    r = _pages(client, project_id, two["id"], pages=[3])
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_pages"
    assert r.json()["error"]["details"] == {"reason": "page"}
    r = _pages(client, project_id, str(uuid.uuid4()))
    assert r.status_code == 404


def test_a_single_page_build_still_works_after(client, project_id, wait_job, tmp_path):
    insp = inspect_ready(client, project_id, wait_job, write_pdf(tmp_path / "s.pdf", [(200.0, 200.0)] * 2))
    body = _pages(client, project_id, insp["id"], pages=[1]).json()
    wait_job(project_id, body["job"]["id"])
    d = build_drawing(client, project_id, wait_job, insp["id"], page=2)
    assert d["status"] == "ready" and d["page"] == 2


def test_startup_sweep_fails_every_page_left_of_an_interrupted_job(handle, app):
    dead = str(uuid.uuid4())
    with handle.session() as s:
        rows = [
            Drawing(
                name=f"Set · p{p}",
                format="pdf",
                source_path="C:/x/set.pdf",
                source_size=1,
                page=p,
                status="importing",
                job_id=dead,
            )
            for p in (2, 3)
        ]
        built = Drawing(
            name="Set · p1",
            format="pdf",
            source_path="C:/x/set.pdf",
            source_size=1,
            page=1,
            status="ready",
            job_id=dead,
        )
        s.add_all([*rows, built])
        s.flush()
        ids = {r.id for r in rows}
        built_id = built.id
    assert set(startup.sweep_interrupted(handle, app.state.jobs)) == ids
    with handle.session() as s:
        assert {s.get(Drawing, i).status for i in ids} == {"failed"}
        assert s.get(Drawing, built_id).status == "ready"


def test_cancelled_before_start_fails_every_page(handle):
    with handle.session() as s:
        rows = [
            Drawing(
                name="p", format="pdf", source_path="C:/x/s.pdf", source_size=1, page=p, status="importing"
            )
            for p in (1, 2)
        ]
        s.add_all(rows)
        s.flush()
        ids = [r.id for r in rows]

    class Ctx:
        project = handle
        params = {
            "phase": "pages",
            "inspection_id": str(uuid.uuid4()),
            "placement": {"method": "none"},
            "items": [{"drawing_id": i, "page": n + 1, "dpi": 150} for n, i in enumerate(ids)],
        }
        published: list = []

        def publish(self, type, payload):
            self.published.append((type, payload))

    phase_pages.cancelled_before_start(Ctx())
    with handle.session() as s:
        assert [(s.get(Drawing, i).status, s.get(Drawing, i).error) for i in ids] == [
            ("failed", "import cancelled"),
            ("failed", "import cancelled"),
        ]
