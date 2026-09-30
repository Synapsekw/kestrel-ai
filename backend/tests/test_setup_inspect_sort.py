"""S1-U3 sort (spec §7.2-§7.3, §12 "The inspect job"): the 20-per-folder header sample (counted),
the bucket grouping by (route, match, folder), the caps, slot assignment and the suggestion."""

import pytest
from imagery_camera_helpers import dji_jpeg
from setup_inspect_helpers import DSM, ORTHO, THERMAL_XMP, CountingReader, dji_names, touch_files

from app.jobs.cancellation import JobCancelled
from app.setup import inspect_job, schemas
from app.setup.builtins import BUILTIN_TEMPLATES
from app.setup.classify import ImageMeta, RealHeaderReader
from app.setup.inspect_job import assign_slots, dump_result, inspect_paths, suggest_template
from app.setup.schemas import InspectBucket, InspectResult, SlotMatch


def run(paths, reader, **kw) -> InspectResult:
    return inspect_paths(
        [str(p) for p in paths], reader, check_cancelled=lambda: None, progress=lambda *a: None, **kw
    )


def by_key(result: InspectResult) -> dict:
    return {(b.route, b.match.thermal, b.match.raster, b.folder): b for b in result.buckets}


def test_3000_dji_jpegs_open_only_20_headers(tmp_path):
    """Review focus 1: one DCIM folder, 2,000 visual and 1,000 thermal frames."""
    dcim = tmp_path / "DCIM" / "100MEDIA"
    touch_files(dcim, dji_names(2000, "V") + dji_names(1000, "T", start=5001))
    reader = CountingReader()
    result = run([tmp_path], reader)
    assert reader.calls == {"image_meta": 20}
    buckets = by_key(result)
    visual, thermal = buckets[("images", False, None, str(dcim))], buckets[("images", True, None, str(dcim))]
    assert (visual.count, thermal.count) == (2000, 1000)
    assert visual.files == [] and thermal.files == []  # images import by folder
    assert len(visual.samples) == inspect_job.MAX_SAMPLES
    assert result.not_recognised.count == 0 and result.truncated is False


def test_the_header_sample_is_per_folder(tmp_path):
    a, b = tmp_path / "A", tmp_path / "B"
    touch_files(a, dji_names(30, "V"))
    touch_files(b, dji_names(30, "V"))
    reader = CountingReader()
    run([tmp_path], reader)
    assert (reader.reads_in(a), reader.reads_in(b)) == (20, 20)


def test_unnamed_photos_beyond_the_sample_follow_the_folder_majority(tmp_path):
    """Renamed thermal frames (no `_T`): the 20 sampled say thermal, so the other 5 are thermal too."""
    folder = tmp_path / "thermal_renamed"
    touch_files(folder, [f"IMG_{i:04d}.JPG" for i in range(25)])
    reader = CountingReader(image=ImageMeta(thermal=True))
    result = run([folder], reader)
    assert reader.calls == {"image_meta": 20}
    assert [(b.match.thermal, b.count) for b in result.buckets] == [(True, 25)]


def test_real_reader_opens_only_20_of_30_photos(tmp_path):
    """The same bound through RealHeaderReader: a spy counts the real header reads."""
    folder = tmp_path / "DCIM"
    for name in dji_names(30, "T"):
        dji_jpeg(folder / name, size=(16, 12), xmp=THERMAL_XMP)
    real, opened = RealHeaderReader(), []

    class Spy:
        def __getattr__(self, method):
            def call(path):
                opened.append((method, path.name))
                return getattr(real, method)(path)

            return call

    result = run([folder], Spy())
    assert len(opened) == 20 and {m for m, _ in opened} == {"image_meta"}
    assert [(b.match.thermal, b.count) for b in result.buckets] == [(True, 30)]


def test_visual_and_thermal_in_one_folder_are_two_buckets_of_that_folder(tmp_path):
    """Index ruling S-R4: two buckets with the same `folder`; U6 imports the folder once."""
    folder = tmp_path / "100MEDIA"
    touch_files(folder, dji_names(3, "V"), content=b"x" * 10)
    touch_files(folder, dji_names(2, "T", start=11), content=b"x" * 7)
    result = run([folder], CountingReader())
    got = sorted((b.route, b.match.thermal, b.folder, b.count, b.bytes) for b in result.buckets)
    assert got == [("images", False, str(folder), 3, 30), ("images", True, str(folder), 2, 14)]


def test_rasters_group_by_route_and_folder_and_list_their_files(tmp_path):
    maps, other = tmp_path / "maps", tmp_path / "older"
    touch_files(maps, ["ortho_a.tif", "ortho_b.tif", "dsm.tif"])
    touch_files(other, ["ortho_2025.tif"])
    reader = CountingReader(raster=lambda p: DSM if "dsm" in p.name else ORTHO)
    result = run([tmp_path], reader)
    buckets = by_key(result)
    ortho = buckets[("map", None, "ortho", str(maps))]
    assert ortho.files == [str(maps / "ortho_a.tif"), str(maps / "ortho_b.tif")]
    assert ortho.crs == "EPSG:32633" and ortho.match == SlotMatch(raster="ortho")
    assert buckets[("elevation", None, "elevation", str(maps))].files == [str(maps / "dsm.tif")]
    assert buckets[("map", None, "ortho", str(other))].count == 1
    assert reader.calls == {"raster": 4}  # one header per GeoTIFF


def test_samples_and_files_are_capped_at_200(tmp_path):
    touch_files(tmp_path, [f"scan_{i:03d}.las" for i in range(250)])
    reader = CountingReader()
    [bucket] = run([tmp_path], reader).buckets
    assert (bucket.route, bucket.count, len(bucket.samples), len(bucket.files)) == (
        "pointcloud",
        250,
        200,
        200,
    )
    assert reader.calls == {"las": 250}


def test_not_recognised_keeps_the_count_and_50_samples(tmp_path):
    touch_files(tmp_path, [f"junk_{i:03d}.bin" for i in range(70)] + ["Thumbs.db"])
    result = run([tmp_path], CountingReader())
    assert result.buckets == []
    assert (result.not_recognised.count, len(result.not_recognised.samples)) == (71, 50)
    assert result.not_recognised.samples[0].reason == "unknown type"


def test_a_header_that_fails_is_not_recognised_and_the_rest_continues(tmp_path):
    touch_files(tmp_path, ["a.tif", "b.tif", "c.tif"])
    result = run([tmp_path], CountingReader(fail=("b.tif",)))
    assert [b.count for b in result.buckets] == [2]
    assert [(s.name, s.reason) for s in result.not_recognised.samples] == [("b.tif", "could not read header")]


def test_a_single_file_path_is_sorted_alone(tmp_path):
    """Review focus 3 end to end: the sibling photo is not sorted."""
    touch_files(tmp_path, ["ortho.tif", "DJI_0001_V.JPG"])
    reader = CountingReader()
    result = run([tmp_path / "ortho.tif"], reader)
    [bucket] = result.buckets
    assert (bucket.route, bucket.folder, bucket.files, bucket.count) == (
        "map",
        str(tmp_path),
        [str(tmp_path / "ortho.tif")],
        1,
    )
    assert reader.calls == {"raster": 1}


def test_a_truncated_walk_says_so_in_the_result(tmp_path, monkeypatch):
    monkeypatch.setattr(inspect_job, "MAX_FILES", 10)
    touch_files(tmp_path, [f"{i:02d}.las" for i in range(15)])
    result = run([tmp_path], CountingReader())
    assert result.truncated is True and result.buckets[0].count == 10


def test_cancel_stops_the_sort(tmp_path):
    touch_files(tmp_path, [f"{i:02d}.tif" for i in range(10)])
    reader, calls = CountingReader(), []

    def check():
        calls.append(1)
        if len(calls) > 4:
            raise JobCancelled()

    with pytest.raises(JobCancelled):
        inspect_paths([str(tmp_path)], reader, check_cancelled=check, progress=lambda *a: None)
    assert reader.calls["raster"] < 10


def test_progress_is_monotonic_and_ends_at_one(tmp_path, monkeypatch):
    monkeypatch.setattr(inspect_job, "PROGRESS_INTERVAL_S", 0)
    touch_files(tmp_path / "a", dji_names(5, "V"))
    touch_files(tmp_path / "b", ["x.tif", "y.las"])
    seen = []
    inspect_paths(
        [str(tmp_path)],
        CountingReader(),
        check_cancelled=lambda: None,
        progress=lambda f, m: seen.append((f, m)),
    )
    values = [f for f, _ in seen]
    assert values == sorted(values) and values[-1] == 1.0
    assert any(m.startswith("Listing folders") for _, m in seen)
    assert any(m.startswith("Reading headers") for _, m in seen)
    assert seen[-1][1] == "Sorted 7 files into 3 group(s)"


def test_progress_is_throttled(tmp_path, monkeypatch):
    monkeypatch.setattr(inspect_job, "PROGRESS_INTERVAL_S", 3600)
    touch_files(tmp_path, dji_names(300, "V"))
    seen = []
    inspect_paths(
        [str(tmp_path)], CountingReader(), check_cancelled=lambda: None, progress=lambda f, m: seen.append(f)
    )
    assert len(seen) <= 2 and seen[-1] == 1.0


# ------------------------------------------------------------------------ slots and the suggestion


def bucket(route: str, folder: str = "E:\\d", **match) -> InspectBucket:
    return InspectBucket(
        route=route,
        match=SlotMatch(**match),
        slot_key=None,
        folder=folder,
        files=[],
        count=1,
        bytes=1,
        samples=[],
        crs=None,
    )


def slot(key: str, route: str, match: dict | None = None, required: bool = False) -> dict:
    return {
        "key": key,
        "label": key.title(),
        "route": route,
        "required": required,
        "accepts": ["x"],
        "match": match,
    }


def config(*slots: dict) -> dict:
    return {"config_version": 1, "slots": list(slots), "types": []}


VERTICAL = config(
    slot("visual", "images", None, required=True),
    slot("thermal", "images", {"thermal": True}),
    slot("cloud", "pointcloud"),
)


def test_assign_slots_most_specific_wins_whatever_the_slot_order():
    buckets = [bucket("images", thermal=True), bucket("images", thermal=False), bucket("pointcloud")]
    for cfg in (VERTICAL, config(*reversed(VERTICAL["slots"]))):
        assert [b.slot_key for b in assign_slots(buckets, cfg)] == ["thermal", "visual", "cloud"]


def test_assign_slots_without_a_thermal_slot_puts_thermal_with_the_photos():
    cfg = config(slot("raw", "images"), slot("ortho", "map", {"raster": "ortho"}))
    got = assign_slots(
        [
            bucket("images", thermal=True),
            bucket("map", raster="ortho"),
            bucket("elevation", raster="elevation"),
        ],
        cfg,
    )
    assert [b.slot_key for b in got] == ["raw", "ortho", None]  # nothing takes elevation


def test_a_slot_asking_for_thermal_false_takes_a_bucket_that_does_not_say():
    got = assign_slots([bucket("images")], config(slot("visual", "images", {"thermal": False})))
    assert got[0].slot_key == "visual"


def test_assign_slots_with_an_invalid_config_assigns_nothing():
    assert assign_slots([bucket("images", thermal=False)], {"slots": "nonsense"})[0].slot_key is None


def test_suggest_prefers_filled_required_slots_then_filled_slots_then_order():
    mapping = {
        "id": "m",
        "config": config(slot("ortho", "map", {"raster": "ortho"}, True), slot("raw", "images")),
    }
    vertical = {"id": "v", "config": VERTICAL}
    confined = {"id": "c", "config": config(slot("stills", "images", None, True))}
    photos = [bucket("images", thermal=False), bucket("images", thermal=True)]
    assert suggest_template(photos, [mapping, vertical, confined]) == "v"  # (1, 2) beats c's (1, 1)
    assert suggest_template(photos[:1], [mapping, confined, vertical]) == "c"  # (1, 1) tie: order
    assert suggest_template([bucket("map", raster="ortho")], [vertical, mapping]) == "m"
    assert suggest_template([bucket("drawing")], [mapping, vertical]) is None


def test_the_builtins_suggest_mapping_for_an_ortho_and_vertical_for_photo_pairs():
    ortho_dsm = [bucket("map", raster="ortho"), bucket("elevation", raster="elevation")]
    pairs = [bucket("images", thermal=False), bucket("images", thermal=True)]
    assert suggest_template(ortho_dsm, BUILTIN_TEMPLATES) == "builtin-mapping"
    assert suggest_template(pairs, BUILTIN_TEMPLATES) == "builtin-vertical"


def test_inspect_paths_assigns_slots_when_given_a_config(tmp_path):
    touch_files(tmp_path, dji_names(2, "V") + dji_names(2, "T", start=3) + ["scan.las"])
    result = run([tmp_path], CountingReader(), template_config=VERTICAL)
    assert sorted(b.slot_key for b in result.buckets) == ["cloud", "thermal", "visual"]
    assert result.suggested_template_id == "builtin-vertical"


def test_dump_result_is_json_and_a_match_names_only_its_keys(tmp_path):
    touch_files(tmp_path, dji_names(1, "V") + ["ortho.tif", "scan.las"])
    data = dump_result(run([tmp_path], CountingReader()))
    assert sorted(tuple(sorted(b["match"].items())) for b in data["buckets"]) == [
        (),
        (("raster", "ortho"),),
        (("thermal", False),),
    ]
    assert InspectResult.model_validate(data).truncated is False
    assert set(data) == {"buckets", "not_recognised", "suggested_template_id", "truncated"}


# ------------------------------------------------------------------------------------- bucket cap


def test_more_than_max_buckets_keeps_the_first_in_walk_order_and_says_so(tmp_path, monkeypatch):
    monkeypatch.setattr(inspect_job, "MAX_BUCKETS", 2)
    for name in ("a", "b", "c"):
        touch_files(tmp_path / name, ["scan.las"])
    result = run([tmp_path], CountingReader())
    assert [b.folder for b in result.buckets] == [str(tmp_path / "a"), str(tmp_path / "b")]
    assert result.truncated is True


def test_exactly_max_buckets_is_not_truncated(tmp_path, monkeypatch):
    monkeypatch.setattr(inspect_job, "MAX_BUCKETS", 2)
    for name in ("a", "b"):
        touch_files(tmp_path / name, ["scan.las"])
    result = run([tmp_path], CountingReader())
    assert len(result.buckets) == 2 and result.truncated is False


def test_the_local_caps_equal_the_schema_caps():
    assert inspect_job.MAX_BUCKETS == schemas.MAX_INSPECT_BUCKETS
    assert inspect_job.MAX_SAMPLES == schemas.MAX_BUCKET_FILES == schemas.MAX_BUCKET_SAMPLES
    assert inspect_job.MAX_NOT_RECOGNISED == schemas.MAX_NOT_RECOGNISED_SAMPLES
