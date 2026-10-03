"""Catalogue revision 0002 (spec 2026-09-26-reports section 6.2): report_template, seeded with the
four built-ins from a frozen copy of app/reports/templates/builtins.py; an existing 0001 catalogue
upgrades and keeps its types; the ORM and the migration agree."""

import importlib.util
from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect, select

from app.catalogue.db import CatalogueBase, CatalogueType, ReportTemplate
from app.catalogue.handle import MIGRATIONS, open_catalogue
from app.catalogue.paths import catalogue_root
from app.reports.schemas import ReportTemplate as ReportTemplateOut
from app.reports.templates.builtins import BUILTIN_TEMPLATES

PATH = MIGRATIONS / "versions" / "0002_report_templates.py"
STRUCTURAL = {"add_table", "remove_table", "add_column", "remove_column", "add_index", "remove_index"}


def _module():
    spec = importlib.util.spec_from_file_location("cat_0002", PATH)
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


def _at_0001_with_a_type(data_dir: Path) -> None:
    def go(cfg, conn):
        command.upgrade(cfg, "0001")
        conn.exec_driver_sql(
            "INSERT INTO catalogue_type (id, name, name_key, colour, kind, archived, origin, created_at,"
            " updated_at) VALUES ('t1', 'Crack', 'crack', '#ff0000', 'defect', 0, 'user',"
            " '2026-09-01 00:00:00.000000', '2026-09-01 00:00:00.000000')"
        )

    _run(data_dir, go)


def _out(row: ReportTemplate) -> ReportTemplateOut:
    return ReportTemplateOut.model_validate(
        {
            "id": row.id,
            "name": row.name,
            "description": row.description,
            "builtin": row.builtin,
            "config": row.config,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }
    )


def test_a_0001_catalogue_upgrades_keeps_its_types_and_gains_the_built_ins(tmp_path):
    _at_0001_with_a_type(tmp_path / "appdata")
    cat = open_catalogue(tmp_path / "appdata")
    try:
        with cat.engine.connect() as conn:
            assert conn.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one() >= "0002"
        with cat.session() as s:
            assert s.get(CatalogueType, "t1").name == "Crack"
            ids = [r.id for r in s.execute(select(ReportTemplate).order_by(ReportTemplate.id)).scalars()]
        assert sorted(ids) == sorted(t.id for t in BUILTIN_TEMPLATES)
    finally:
        cat.engine.dispose()


def test_the_seeded_rows_are_the_code_built_ins(tmp_path):
    cat = open_catalogue(tmp_path / "appdata")
    try:
        with cat.session() as s:
            for template in BUILTIN_TEMPLATES:
                stored = _out(s.get(ReportTemplate, template.id))
                # the frozen seed predates asset_summary: a seeded row lists the other eight sections
                mine = template.model_copy(
                    update={
                        "config": template.config.model_copy(
                            update={
                                "sections": [x for x in template.config.sections if x.key != "asset_summary"]
                            }
                        )
                    }
                )
                assert stored == mine, template.id
    finally:
        cat.engine.dispose()


# Report config pieces added after 0002, each read back by a seeded row as its default: the frozen 0002
# seed never carries them and must not be rewritten to (C0 Task 3b; R1 adds its own here).
ADDED_AFTER_0002 = {"brand_id", "csv_layout"}
SECTIONS_AFTER_0002 = {"asset_summary"}
OPTIONS_AFTER_0002 = {"finding_pages": {"min_severity"}}


def _as_of_0002(config: dict) -> dict:
    out = {k: v for k, v in config.items() if k not in ADDED_AFTER_0002}
    out["sections"] = [
        {
            **s,
            "options": {
                k: v for k, v in s["options"].items() if k not in OPTIONS_AFTER_0002.get(s["key"], set())
            },
        }
        for s in config["sections"]
        if s["key"] not in SECTIONS_AFTER_0002
    ]
    return out


def test_the_migration_carries_a_frozen_copy():
    """A later edit of builtins.py must not rewrite 0002's history, and the two must agree today."""
    assert "from app" not in PATH.read_text(encoding="utf-8")
    frozen = [{k: row[k] for k in ("id", "name", "description", "config")} for row in _module().BUILTIN_ROWS]
    code = [
        {
            "id": t.id,
            "name": t.name,
            "description": t.description,
            "config": _as_of_0002(t.config.model_dump(mode="json", by_alias=True)),
        }
        for t in BUILTIN_TEMPLATES
    ]
    assert frozen == code


def test_the_orm_and_the_migration_describe_the_same_table(tmp_path):
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
        d for d in diffs if isinstance(d, tuple) and d[0] in STRUCTURAL and table(d) == "report_template"
    ]
    assert structural == []


def test_0002_downgrades_to_0001(tmp_path):
    open_catalogue(tmp_path / "appdata").engine.dispose()

    def go(cfg, conn):
        command.downgrade(cfg, "0001")
        assert "report_template" not in inspect(conn).get_table_names()
        assert "catalogue_type" in inspect(conn).get_table_names()

    _run(tmp_path / "appdata", go)
