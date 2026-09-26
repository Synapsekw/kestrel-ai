import pytest

from app.datasets.splits import assign_splits

FLIGHTS = {"0031": 6, "0033": 3}


def _pairs(sizes: dict[str, int]) -> list[tuple[str, str]]:
    return [(f"{key}-{i}", key) for key, size in sizes.items() for i in range(size)]


def test_assign_splits_keeps_groups_whole():
    items = _pairs({"a": 6, "b": 3, "c": 1})
    got = assign_splits(items, "by_group", 0.2, 42)
    by_group: dict[str, set[str]] = {}
    for image_id, key in items:
        by_group.setdefault(key, set()).add(got[image_id])
    assert all(len(splits) == 1 for splits in by_group.values()), by_group


def test_assign_splits_reaches_the_val_fraction_within_one_group():
    items = _pairs({"a": 6, "b": 3, "c": 1})  # 10 images, target 2 -> smallest groups first
    got = assign_splits(items, "by_group", 0.2, 42)
    val = [i for i, s in got.items() if s == "val"]
    assert len(val) == 4  # groups c (1) and b (3): the first that reaches the target
    assert {i.split("-")[0] for i in val} == {"b", "c"}


def test_assign_splits_is_deterministic_for_a_seed():
    items = _pairs({"a": 2, "b": 2, "c": 2, "d": 2, "e": 2})
    first = assign_splits(items, "by_group", 0.2, 7)
    assert first == assign_splits(items, "by_group", 0.2, 7)
    assert sum(1 for s in first.values() if s == "val") == 2  # five equal groups, the seed breaks the tie


def test_assign_splits_random_hits_the_exact_count():
    items = _pairs({"a": 10})
    got = assign_splits(items, "random", 0.3, 1)
    assert sum(1 for s in got.values() if s == "val") == 3
    assert got == assign_splits(items, "random", 0.3, 1)


def test_assign_splits_falls_back_to_random_for_a_single_group():
    items = _pairs({"only": 10})
    got = assign_splits(items, "by_group", 0.2, 42)
    assert sum(1 for s in got.values() if s == "val") == 2


def test_assign_splits_always_keeps_a_train_image():
    got = assign_splits(_pairs({"a": 1, "b": 1}), "by_group", 0.5, 42)
    assert sorted(got.values()) == ["train", "val"]
    assert assign_splits([("only", "g")], "by_group", 0.5, 42) == {"only": "train"}
    assert assign_splits([], "by_group", 0.2, 42) == {}


def test_place_refuses_to_overwrite_an_existing_file(tmp_path):
    from app.datasets.materialise import _place

    src, dest = tmp_path / "a.jpg", tmp_path / "b.jpg"
    src.write_bytes(b"x")
    dest.write_bytes(b"y")
    with pytest.raises(FileExistsError):
        _place(src, dest)
