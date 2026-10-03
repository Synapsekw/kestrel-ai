"""Merge, split and the Regroup route (spec 2026-10-02-asset-findings §8; index amendment: merge and
split are synchronous routes, Regroup is the job)."""

import pytest
from asset_findings_helpers import (
    API,
    assert_counts_true,
    by_photo,
    finding_row,
    make_model,
    make_photos,
    place,
    post_asset,
)
from findings_helpers import add_type, use_types


@pytest.fixture
def ctx(client, project, crack, handle, import_source, tmp_path, make_jpeg) -> dict:
    return {
        "base": f"{API}/projects/{project['id']}",
        "pid": project["id"],
        "photos": make_photos(client, project, import_source, tmp_path, make_jpeg, n=3),
        "model": make_model(handle),
        "crack": crack["id"],
    }


def _refusal(r) -> tuple[str, str]:
    """The contract's refusal: `code` plus `details.reason`."""
    err = r.json()["error"]
    return err["code"], (err.get("details") or {}).get("reason")


def test_merge_moves_the_sightings_and_closes_the_source(client, handle, ctx):
    a = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:1])
    b = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][1:3])
    r = client.post(f"{ctx['base']}/findings/{a['id']}/merge", json={"into": b["id"]})
    assert r.status_code == 200, r.text
    assert (r.json()["id"], r.json()["sighting_count"]) == (b["id"], 3)
    src = client.get(f"{ctx['base']}/findings/{a['id']}").json()
    assert (src["status"], src["sighting_count"]) == ("closed", 0)
    texts = [c["text"] for c in client.get(f"{ctx['base']}/findings/{a['id']}/comments").json()["items"]]
    assert texts == ["Merged into F-0002."]
    kinds = {
        x["kind"]
        for x in client.get(f"{ctx['base']}/activity", params={"subject_id": a["id"]}).json()["items"]
    }
    assert "finding.merged" in kinds
    assert_counts_true(handle)


def test_merge_refuses_itself_another_model_or_another_type(client, handle, project, ctx):
    a = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:1])
    r = client.post(f"{ctx['base']}/findings/{a['id']}/merge", json={"into": a["id"]})
    assert (r.status_code, _refusal(r)) == (422, ("invalid_merge", "same_finding"))
    other = post_asset(client, ctx["pid"], ctx["crack"], make_model(handle, name="Stack"), ctx["photos"][1:2])
    r = client.post(f"{ctx['base']}/findings/{a['id']}/merge", json={"into": other["id"]})
    assert (r.status_code, _refusal(r)) == (422, ("invalid_merge", "other_model"))
    rust = add_type(client, "rust")
    use_types(client, project, rust)
    rusty = post_asset(client, ctx["pid"], rust["id"], ctx["model"], ctx["photos"][2:3])
    r = client.post(f"{ctx['base']}/findings/{a['id']}/merge", json={"into": rusty["id"]})
    assert (r.status_code, _refusal(r)) == (422, ("invalid_merge", "other_type"))
    assert client.get(f"{ctx['base']}/findings/{a['id']}").json()["status"] == "open"


def test_split_makes_a_new_finding_from_the_chosen_sightings(client, handle, ctx):
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"])
    s = by_photo(handle, f["id"])
    chosen = [s[ctx["photos"][1]].id, s[ctx["photos"][2]].id]
    r = client.post(f"{ctx['base']}/findings/{f['id']}/split", json={"sighting_ids": chosen})
    assert r.status_code == 201, r.text
    new = r.json()
    assert (new["number"], new["sighting_count"], new["type_id"]) == (2, 2, ctx["crack"])
    assert finding_row(handle, f["id"]).sighting_count == 1
    kinds = {
        x["kind"]
        for x in client.get(f"{ctx['base']}/activity", params={"subject_id": f["id"]}).json()["items"]
    }
    assert "finding.split" in kinds
    assert_counts_true(handle)


def test_split_refuses_all_or_foreign_sightings(client, handle, ctx):
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:2])
    other = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][2:3])
    every = [r.id for r in by_photo(handle, f["id"]).values()]
    r = client.post(f"{ctx['base']}/findings/{f['id']}/split", json={"sighting_ids": every})
    assert (r.status_code, _refusal(r)) == (422, ("invalid_split", "all_sightings"))
    foreign = [r.id for r in by_photo(handle, other["id"]).values()]
    r = client.post(f"{ctx['base']}/findings/{f['id']}/split", json={"sighting_ids": foreign})
    assert (r.status_code, _refusal(r)) == (422, ("invalid_split", "not_on_finding"))
    assert finding_row(handle, f["id"]).sighting_count == 2


def test_regroup_route_runs_the_job(client, handle, wait_job, ctx):
    a = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:1])
    b = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][1:2])
    place(handle, by_photo(handle, a["id"])[ctx["photos"][0]].id, (0.0, 10.0, 0.0))
    place(handle, by_photo(handle, b["id"])[ctx["photos"][1]].id, (0.2, 10.0, 0.0))
    r = client.post(f"{ctx['base']}/asset-models/{ctx['model']}/findings/regroup")
    assert r.status_code == 202, r.text
    job = wait_job(ctx["pid"], r.json()["job"]["id"])
    assert job["state"] == "succeeded", job
    assert {k: job["result"][k] for k in ("created", "kept", "merged", "split")} == {
        "created": 0,
        "kept": 1,
        "merged": 1,
        "split": 0,
    }
    assert client.get(f"{ctx['base']}/findings/{b['id']}").json()["status"] == "closed"
    assert_counts_true(handle)


def test_regroup_route_404s_on_an_unknown_model(client, ctx):
    r = client.post(f"{ctx['base']}/asset-models/nope/findings/regroup")
    assert r.status_code == 404


def test_merge_and_split_refuse_an_image_finding(client, ctx):
    a = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:1])
    box = {"class_id": ctx["crack"], "x": 10, "y": 20, "w": 30, "h": 40}
    assert client.post(f"{ctx['base']}/images/{ctx['photos'][1]}/boxes", json=box).status_code == 201
    [img] = [
        f for f in client.get(f"{ctx['base']}/findings").json()["items"] if f["anchor"]["kind"] == "image"
    ]
    r = client.post(f"{ctx['base']}/findings/{img['id']}/merge", json={"into": a["id"]})
    assert (r.status_code, _refusal(r)) == (422, ("invalid_merge", "not_asset"))
    r = client.post(f"{ctx['base']}/findings/{img['id']}/split", json={"sighting_ids": ["x"]})
    assert (r.status_code, _refusal(r)) == (422, ("invalid_split", "not_asset"))


def test_merge_and_split_refuse_extra_keys_and_repeated_ids(client, handle, ctx):
    f = post_asset(client, ctx["pid"], ctx["crack"], ctx["model"], ctx["photos"][:2])
    r = client.post(f"{ctx['base']}/findings/{f['id']}/merge", json={"into": f["id"], "extra": 1})
    assert r.status_code == 422
    one = by_photo(handle, f["id"])[ctx["photos"][0]].id
    r = client.post(f"{ctx['base']}/findings/{f['id']}/split", json={"sighting_ids": [one, one]})
    assert r.status_code == 422
    assert finding_row(handle, f["id"]).sighting_count == 2


def test_regroup_route_409s_while_a_grouping_job_is_live(client, handle, ctx):
    from app.asset_review import jobs_group
    from app.db.models import Job

    with handle.session() as s:
        s.add(Job(type=jobs_group.GROUP_JOB, state="running", params={"asset_model_id": ctx["model"]}))
    r = client.post(f"{ctx['base']}/asset-models/{ctx['model']}/findings/regroup")
    assert (r.status_code, r.json()["error"]["code"]) == (409, "job_running")
