"""GET /images on image_summary with the new filters (image inspection spec §7.1, §14)."""

import pytest
from image_summary_helpers import add_box, new_image

from app.findings.anchors import AnchorIn
from app.findings.service import create_finding, patch_finding

API = "/api/v1"


@pytest.fixture
def world(client, project, handle, crack):
    """Five images: a (open sev 2 crack), b (closed sev 4 crack + open sev 1 crack; closed findings
    are not counted, I-C0 ruling 5),
    c (pending suggestion 0.8), d (marked empty), e (nothing)."""
    cls = [c["id"] for c in project["classes"]]
    src = None
    ids = {}
    for name in "abcde":
        ids[name] = new_image(handle, source_id=src, marked_empty=(name == "d"))
        if src is None:
            with handle.session() as s:
                from app.db.models import Image

                src = s.get(Image, ids[name]).source_id

    def finding(image_id, severity, status="open"):
        box_id = add_box(handle, image_id, crack["id"])
        f = create_finding(
            handle,
            type_id=crack["id"],
            anchor=AnchorIn(kind="image", image_id=image_id, annotation_id=box_id),
            severity=severity,
        )
        if status != "open":
            patch_finding(handle, f.id, {"status": status})
        return f

    finding(ids["a"], 2)
    finding(ids["b"], 4, "closed")
    finding(ids["b"], 1)
    add_box(handle, ids["c"], cls[1], state="unreviewed", conf=0.8)
    return {"pid": project["id"], "ids": ids, "cls": cls, "crack": crack["id"]}


def _names(client, world, **params):
    r = client.get(f"{API}/projects/{world['pid']}/images", params={"limit": 1000, **params})
    assert r.status_code == 200, r.text
    back = {v: k for k, v in world["ids"].items()}
    return sorted(back[i["id"]] for i in r.json()["items"] if i["id"] in back), r.json()["items"]


def test_new_fields_on_image(client, world):
    _, items = _names(client, world)
    by_id = {i["id"]: i for i in items}
    b = by_id[world["ids"]["b"]]
    assert (b["finding_count"], b["worst_severity"], b["reviewed"]) == (
        1,
        1,
        True,
    )  # the closed one is not counted
    c = by_id[world["ids"]["c"]]
    assert (c["pending_count"], c["reviewed"], c["worst_severity"]) == (1, False, None)
    assert by_id[world["ids"]["d"]]["reviewed"] is True
    assert by_id[world["ids"]["e"]]["reviewed"] is False


def test_has_findings_and_status_filter(client, world):
    assert _names(client, world, has_findings=True)[0] == ["a", "b"]
    assert _names(client, world, has_findings=False)[0] == ["c", "d", "e"]
    names, items = _names(client, world, finding_status="closed")
    assert names == ["b"]
    # finding_status filters images; the counts stay "not closed" (I-BX Ruling 3, I-C0 ruling 5)
    assert items[0]["finding_count"] == 1 and items[0]["worst_severity"] == 1


def test_severity_filter_ignores_closed_findings_without_a_status(client, world):
    assert _names(client, world, severity="4")[0] == []
    assert _names(client, world, severity="1,2")[0] == ["a", "b"]


def test_severity_and_status_combine_on_one_finding(client, world):
    assert _names(client, world, severity="4", finding_status="open")[0] == []
    assert _names(client, world, severity="4", finding_status="closed")[0] == ["b"]
    assert _names(client, world, severity="1", finding_status="open")[0] == ["b"]


def test_suggestions_reviewed_unlabeled_types(client, world):
    assert _names(client, world, has_suggestions=True)[0] == ["c"]
    assert _names(client, world, reviewed=True)[0] == ["a", "b", "d"]
    assert _names(client, world, unlabeled=True)[0] == ["c", "e"]
    assert _names(client, world, type_ids=world["crack"])[0] == ["a", "b"]
    assert _names(client, world, type_ids=world["cls"][1])[0] == ["c"]


def test_sort_by_worst_severity(client, world):
    r = client.get(
        f"{API}/projects/{world['pid']}/images",
        params={"sort": "worst_severity", "order": "desc", "limit": 2},
    )
    assert r.status_code == 200, r.text
    first = r.json()["items"]
    assert [i["id"] for i in first] == [world["ids"]["a"], world["ids"]["b"]]  # 2, then 1
    nxt = client.get(
        f"{API}/projects/{world['pid']}/images",
        params={"sort": "worst_severity", "order": "desc", "limit": 2, "cursor": r.json()["next_cursor"]},
    ).json()["items"]
    assert not {i["id"] for i in nxt} & {world["ids"]["a"], world["ids"]["b"]}


@pytest.mark.parametrize(
    "params", [{"severity": "12"}, {"severity": "high"}, {"severity": "none"}, {"finding_status": "done"}]
)
def test_bad_filter_values_are_422(client, world, params):
    r = client.get(f"{API}/projects/{world['pid']}/images", params=params)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"
