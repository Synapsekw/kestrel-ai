"""Rows and folders of asset models (spec §5)."""

import pytest

from app.asset_models import store
from app.db.models import AssetModel, AssetModelVersion
from app.errors import AppError

MID = "11111111-2222-3333-4444-555555555555"
RID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


def _seed(handle, versions=()):
    with handle.session() as s:
        m = AssetModel(name="m", status="empty")
        s.add(m)
        s.flush()
        for n in versions:
            s.add(
                AssetModelVersion(
                    model_id=m.id,
                    version=n,
                    spec={},
                    kind="manual",
                    glb_status="pending",
                    source_ids=[],
                    part_count=0,
                )
            )
        return m.id


def test_model_dir_rejects_a_non_uuid_id(handle):
    with pytest.raises(AppError) as e:
        store.model_dir(handle, "../x")
    assert e.value.status == 404


def test_version_glb_path(handle):
    p = store.version_glb_path(handle, MID, 3)
    assert p.name == "v3.glb" and p.parent == handle.asset_models_dir / MID


def test_run_dir(handle):
    assert store.run_dir(handle, MID, RID) == handle.asset_models_dir / MID / "runs" / RID
    with pytest.raises(AppError) as e:
        store.run_dir(handle, MID, "nope")
    assert e.value.status == 404


def test_get_model_and_version_404(handle):
    mid = _seed(handle)
    with handle.session() as s:
        assert store.get_model(s, mid).id == mid
        for call in (lambda: store.get_model(s, MID), lambda: store.get_version(s, mid, 1)):
            with pytest.raises(AppError) as e:
                call()
            assert e.value.status == 404


def test_next_version_number(handle):
    empty = _seed(handle)
    some = _seed(handle, versions=(1, 2, 5))
    with handle.session() as s:
        assert store.next_version_number(s, empty) == 1
        assert store.next_version_number(s, some) == 6
