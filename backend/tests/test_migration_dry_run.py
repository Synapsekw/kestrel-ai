"""The dry run over copies of project folders (foundation spec §11.5)."""

import json
import sqlite3
from pathlib import Path

import pytest
from migration_helpers import (
    add_dataset,
    add_detect_rows,
    add_images_and_boxes,
    at_revision,
    load_script,
    revision_of,
)

from app.db.session import head_revision
from app.migration import backup
from app.migration.invariants import compare, snapshot


@pytest.fixture
def mod():
    return load_script("migration_dry_run")


@pytest.fixture
def real_like(tmp_path, monkeypatch):
    """Two folders shaped like the operator's: one at 0001 (E:\\Projects\\Ahmadia) and one at 0008 with
    boxes, runs and a materialised dataset, listed in an app-data folder's recent list."""
    monkeypatch.setattr(backup, "BACKUP_BEFORE", "0009")
    old = at_revision(tmp_path / "projects" / "old", "0001", name="Old")
    busy = at_revision(tmp_path / "projects" / "busy", "0008", name="Busy")
    add_images_and_boxes(busy)
    add_detect_rows(busy)
    add_dataset(busy)
    data_dir = tmp_path / "appdata"
    data_dir.mkdir()
    recent = [{"id": "p-busy", "name": "Busy", "folder": str(busy)}]
    (data_dir / "recent_projects.json").write_text(json.dumps(recent), "utf-8")
    return data_dir, old, busy


def test_snapshot_totals_sum_every_count_shape(tmp_path):
    folder = at_revision(tmp_path / "p", "0008")
    add_images_and_boxes(folder)
    add_detect_rows(folder)
    snap = snapshot(folder / "project.db")
    assert snap["rows"]["box"] == 10 and snap["rows"]["map_detection"] == 4
    assert snap["totals"]["map_run.counts"] == 4
    assert snap["totals"]["map_run.area_counts"] == 4  # 2+1 totals and 1+0 verified
    assert compare(snap, snap) == []
    moved = {"rows": dict(snap["rows"], box=9), "totals": snap["totals"]}
    assert compare(snap, moved) == ["box: 10 before, 9 after"]


def test_the_dry_run_upgrades_copies_and_never_touches_the_originals(mod, real_like, tmp_path):
    data_dir, old, busy = real_like
    before = {f: mod.fingerprint(f) for f in (old, busy)}
    report = mod.dry_run(mod.recent_folders(data_dir) + [old], data_dir, tmp_path / "work")
    assert report["ok"], report
    assert [Path(p["folder"]) for p in report["projects"]] == [busy, old]
    for p in report["projects"]:
        assert p["originals_unchanged"] and p["mismatches"] == [], p
        assert p["revision_after"] == head_revision() and p["backup_expected"]
        assert p["backup"]["quick_check"] == "ok"
    assert {f: mod.fingerprint(f) for f in (old, busy)} == before
    assert revision_of(busy / "project.db") == "0008" and revision_of(old / "project.db") == "0001"
    assert not (busy / "backups").exists()


def test_rows_still_in_the_wal_are_copied(mod, tmp_path):
    folder = at_revision(tmp_path / "live", "0009")
    add_images_and_boxes(folder)
    live = sqlite3.connect(folder / "project.db")  # the "running app": its writes sit in -wal
    try:
        live.execute("PRAGMA journal_mode=WAL")
        live.execute("PRAGMA wal_autocheckpoint=0")
        live.execute("UPDATE box SET review_state = 'accepted' WHERE review_state = 'unreviewed'")
        live.execute(
            "INSERT INTO box (id, image_id, class_id, x, y, w, h, provenance_kind, review_state, created_at)"
            " VALUES ('b-late', 'i1', 'c-exc', 1, 1, 2, 2, 'person', 'accepted',"
            " '2026-02-01 00:00:00.000000')"
        )
        live.commit()
        assert (folder / "project.db-wal").exists()
        result = mod.dry_run_one(folder, tmp_path / "work" / "p", *mod.open_stores(tmp_path / "appdata"))
    finally:
        live.close()
    assert result["ok"], result
    copied = sqlite3.connect(tmp_path / "work" / "p" / "project.db")
    try:
        assert copied.execute("SELECT COUNT(*) FROM box").fetchone()[0] == 11
    finally:
        copied.close()


def test_a_broken_project_fails_alone_and_the_exit_code_says_so(mod, real_like, tmp_path, capsys):
    data_dir, _old, busy = real_like
    broken = tmp_path / "projects" / "broken"
    broken.mkdir()
    (broken / "project.db").write_bytes(b"not a database" * 100)
    out = tmp_path / "report.json"
    code = mod.main(
        [
            "--data-dir",
            str(data_dir),
            "--recent",
            "--folders",
            str(broken),
            "--work-dir",
            str(tmp_path / "work"),
            "--out",
            str(out),
        ]
    )
    assert code == 1
    by_name = {Path(p["folder"]).name: p for p in json.loads(out.read_text("utf-8"))["projects"]}
    assert by_name["busy"]["ok"] and not by_name["broken"]["ok"] and by_name["broken"]["error"]
    printed = capsys.readouterr().out
    assert "[FAILED]" in printed and "[ok]" in printed


def test_a_folder_listed_twice_runs_once_and_an_empty_run_is_not_a_pass(mod, real_like, tmp_path):
    data_dir, _old, busy = real_like
    report = mod.dry_run([busy, Path(str(busy).upper())], data_dir, tmp_path / "work")
    assert len(report["projects"]) == 1
    assert mod.dry_run([], data_dir, tmp_path / "empty")["ok"] is False
