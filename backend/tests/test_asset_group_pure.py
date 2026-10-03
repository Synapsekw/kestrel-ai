"""Pure grouping (spec 2026-10-02-asset-findings §6.4, §12 "Grouping"): union-find over sightings of
one type, joined by distance or by a shared tag; a spatial hash keeps it O(n)."""

import math
import random

import pytest

from app.asset_review.group import GroupItem, group_by_photo, group_sightings


def _item(sid, center=None, *, type_id="crack", tag=None, image_id=None) -> GroupItem:
    return GroupItem(id=sid, type_id=type_id, center=center, group_tag=tag, image_id=image_id)


def test_photo_unit_two_photos_a_tenth_of_a_metre_apart_stay_two_groups():
    items = [_item("a", (0.0, 10.0, 0.0), image_id="p1"), _item("b", (0.1, 10.0, 0.0), image_id="p2")]
    assert group_by_photo(items) == [["a"], ["b"]]


def test_photo_unit_five_region_sightings_on_one_photo_are_one_group():
    items = [
        _item("a", (0.0, 10.0, 0.0), image_id="p1"),
        _item("b", (8.0, 2.0, 0.0), image_id="p1"),
        _item("c", None, image_id="p1"),
        _item("d", (0.0, 30.0, 5.0), image_id="p1", tag="X"),
        _item("e", None, image_id="p1", tag="Y"),
    ]
    assert group_by_photo(items) == [["a", "b", "c", "d", "e"]]


def test_photo_unit_ignores_tags_across_photos_and_orders_placed_first_highest_first():
    items = [
        _item("low", (0.0, 3.0, 0.0), image_id="p1", tag="T"),
        _item("loose", None, image_id="p2", tag="T"),
        _item("high", (0.0, 25.0, 0.0), image_id="p3"),
    ]
    assert group_by_photo(items) == [["high"], ["low"], ["loose"]]


def test_a_chain_joins_through_the_middle_sighting():
    items = [_item("a", (0.0, 0.0, 0.0)), _item("b", (0.6, 0.0, 0.0)), _item("c", (1.2, 0.0, 0.0))]
    assert group_sightings(items, 0.75) == [["a", "b", "c"]]


def test_two_types_never_join_however_close():
    items = [_item("a", (0.0, 5.0, 0.0)), _item("b", (0.1, 5.0, 0.0), type_id="rust")]
    assert sorted(group_sightings(items, 0.75)) == [["a"], ["b"]]


def test_a_tag_joins_far_and_unplaced_sightings_of_one_type():
    items = [
        _item("a", (0.0, 1.0, 0.0), tag="D07"),
        _item("b", None, tag="D07"),
        _item("c", (50.0, 1.0, 0.0), tag="D07"),
        _item("d", None, tag="D07", type_id="rust"),
    ]
    assert group_sightings(items, 0.75) == [["a", "b", "c"], ["d"]]


def test_an_unplaced_sighting_is_a_singleton():
    items = [_item("a"), _item("b")]
    assert group_sightings(items, 0.75) == [["a"], ["b"]]


def test_groups_come_placed_first_then_highest_first():
    items = [
        _item("low", (0.0, 3.0, 0.0)),
        _item("loose"),
        _item("high", (0.0, 25.0, 0.0)),
        _item("mid", (0.0, 12.0, 0.0)),
    ]
    assert group_sightings(items, 0.75) == [["high"], ["mid"], ["low"], ["loose"]]


def test_the_distance_is_inclusive_and_three_dimensional():
    items = [_item("a", (0.0, 0.0, 0.0)), _item("b", (0.0, 0.0, 0.75)), _item("c", (0.0, 0.76, 0.75))]
    assert group_sightings(items, 0.75) == [["c"], ["a", "b"]]


@pytest.mark.parametrize("bad", [0.0, -1.0, math.inf, math.nan])
def test_cluster_m_must_be_a_positive_number(bad):
    with pytest.raises(ValueError):
        group_sightings([_item("a", (0.0, 0.0, 0.0))], bad)


def _brute(items: list[GroupItem], cluster_m: float) -> set[frozenset[str]]:
    parent = list(range(len(items)))

    def find(i: int) -> int:
        while parent[i] != i:
            i = parent[i]
        return i

    for i, a in enumerate(items):
        for j in range(i + 1, len(items)):
            b = items[j]
            if a.type_id != b.type_id:
                continue
            near = (
                a.center is not None and b.center is not None and math.dist(a.center, b.center) <= cluster_m
            )
            tagged = a.group_tag is not None and a.group_tag == b.group_tag
            if near or tagged:
                parent[find(j)] = find(i)
    groups: dict[int, set[str]] = {}
    for i, it in enumerate(items):
        groups.setdefault(find(i), set()).add(it.id)
    return {frozenset(g) for g in groups.values()}


def test_the_spatial_hash_matches_brute_force():
    rng = random.Random(7)
    items = []
    for i in range(400):
        center = None if rng.random() < 0.1 else tuple(rng.uniform(-10.0, 10.0) for _ in range(3))
        tag = f"T{rng.randrange(5)}" if rng.random() < 0.05 else None
        items.append(_item(f"s{i:03d}", center, type_id=rng.choice(["crack", "rust"]), tag=tag))
    got = {frozenset(g) for g in group_sightings(items, 1.3)}
    assert got == _brute(items, 1.3)
