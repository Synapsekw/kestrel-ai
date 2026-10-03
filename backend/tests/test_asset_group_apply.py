"""Regroup (spec 2026-10-02-asset-findings §6.4; decision A3; index Review Focus 1): numbers,
statuses, notes, comments and photos survive; a merged-away finding is closed with a comment naming
the survivor; a split creates a new finding; nothing is deleted."""

from asset_findings_helpers import (
    assert_counts_true,
    finding_of_sighting,
    finding_row,
    make_model,
    place,
    seed_images,
    seed_sighting,
)
from sqlalchemy import select

from app.asset_review import group
from app.db.models import Activity, AssetModel, Box, FindingAttachment, FindingComment, FindingSighting
from app.findings import annotations, attachments, comments, service


def _regroup(handle, model_id: str) -> group.GroupResult:
    """What the `asset_group` job does, synchronously."""
    with handle.session() as s:
        groups = group.groups_for_model(s.get(AssetModel, model_id), group.load_items(s, model_id))
    with handle.session() as s:
        return group.apply_groups(s, handle, model_id, groups)


def test_photo_unit_two_photos_close_together_stay_two_findings(handle, crack):
    mid = make_model(handle, profile_id="stack")
    img = seed_images(handle, 2)
    a = seed_sighting(
        handle, model_id=mid, image_id=img[0], type_id=crack["id"], center=(0.0, 10.0, 0.0), tag="D1"
    )
    b = seed_sighting(
        handle, model_id=mid, image_id=img[1], type_id=crack["id"], center=(0.1, 10.0, 0.0), tag="D1"
    )
    assert _tally(_regroup(handle, mid)) == (2, 0, 0, 0)
    assert finding_of_sighting(handle, a).id != finding_of_sighting(handle, b).id


def test_photo_unit_one_photo_with_five_sightings_is_one_finding_and_regroup_keeps_it(handle, crack):
    mid = make_model(handle, profile_id="stack")
    [photo] = seed_images(handle, 1)
    centres = [(0.0, 10.0, 0.0), (6.0, 2.0, 0.0), None, (0.0, 28.0, 3.0), None]
    ids = [
        seed_sighting(
            handle, model_id=mid, image_id=photo, type_id=crack["id"], center=c, severity=1 + (i % 2)
        )
        for i, c in enumerate(centres)
    ]
    assert _tally(_regroup(handle, mid)) == (1, 0, 0, 0)
    f = finding_of_sighting(handle, ids[0])
    assert {finding_of_sighting(handle, sid).id for sid in ids} == {f.id}
    assert (f.number, f.sighting_count, f.severity) == (1, 5, 2)
    service.patch_finding(handle, f.id, {"status": "reviewed", "note": "soot band"})
    assert _tally(_regroup(handle, mid)) == (0, 1, 0, 0)
    kept = finding_row(handle, f.id)
    assert (kept.number, kept.status, kept.note, kept.sighting_count) == (1, "reviewed", "soot band", 5)
    assert_counts_true(handle)


def _tally(r: group.GroupResult) -> tuple[int, int, int, int]:
    return (r.created, r.kept, r.merged, r.split)


def _comment_texts(handle, finding_id: str) -> list[str]:
    with handle.session() as s:
        q = select(FindingComment.text).where(FindingComment.finding_id == finding_id)
        return list(s.execute(q.order_by(FindingComment.created_at, FindingComment.id)).scalars())


def _kinds(handle, subject_id: str) -> set[str]:
    with handle.session() as s:
        return set(s.execute(select(Activity.kind).where(Activity.subject_id == subject_id)).scalars())


def test_first_run_numbers_top_down_with_unplaced_last(handle, crack):
    mid = make_model(handle, review=False)
    img = seed_images(handle, 5)
    t = crack["id"]
    low = seed_sighting(handle, model_id=mid, image_id=img[0], type_id=t, center=(0.0, 3.0, 0.0))
    loose = seed_sighting(handle, model_id=mid, image_id=img[1], type_id=t, severity=2)
    high = seed_sighting(handle, model_id=mid, image_id=img[2], type_id=t, center=(0.0, 25.0, 0.0))
    pair_a = seed_sighting(handle, model_id=mid, image_id=img[3], type_id=t, center=(0.0, 12.0, 0.0))
    pair_b = seed_sighting(
        handle, model_id=mid, image_id=img[4], type_id=t, center=(0.2, 12.0, 0.0), severity=3
    )
    assert _tally(_regroup(handle, mid)) == (4, 0, 0, 0)
    numbers = {
        k: finding_of_sighting(handle, v).number
        for k, v in {"high": high, "pair": pair_a, "low": low, "loose": loose}.items()
    }
    assert numbers == {"high": 1, "pair": 2, "low": 3, "loose": 4}
    pair = finding_of_sighting(handle, pair_b)
    assert (pair.number, pair.severity, pair.sighting_count) == (2, 3, 2)  # the maximum, on creation
    unplaced = finding_of_sighting(handle, loose)
    assert (unplaced.placement, unplaced.height_m, unplaced.severity) == (None, None, 2)  # pending: R1
    with handle.session() as s:
        assert "findings.grouped" in set(s.execute(select(Activity.kind)).scalars())
    assert_counts_true(handle)


def test_regroup_preserves_operator_edits(handle, crack, tmp_path, make_jpeg):
    mid = make_model(handle, review=False)
    img = seed_images(handle, 4)
    t = crack["id"]
    a = seed_sighting(handle, model_id=mid, image_id=img[0], type_id=t, center=(0.0, 10.0, 0.0), severity=1)
    seed_sighting(handle, model_id=mid, image_id=img[1], type_id=t, center=(0.3, 10.0, 0.0), severity=2)
    c = seed_sighting(handle, model_id=mid, image_id=img[2], type_id=t, center=(0.0, 20.0, 0.0), severity=1)
    assert _tally(_regroup(handle, mid)) == (2, 0, 0, 0)
    top, pair = finding_of_sighting(handle, c), finding_of_sighting(handle, a)
    assert (top.number, pair.number, pair.severity) == (1, 2, 2)

    # The operator reviews the pair: status, severity, note, a comment and a site photo.
    service.patch_finding(handle, pair.id, {"status": "reviewed", "severity": 3, "note": "bolt sheared"})
    with handle.session() as s:
        comments.add(s, project_id=handle.id, finding_id=pair.id, text="check on next visit", author="Dan")
    attachments.add(handle, pair.id, str(make_jpeg(tmp_path / "site.jpg", 64, 48)))
    top_updated = finding_row(handle, top.id).updated_at

    # A new sighting of the same defect arrives (a later import), then Regroup.
    d = seed_sighting(handle, model_id=mid, image_id=img[3], type_id=t, center=(0.5, 10.0, 0.0), severity=1)
    assert _tally(_regroup(handle, mid)) == (0, 2, 0, 0)
    kept = finding_row(handle, pair.id)
    assert (kept.number, kept.status, kept.severity, kept.note) == (2, "reviewed", 3, "bolt sheared")
    assert kept.sighting_count == 3 and finding_of_sighting(handle, d).id == pair.id
    assert _comment_texts(handle, pair.id) == ["check on next visit"]
    with handle.session() as s:
        n_photos = len(
            list(s.execute(select(FindingAttachment.id).where(FindingAttachment.finding_id == pair.id)))
        )
    assert n_photos == 1
    # The finding whose sightings did not change is not written at all.
    assert finding_row(handle, top.id).updated_at == top_updated
    # Running Regroup again changes nothing.
    assert _tally(_regroup(handle, mid)) == (0, 2, 0, 0)
    assert finding_row(handle, pair.id).severity == 3
    assert_counts_true(handle)


def test_regroup_merge_closes_with_comment(handle, crack):
    mid = make_model(handle, review=False)
    img = seed_images(handle, 2)
    t = crack["id"]
    a = seed_sighting(handle, model_id=mid, image_id=img[0], type_id=t, center=(0.0, 10.0, 0.0))
    b = seed_sighting(handle, model_id=mid, image_id=img[1], type_id=t, center=(5.0, 9.0, 0.0))
    assert _tally(_regroup(handle, mid)) == (2, 0, 0, 0)
    first, second = finding_of_sighting(handle, a), finding_of_sighting(handle, b)
    assert (first.number, second.number) == (1, 2)
    service.patch_finding(handle, second.id, {"note": "loose panel"})
    with handle.session() as s:
        comments.add(
            s, project_id=handle.id, finding_id=second.id, text="seen from the north too", author="Dan"
        )

    place(handle, b, (0.4, 10.0, 0.0))  # a recomputed placement puts b beside a: one defect after all
    assert _tally(_regroup(handle, mid)) == (0, 1, 1, 0)
    survivor = finding_of_sighting(handle, b)
    assert (survivor.id, survivor.number, survivor.sighting_count) == (first.id, 1, 2)
    gone = finding_row(handle, second.id)
    assert gone is not None  # closed, never deleted
    assert (gone.status, gone.sighting_count, gone.note) == ("closed", 0, "loose panel")
    assert gone.closed_at is not None
    assert _comment_texts(handle, second.id) == ["seen from the north too", "Merged into F-0001 by Regroup."]
    assert {"finding.merged", "finding.status"} <= _kinds(handle, second.id)
    assert_counts_true(handle)


def test_regroup_split_creates_a_new_finding_and_keeps_the_old_one(handle, crack):
    mid = make_model(handle, review=False)
    img = seed_images(handle, 2)
    t = crack["id"]
    a = seed_sighting(handle, model_id=mid, image_id=img[0], type_id=t, center=(0.0, 10.0, 0.0))
    b = seed_sighting(handle, model_id=mid, image_id=img[1], type_id=t, center=(0.3, 10.0, 0.0))
    assert _tally(_regroup(handle, mid)) == (1, 0, 0, 0)
    old = finding_of_sighting(handle, a)
    place(handle, b, (0.0, 2.0, 0.0))
    assert _tally(_regroup(handle, mid)) == (0, 1, 0, 1)
    assert finding_of_sighting(handle, a).id == old.id
    new = finding_of_sighting(handle, b)
    assert new.id != old.id and new.number == 2
    assert finding_row(handle, old.id).sighting_count == 1
    assert "finding.split" in _kinds(handle, old.id)
    assert_counts_true(handle)


def test_a_sighting_deleted_since_grouping_is_skipped(handle, crack):
    mid = make_model(handle, review=False)
    img = seed_images(handle, 1)
    a = seed_sighting(handle, model_id=mid, image_id=img[0], type_id=crack["id"], center=(0.0, 1.0, 0.0))
    with handle.session() as s:
        result = group.apply_groups(s, handle, mid, [["missing-id"], [a]])
    assert _tally(result) == (1, 0, 0, 0)


def test_regroup_refreshes_a_kept_finding_whose_sighting_was_placed_again(handle, crack):
    """Ruling R14: `asset_place` only writes sighting columns and relies on grouping to refresh the
    finding, so a kept finding with unchanged sightings is still refreshed."""
    mid = make_model(handle, review=False)
    [photo] = seed_images(handle, 1)
    a = seed_sighting(handle, model_id=mid, image_id=photo, type_id=crack["id"], center=(0.0, 10.0, 0.0))
    assert _tally(_regroup(handle, mid)) == (1, 0, 0, 0)
    f = finding_of_sighting(handle, a)
    assert (f.height_m, f.ay, f.asset_version) == (10.0, 10.0, 1)

    place(handle, a, (0.0, 20.0, 0.0), placed_version=2)
    assert _tally(_regroup(handle, mid)) == (0, 1, 0, 0)
    after = finding_row(handle, f.id)
    assert (after.height_m, after.ay, after.asset_version) == (20.0, 20.0, 2)
    assert after.updated_at > f.updated_at
    unchanged = after.updated_at
    assert _tally(_regroup(handle, mid)) == (0, 1, 0, 0)
    assert finding_row(handle, f.id).updated_at == unchanged  # nothing changed: not written
    assert_counts_true(handle)


def test_regroup_brings_the_placement_back_after_a_box_edit(handle, crack):
    mid = make_model(handle, review=False)
    [photo] = seed_images(handle, 1)
    a = seed_sighting(handle, model_id=mid, image_id=photo, type_id=crack["id"], center=(0.0, 10.0, 0.0))
    assert _tally(_regroup(handle, mid)) == (1, 0, 0, 0)
    f = finding_of_sighting(handle, a)
    assert f.placement == "point"

    with handle.session() as s:  # a geometry edit of the sighting's box: the box hook
        box = s.get(Box, s.get(FindingSighting, a).annotation_id)
        box.x += 5.0
        assert annotations.on_box_changed(s, handle.id, handle.catalogue, box) == []
    edited = finding_row(handle, f.id)
    assert (edited.placement, edited.height_m) == (None, None)

    place(handle, a, (0.0, 12.0, 0.0), placed_version=2)
    assert _tally(_regroup(handle, mid)) == (0, 1, 0, 0)
    back = finding_row(handle, f.id)
    assert (back.placement, back.height_m, back.ay, back.asset_version) == ("point", 12.0, 12.0, 2)
    assert_counts_true(handle)


def test_regroup_keeps_the_open_finding_when_a_closed_one_joins_it(handle, crack):
    """Ruling R15: the survivor is the lowest-numbered finding that is not closed."""
    mid = make_model(handle, review=False)
    img = seed_images(handle, 2)
    t = crack["id"]
    a = seed_sighting(handle, model_id=mid, image_id=img[0], type_id=t, center=(0.0, 10.0, 0.0))
    b = seed_sighting(handle, model_id=mid, image_id=img[1], type_id=t, center=(5.0, 9.0, 0.0))
    assert _tally(_regroup(handle, mid)) == (2, 0, 0, 0)
    first, second = finding_of_sighting(handle, a), finding_of_sighting(handle, b)
    assert (first.number, second.number) == (1, 2)
    service.patch_finding(handle, first.id, {"status": "closed"})

    place(handle, b, (0.4, 10.0, 0.0))
    assert _tally(_regroup(handle, mid)) == (0, 1, 1, 0)
    survivor = finding_row(handle, second.id)
    assert (survivor.status, survivor.sighting_count) == ("open", 2)
    assert finding_of_sighting(handle, a).id == second.id
    gone = finding_row(handle, first.id)
    assert (gone.status, gone.sighting_count) == ("closed", 0)
    assert _comment_texts(handle, first.id) == ["Merged into F-0002 by Regroup."]
    assert "finding.merged" in _kinds(handle, first.id)
    assert_counts_true(handle)


def test_regroup_of_closed_findings_only_keeps_the_lowest_number(handle, crack):
    mid = make_model(handle, review=False)
    img = seed_images(handle, 2)
    t = crack["id"]
    a = seed_sighting(handle, model_id=mid, image_id=img[0], type_id=t, center=(0.0, 10.0, 0.0))
    b = seed_sighting(handle, model_id=mid, image_id=img[1], type_id=t, center=(5.0, 9.0, 0.0))
    assert _tally(_regroup(handle, mid)) == (2, 0, 0, 0)
    first, second = finding_of_sighting(handle, a), finding_of_sighting(handle, b)
    for f in (first, second):
        service.patch_finding(handle, f.id, {"status": "closed"})

    place(handle, b, (0.4, 10.0, 0.0))
    assert _tally(_regroup(handle, mid)) == (0, 1, 1, 0)
    assert finding_of_sighting(handle, b).id == first.id
    assert _comment_texts(handle, second.id) == ["Merged into F-0001 by Regroup."]
    assert_counts_true(handle)
