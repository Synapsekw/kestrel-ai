# backend/tests/test_plant_live_helpers.py
"""The live acceptance test's helpers, run in the gate (no key, no project folder needed)."""

import sqlite3

from plant_live_helpers import copy_project_state, pick_sources


def test_copy_takes_the_database_and_kestrel_folders_only(tmp_path):
    src = tmp_path / "LNG Terminal"
    src.mkdir()
    db = sqlite3.connect(src / "project.db")
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("CREATE TABLE t (v INTEGER)")
    db.execute("INSERT INTO t VALUES (7)")
    db.commit()  # left open: the row may still sit in the WAL, as in a live project
    for rel in ("pointclouds/c1/octree/octree.bin", "pointclouds/c1/.work/x", "pointclouds/c1/meta.json",
                "maps/m1/tiles/0.png", "drawings/d1/page.png", "Ortho/big.tif"):  # fmt: skip
        (src / rel).parent.mkdir(parents=True, exist_ok=True)
        (src / rel).write_bytes(b"x")
    dst = copy_project_state(src, tmp_path / "copy")
    db.close()
    copied = sqlite3.connect(dst / "project.db")
    assert copied.execute("SELECT v FROM t").fetchall() == [(7,)]
    copied.close()
    assert (dst / "pointclouds/c1/meta.json").exists()
    assert (dst / "maps/m1/tiles/0.png").exists() and (dst / "drawings/d1/page.png").exists()
    assert not (dst / "pointclouds/c1/octree").exists() and not (dst / "pointclouds/c1/.work").exists()
    assert not (dst / "Ortho").exists()


def test_pick_sources_needs_every_sheet():
    drawings = [
        {"id": "d1", "name": "P0058LNG-00-40-0-T0005 — p1", "status": "ready"},
        {"id": "d2", "name": "P0058LNG-00-40-0-T0003 — p1", "status": "ready"},
        {"id": "d3", "name": "P0058LNG-00-40-0-T0006 — p1", "status": "failed"},
        {"id": "d4", "name": "Something else", "status": "ready"},
    ]
    clouds = [{"id": "c1", "status": "ready"}, {"id": "c2", "status": "importing"}]
    sources, missing = pick_sources(drawings, clouds)
    assert sources == [
        {"type": "point_cloud", "id": "c1"},
        {"type": "drawing", "id": "d2"},
        {"type": "drawing", "id": "d1"},
    ]
    assert missing == ["T0006", "T0007", "T0008"]
    many = [{"id": f"d{k}", "name": f"T0003 — p{k:02d}", "status": "ready"} for k in range(60)]
    sources, missing = pick_sources(many, clouds, sheets=("T0003",), limit=50)
    assert len(sources) == 50 and missing == []
