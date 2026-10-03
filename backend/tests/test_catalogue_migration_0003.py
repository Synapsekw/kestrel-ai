"""Catalogue revision 0003 (spec 2026-09-30-project-setup section 5; plan 2026-09-30-setup-u1):
`definition` and `severity_rules` on catalogue_type, origin 'template', and project_template seeded
with the three built-ins from a frozen copy of app/setup/builtins.py. An existing 0002 catalogue,
archived duplicates and hotkeys included, upgrades with every type intact, and 0003 downgrades."""

import importlib.util
import sqlite3
from pathlib import Path

import pytest
from alembic import command
from alembic import op as alembic_op
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, func, inspect, select
from sqlalchemy.exc import IntegrityError

from app.catalogue.db import CatalogueBase, CatalogueType, ProjectTemplate
from app.catalogue.handle import MIGRATIONS, open_catalogue
from app.catalogue.names import normalise_name
from app.catalogue.paths import catalogue_root
from app.setup.builtins import BUILTIN_IDS, BUILTIN_TEMPLATES, SEEDED_AT
from app.setup.schemas import ProjectTemplateOut

PATH = MIGRATIONS / "versions" / "0003_project_setup.py"
STRUCTURAL = {"add_table", "remove_table", "add_column", "remove_column", "add_index", "remove_index"}
T0 = "2026-09-01 00:00:00.000000"
# (id, name, name_key, hotkey, archived, origin, group). t1 and t2 share a normalised name and a
# hotkey, which only the partial unique indexes allow: a rebuild that lost their WHERE clauses fails.
TYPES_AT_0002 = [
    ("t1", "Crack", "crack", "c", 0, "user", "Concrete"),
    ("t2", "crack", "crack", "c", 1, "user", None),
    ("t3", "Excavator", "excavator", "1", 0, "migrated", "Machinery"),
]
COLUMNS = 'id, name, name_key, colour, kind, default_severity, hotkey, "group", archived, origin, created_at'


def _module():
    spec = importlib.util.spec_from_file_location("cat_0003", PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _cfg(url: str) -> Config:
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    cfg.set_main_option("sqlalchemy.url", url)
    return cfg


def _run(data_dir: Path, fn) -> None:
    root = catalogue_root(data_dir)
    root.mkdir(parents=True, exist_ok=True)
    url = f"sqlite:///{(root / 'catalogue.db').as_posix()}"
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            cfg = _cfg(url)
            cfg.attributes["connection"] = conn
            fn(cfg, conn)
    finally:
        engine.dispose()


def _sql(data_dir: Path, query: str) -> list[tuple]:
    con = sqlite3.connect(catalogue_root(data_dir) / "catalogue.db")
    try:
        return con.execute(query).fetchall()
    finally:
        con.close()


def _rows(data_dir: Path) -> list[tuple]:
    return _sql(data_dir, f"SELECT {COLUMNS} FROM catalogue_type ORDER BY id")


def _index_sql(data_dir: Path) -> dict[str, str]:
    rows = _sql(
        data_dir,
        "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'catalogue_type'"
        " AND sql IS NOT NULL",
    )
    return dict(rows)


def _at_0002_with_types(data_dir: Path) -> None:
    def go(cfg, conn):
        command.upgrade(cfg, "0002")
        for tid, name, key, hotkey, archived, origin, group in TYPES_AT_0002:
            conn.exec_driver_sql(
                "INSERT INTO catalogue_type (id, name, name_key, colour, kind, default_severity, hotkey,"
                ' "group", archived, origin, created_at, updated_at)'
                " VALUES (?, ?, ?, '#ff0000', 'defect', 2, ?, ?, ?, ?, ?, ?)",
                (tid, name, key, hotkey, group, archived, origin, T0, T0),
            )

    _run(data_dir, go)


def _type(name: str, **kw) -> CatalogueType:
    return CatalogueType(name=name, name_key=normalise_name(name), colour="#000000", kind="defect", **kw)


def _assert_partial(data_dir: Path) -> None:
    sql = _index_sql(data_dir)
    assert sql["ux_catalogue_type_live_name"].endswith("WHERE archived = 0")
    assert sql["ux_catalogue_type_live_hotkey"].endswith("WHERE archived = 0 AND hotkey IS NOT NULL")


def test_a_0002_catalogue_upgrades_and_keeps_every_type(tmp_path):
    data = tmp_path / "appdata"
    _at_0002_with_types(data)
    before = _rows(data)
    cat = open_catalogue(data)
    try:
        with cat.engine.connect() as conn:
            assert conn.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one() >= "0003"
        with cat.session() as s:
            rows = s.execute(select(CatalogueType).order_by(CatalogueType.id)).scalars().all()
            assert [(r.id, r.definition, r.severity_rules) for r in rows] == [
                (t[0], None, []) for t in TYPES_AT_0002
            ]
            assert sorted(s.execute(select(ProjectTemplate.id)).scalars()) == sorted(BUILTIN_IDS)
    finally:
        cat.engine.dispose()
    assert _rows(data) == before


def test_the_live_name_and_hotkey_indexes_stay_partial(tmp_path):
    data = tmp_path / "appdata"
    _at_0002_with_types(data)
    open_catalogue(data).engine.dispose()
    _assert_partial(data)
    cat = open_catalogue(data)
    try:
        with pytest.raises(IntegrityError), cat.session() as s:
            s.add(_type("CRACK"))  # a second live "crack"
            s.flush()
        with pytest.raises(IntegrityError), cat.session() as s:
            s.add(_type("Rust", hotkey="c"))  # the live hotkey c
            s.flush()
    finally:
        cat.engine.dispose()


def test_origin_takes_template_and_the_checks_still_hold(tmp_path):
    cat = open_catalogue(tmp_path / "appdata")
    try:
        with cat.session() as s:
            s.add(_type("Rust", origin="template"))
        with pytest.raises(IntegrityError), cat.session() as s:
            s.add(_type("Moss", origin="agent"))
            s.flush()
        with pytest.raises(IntegrityError), cat.session() as s:
            s.add(CatalogueType(name="Pit", name_key="pit", colour="#000000", kind="thing"))
            s.flush()
    finally:
        cat.engine.dispose()


def test_a_new_type_has_no_definition_and_no_rules_on_both_paths(tmp_path):
    data = tmp_path / "appdata"
    cat = open_catalogue(data)
    try:
        with cat.session() as s:
            row = _type("Rust")
            s.add(row)
            s.flush()
            assert (row.definition, row.severity_rules) == (None, [])
        with cat.session() as s:
            s.add(
                _type(
                    "Scale",
                    definition="Build-up on walls.",
                    severity_rules=[{"when": "Thick", "severity": 2}],
                )
            )
    finally:
        cat.engine.dispose()
    # A raw insert that names neither column (as 0002-era code would) gets the server default.
    con = sqlite3.connect(catalogue_root(data) / "catalogue.db")
    try:
        con.execute(
            "INSERT INTO catalogue_type (id, name, name_key, colour, kind, archived, origin, created_at,"
            " updated_at) VALUES ('raw', 'Raw', 'raw', '#000000', 'defect', 0, 'user', ?, ?)",
            (T0, T0),
        )
        con.commit()
        assert con.execute(
            "SELECT definition, severity_rules FROM catalogue_type WHERE id = 'raw'"
        ).fetchone() == (
            None,
            "[]",
        )
        scale = con.execute(
            "SELECT definition, severity_rules FROM catalogue_type WHERE name = 'Scale'"
        ).fetchone()
        assert scale == ("Build-up on walls.", '[{"when": "Thick", "severity": 2}]')
    finally:
        con.close()


def test_the_seeded_rows_are_the_code_built_ins(tmp_path):
    cat = open_catalogue(tmp_path / "appdata")
    try:
        with cat.session() as s:
            for template in BUILTIN_TEMPLATES:
                row = s.get(ProjectTemplate, template["id"])
                assert (row.name, row.description, row.config, row.builtin) == (
                    template["name"],
                    template["description"],
                    template["config"],
                    True,
                )
                assert row.name_key == normalise_name(row.name)
                assert row.created_at.replace(tzinfo=None) == row.updated_at.replace(tzinfo=None) == SEEDED_AT
                out = ProjectTemplateOut.model_validate(row, from_attributes=True)
                assert out.config.model_dump(mode="json") == template["config"]
    finally:
        cat.engine.dispose()


def test_the_built_ins_are_seeded_once(tmp_path):
    data = tmp_path / "appdata"
    first = open_catalogue(data)
    with first.session() as s:
        s.get(ProjectTemplate, "builtin-mapping").description = "Edited in place."
    first.engine.dispose()
    again = open_catalogue(data)
    try:
        with again.session() as s:
            assert s.execute(select(func.count()).select_from(ProjectTemplate)).scalar_one() == 3
            assert s.get(ProjectTemplate, "builtin-mapping").description == "Edited in place."
    finally:
        again.engine.dispose()


def test_template_names_are_unique_by_name_key(tmp_path):
    cat = open_catalogue(tmp_path / "appdata")
    try:
        with pytest.raises(IntegrityError), cat.session() as s:
            s.add(ProjectTemplate(name="MAPPING and survey", name_key="mapping and survey", config={}))
            s.flush()
    finally:
        cat.engine.dispose()


def test_the_migration_carries_a_frozen_copy():
    """A later edit of builtins.py must not rewrite 0003's history, and the two must agree today."""
    text = PATH.read_text(encoding="utf-8")
    assert "from app" not in text and "import app" not in text
    module = _module()
    frozen = [{k: row[k] for k in ("id", "name", "description", "config")} for row in module.BUILTIN_ROWS]
    assert frozen == BUILTIN_TEMPLATES
    assert [row["name_key"] for row in module.BUILTIN_ROWS] == [
        normalise_name(t["name"]) for t in BUILTIN_TEMPLATES
    ]
    assert module.SEEDED_AT == SEEDED_AT


def test_the_orm_and_the_migration_describe_the_same_tables(tmp_path):
    cat = open_catalogue(tmp_path / "appdata")
    try:
        with cat.engine.connect() as conn:
            diffs = compare_metadata(MigrationContext.configure(conn), CatalogueBase.metadata)
    finally:
        cat.engine.dispose()

    def table(d):
        kind = d[0]
        if kind in ("add_table", "remove_table"):
            return d[1].name
        if kind in ("add_column", "remove_column"):
            return d[2]
        return d[1].table.name if kind in ("add_index", "remove_index") else ""

    structural = [
        d
        for d in diffs
        if isinstance(d, tuple) and d[0] in STRUCTURAL and table(d) in ("project_template", "catalogue_type")
    ]
    assert structural == []


def test_0003_downgrades_to_0002_and_keeps_every_type(tmp_path):
    data = tmp_path / "appdata"
    _at_0002_with_types(data)
    before = _rows(data)
    cat = open_catalogue(data)
    with cat.session() as s:
        s.add(_type("Rust", id="t4", origin="template", definition="Orange.", severity_rules=[]))
    cat.engine.dispose()

    def go(cfg, conn):
        command.downgrade(cfg, "0002")
        insp = inspect(conn)
        assert "project_template" not in insp.get_table_names()
        assert not {"definition", "severity_rules"} & {c["name"] for c in insp.get_columns("catalogue_type")}
        assert (
            conn.exec_driver_sql("SELECT origin FROM catalogue_type WHERE id = 't4'").scalar_one() == "user"
        )

    _run(data, go)
    assert [r for r in _rows(data) if r[0] != "t4"] == before
    _assert_partial(data)


def test_an_interrupted_run_that_dropped_the_partial_indexes_recovers(tmp_path):
    """pysqlite commits DDL at once: a run that died after the drops leaves 0002 with no indexes."""
    data = tmp_path / "appdata"
    _at_0002_with_types(data)
    _run(
        data,
        lambda cfg, conn: [
            conn.exec_driver_sql("DROP INDEX ux_catalogue_type_live_hotkey"),
            conn.exec_driver_sql("DROP INDEX ux_catalogue_type_live_name"),
        ],
    )
    before = _rows(data)
    open_catalogue(data).engine.dispose()
    _assert_partial(data)
    assert _rows(data) == before


def test_a_failure_after_the_rebuild_rolls_back_and_the_next_open_recovers(tmp_path, monkeypatch):
    """The seed insert dies after the batch rebuild: the open raises, and the next open still reaches 0003."""
    data = tmp_path / "appdata"
    _at_0002_with_types(data)
    before = _rows(data)

    def boom(*args, **kwargs):
        raise RuntimeError("seed failed")

    with monkeypatch.context() as patched:
        patched.setattr(alembic_op, "bulk_insert", boom)
        with pytest.raises(Exception, match="seed failed"):
            open_catalogue(data)

    cat = open_catalogue(data)
    try:
        with cat.engine.connect() as conn:
            assert conn.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one() >= "0003"
        with cat.session() as s:
            assert sorted(s.execute(select(ProjectTemplate.id)).scalars()) == sorted(BUILTIN_IDS)
    finally:
        cat.engine.dispose()
    assert _rows(data) == before
    _assert_partial(data)


def test_a_stray_alembic_temp_table_does_not_wedge_the_upgrade(tmp_path):
    data = tmp_path / "appdata"
    _at_0002_with_types(data)
    _run(
        data,
        lambda cfg, conn: conn.exec_driver_sql("CREATE TABLE _alembic_tmp_catalogue_type (id VARCHAR(36))"),
    )
    before = _rows(data)
    open_catalogue(data).engine.dispose()
    _assert_partial(data)
    assert _rows(data) == before
    assert _sql(data, "SELECT name FROM sqlite_master WHERE name = '_alembic_tmp_catalogue_type'") == []
