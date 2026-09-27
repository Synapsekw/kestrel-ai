"""Drawings in the Data list, the overview counts, and the sweep on project open (spec §4 item 7,
§12 "startup sweep", §14 "the app must start"; plan Task 14)."""

import os
import time
from datetime import UTC, date, datetime, timedelta

from drawings_helpers import BASE, build_drawing, inspect_ready, seed_frame, write_png

from app.db.models import Drawing
from app.drawings import startup, store
from app.overview.service import data_counts


class _Idle:
    def is_live(self, job_id) -> bool:
        return False


def test_a_drawing_is_a_data_item(client, project_id, wait_job, handle, tmp_path):
    insp = inspect_ready(client, project_id, wait_job, write_png(tmp_path / "p.png", 20, 20))
    d = build_drawing(
        client, project_id, wait_job, insp["id"], name="Site plan rev C", captured_on="2026-09-10"
    )
    items = client.get(f"{BASE}/{project_id}/data", params={"type": "drawing"}).json()["items"]
    assert [(i["id"], i["type"], i["label"], i["status"]) for i in items] == [
        (d["id"], "drawing", "Site plan rev C", "ready")
    ]
    assert items[0]["captured_on"] == "2026-09-10"
    assert items[0]["summary"] == {"format": "png", "placed": False, "rmse_m": None}
    seed_frame(handle, 32633)
    pts = [{"src": [0, 0], "dst": [0, 0]}, {"src": [20, 0], "dst": [2, 0]}]
    client.put(
        f"{BASE}/{project_id}/drawings/{d['id']}/georef",
        json={"model": "similarity", "points": pts, "dst_frame": "site"},
    )
    items = client.get(f"{BASE}/{project_id}/data", params={"type": "drawing"}).json()["items"]
    assert items[0]["summary"] == {"format": "png", "placed": True, "rmse_m": 0.0}
    with handle.session() as s:
        assert data_counts(s)["drawings"] == 1


def test_the_sweep_fails_interrupted_imports_and_cleans_up(handle, tmp_path):
    with handle.session() as s:
        row = Drawing(
            name="x",
            format="png",
            source_path=str(tmp_path / "x.png"),
            source_size=1,
            status="importing",
            job_id="gone",
            layers=[],
            layer_state={},
            georef_version=0,
            captured_on=date(2026, 9, 1),
        )
        s.add(row)
        s.flush()
        did = row.id
    store.drawing_dir(handle, did).mkdir(parents=True)
    src = write_png(tmp_path / "p.png", 5, 5)
    old = store.create_inspection(handle, store.new_id(), src, "png")
    store.patch_json(old / "request.json", created_at=(datetime.now(UTC) - timedelta(hours=25)).isoformat())
    fresh = store.create_inspection(handle, store.new_id(), src, "png")
    assert startup.sweep_interrupted(handle, _Idle()) == [did]
    with handle.session() as s:
        assert s.get(Drawing, did).status == "failed"
    assert not store.drawing_dir(handle, did).exists() and not old.exists()
    assert store.read_json(fresh / "inspection.json")["state"] == "failed"


def test_a_broken_inspection_folder_does_not_stop_the_sweep(handle):
    bad = store.inspections_root(handle) / "00000000-0000-4000-8000-000000000001"
    bad.mkdir(parents=True)
    (bad / "request.json").write_text("[not a dict]", "utf-8")
    os.utime(bad, (time.time() - 3 * 86400, time.time() - 3 * 86400))
    assert startup.sweep_inspections(handle, _Idle()) == [bad.name]


def test_the_sweep_removes_drawing_folders_that_have_no_row(handle, tmp_path, monkeypatch):
    """A DELETE whose folder removal failed (a file held open) leaves a folder with no row: the next
    project open removes it. A folder whose row exists stays; a folder that cannot be removed is
    logged and skipped, never raised."""
    with handle.session() as s:
        row = Drawing(
            name="kept",
            format="png",
            source_path=str(tmp_path / "x.png"),
            source_size=1,
            status="ready",
            layers=[],
            layer_state={},
            georef_version=0,
        )
        s.add(row)
        s.flush()
        kept = row.id
    orphan, stuck = store.new_id(), store.new_id()
    for did in (kept, orphan, stuck):
        store.drawing_dir(handle, did).mkdir(parents=True)
        (store.drawing_dir(handle, did) / "plan.tif").write_bytes(b"x")
    stray = store.drawing_dir(handle, kept).parent / "not-an-id"
    stray.mkdir()
    real = startup.shutil.rmtree

    def rmtree(path, *a, **k):
        if os.path.basename(path) == stuck:
            raise PermissionError("held open")
        return real(path, *a, **k)

    monkeypatch.setattr(startup.shutil, "rmtree", rmtree)
    assert startup.sweep_orphan_folders(handle) == [orphan]
    assert store.drawing_dir(handle, kept).is_dir() and stray.is_dir()
    assert not store.drawing_dir(handle, orphan).exists() and store.drawing_dir(handle, stuck).exists()
    monkeypatch.setattr(startup.shutil, "rmtree", real)
    startup.sweep_interrupted(handle, _Idle())  # the open sweep runs it too
    assert not store.drawing_dir(handle, stuck).exists()
