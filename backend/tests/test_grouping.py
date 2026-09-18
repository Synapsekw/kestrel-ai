from app.datasets.grouping import find_duplicates, group_key, slugify, tile_key

RX = r"^(?P<camera>[A-Za-z0-9-]+)_(?P<flight>\d+)_(?P<frame>\d+)"


def test_find_duplicates_keeps_earliest():
    dups = find_duplicates(
        [
            ("a", "0000000000000000"),
            ("b", "0000000000000001"),
            ("c", "ffffffffffffffff"),
            ("d", "0000000000000003"),
        ],
        4,
    )
    assert dups == {"b": ("a", 1), "d": ("a", 2)}


def test_find_duplicates_ignores_items_beyond_the_threshold():
    assert find_duplicates([("a", "0000000000000000"), ("b", "000000000000001f")], 4) == {}


def test_find_duplicates_skips_items_without_a_hash():
    assert find_duplicates([("a", ""), ("b", "0000000000000000")], 4) == {}


def test_group_key_uses_flight_number():
    # One flight spans two cameras, so the camera must not be part of the key.
    assert group_key("IX-12-02491_0031_0001.jpg", RX, None, None, "ahmadia") == "0031"
    assert group_key("IX-12-65292_0031_0009.jpg", RX, None, None, "ahmadia") == "0031"


def test_group_key_falls_back_to_tile_then_site():
    assert group_key("DJI_0001.JPG", RX, 29.49469, 47.76513, "ahmadia") == tile_key(29.49469, 47.76513)
    assert group_key("DJI_0001.JPG", RX, None, None, "ahmadia") == "ahmadia"
    assert group_key("x.jpg", "([", None, None, "site") == "site"  # bad regex -> no match


def test_group_key_uses_the_whole_match_without_a_flight_group():
    assert group_key("flightA_0001.jpg", r"^[A-Za-z]+", None, None, "site") == "flightA"


def test_tile_key_changes_every_250m():
    a = tile_key(29.5, 47.7)
    assert tile_key(29.5, 47.7 + 0.001) == a  # ~97 m east, same tile
    assert tile_key(29.5, 47.7 + 0.01) != a  # ~970 m east


def test_slugify_makes_a_site_name():
    assert slugify("Ahmadia Construction Data") == "ahmadia_construction_data"
    assert slugify("--Site 7--") == "site_7"
