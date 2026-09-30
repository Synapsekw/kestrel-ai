"""R3: dispatch, keys, the two render slots and the cache (spec §9.1, §9.5, §17): byte-identical
output, the key changing with the source mtime, placeholders never cached under a key."""

import os
import threading
from types import SimpleNamespace

import pytest
from PIL import Image as PILImage
from report_snapshot_helpers import add_image, image_crop_spec, ns

from app.reports import snapshots
from app.reports.snapshots import cache as cache_module
from app.reports.snapshots import render
from app.reports.snapshots.cache import cache_dir, cached_path, encode_jpeg, placeholder_path
from app.reports.snapshots.image_crop import ring_of
from app.reports.snapshots.keys import snapshot_key
from app.reports.snapshots.render import (
    RENDER_SLOTS,
    RENDERERS,
    Renderer,
    check_limits,
    compute_key,
    output_size,
    render_result,
    render_to_cache,
)


def _crop(handle, name="a.jpg"):
    image_id = add_image(handle, name, (2000, 1500))
    return image_crop_spec(image_id, ring_of("box", 900, 700, 200, 100), label="F-0001 · Crack")


def test_the_same_spec_renders_byte_identical_jpeg(handle):
    spec = _crop(handle)
    first = render_to_cache(handle, spec).read_bytes()
    for p in cache_dir(handle).glob("*.jpg"):
        p.unlink()
    again = render_to_cache(handle, spec)
    assert again.read_bytes() == first
    assert again == cached_path(handle, compute_key(handle, spec)[0])


def test_the_key_changes_when_the_source_mtime_changes(handle):
    spec = _crop(handle)
    key = snapshot_key(handle, spec)
    path = handle.folder / "images" / "a.jpg"
    st = path.stat()
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 2_000_000_000))
    assert snapshot_key(handle, spec) != key


def test_the_package_level_render_to_cache_is_the_same_function(handle):
    spec = _crop(handle)
    assert snapshots.render_to_cache(handle, spec) == render_to_cache(handle, spec)


def test_a_missing_source_is_a_placeholder_never_cached_under_the_key(handle):
    spec = _crop(handle)
    path = handle.folder / "images" / "a.jpg"
    kept = path.read_bytes()
    path.unlink()
    result = render_result(handle, spec)
    assert result.missing_reason == "The image file is missing"
    assert result.path.name.startswith("ph-") and result.path.is_file()
    assert not cached_path(handle, result.key).exists()
    path.write_bytes(kept)
    back = render_result(handle, spec)
    assert back.missing_reason is None and back.key != result.key
    assert back.path == cached_path(handle, back.key)


def test_a_renderer_crash_is_a_placeholder_not_an_exception(handle, monkeypatch):
    def boom(h, s):
        raise RuntimeError("disk on fire")

    monkeypatch.setitem(RENDERERS, "volume_plan", Renderer(lambda h, s: "v1", boom))
    result = render_result(handle, ns(kind="volume_plan", measurement_id="m"))
    assert result.missing_reason == render.UNKNOWN_FAILURE and result.path.is_file()


def test_a_lookup_error_is_a_placeholder_with_its_reason(handle, monkeypatch):
    def gone(h, s):
        raise LookupError("The photo was removed from the finding")

    monkeypatch.setitem(RENDERERS, "attachment", Renderer(lambda h, s: "v1", gone))
    spec = ns(kind="attachment", finding_id="f", attachment_id="a", out=[480, 360])
    result = render_result(handle, spec)
    assert result.missing_reason == "The photo was removed from the finding"
    with PILImage.open(result.path) as im:
        assert im.size == (480, 360)


def test_a_renderer_module_may_set_its_own_jpeg_quality(tmp_path, monkeypatch):
    img = PILImage.new("RGB", (1600, 1000), (40, 90, 160))
    fake = SimpleNamespace(source_version=lambda h, s: "v1", render=lambda h, s: img, JPEG_QUALITY=88)
    monkeypatch.setitem(RENDERERS, "view3d", fake)
    spec = ns(kind="view3d", subject_kind="finding", subject_id="f", cloud_id="c")
    path = render_to_cache(SimpleNamespace(folder=tmp_path), spec)
    assert path.read_bytes() == encode_jpeg(img, 88) != encode_jpeg(img)


def test_no_more_than_two_renders_run_at_once(tmp_path, monkeypatch):
    entered, release = threading.Semaphore(0), threading.Event()

    def slow(h, s):
        entered.release()
        release.wait(10)
        return PILImage.new("RGB", (1200, 900), (1, 2, 3))

    monkeypatch.setitem(RENDERERS, "volume_plan", Renderer(lambda h, s: f"v-{s.measurement_id}", slow))
    h = SimpleNamespace(folder=tmp_path)
    threads = [
        threading.Thread(target=render_result, args=(h, ns(kind="volume_plan", measurement_id=str(i))))
        for i in range(3)
    ]
    for t in threads:
        t.start()
    assert entered.acquire(timeout=10) and entered.acquire(timeout=10)
    assert RENDER_SLOTS.acquire(blocking=False) is False  # both slots held; the third waits
    release.set()
    for t in threads:
        t.join(10)
    assert entered.acquire(timeout=1)  # the third ran once a slot freed
    assert len(list(cache_dir(h).glob("*.jpg"))) == 3


def test_the_first_miss_prunes_the_cache(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(render, "_misses", 0)
    monkeypatch.setattr(render.cache, "prune", lambda h, *a, **k: calls.append(h) or 0)
    monkeypatch.setitem(
        RENDERERS, "volume_plan", Renderer(lambda h, s: "v", lambda h, s: PILImage.new("RGB", (1200, 900)))
    )
    render_result(SimpleNamespace(folder=tmp_path), ns(kind="volume_plan", measurement_id="m"))
    assert len(calls) == 1


def test_a_cache_write_failure_is_a_placeholder_not_an_exception(tmp_path, monkeypatch):
    """Amendment A13: render_result never raises for cache I/O. The real snapshot write fails
    (a full or locked cache disk); the placeholder write (a different, "ph-" prefixed path) still
    succeeds, so the caller gets a viewable placeholder instead of an unhandled OSError."""
    real_write_jpeg = cache_module.write_jpeg

    def flaky(img, path, quality=cache_module.JPEG_QUALITY):
        if not path.name.startswith("ph-"):
            raise OSError("disk full")
        return real_write_jpeg(img, path, quality)

    monkeypatch.setattr(cache_module, "write_jpeg", flaky)
    monkeypatch.setitem(
        RENDERERS, "volume_plan", Renderer(lambda h, s: "v", lambda h, s: PILImage.new("RGB", (1200, 900)))
    )
    result = render_result(SimpleNamespace(folder=tmp_path), ns(kind="volume_plan", measurement_id="m"))
    assert result.missing_reason == render.UNKNOWN_FAILURE
    assert result.path.name.startswith("ph-") and result.path.is_file()


def test_placeholder_path_returns_the_file_if_it_now_exists_after_a_failed_write(tmp_path, monkeypatch):
    """Amendment A13: cache.placeholder_path catches OSError on write; if the file now exists (a
    concurrent writer got there first) it returns that file rather than raising."""
    h = SimpleNamespace(folder=tmp_path)

    def racy_but_written(img, path, quality=cache_module.JPEG_QUALITY):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"written by someone else")
        raise OSError("reported failure after the bytes landed")

    monkeypatch.setattr(cache_module, "write_jpeg", racy_but_written)
    path = placeholder_path(h, "a reason", (400, 300))
    assert path.is_file() and path.read_bytes() == b"written by someone else"


def test_placeholder_path_retries_once_to_a_unique_name_on_write_failure(tmp_path, monkeypatch):
    """Amendment A13: a write failure that leaves no file behind is retried once to a private
    unique name."""
    h = SimpleNamespace(folder=tmp_path)
    real_write_jpeg = cache_module.write_jpeg
    calls = {"n": 0}

    def fails_once(img, path, quality=cache_module.JPEG_QUALITY):
        calls["n"] += 1
        if calls["n"] == 1:
            raise OSError("disk full")
        return real_write_jpeg(img, path, quality)

    monkeypatch.setattr(cache_module, "write_jpeg", fails_once)
    path = placeholder_path(h, "a reason", (400, 300))
    assert calls["n"] == 2
    assert path.is_file() and path.name.startswith("ph-")


def test_placeholder_path_reraises_when_nothing_can_be_written(tmp_path, monkeypatch):
    """Amendment A13: re-raise only if nothing can be written (the retry also fails)."""
    h = SimpleNamespace(folder=tmp_path)

    def always_fails(img, path, quality=cache_module.JPEG_QUALITY):
        raise OSError("disk full")

    monkeypatch.setattr(cache_module, "write_jpeg", always_fails)
    with pytest.raises(OSError):
        placeholder_path(h, "a reason", (400, 300))


def test_output_sizes_are_known_before_rendering():
    assert output_size(image_crop_spec("i", [[1.0, 1.0]], out=[800, 600])) == (800, 600)
    assert output_size(ns(kind="volume_plan", measurement_id="m")) == (1200, 900)
    view3d_spec = ns(kind="view3d", subject_kind="finding", subject_id="f", cloud_id="c")
    assert output_size(view3d_spec) == (1600, 1000)
    pair = ns(kind="pair", a=ns(kind="map", out=[1000, 750]), b=ns(kind="map", out=[1000, 750]))
    assert output_size(pair) == (1000, 750)


@pytest.mark.parametrize(
    "spec",
    [
        image_crop_spec("i", [[1.0, 1.0]], out=[99999, 900]),
        image_crop_spec("i", [[1.0, 1.0]], context=1000.0),
        image_crop_spec("i", []),
        ns(
            kind="map",
            item_id="m",
            geometry={"type": "MultiPoint", "coordinates": [[0, 0]]},
            out=[1200, 900],
        ),
        ns(
            kind="pair",
            a=ns(kind="map", item_id="a"),
            b=ns(kind="volume_plan", measurement_id="v"),
            split=0.5,
        ),
        ns(kind="pair", a=ns(kind="map", item_id="a"), b=ns(kind="map", item_id="b"), split=1.5),
        ns(kind="nope"),
    ],
    ids=[
        "out-sides-too-large",
        "context-too-large",
        "empty-ring",
        "unsupported-geometry-type",
        "pair-part-not-map-or-elevation",
        "split-out-of-range",
        "unknown-kind",
    ],
)
def test_limits_refuse_absurd_specs(spec):
    with pytest.raises(ValueError):
        check_limits(spec)


@pytest.mark.parametrize(
    "spec",
    [
        image_crop_spec("i", [[1.0, 1.0]], context=0.5),
        image_crop_spec("i", [[1.0, 1.0]] * 4097),
        ns(kind="map", item_id="m", geometry=None, out=[1200, 900], min_extent_m=0.5),
        ns(kind="pair", a=ns(kind="map", item_id="a"), b=ns(kind="map", item_id="b"), split=0.04),
        ns(kind="pair", a=ns(kind="map", item_id="a"), b=ns(kind="map", item_id="b"), split=0.96),
    ],
    ids=[
        "context-below-1",
        "ring-over-4096-vertices",
        "min-extent-m-below-1",
        "split-below-0.05",
        "split-above-0.95",
    ],
)
def test_limits_enforce_r0s_exact_bounds(spec):
    """Amendment A2: check_limits aligns to R0's models (context 1-10, 1-4096 vertices,
    0.05<=split<=0.95, min_extent_m>=1)."""
    with pytest.raises(ValueError):
        check_limits(spec)


@pytest.mark.parametrize(
    "spec",
    [
        image_crop_spec("i", [[1.0, 1.0]], context=1.0),
        image_crop_spec("i", [[1.0, 1.0]], context=10.0),
        image_crop_spec("i", [[1.0, 1.0]] * 4096),
        ns(kind="map", item_id="m", geometry=None, out=[1200, 900], min_extent_m=1.0),
        ns(kind="pair", a=ns(kind="map", item_id="a"), b=ns(kind="map", item_id="b"), split=0.05),
        ns(kind="pair", a=ns(kind="map", item_id="a"), b=ns(kind="map", item_id="b"), split=0.95),
    ],
    ids=[
        "context-at-1",
        "context-at-10",
        "ring-at-4096-vertices",
        "min-extent-m-at-1",
        "split-at-0.05",
        "split-at-0.95",
    ],
)
def test_limits_accept_r0s_exact_boundaries(spec):
    check_limits(spec)  # must not raise
