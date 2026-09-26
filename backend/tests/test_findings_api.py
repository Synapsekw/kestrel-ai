"""The findings endpoints (spec 2026-09-26-foundation sections 8.3, 15)."""

import pytest
from findings_helpers import insert_cloud, insert_map
from sqlalchemy import update

from app.db.models import FindingCount, Job
from app.findings import events, jobs

API = "/api/v1"


class _Bus:
    def __init__(self):
        self.seen: list[dict] = []

    def publish(self, event: dict) -> None:
        self.seen.append(event)


@pytest.fixture
def base(project) -> str:
    return f"{API}/projects/{project['id']}"


@pytest.fixture
def cloud(handle) -> str:
    return insert_cloud(handle)


def _anchor(cloud_id: str) -> dict:
    return {"kind": "cloud", "cloud_id": cloud_id, "x": 1.0, "y": 2.0, "z": 3.0}


def _create(client, base: str, type_id: str, cloud_id: str, **body) -> dict:
    r = client.post(f"{base}/findings", json={"type_id": type_id, "anchor": _anchor(cloud_id), **body})
    assert r.status_code == 201, r.text
    return r.json()


def _error(r) -> tuple[int, str]:
    return r.status_code, r.json()["error"]["code"]


def test_create_get_patch_delete(client, base, crack, cloud):
    f = _create(client, base, crack["id"], cloud, severity=3, note="at pier 3")
    assert (f["number"], f["type_id"], f["severity"], f["status"], f["note"], f["created_by"]) == (
        1,
        crack["id"],
        3,
        "open",
        "at pier 3",
        "human",
    )
    assert f["anchor"] == {
        "kind": "cloud",
        "cloud_id": cloud,
        "x": 1.0,
        "y": 2.0,
        "z": 3.0,
        "uncertainty_m": None,
    }
    assert (f["attachment_count"], f["comment_count"], f["data_type"], f["data_id"]) == (
        0,
        0,
        "point_cloud",
        cloud,
    )
    assert client.get(f"{base}/findings/{f['id']}").json() == f
    r = client.patch(f"{base}/findings/{f['id']}", json={"status": "reviewed"})
    assert (r.status_code, r.json()["status"]) == (200, "reviewed")
    assert client.patch(f"{base}/findings/{f['id']}", json={"status": "closed"}).status_code == 200
    assert _error(client.patch(f"{base}/findings/{f['id']}", json={"status": "reviewed"})) == (
        409,
        "invalid_transition",
    )
    assert client.delete(f"{base}/findings/{f['id']}").status_code == 204
    assert client.get(f"{base}/findings/{f['id']}").status_code == 404


def test_an_absent_severity_takes_the_default_and_null_means_none(client, base, crack, cloud):
    assert _create(client, base, crack["id"], cloud)["severity"] == 2
    assert _create(client, base, crack["id"], cloud, severity=None)["severity"] is None


def test_an_object_type_is_not_a_defect(client, base, project, cloud):
    r = client.post(
        f"{base}/findings", json={"type_id": project["classes"][0]["id"], "anchor": _anchor(cloud)}
    )
    assert _error(r) == (422, "not_a_defect")


def test_a_map_finding_keeps_the_lon_lat_it_was_posted_with(client, base, handle, crack):
    map_id = insert_map(handle)
    anchor = {
        "kind": "map",
        "map_id": map_id,
        "geometry": {"type": "Point", "coordinates": [583120.4, 3265410.2]},
    }
    r = client.post(
        f"{base}/findings", json={"type_id": crack["id"], "anchor": anchor, "lon": 47.7625, "lat": 29.4951}
    )
    assert r.status_code == 201, r.text
    f = r.json()
    assert (f["lon"], f["lat"], f["data_type"], f["data_id"]) == (47.7625, 29.4951, "map", map_id)


def test_list_filters_and_pages(client, base, crack, cloud):
    for sev in [None, 1, 2, 2, 4]:
        _create(client, base, crack["id"], cloud, severity=sev)
    page = client.get(f"{base}/findings", params={"limit": 2}).json()
    assert [i["number"] for i in page["items"]] == [5, 4]
    rest = client.get(f"{base}/findings", params={"limit": 10, "cursor": page["next_cursor"]}).json()
    assert [i["number"] for i in rest["items"]] == [3, 2, 1] and rest["next_cursor"] is None
    picked = client.get(
        f"{base}/findings", params=[("severity", "none"), ("severity", "2"), ("sort", "number")]
    ).json()
    assert [i["number"] for i in picked["items"]] == [1, 3, 4]
    assert client.get(f"{base}/findings", params={"severity": "7"}).json()["items"] == []
    for bad in ("10", "high"):
        assert _error(client.get(f"{base}/findings", params={"severity": bad})) == (422, "validation_error")


def test_bulk(client, base, crack, cloud):
    a = _create(client, base, crack["id"], cloud)
    b = _create(client, base, crack["id"], cloud)
    r = client.post(
        f"{base}/findings/bulk", json={"ids": [a["id"], b["id"], "nope"], "set": {"status": "closed"}}
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"updated": 2, "skipped": [{"id": "nope", "code": "not_found"}]}


def test_summary(client, base, crack, cloud):
    _create(client, base, crack["id"], cloud, severity=4)
    _create(client, base, crack["id"], cloud, severity=None)
    out = client.get(f"{base}/findings/summary").json()
    assert out["by_status"] == {"open": 2, "reviewed": 0, "closed": 0}
    assert out["open_by_severity"]["4"] == 1
    assert out["open_no_severity"] == 1
    assert len(out["trend"]) == 60


def test_the_activity_feed(client, base, crack, cloud):
    f = _create(client, base, crack["id"], cloud)
    client.patch(f"{base}/findings/{f['id']}", json={"severity": 4})
    items = client.get(f"{base}/activity", params={"subject_id": f["id"]}).json()["items"]
    assert sorted(i["kind"] for i in items) == ["finding.created", "finding.severity"]


def test_the_recount_job_repairs_tampered_counts(client, base, project, handle, crack, cloud, wait_job):
    _create(client, base, crack["id"], cloud)
    with handle.session() as s:
        s.execute(update(FindingCount).values(n=99))
    r = client.post(f"{base}/findings/recount")
    assert r.status_code == 202, r.text
    assert r.json()["job"]["type"] == "findings_recount"
    assert wait_job(project["id"], r.json()["job"]["id"])["state"] == "succeeded"
    assert client.get(f"{base}/findings/summary").json()["by_status"]["open"] == 1


@pytest.mark.parametrize("state", ["queued", "running"])
def test_a_second_recount_is_refused_while_one_is_live(client, base, handle, state):
    with handle.session() as s:
        live = Job(type="findings_recount", state=state, params={})
        s.add(live)
        s.flush()
        live_id = live.id
    r = client.post(f"{base}/findings/recount")
    assert _error(r) == (409, "job_running")
    assert r.json()["error"]["details"] == {"job_id": live_id}


def test_the_counts_check_on_open_queues_a_recount_only_when_needed(
    client, project, handle, crack, cloud, wait_job
):
    base = f"{API}/projects/{project['id']}"
    _create(client, base, crack["id"], cloud)
    assert jobs.check_on_open(handle, client.app.state.jobs) is None
    with handle.session() as s:
        s.execute(update(FindingCount).values(n=5))
    job = jobs.check_on_open(handle, client.app.state.jobs)
    assert wait_job(project["id"], job.id)["state"] == "succeeded"
    assert jobs.check_on_open(handle, client.app.state.jobs) is None


def test_writes_publish_findings_changed(client, base, project, crack, cloud, monkeypatch):
    bus = _Bus()
    monkeypatch.setattr(events, "_bus", bus)
    f = _create(client, base, crack["id"], cloud)
    assert [(e["type"], e["project_id"], e["payload"]) for e in bus.seen] == [
        ("findings.changed", project["id"], {"ids": [f["id"]]})
    ]


def test_search_returns_findings(client, base, crack, cloud):
    _create(client, base, crack["id"], cloud, note="spalling at pier 3")
    out = client.get(f"{base}/search", params={"q": "pier"}).json()
    assert [f["number"] for f in out["findings"]] == [1]
