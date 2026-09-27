"""An accepted defect detection on a map IS a finding (map workspace spec §9.3; F §8.5).

Every test ends with the run's stored counts equal to a recount of its rows: the review, its count
increment and the finding are one transaction.
"""

from types import SimpleNamespace

import pytest
from findings_helpers import add_type, use_types
from pyproj import CRS
from sqlalchemy import select

from app.db.models import Finding, FindingCount, GeoMap, MapDetection, MapRun
from app.detect import review
from app.detect.counts import recount_map_run

BASE = "/api/v1/projects"
UTM33 = CRS.from_epsg(32633).to_wkt()
GT = (500000.0, 0.03, 0.0, 4983000.0, 0.0, -0.03)


def _map(s, map_id: str, *, georef: bool = True) -> None:
    s.add(
        GeoMap(
            id=map_id,
            name=map_id,
            status="ready",
            source_path="x",
            source_size=1,
            width=1000,
            height=1000,
            geotransform=list(GT) if georef else None,
            crs_wkt=UTM33 if georef else None,
        )
    )


@pytest.fixture
def types(project, crack) -> dict:
    return {"crack": crack["id"], "truck": project["classes"][3]["id"]}


@pytest.fixture
def run(handle, types) -> str:
    """Map m1 (UTM 33) and run r1 of library model lib-1: two unreviewed cracks and a truck."""
    with handle.session() as s:
        _map(s, "m1")
        s.flush()
        s.add(MapRun(id="r1", map_id="m1", kind="local_model", model_id="lib-1", model_name="v3", conf=0.25))
        s.flush()
        for det_id, cls, x in (
            ("d-crack", "crack", 100),
            ("d-truck", "truck", 300),
            ("d-crack2", "crack", 500),
        ):
            s.add(
                MapDetection(
                    id=det_id, run_id="r1", class_id=types[cls], confidence=0.8, x=x, y=100, w=20, h=10
                )
            )
        s.flush()
        recount_map_run(s, s.get(MapRun, "r1"), [])
    return "r1"


def _review(client, project_id, ids, action, *, run_id="r1", confirm=False, class_id=None):
    body = {"detection_ids": ids, "action": action}
    if class_id:
        body["class_id"] = class_id
    params = {"confirm_finding_delete": "true"} if confirm else None
    return client.post(f"{BASE}/{project_id}/map-runs/{run_id}/review", json=body, params=params)


def _findings(handle) -> list[Finding]:
    with handle.session() as s:
        rows = list(s.execute(select(Finding).order_by(Finding.number)).scalars())
        s.expunge_all()
    return rows


def _det(handle, det_id) -> MapDetection:
    with handle.session() as s:
        row = s.get(MapDetection, det_id)
        s.expunge(row)
    return row


def _counts_match_a_recount(handle, run_id="r1") -> None:
    with handle.session() as s:
        run = s.get(MapRun, run_id)
        stored = (dict(run.counts), dict(run.verified_counts))
        fresh = SimpleNamespace(id=run_id)
        recount_map_run(s, fresh, [])
        s.rollback()
    assert stored == (fresh.counts, fresh.verified_counts)


def test_accepting_a_defect_creates_one_reviewed_finding_on_the_map(client, project_id, handle, run, types):
    r = _review(client, project_id, ["d-crack"], "accept")
    assert r.status_code == 200 and r.json()["updated"] == 1, r.text
    [f] = _findings(handle)
    assert (f.type_id, f.status, f.created_by, f.confidence) == (
        types["crack"],
        "reviewed",
        "model:lib-1",
        0.8,
    )
    assert f.anchor_kind == "map" and f.map_id == "m1" and f.data_id == "m1" and f.severity == 2
    ring = f.geometry["coordinates"][0]
    assert f.geometry["type"] == "Polygon" and len(ring) == 5 and ring[0] == ring[-1]
    assert ring[0] == pytest.approx([500000.0 + 0.03 * 100, 4983000.0 - 0.03 * 100])
    assert ring[2] == pytest.approx([500000.0 + 0.03 * 120, 4983000.0 - 0.03 * 110])
    assert f.lon is not None and 14 < f.lon < 16 and f.lat is not None
    assert _det(handle, "d-crack").finding_id == f.id
    _counts_match_a_recount(handle)


def test_accepting_an_object_creates_none(client, project_id, handle, run):
    assert _review(client, project_id, ["d-truck"], "accept").status_code == 200
    assert _findings(handle) == [] and _det(handle, "d-truck").finding_id is None


def test_accepting_twice_and_accept_above_keep_one_finding_each(client, project_id, handle, run, wait_job):
    _review(client, project_id, ["d-crack"], "accept")
    assert _review(client, project_id, ["d-crack"], "accept").json()["updated"] == 0
    r = client.post(f"{BASE}/{project_id}/runs/r1/accept-above", json={"min_confidence": 0.0})
    assert r.status_code == 202, r.text
    assert wait_job(project_id, r.json()["job"]["id"])["state"] == "succeeded"
    by_detection = {_det(handle, d).finding_id for d in ("d-crack", "d-crack2")}
    assert len(_findings(handle)) == 2 and None not in by_detection and len(by_detection) == 2
    _counts_match_a_recount(handle)


def test_the_finding_is_in_the_review_transaction(handle, run, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("counts are down")

    monkeypatch.setattr("app.findings.counts.change", boom)
    with pytest.raises(RuntimeError):
        review.review_map_detections(handle, "r1", ["d-crack"], "accept")
    assert _det(handle, "d-crack").review_state == "unreviewed"
    with handle.session() as s:
        assert s.execute(select(Finding)).first() is None
        assert s.execute(select(FindingCount)).first() is None
    _counts_match_a_recount(handle)


@pytest.mark.parametrize("action", ["reject", "unreview"])
def test_reject_or_unreview_needs_confirmation(client, project_id, handle, run, action):
    _review(client, project_id, ["d-crack"], "accept")
    [f] = _findings(handle)
    r = _review(client, project_id, ["d-crack"], action)
    assert r.status_code == 409, r.text
    err = r.json()["error"]
    assert err["code"] == "finding_would_be_deleted"
    assert err["details"]["finding_ids"] == [f.id] and err["details"]["count"] == 1
    assert _det(handle, "d-crack").review_state == "accepted" and len(_findings(handle)) == 1


def test_reject_with_confirm_deletes_the_finding_and_counts_match_a_recount(client, project_id, handle, run):
    _review(client, project_id, ["d-crack"], "accept")
    r = _review(client, project_id, ["d-crack"], "reject", confirm=True)
    assert r.status_code == 200, r.text
    d = _det(handle, "d-crack")
    assert d.review_state == "rejected" and d.finding_id is None and _findings(handle) == []
    _counts_match_a_recount(handle)


def test_a_batch_with_one_finding_to_delete_is_refused_whole(client, project_id, handle, run):
    _review(client, project_id, ["d-crack"], "accept")
    r = _review(client, project_id, ["d-crack", "d-crack2", "d-truck"], "reject")
    assert r.status_code == 409, r.text
    assert [_det(handle, d).review_state for d in ("d-crack", "d-crack2", "d-truck")] == [
        "accepted",
        "unreviewed",
        "unreviewed",
    ]
    _counts_match_a_recount(handle)


def test_reclass_follows_to_a_defect_and_needs_confirmation_to_an_object(
    client, project_id, project, handle, run, types
):
    spall = add_type(client, "spall")
    use_types(client, project, spall)
    _review(client, project_id, ["d-crack"], "accept")
    [f] = _findings(handle)
    assert _review(client, project_id, ["d-crack"], "reclass", class_id=spall["id"]).status_code == 200
    [moved] = _findings(handle)
    assert moved.id == f.id and moved.type_id == spall["id"]
    r = _review(client, project_id, ["d-crack"], "reclass", class_id=types["truck"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "finding_would_be_deleted"
    r = _review(client, project_id, ["d-crack"], "reclass", class_id=types["truck"], confirm=True)
    assert r.status_code == 200, r.text
    d = _det(handle, "d-crack")
    assert (d.class_id, d.review_state, d.finding_id) == (types["truck"], "edited", None)
    assert _findings(handle) == []
    _counts_match_a_recount(handle)


def test_reclassing_an_object_to_a_defect_creates_the_finding(client, project_id, handle, run, types):
    r = _review(client, project_id, ["d-truck"], "reclass", class_id=types["crack"])
    assert r.status_code == 200, r.text
    [f] = _findings(handle)
    assert f.type_id == types["crack"] and _det(handle, "d-truck").finding_id == f.id


def test_deleting_the_finding_leaves_the_detection_rejected(client, project_id, handle, run):
    _review(client, project_id, ["d-crack"], "accept")
    [f] = _findings(handle)
    assert client.delete(f"{BASE}/{project_id}/findings/{f.id}").status_code == 204
    d = _det(handle, "d-crack")
    assert d.review_state == "rejected" and d.finding_id is None
    _counts_match_a_recount(handle)


def test_a_person_drawn_defect_is_an_open_finding_by_a_human(client, project_id, handle, run, types):
    body = {"class_id": types["crack"], "x": 600, "y": 600, "w": 30, "h": 30}
    r = client.post(f"{BASE}/{project_id}/map-runs/r1/detections", json=body)
    assert r.status_code == 201, r.text
    [f] = _findings(handle)
    assert (f.status, f.created_by, f.confidence) == ("open", "human", None)
    assert _det(handle, r.json()["id"]).finding_id == f.id
    _counts_match_a_recount(handle)


def test_a_map_without_georeference_accepts_without_a_finding(client, project_id, handle, types):
    with handle.session() as s:
        _map(s, "m-flat", georef=False)
        s.flush()
        s.add(MapRun(id="r-flat", map_id="m-flat", kind="local_model", model_id="lib-1", conf=0.25))
        s.flush()
        s.add(
            MapDetection(
                id="d-flat", run_id="r-flat", class_id=types["crack"], confidence=0.9, x=1, y=1, w=5, h=5
            )
        )
    r = _review(client, project_id, ["d-flat"], "accept", run_id="r-flat")
    assert r.status_code == 200, r.text
    assert _det(handle, "d-flat").review_state == "accepted" and _findings(handle) == []
