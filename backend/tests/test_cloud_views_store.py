"""Report views, storage (spec 2026-09-26-point-cloud-workspace section 11.2): subjects, the atomic
write, replacement, reads, staleness, and the two sweeps."""

import hashlib
import os
import time

import pytest
from cloud_views import jpeg, meta_json, png
from findings_helpers import insert_map
from pointclouds import insert_cloud
from sqlalchemy import func, select

from app.db.models import CloudView
from app.errors import AppError
from app.pointclouds import startup, views

API = "/api/v1/projects"
OLD = time.time() - 3600


@pytest.fixture
def cloud_id(handle) -> str:
    return insert_cloud(handle)


def _finding(client, project_id, type_id, cloud_id, x=243540.2) -> str:
    anchor = {"kind": "cloud", "cloud_id": cloud_id, "x": x, "y": 3178030.5, "z": 12.4}
    r = client.post(f"{API}/{project_id}/findings", json={"type_id": type_id, "anchor": anchor})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _measurement(client, project_id, cloud_id) -> str:
    body = {"kind": "point", "points": [{"x": 243500.0, "y": 3178000.0, "z": 1.0, "uncertainty_m": 0.01}]}
    r = client.post(f"{API}/{project_id}/pointclouds/{cloud_id}/measurements", json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _meta(kind="finding", **changes):
    return views.parse_meta(meta_json(**changes), kind)


def _rows(handle) -> int:
    with handle.session() as s:
        return s.execute(select(func.count()).select_from(CloudView)).scalar_one()


def test_a_cloud_finding_resolves_to_its_subject(client, project_id, handle, crack, cloud_id):
    fid = _finding(client, project_id, crack["id"], cloud_id)
    subject = views.finding_subject(handle, fid)
    assert (subject.kind, subject.id, subject.cloud_id) == ("finding", fid, cloud_id)
    assert subject.anchor_hash == views.finding_hash(243540.2, 3178030.5, 12.4)


def test_unknown_and_non_cloud_findings_are_refused(client, project_id, handle, crack):
    with pytest.raises(AppError) as e:
        views.finding_subject(handle, "nope")
    assert (e.value.status, e.value.code) == (404, "not_found")
    map_id = insert_map(handle)
    anchor = {
        "kind": "map",
        "map_id": map_id,
        "geometry": {"type": "Point", "coordinates": [583120.4, 3265410.2]},
    }
    body = {"type_id": crack["id"], "anchor": anchor, "lon": 47.7625, "lat": 29.4951}
    fid = client.post(f"{API}/{project_id}/findings", json=body).json()["id"]
    with pytest.raises(AppError) as e:
        views.finding_subject(handle, fid)
    assert (e.value.status, e.value.code) == (409, "not_a_cloud_finding")


def test_a_measurement_on_another_cloud_is_not_found(client, project_id, handle, cloud_id):
    mid = _measurement(client, project_id, cloud_id)
    assert views.measurement_subject(handle, cloud_id, mid).kind == "cloud_measurement"
    other = insert_cloud(handle)
    with pytest.raises(AppError) as e:
        views.measurement_subject(handle, other, mid)
    assert (e.value.status, e.value.code) == (404, "not_found")


def test_store_writes_through_a_partial_and_an_atomic_replace(
    client, project_id, handle, crack, cloud_id, monkeypatch
):
    fid = _finding(client, project_id, crack["id"], cloud_id)
    replaced: list[tuple[str, str]] = []
    real = os.replace

    def spy(src, dst):
        replaced.append((os.path.basename(src), os.path.basename(dst)))
        return real(src, dst)

    monkeypatch.setattr(views.os, "replace", spy)
    data = png()
    out = views.store(handle, views.finding_subject(handle, fid), data, _meta(anchor_normal=[0, 0, 3]))
    assert len(replaced) == 1 and replaced[0][0].startswith(".partial-")
    assert replaced[0][1] == f"finding-{fid}.png"
    folder = views.views_dir(handle, cloud_id)
    assert sorted(p.name for p in folder.iterdir()) == [f"finding-{fid}.png"]
    assert (folder / f"finding-{fid}.png").read_bytes() == data
    assert (out.subject_kind, out.subject_id, out.stale) == ("finding", fid, False)
    assert (out.sha256, out.bytes, out.width, out.height) == (
        hashlib.sha256(data).hexdigest(),
        len(data),
        1600,
        1000,
    )
    assert out.anchor_normal == [0.0, 0.0, 1.0]
    with handle.session() as s:
        row = s.execute(select(CloudView)).scalar_one()
        assert row.path == f"pointclouds/{cloud_id}/views/finding-{fid}.png"


def test_a_failed_replace_leaves_no_file_and_no_row(client, project_id, handle, crack, cloud_id, monkeypatch):
    fid = _finding(client, project_id, crack["id"], cloud_id)

    def boom(src, dst):
        raise OSError("disk gone")

    monkeypatch.setattr(views.os, "replace", boom)
    with pytest.raises(OSError):
        views.store(handle, views.finding_subject(handle, fid), png(), _meta())
    assert list(views.views_dir(handle, cloud_id).iterdir()) == []
    assert _rows(handle) == 0


def test_a_permission_error_on_replace_is_retried(client, project_id, handle, crack, cloud_id, monkeypatch):
    fid = _finding(client, project_id, crack["id"], cloud_id)
    real = os.replace
    calls: list[int] = []

    def flaky(src, dst):
        calls.append(len(calls))
        if len(calls) <= 2:
            raise PermissionError("the process cannot access the file because it is being used")
        return real(src, dst)

    monkeypatch.setattr(views.os, "replace", flaky)
    monkeypatch.setattr(views.time, "sleep", lambda s: None)
    out = views.store(handle, views.finding_subject(handle, fid), png(), _meta())
    assert len(calls) == 3
    folder = views.views_dir(handle, cloud_id)
    assert sorted(p.name for p in folder.iterdir()) == [f"finding-{fid}.png"]
    assert _rows(handle) == 1
    assert out.subject_id == fid


def test_a_deleted_subject_races_the_upsert_and_answers_not_found(handle, cloud_id):
    subject = views.Subject("finding", "00000000-0000-4000-8000-000000000099", cloud_id, "0" * 64)
    with pytest.raises(AppError) as e:
        views.store(handle, subject, png(), _meta())
    assert (e.value.status, e.value.code) == (404, "not_found")
    folder = views.views_dir(handle, cloud_id)
    assert list(folder.iterdir()) == []
    assert _rows(handle) == 0


def test_a_jpeg_replaces_a_png_and_removes_it(client, project_id, handle, crack, cloud_id):
    fid = _finding(client, project_id, crack["id"], cloud_id)
    subject = views.finding_subject(handle, fid)
    first = views.store(handle, subject, png(), _meta())
    second = views.store(handle, subject, jpeg(), _meta())
    assert first.sha256 != second.sha256
    folder = views.views_dir(handle, cloud_id)
    assert sorted(p.name for p in folder.iterdir()) == [f"finding-{fid}.jpg"]
    assert _rows(handle) == 1
    data, media, sha = views.read_image(handle, "finding", fid)
    assert (media, sha, hashlib.sha256(data).hexdigest()) == ("image/jpeg", second.sha256, second.sha256)


def test_a_store_on_a_deleted_cloud_is_not_found(handle):
    subject = views.Subject("finding", "f1", "gone", "0" * 64)
    with pytest.raises(AppError) as e:
        views.store(handle, subject, png(), _meta())
    assert (e.value.status, e.value.code) == (404, "not_found")


def test_no_view_and_a_missing_file_both_answer_no_view(client, project_id, handle, crack, cloud_id):
    fid = _finding(client, project_id, crack["id"], cloud_id)
    assert views.stored_view(handle, "finding", fid) is None
    with pytest.raises(AppError) as e:
        views.read_image(handle, "finding", fid)
    assert (e.value.status, e.value.code) == (404, "no_view")
    views.store(handle, views.finding_subject(handle, fid), png(), _meta())
    stored = views.stored_view(handle, "finding", fid)
    assert stored is not None and stored.media_type == "image/png" and stored.path.is_file()
    stored.path.unlink()
    with pytest.raises(AppError) as e:
        views.read_image(handle, "finding", fid)
    assert e.value.code == "no_view"


def test_stale_flips_when_the_finding_moves(client, project_id, handle, crack, cloud_id):
    fid = _finding(client, project_id, crack["id"], cloud_id)
    views.store(handle, views.finding_subject(handle, fid), png(), _meta())
    assert [v.stale for v in views.list_for_cloud(handle, cloud_id)] == [False]
    r = client.patch(f"{API}/{project_id}/findings/{fid}", json={"anchor": {"x": 243541.0}})
    assert r.status_code == 200, r.text
    assert [v.stale for v in views.list_for_cloud(handle, cloud_id)] == [True]
    assert views.stored_view(handle, "finding", fid).meta.stale is True


def test_the_list_is_capped_and_holds_measurements_too(
    client, project_id, handle, crack, cloud_id, monkeypatch
):
    for x in (243540.2, 243541.2):
        fid = _finding(client, project_id, crack["id"], cloud_id, x=x)
        views.store(handle, views.finding_subject(handle, fid), png(), _meta())
    mid = _measurement(client, project_id, cloud_id)
    views.store(handle, views.measurement_subject(handle, cloud_id, mid), png(), _meta("cloud_measurement"))
    kinds = sorted(v.subject_kind for v in views.list_for_cloud(handle, cloud_id))
    assert kinds == ["cloud_measurement", "finding", "finding"]
    assert views.measurement_views(handle, cloud_id)[mid].subject_id == mid
    assert views.measurement_view(handle, mid).stale is False
    monkeypatch.setattr(views, "MAX_LISTED", 2)
    assert len(views.list_for_cloud(handle, cloud_id)) == 2


def test_the_list_sweep_spares_young_files_and_partials(client, project_id, handle, crack, cloud_id):
    fid = _finding(client, project_id, crack["id"], cloud_id)
    views.store(handle, views.finding_subject(handle, fid), png(), _meta())
    folder = views.views_dir(handle, cloud_id)
    old_orphan = folder / "finding-00000000-0000-4000-8000-000000000001.png"
    young_orphan = folder / "cloud_measurement-00000000-0000-4000-8000-000000000002.jpg"
    old_partial = folder / ".partial-abc"
    foreign = folder / "notes.txt"
    for f in (old_orphan, young_orphan, old_partial, foreign):
        f.write_bytes(b"x")
    for f in (old_orphan, old_partial, foreign):
        os.utime(f, (OLD, OLD))
    views.list_for_cloud(handle, cloud_id)
    names = sorted(p.name for p in folder.iterdir())
    assert names == sorted([f"finding-{fid}.png", young_orphan.name, old_partial.name, foreign.name])


def test_the_startup_sweep_removes_old_partials_and_orphans(client, project_id, handle, crack, cloud_id):
    fid = _finding(client, project_id, crack["id"], cloud_id)
    views.store(handle, views.finding_subject(handle, fid), png(), _meta())
    folder = views.views_dir(handle, cloud_id)
    kept = folder / f"finding-{fid}.png"
    os.utime(kept, (OLD, OLD))  # old, but it has a row
    old_partial, young_partial = folder / ".partial-old", folder / ".partial-young"
    orphan = folder / "finding-00000000-0000-4000-8000-000000000003.jpg"
    for f in (old_partial, young_partial, orphan):
        f.write_bytes(b"x")
    for f in (old_partial, orphan):
        os.utime(f, (OLD, OLD))
    assert startup.sweep_views(handle) == 2
    assert sorted(p.name for p in folder.iterdir()) == sorted([kept.name, young_partial.name])


def test_the_startup_sweep_still_removes_partials_when_the_rows_cannot_be_read(
    client, project_id, handle, crack, cloud_id, monkeypatch
):
    folder = views.views_dir(handle, cloud_id)
    folder.mkdir(parents=True)
    partial, orphan = folder / ".partial-old", folder / "finding-00000000-0000-4000-8000-000000000004.png"
    for f in (partial, orphan):
        f.write_bytes(b"x")
        os.utime(f, (OLD, OLD))

    def broken():
        raise RuntimeError("database locked")

    monkeypatch.setattr(handle, "session", broken)
    assert views.sweep_all(handle) == 1
    assert [p.name for p in folder.iterdir()] == [orphan.name]


def test_remove_files_takes_both_extensions(handle, cloud_id):
    folder = views.views_dir(handle, cloud_id)
    folder.mkdir(parents=True)
    for ext in ("png", "jpg"):
        (folder / f"cloud_measurement-m1.{ext}").write_bytes(b"x")
    views.remove_files(handle, cloud_id, "cloud_measurement", "m1")
    views.remove_files(handle, cloud_id, "cloud_measurement", "m1")  # idempotent
    assert list(folder.iterdir()) == []
