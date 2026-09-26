"""JSON rekeying for step 2 (spec §11.4): counts follow their class, and merged classes sum."""

from app.migration.rekey import rekey_area_counts, rekey_counts, remap_classes, remap_values

M = {"old-a": "new-a", "old-b": "new-b", "old-b2": "new-b"}


def test_counts_follow_their_class_and_merge_when_two_classes_became_one():
    got = rekey_counts({"old-a": 3, "old-b": 1, "old-b2": 2, "gone": 4}, M)
    assert got == {"new-a": 3, "new-b": 3, "gone": 4}


def test_area_counts_sum_each_field():
    area = {
        "area1": {"old-b": {"total": 1, "verified": 0}, "old-b2": {"total": 2, "verified": 2}},
        "area2": {},
    }
    assert rekey_area_counts(area, M) == {"area1": {"new-b": {"total": 3, "verified": 2}}, "area2": {}}


def test_class_map_values_follow_and_ignored_classes_stay_ignored():
    assert remap_values({"truck": "old-b", "bird": None, "x": "gone"}, M) == {
        "truck": "new-b",
        "bird": None,
        "x": "gone",
    }


def test_dataset_classes_keep_their_names_and_order():
    classes = [
        {"id": "old-a", "name": "excavator", "order": 0},
        {"id": "old-b", "name": "dump_truck", "order": 1},
    ]
    assert remap_classes(classes, M) == [
        {"id": "new-a", "name": "excavator", "order": 0},
        {"id": "new-b", "name": "dump_truck", "order": 1},
    ]


def test_rekeying_twice_changes_nothing_and_null_reads_as_empty():
    once = rekey_counts({"old-a": 1}, M)
    assert rekey_counts(once, M) == once
    assert rekey_counts(None, M) == {} and rekey_area_counts(None, M) == {}
    assert remap_values(None, M) == {} and remap_classes(None, M) == []
