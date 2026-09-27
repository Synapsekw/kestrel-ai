"""deletePointCloud with findings (spec 2026-09-26-point-cloud-workspace C14, sections 12 row 13, 14, 15)."""

import pytest
from pointclouds import insert_cloud
from sqlalchemy import func, select

from app.db.models import Finding, FindingCount, PointCloud
from app.findings import events

API = "/api/v1"


class _Bus:
    def __init__(self):
        self.seen: list[dict] = []

    def publish(self, event: dict) -> None:
        self.seen.append(event)


@pytest.fixture
def base(project) -> str:
    return f"{API}/projects/{project['id']}"


def _finding(client, base, type_id, cloud_id) -> str:
    anchor = {"kind": "cloud", "cloud_id": cloud_id, "x": 1.0, "y": 2.0, "z": 3.0}
    r = client.post(f"{base}/findings", json={"type_id": type_id, "anchor": anchor})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _count(handle, model, *where) -> int:
    with handle.session() as s:
        return s.execute(select(func.count()).select_from(model).where(*where)).scalar_one()


def test_a_cloud_with_findings_is_refused_with_their_count(client, base, handle, crack):
    cid = insert_cloud(handle, name="Chimney")
    _finding(client, base, crack["id"], cid)
    _finding(client, base, crack["id"], cid)
    for query in ("", "?delete_findings=false"):
        r = client.delete(f"{base}/pointclouds/{cid}{query}")
        assert r.status_code == 409, r.text
        err = r.json()["error"]
        assert (err["code"], err["details"]) == ("cloud_has_findings", {"count": 2})
        assert "Chimney has 2 findings" in err["message"]
    assert _count(handle, PointCloud, PointCloud.id == cid) == 1
    assert _count(handle, Finding) == 2


def test_delete_findings_true_deletes_them_through_the_findings_service(
    client, base, handle, crack, tmp_path, make_jpeg, monkeypatch
):
    cid = insert_cloud(handle)
    fid = _finding(client, base, crack["id"], cid)
    photo = make_jpeg(tmp_path / "crack.jpg", 64, 48)
    assert client.post(f"{base}/findings/{fid}/attachments", json={"path": str(photo)}).status_code == 201
    folder = handle.folder / "findings" / fid
    assert folder.is_dir()
    (handle.folder / "pointclouds" / cid).mkdir(parents=True, exist_ok=True)
    bus = _Bus()
    monkeypatch.setattr(events, "_bus", bus)

    r = client.delete(f"{base}/pointclouds/{cid}", params={"delete_findings": "true"})

    assert r.status_code == 204, r.text
    assert client.get(f"{base}/findings/{fid}").status_code == 404
    assert _count(handle, PointCloud, PointCloud.id == cid) == 0
    assert not folder.exists()  # moved to F's trash, not left behind
    assert list((handle.folder / "findings" / "_trash").glob(f"{fid}-*"))
    with handle.session() as s:
        assert (s.execute(select(func.coalesce(func.sum(FindingCount.n), 0))).scalar_one()) == 0
    assert [(e["type"], e["payload"]) for e in bus.seen] == [("findings.changed", {"ids": [fid]})]
    assert not (handle.folder / "pointclouds" / cid).exists()


def test_a_finding_on_another_cloud_survives(client, base, handle, crack):
    gone, kept = insert_cloud(handle, name="A"), insert_cloud(handle, name="B")
    _finding(client, base, crack["id"], gone)
    survivor = _finding(client, base, crack["id"], kept)
    assert client.delete(f"{base}/pointclouds/{gone}?delete_findings=true").status_code == 204
    assert client.get(f"{base}/findings/{survivor}").status_code == 200
    assert _count(handle, Finding) == 1


def test_a_cloud_without_findings_deletes_without_the_flag(client, base, handle):
    cid = insert_cloud(handle)
    assert client.delete(f"{base}/pointclouds/{cid}").status_code == 204
    assert client.delete(f"{base}/pointclouds/{cid}").status_code == 404


def test_a_running_job_is_still_refused_first(client, base, handle, crack, app, monkeypatch):
    cid = insert_cloud(handle, job_id="j-live")
    _finding(client, base, crack["id"], cid)
    monkeypatch.setattr(app.state.jobs, "is_live", lambda job_id: job_id == "j-live")
    r = client.delete(f"{base}/pointclouds/{cid}?delete_findings=true")
    assert (r.status_code, r.json()["error"]["code"]) == (409, "job_running")
    assert _count(handle, Finding) == 1
