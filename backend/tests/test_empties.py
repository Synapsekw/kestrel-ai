"""Marking images empty: `marked_empty`, `labeled` semantics, the marking service and routes,
and how ground truth clears the mark (spec section 6, walk-through item E4).
"""

from __future__ import annotations

import sqlite3

import pytest
from alembic import command
from alembic.config import Config

from app.db.models import Image
from app.db.session import MIGRATIONS

BASE = "/api/v1/projects"
FLIGHTS = ("0001", "0002")


@pytest.fixture
def image_ids(client, project, import_source, tmp_path, make_jpeg) -> list[str]:
    """20 imported frames, ids ordered by path (mirrors `test_images.py`'s `imported` fixture)."""
    folder = tmp_path / "frames"
    for i in range(20):
        flight, frame = FLIGHTS[i // 10], i % 10 + 1
        make_jpeg(folder / f"S_{flight}_{frame:04d}.jpg", 320, 240, seed=i)
    import_source(project["id"], folder)
    page = client.get(f"{BASE}/{project['id']}/images", params={"limit": 100, "sort": "path"}).json()
    return [i["id"] for i in page["items"]]


def _mark(handle, image_id, value=True):
    with handle.session() as s:
        s.get(Image, image_id).marked_empty = value


def test_a_marked_image_counts_as_labeled_everywhere(client, project_id, handle, image_ids):
    _mark(handle, image_ids[0])
    row = client.get(f"{BASE}/{project_id}/images/{image_ids[0]}").json()
    assert row["marked_empty"] is True and row["labeled"] is True and row["box_count"] == 0
    other = client.get(f"{BASE}/{project_id}/images/{image_ids[1]}").json()
    assert other["marked_empty"] is False and other["labeled"] is False

    labeled = client.get(f"{BASE}/{project_id}/images", params={"labeled": "true"}).json()
    assert [i["id"] for i in labeled["items"]] == [image_ids[0]]
    unlabeled = client.get(f"{BASE}/{project_id}/images", params={"labeled": "false"}).json()
    assert image_ids[0] not in [i["id"] for i in unlabeled["items"]]

    stats = client.get(f"{BASE}/{project_id}/stats").json()
    assert stats["labeled_count"] == 1
    assert stats["unlabeled_count"] == len(image_ids) - 1


def test_an_existing_database_gains_the_column_with_false(tmp_path):
    """Open a project created at revision 0001, upgrade, and read `marked_empty` = 0 for old rows."""
    db_path = tmp_path / "project.db"
    url = f"sqlite:///{db_path.as_posix()}"
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "0001")

    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "INSERT INTO source (id, folder, site, settings, image_count, duplicate_count, "
            "job_id, imported_at, created_at) VALUES "
            "('s1', 'f', 'site', '{}', 0, 0, NULL, NULL, '2024-01-01 00:00:00')"
        )
        conn.execute(
            "INSERT INTO image (id, path, width, height, source_id, capture_time, lat, lon, "
            "alt, phash, group_key, created_at) VALUES "
            "('i1', 'images/a.jpg', 10, 10, 's1', NULL, NULL, NULL, NULL, NULL, '', "
            "'2024-01-01 00:00:00')"
        )
        conn.commit()
    finally:
        conn.close()

    command.upgrade(cfg, "head")

    conn = sqlite3.connect(db_path)
    try:
        value = conn.execute("SELECT marked_empty FROM image WHERE id = 'i1'").fetchone()[0]
    finally:
        conn.close()
    assert value == 0
