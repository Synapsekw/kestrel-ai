"""Matching kit photos to project images (spec §6.5 step 2): nothing is guessed."""

from datetime import UTC, datetime

from app.asset_review.kit_format import KitPhoto
from app.asset_review.kit_match import Candidate, match_photos


def cand(image_id, name, *, w=4000, h=3000, time="2024:06:05 08:00:00", orig=True):
    t = datetime.strptime(time, "%Y:%m:%d %H:%M:%S").replace(tzinfo=UTC)
    return Candidate(image_id, name, w // 2, h // 2, w if orig else None, h if orig else None, t)


def kp(kit_id, source_name, *, w=4000, h=3000, time="2024:06:05 09:00:00"):
    return KitPhoto(
        id=kit_id, name=source_name.rsplit("/", 1)[-1], source_name=source_name, width=w, height=h, time=time
    )


def test_path_then_suffix_then_name_then_time_and_size():
    photos = [
        kp("a", "flight-a/DJI_0001.JPG"),
        kp("b", "p1 50mm/flight-a/DJI_0002.JPG"),
        kp("c", "x/DJI_0003.JPG"),
        kp("d", "renamed.JPG", time="2024:06:05 08:30:00"),
    ]
    cands = [
        cand("i1", "Flight-A\\DJI_0001.jpg"),  # case and slashes do not matter
        cand("i2", "flight-a/DJI_0002.JPG"),
        cand("i3", "y/DJI_0003.JPG"),
        cand("i4", "IMG_0004.JPG", time="2024:06:05 08:30:00"),
    ]
    r = match_photos(photos, cands)
    assert {k: (m.image_id, m.by) for k, m in r.matched.items()} == {
        "a": ("i1", "path"),
        "b": ("i2", "suffix"),
        "c": ("i3", "name"),
        "d": ("i4", "time_size"),
    }
    assert r.unmatched == []
    assert (r.matched["a"].width, r.matched["a"].height) == (2000, 1500)


def test_two_images_with_one_name_fall_back_to_time_and_size():
    photos = [kp("p001", "1 (1).JPG", time="2019:01:24 11:45:58")]
    cands = [
        cand("i1", "GEOTAGED/1 (1).JPG", time="2019:01:24 11:45:58"),
        cand("i2", "OTHER/1 (1).JPG", time="2019:01:24 12:00:00"),
    ]
    r = match_photos(photos, cands)
    assert r.matched["p001"].image_id == "i1" and r.matched["p001"].by == "time_size"


def test_ambiguous_is_unmatched_not_guessed():
    photos = [kp("p001", "1 (1).JPG", time="2019:01:24 11:45:58")]
    cands = [
        cand("i1", "a/1 (1).JPG", time="2019:01:24 11:45:58"),
        cand("i2", "b/1 (1).JPG", time="2019:01:24 11:45:58"),
    ]
    r = match_photos(photos, cands)
    assert r.matched == {}
    assert r.unmatched == [{"kit_id": "p001", "source_name": "1 (1).JPG", "reason": "ambiguous"}]


def test_size_must_agree_for_the_time_fallback():
    photos = [kp("d", "renamed.JPG", w=5184, h=3888, time="2024:06:05 08:30:00")]
    r = match_photos(photos, [cand("i4", "IMG_0004.JPG", time="2024:06:05 08:30:00")])
    assert r.unmatched[0]["reason"] == "not_found"


def test_an_image_is_claimed_once():
    photos = [kp("a", "flight-a/DJI_0001.JPG"), kp("a2", "other/DJI_0001.JPG")]
    r = match_photos(photos, [cand("i1", "flight-a/DJI_0001.JPG")])
    assert r.matched["a"].image_id == "i1"
    assert r.unmatched == [{"kit_id": "a2", "source_name": "other/DJI_0001.JPG", "reason": "duplicate"}]


def test_without_original_size_the_aspect_decides():
    photos = [kp("d", "renamed.JPG", time="2024:06:05 08:30:00")]
    r = match_photos(photos, [cand("i4", "IMG_0004.JPG", time="2024:06:05 08:30:00", orig=False)])
    assert r.matched["d"].by == "time_size"
