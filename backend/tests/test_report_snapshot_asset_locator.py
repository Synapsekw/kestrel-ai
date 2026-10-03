"""asset_locator snapshots (spec 2026-10-02-asset-findings §10, decision A9)."""

import struct

import numpy as np
import pytest
import trimesh

from app.asset_models.store import version_glb_path
from app.asset_review.jobs_place import placements_dir
from app.asset_review.place import encode_patch
from app.db.base import new_id
from app.errors import AppError
from app.reports.schemas import AssetLocatorSpec
from app.reports.snapshots import MISSING, SnapshotUnavailable, asset_locator
from app.reports.snapshots import render as render_mod

BOX = trimesh.creation.box(extents=(2.0, 2.0, 2.0))
RED = (255, 0, 0)


def _spec(mid: str, **kw) -> AssetLocatorSpec:
    base = {
        "kind": "asset_locator",
        "asset_model_id": mid,
        "version": 1,
        "sighting_id": None,
        "mark": "pin",
        "center": [1.0, 0.0, 0.0],
        "normal": [1.0, 0.0, 0.0],
        "half_extent_m": 2.0,
        "oblique_deg": 0.0,
        "colour": "#FF0000",
        "out": [256, 256],
    }
    return AssetLocatorSpec.model_validate({**base, **kw})


def _glb(handle, mid: str) -> None:
    p = version_glb_path(handle, mid, 1)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"glTF-test")


def _patch(handle, mid: str, sid: str, pts) -> None:
    folder = placements_dir(handle, mid, 1)
    folder.mkdir(parents=True, exist_ok=True)
    pos = np.array(pts, dtype=np.float32)
    (folder / f"{sid}.bin").write_bytes(encode_patch(pos, np.zeros((len(pts), 2), np.float32)))


SQUARE = [(1.0, -0.5, -0.5), (1.0, -0.5, 0.5), (1.0, 0.5, 0.5), (1.0, 0.5, -0.5)]


@pytest.fixture
def box_mesh(monkeypatch):
    monkeypatch.setattr(asset_locator, "_load_mesh", lambda handle, mid, version: BOX)


def test_source_version_follows_the_glb_and_the_patch(handle):
    mid, sid = new_id(), new_id()
    assert asset_locator.source_version(handle, _spec(mid)).startswith(MISSING)
    _glb(handle, mid)
    pin = asset_locator.source_version(handle, _spec(mid))
    assert not pin.startswith(MISSING)
    patch = _spec(mid, mark="patch", sighting_id=sid)
    assert asset_locator.source_version(handle, patch) == pin  # no patch file yet
    _patch(handle, mid, sid, SQUARE)
    assert asset_locator.source_version(handle, patch).startswith(pin + "|")


def test_a_bad_model_id_is_a_missing_source(handle):
    assert asset_locator.source_version(handle, _spec("../x")).startswith(MISSING)


def test_a_pin_renders_in_the_severity_colour(handle, box_mesh):
    _glb(handle, new_id())
    img = asset_locator.render(handle, _spec(new_id()))
    assert img.size == (256, 256) and img.getpixel((128, 128)) == RED


def test_a_patch_draws_its_outline_not_a_pin(handle, box_mesh):
    mid, sid = new_id(), new_id()
    _patch(handle, mid, sid, SQUARE)
    img = asset_locator.render(handle, _spec(mid, mark="patch", sighting_id=sid))
    assert RED in [img.getpixel((128, y)) for y in range(96, 104)]
    assert img.getpixel((128, 128)) != RED


def test_a_missing_patch_file_falls_back_to_the_pin(handle, box_mesh):
    img = asset_locator.render(handle, _spec(new_id(), mark="patch", sighting_id=new_id()))
    assert img.getpixel((128, 128)) == RED


def test_view_direction_looks_against_the_normal_and_turns_by_the_oblique_angle():
    assert asset_locator.view_direction([1.0, 0.0, 0.0], 0.0) == pytest.approx((-1.0, 0.0, 0.0))
    assert asset_locator.view_direction([1.0, 0.0, 0.0], 90.0) == pytest.approx((0.0, 0.0, 1.0), abs=1e-9)
    assert asset_locator.view_direction([0.0, 0.0, 0.0], 0.0) == pytest.approx((-1.0, 0.0, 0.0))


def test_the_kind_is_registered_and_square(handle):
    assert render_mod.RENDERERS["asset_locator"] is asset_locator
    with pytest.raises(ValueError):
        render_mod.check_limits(_spec(new_id(), out=[300, 200]))
    with pytest.raises(ValueError):
        render_mod.check_limits(_spec(new_id(), out=[2000, 2000]))


def test_render_result_caches_a_jpeg(handle, box_mesh):
    mid = new_id()
    _glb(handle, mid)
    result = render_mod.render_result(handle, _spec(mid))
    assert result.missing_reason is None and result.path.suffix == ".jpg"
    from PIL import Image

    with Image.open(result.path) as im:
        assert im.size == (256, 256)
        assert np.asarray(im.convert("RGB"))[128, 128, 0] > 200


def test_a_corrupt_patch_file_falls_back_to_the_pin(handle, box_mesh):
    mid, sid = new_id(), new_id()
    folder = placements_dir(handle, mid, 1)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{sid}.bin").write_bytes(struct.pack("<I", 7) + b"junk")
    img = asset_locator.render(handle, _spec(mid, mark="patch", sighting_id=sid))
    assert img.getpixel((128, 128)) == RED


def test_an_oversize_patch_file_falls_back_to_the_pin(handle, box_mesh):
    mid, sid = new_id(), new_id()
    n = 4000  # 4 + 20 n bytes is over the 64 KB read cap
    ring = np.zeros((n, 3), np.float32)
    ring[:, 0] = 1.0
    ring[:, 1] = np.cos(np.linspace(0, 6.28, n)) * 0.5
    ring[:, 2] = np.sin(np.linspace(0, 6.28, n)) * 0.5
    folder = placements_dir(handle, mid, 1)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{sid}.bin").write_bytes(encode_patch(ring, np.zeros((n, 2), np.float32)))
    img = asset_locator.render(handle, _spec(mid, mark="patch", sighting_id=sid))
    assert img.getpixel((128, 128)) == RED


def test_a_version_that_is_not_ready_is_the_not_ready_reason(handle, monkeypatch):
    def not_ready(h, mid, version):
        raise AppError("not_ready", "The 3D model for this version is not ready.", 409)

    monkeypatch.setattr("app.asset_review.meshes.load_version_mesh", not_ready)
    with asset_locator.allow_mesh_load(), pytest.raises(SnapshotUnavailable) as e:
        asset_locator.render(handle, _spec(new_id()))
    assert e.value.reason == asset_locator.NOT_READY


def _count_loads(monkeypatch):
    calls = []

    def load(h, mid, version):
        calls.append(mid)
        return BOX, np.zeros(len(BOX.faces), np.int32)

    monkeypatch.setattr("app.asset_review.meshes.load_version_mesh", load)
    monkeypatch.setattr("app.asset_review.meshes.cached_version_mesh", lambda h, mid, version: None)
    return calls


def test_the_route_path_never_loads_a_cold_mesh(handle, monkeypatch):
    calls = _count_loads(monkeypatch)
    mid = new_id()
    _glb(handle, mid)
    result = render_mod.render_result(handle, _spec(mid))
    assert result.missing_reason == asset_locator.NOT_DRAWN_YET
    assert asset_locator.NOT_DRAWN_YET == "The 3D view is drawn when the report renders."
    assert calls == []


def test_the_route_path_draws_a_warm_mesh(handle, monkeypatch):
    mid = new_id()
    _glb(handle, mid)
    monkeypatch.setattr(
        "app.asset_review.meshes.cached_version_mesh",
        lambda h, m, v: (BOX, np.zeros(len(BOX.faces), np.int32)),
    )
    assert render_mod.render_result(handle, _spec(mid)).missing_reason is None


def test_the_job_path_loads_and_renders(handle, monkeypatch):
    calls = _count_loads(monkeypatch)
    mid = new_id()
    _glb(handle, mid)
    path = render_mod.render_to_cache(handle, _spec(mid))
    assert calls == [mid] and path.suffix == ".jpg"
