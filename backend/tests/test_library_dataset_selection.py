"""Which images a dataset filter selects in one project, what they count, and the preview across
projects (foundation F §12.2 step 1; plan BM Task 5 and decisions 2, 3 and 14)."""

from datetime import UTC, date, datetime

import pytest
from library_datasets_helpers import LIB, add_box, add_image, add_source, make_project
from sqlalchemy import text

from app.library.datasets.selection import (
    Filter,
    PreviewTimeout,
    count,
    interrupt_after,
    labels_of,
    matching_images,
)

EXC, TRUCK, CRANE = "type-exc", "type-truck", "type-crane"
SLOW = text("WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c")


def _at(day: int) -> datetime:
    return datetime(2026, 5, day, 9, tzinfo=UTC)


@pytest.fixture
def site(client, app, tmp_path, make_jpeg):
    """Images that each exercise one rule. The survey date of the source is 1 May.

    Depends on `client` (unused otherwise) to force the app's lifespan to start, which is what
    opens `app.state.projects`; `make_project` needs it and runs before any test body."""
    handle = make_project(app, tmp_path / "a", "Site A")
    src = add_source(handle, captured_on=date(2026, 5, 1))
    undated = add_source(handle, site="undated")
    ids = {}
    ids["accepted"] = add_image(handle, make_jpeg, src, "a.jpg", capture_time=_at(1))
    add_box(handle, ids["accepted"], EXC)
    ids["edited"] = add_image(handle, make_jpeg, src, "b.jpg", capture_time=_at(2))
    add_box(handle, ids["edited"], TRUCK, review_state="edited", provenance_kind="local_model")
    ids["pending"] = add_image(handle, make_jpeg, src, "c.jpg", capture_time=_at(3))
    add_box(handle, ids["pending"], EXC)
    add_box(handle, ids["pending"], EXC, review_state="unreviewed", provenance_kind="local_model")
    ids["proposal_only"] = add_image(handle, make_jpeg, src, "d.jpg", capture_time=_at(3))
    add_box(handle, ids["proposal_only"], EXC, review_state="unreviewed", provenance_kind="local_model")
    ids["other_type"] = add_image(handle, make_jpeg, src, "e.jpg", capture_time=_at(3))
    add_box(handle, ids["other_type"], CRANE)
    ids["empty"] = add_image(handle, make_jpeg, src, "f.jpg", marked_empty=True)  # no capture time
    ids["no_date"] = add_image(handle, make_jpeg, undated, "g.jpg", site="undated")
    add_box(handle, ids["no_date"], EXC)
    return handle, ids


def _selected(handle, **kw) -> set[str]:
    f = Filter(project_ids=(handle.id,), type_ids=(EXC, TRUCK), **kw)
    with handle.session() as s:
        return set(s.execute(matching_images(f)).scalars())


def test_ground_truth_and_negatives_are_selected_and_proposals_are_not(site):
    handle, ids = site
    assert _selected(handle) == {ids[k] for k in ("accepted", "edited", "pending", "empty", "no_date")}


def test_reviewed_only_drops_images_that_still_have_a_pending_proposal(site):
    handle, ids = site
    assert _selected(handle, reviewed_only=True) == {
        ids[k] for k in ("accepted", "edited", "empty", "no_date")
    }


def test_the_date_range_uses_the_capture_time_then_the_survey_date(site):
    handle, ids = site
    assert _selected(handle, captured_from=date(2026, 5, 2), captured_to=date(2026, 5, 2)) == {ids["edited"]}
    # "empty" has no capture time: its source's survey date (1 May) decides; "no_date" has neither
    assert _selected(handle, captured_from=date(2026, 5, 1), captured_to=date(2026, 5, 1)) == {
        ids["accepted"],
        ids["empty"],
    }
    assert _selected(handle, captured_from=date(2026, 5, 9), captured_to=date(2026, 5, 1)) == set()


def test_counts_are_images_and_ground_truth_boxes_per_type(site):
    handle, _ = site
    with handle.session() as s:
        images, per_type = count(s, Filter((handle.id,), (EXC, TRUCK)))
    assert images == 5
    assert per_type == {EXC: 3, TRUCK: 1}


def test_labels_are_ground_truth_of_the_selected_types_with_their_rotation(site):
    handle, ids = site
    add_box(handle, ids["accepted"], TRUCK, x=10, y=12, w=30, h=8, angle=30.0)
    with handle.session() as s:
        labels = labels_of(
            s, [ids["accepted"], ids["pending"], ids["other_type"]], Filter((handle.id,), (EXC, TRUCK))
        )
    assert [lb["type_id"] for lb in labels[ids["accepted"]]] == [EXC, TRUCK]
    assert labels[ids["accepted"]][1] == {
        "type_id": TRUCK,
        "x": 10,
        "y": 12,
        "w": 30,
        "h": 8,
        "angle": 30.0,
        "shape": "box",
    }
    assert len(labels[ids["pending"]]) == 1  # the unreviewed proposal is not a label
    assert ids["other_type"] not in labels


def test_a_slow_count_is_interrupted(client, app, tmp_path):
    handle = make_project(app, tmp_path / "slow", "Slow")
    with pytest.raises(PreviewTimeout), handle.session() as s, interrupt_after(s, 0.2):
        s.execute(SLOW)


def test_the_preview_counts_each_project_and_names_the_missing_one(client, app, tmp_path, make_jpeg):
    a = make_project(app, tmp_path / "a", "Site A")
    b = make_project(app, tmp_path / "b", "Site B")
    for handle, n in ((a, 2), (b, 1)):
        src = add_source(handle)
        for i in range(n):
            add_box(handle, add_image(handle, make_jpeg, src, f"{i}.jpg"), EXC)
    body = {"project_ids": [a.id, b.id, "ghost"], "type_ids": [EXC], "reviewed_only": False}
    r = client.post(f"{LIB}/datasets/preview", json=body)
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["images"] == 3 and got["boxes_per_type"] == {EXC: 3}
    by_id = {p["project_id"]: p for p in got["projects"]}
    assert by_id[a.id] == {
        "project_id": a.id,
        "project_name": "Site A",
        "images": 2,
        "boxes": 2,
        "state": "ok",
    }
    assert by_id[b.id]["images"] == 1
    assert by_id["ghost"]["state"] == "missing" and by_id["ghost"]["images"] == 0


def test_a_project_that_times_out_is_reported_and_the_rest_still_count(
    client, app, tmp_path, make_jpeg, monkeypatch
):
    slow = make_project(app, tmp_path / "slow", "Slow")
    fine = make_project(app, tmp_path / "fine", "Fine")
    add_box(fine, add_image(fine, make_jpeg, add_source(fine), "x.jpg"), EXC)
    from app.library.datasets import selection

    real_count = selection.count

    def hang_in_slow(s, f):
        if s.bind is slow.engine:  # only the "Slow" project's session runs the endless query
            s.execute(SLOW)
        return real_count(s, f)

    monkeypatch.setattr(selection, "PREVIEW_TIMEOUT_S", 0.2)
    monkeypatch.setattr(selection, "count", hang_in_slow)
    body = {"project_ids": [slow.id, fine.id], "type_ids": [EXC]}
    r = client.post(f"{LIB}/datasets/preview", json=body)
    assert r.status_code == 200, r.text
    by_id = {p["project_id"]: p for p in r.json()["projects"]}
    assert by_id[slow.id]["state"] == "timed_out" and by_id[slow.id]["project_name"] == "Slow"
    assert by_id[fine.id]["state"] == "ok" and r.json()["images"] == 1
