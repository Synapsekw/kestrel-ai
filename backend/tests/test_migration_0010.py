"""Migration 0010 (spec 2026-09-26-foundation section 11.1): the project type list, the finding
tables, the counts, the activity feed and MG's bookkeeping tables. A project at 0009 upgrades with
every row it had, and the anchor CHECK and the box foreign key hold. `project.kind` is not dropped
by this revision (unit BK, which removes it, has not merged yet; a later task adds that drop)."""

import sqlite3

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy.exc import IntegrityError

from app.db.models import (
    Activity,
    Box,
    ClassIdMap,
    Finding,
    FindingAttachment,
    FindingComment,
    FindingCount,
    FindingDaily,
    MigrationStep,
    ProjectType,
)
from app.db.session import MIGRATIONS, make_session_factory, open_project_db

REVISION = "0010"
TABLES = {
    "project_type": ProjectType,
    "finding": Finding,
    "finding_attachment": FindingAttachment,
    "finding_comment": FindingComment,
    "finding_count": FindingCount,
    "finding_daily": FindingDaily,
    "activity": Activity,
    "migration_step": MigrationStep,
    "class_id_map": ClassIdMap,
}


def _cfg(folder=None) -> Config:
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    if folder is not None:
        cfg.set_main_option("sqlalchemy.url", f"sqlite:///{(folder / 'project.db').as_posix()}")
    return cfg


def _at_0009(folder):
    folder.mkdir()
    command.upgrade(_cfg(folder), "0009")
    con = sqlite3.connect(folder / "project.db")
    con.execute(
        "INSERT INTO project (id, name, classes, schema_version, import_defaults, created_at, kind) VALUES"
        " ('p1', 'Old', '[{\"id\": \"c1\", \"name\": \"excavator\"}]', 1, '{}',"
        " '2026-01-01 00:00:00.000000', 'detect')"
    )
    con.execute(
        "INSERT INTO source (id, folder, site, settings, image_count, duplicate_count, created_at, kind)"
        " VALUES ('s1', 'C:/f', 'S', '{}', 1, 0, '2026-01-01 00:00:00.000000', 'images')"
    )
    con.execute(
        "INSERT INTO image (id, path, width, height, source_id, group_key, marked_empty, created_at)"
        " VALUES ('i1', 'images/a.jpg', 100, 100, 's1', '', 0, '2026-01-01 00:00:00.000000')"
    )
    con.execute(
        "INSERT INTO box"
        " (id, image_id, class_id, x, y, w, h, angle, provenance_kind, review_state, created_at)"
        " VALUES ('b1', 'i1', 'c1', 1, 1, 5, 5, 0, 'person', 'accepted', '2026-01-01 00:00:00.000000')"
    )
    con.commit()
    con.close()


@pytest.fixture
def engine(tmp_path):
    folder = tmp_path / "old"
    _at_0009(folder)
    eng = open_project_db(folder)
    yield eng
    eng.dispose()


def _columns(eng, table: str) -> set[str]:
    with eng.connect() as c:
        return {r[1] for r in c.exec_driver_sql(f"PRAGMA table_info({table})")}


def _cloud_finding(**kw) -> Finding:
    base = dict(
        number=1,
        type_id="t1",
        status="open",
        note="",
        created_by="human",
        anchor_kind="cloud",
        cloud_id="c1",
        x=0.0,
        y=0.0,
        z=0.0,
        data_type="point_cloud",
        data_id="c1",
    )
    return Finding(**{**base, **kw})


def test_the_chain_has_one_head_and_0010_is_on_it():
    script = ScriptDirectory.from_config(_cfg())
    heads = script.get_heads()
    assert len(heads) == 1, heads
    chain = {rev.revision for rev in script.walk_revisions(base="base", head=heads[0])}
    assert REVISION in chain


def test_a_0009_project_upgrades_with_its_rows_and_without_kind(engine):
    with engine.connect() as c:
        row = c.exec_driver_sql("SELECT id, name, classes, finding_seq FROM project").one()
        assert (row[0], row[1], row[3]) == ("p1", "Old", 0)
        assert "excavator" in row[2]
        assert c.exec_driver_sql("SELECT count(*) FROM box").scalar_one() == 1


@pytest.mark.parametrize("table", sorted(TABLES))
def test_every_model_column_exists(engine, table):
    assert {c.name for c in TABLES[table].__table__.columns} <= _columns(engine, table)


def test_the_box_class_index_exists(engine):
    with engine.connect() as c:
        names = {r[1] for r in c.exec_driver_sql("PRAGMA index_list(box)")}
    assert "ix_box_class" in names


def test_the_anchor_check_takes_one_kind_at_a_time(engine):
    factory = make_session_factory(engine)
    with factory() as s:
        s.add(_cloud_finding())
        s.commit()
    for bad in (_cloud_finding(number=2, map_id="m1"), _cloud_finding(number=3, z=None)):
        with factory() as s, pytest.raises(IntegrityError):
            s.add(bad)
            s.commit()


def test_a_box_with_a_finding_cannot_be_deleted_behind_its_back(engine):
    factory = make_session_factory(engine)
    with factory() as s:
        s.add(
            Finding(
                number=1,
                type_id="c1",
                status="open",
                note="",
                created_by="human",
                anchor_kind="image",
                image_id="i1",
                annotation_id="b1",
                data_type="image_set",
                data_id="s1",
            )
        )
        s.commit()
    with factory() as s, pytest.raises(IntegrityError):
        s.delete(s.get(Box, "b1"))
        s.commit()
