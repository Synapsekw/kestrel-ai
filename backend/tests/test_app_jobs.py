"""Every job in the app (spec 2026-09-26-foundation sections 10.1 and 16): the library runner's and
every open recent project's, merged newest first."""

from data_rows import at
from project_factory import new_project

from app.db.models import Job

JOBS = "/api/v1/jobs"


def _add(handle, type_: str, state: str, minutes: int) -> str:
    with handle.session() as s:
        job = Job(type=type_, state=state, created_at=at(minutes))
        s.add(job)
        s.flush()
        return job.id


def _page(client, **params) -> dict:
    r = client.get(JOBS, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _all(client, **params) -> list[dict]:
    items, cursor = [], None
    while True:
        page = _page(client, **params, **({"cursor": cursor} if cursor else {}))
        items += page["items"]
        cursor = page["next_cursor"]
        if cursor is None:
            return items


def _two_projects(app, client, tmp_path):
    a = new_project(client, tmp_path / "a", name="Quarry")
    b = new_project(client, tmp_path / "b", name="Bridge")
    reg = app.state.projects
    return reg.get(a["id"]), reg.get(b["id"])


def test_jobs_merge_across_the_library_and_open_projects(app, client, tmp_path):
    ha, hb = _two_projects(app, client, tmp_path)
    j1 = _add(ha, "import", "succeeded", 1)
    j2 = _add(app.state.library, "library_import", "succeeded", 2)
    j3 = _add(hb, "map_import", "running", 3)
    j4 = _add(ha, "infer", "failed", 4)
    items = _page(client)["items"]
    assert [(j["id"], j["project_id"], j["project_name"]) for j in items] == [
        (j4, ha.id, "Quarry"),
        (j3, hb.id, "Bridge"),
        (j2, "library", None),
        (j1, ha.id, "Quarry"),
    ]


def test_paging_walks_every_job_once(app, client, tmp_path):
    ha, hb = _two_projects(app, client, tmp_path)
    ids = [_add(h, "import", "succeeded", n) for n, h in enumerate([ha, hb, app.state.library] * 3)]
    assert [j["id"] for j in _all(client, limit=2)] == list(reversed(ids))


def test_filters(app, client, tmp_path):
    ha, hb = _two_projects(app, client, tmp_path)
    running = _add(ha, "import", "running", 1)
    queued = _add(hb, "train", "queued", 2)
    _add(hb, "import", "failed", 3)
    lib = _add(app.state.library, "library_import", "succeeded", 4)
    assert {j["id"] for j in _page(client, state=["running", "queued"])["items"]} == {running, queued}
    assert [j["id"] for j in _page(client, type="train")["items"]] == [queued]
    assert [j["id"] for j in _page(client, project_id=ha.id)["items"]] == [running]
    assert [j["id"] for j in _page(client, project_id="library")["items"]] == [lib]
    assert _page(client, project_id="no-such-project") == {"items": [], "next_cursor": None}


def test_a_recent_project_that_is_not_open_is_not_read(app, client, tmp_path):
    ha, hb = _two_projects(app, client, tmp_path)
    kept = _add(ha, "import", "succeeded", 1)
    _add(hb, "import", "succeeded", 2)
    app.state.projects._handles.pop(hb.id)
    hb.engine.dispose()
    assert [j["id"] for j in _page(client)["items"]] == [kept]


def test_no_library_still_lists_project_jobs(app, client, tmp_path):
    ha, _ = _two_projects(app, client, tmp_path)
    job = _add(ha, "import", "succeeded", 1)
    app.state.library = None
    assert [j["id"] for j in _page(client)["items"]] == [job]
    assert _page(client, project_id="library")["items"] == []


def test_a_failing_source_is_left_out(app, client, tmp_path, monkeypatch, caplog):
    ha, hb = _two_projects(app, client, tmp_path)
    kept = _add(ha, "import", "succeeded", 1)
    _add(hb, "import", "succeeded", 2)

    def broken():
        raise RuntimeError("disk gone")

    monkeypatch.setattr(hb, "session", broken)
    assert [j["id"] for j in _page(client)["items"]] == [kept]
    assert "disk gone" in caplog.text


def test_a_malformed_cursor_is_422(client):
    r = client.get(JOBS, params={"cursor": "nope"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


def test_open_recent_keeps_recent_order_and_skips_closed(app, client, tmp_path):
    ha, hb = _two_projects(app, client, tmp_path)  # b was created last: first in the recent list
    assert [h.id for h in app.state.projects.open_recent()] == [hb.id, ha.id]
    app.state.projects._handles.pop(ha.id)
    ha.engine.dispose()
    assert [h.id for h in app.state.projects.open_recent()] == [hb.id]
