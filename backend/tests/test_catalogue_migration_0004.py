"""Catalogue revision 0004 (spec 2026-10-02-asset-findings §5.8; plan D2 Task 3): `brand`, seeded with
the e& and White label built-ins from a frozen copy of app/brands/builtins.py. An existing 0003
catalogue upgrades with its types and templates intact, and 0004 downgrades."""

import importlib.util
import sqlite3
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, func, inspect, select
from sqlalchemy.exc import IntegrityError

from app.brands import fonts
from app.brands.builtins import BUILTIN_BRANDS, BUILTIN_EAND, BUILTIN_IDS, SEEDED_AT
from app.catalogue.db import Brand, CatalogueBase, ProjectTemplate
from app.catalogue.handle import MIGRATIONS, open_catalogue
from app.catalogue.names import normalise_name
from app.catalogue.paths import catalogue_root

PATH = MIGRATIONS / "versions" / "0004_brands.py"
STRUCTURAL = {"add_table", "remove_table", "add_column", "remove_column", "add_index", "remove_index"}
T0 = "2026-09-01 00:00:00.000000"


def _module():
    spec = importlib.util.spec_from_file_location("cat_0004", PATH)
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


def _at_0003_with_a_type(data_dir: Path) -> None:
    def go(cfg, conn):
        command.upgrade(cfg, "0003")
        conn.exec_driver_sql(
            "INSERT INTO catalogue_type (id, name, name_key, colour, kind, default_severity, hotkey,"
            ' "group", archived, origin, created_at, updated_at, severity_rules)'
            " VALUES ('t1', 'Crack', 'crack', '#ff0000', 'defect', 2, 'c', NULL, 0, 'user', ?, ?, '[]')",
            (T0, T0),
        )

    _run(data_dir, go)


def _types(data_dir: Path) -> list[tuple]:
    con = sqlite3.connect(catalogue_root(data_dir) / "catalogue.db")
    try:
        return con.execute("SELECT id, name, hotkey FROM catalogue_type ORDER BY id").fetchall()
    finally:
        con.close()


def test_0004_is_on_the_single_catalogue_head():
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    script = ScriptDirectory.from_config(cfg)
    heads = script.get_heads()
    assert len(heads) == 1, heads
    assert "0004" in {rev.revision for rev in script.walk_revisions(base="base", head=heads[0])}
    assert script.get_revision("0004").down_revision == "0003"


def test_a_0003_catalogue_upgrades_keeps_its_rows_and_gains_the_brands(tmp_path):
    data = tmp_path / "appdata"
    _at_0003_with_a_type(data)
    before = _types(data)
    cat = open_catalogue(data)
    try:
        with cat.session() as s:
            assert sorted(s.execute(select(Brand.id)).scalars()) == sorted(BUILTIN_IDS)
            assert s.execute(select(func.count()).select_from(ProjectTemplate)).scalar_one() == 3
    finally:
        cat.engine.dispose()
    assert _types(data) == before


def test_the_seeded_rows_are_the_code_built_ins(tmp_path):
    cat = open_catalogue(tmp_path / "appdata")
    try:
        with cat.session() as s:
            for brand in BUILTIN_BRANDS:
                row = s.get(Brand, brand["id"])
                got = {k: getattr(row, k) for k in brand}
                assert got == brand
                assert row.builtin is True
                assert row.name_key == normalise_name(row.name)
                assert (row.logo_on_light, row.logo_on_dark, row.logo_flat) == (None, None, None)
                assert row.created_at.replace(tzinfo=None) == row.updated_at.replace(tzinfo=None) == SEEDED_AT
    finally:
        cat.engine.dispose()


def test_the_e_and_brand_carries_the_kit_values():
    """Kit brands/eand/brand.yaml: colours, Nunito Sans text, Poppins numerals; no logo (A10)."""
    eand = next(b for b in BUILTIN_BRANDS if b["id"] == BUILTIN_EAND)
    assert eand["name"] == "e&"
    assert eand["colors"] == {
        "accent": "#BC0000",
        "accent_dark": "#9E0000",
        "navy": "#141D2D",
        "ink": "#1A1A1A",
        "pale": "#FFE5E5",
        "line": "#E7E4DE",
    }
    assert (eand["font_text"], eand["font_numerals"]) == ("Nunito Sans", "Poppins")
    assert (eand["website"], eand["owner"], eand["pdf_author"]) == (
        "www.eand.com",
        "e&",
        "e& Drones, Robotics & AI",
    )
    assert eand["confidentiality"].startswith("© {year} e&. All rights reserved.")
    assert "logo_on_light" not in eand


def test_every_built_in_names_bundled_fonts_and_has_no_dashes():
    for brand in BUILTIN_BRANDS:
        assert brand["font_text"] in fonts.FAMILIES and brand["font_numerals"] in fonts.FAMILIES
        text = " ".join(str(v) for v in brand.values())
        assert "—" not in text and "–" not in text


def test_the_built_ins_are_seeded_once(tmp_path):
    data = tmp_path / "appdata"
    first = open_catalogue(data)
    with first.session() as s:
        s.get(Brand, BUILTIN_EAND).website = "www.example.com"
    first.engine.dispose()
    again = open_catalogue(data)
    try:
        with again.session() as s:
            assert s.execute(select(func.count()).select_from(Brand)).scalar_one() == 2
            assert s.get(Brand, BUILTIN_EAND).website == "www.example.com"
    finally:
        again.engine.dispose()


def test_brand_names_are_unique_by_name_key(tmp_path):
    cat = open_catalogue(tmp_path / "appdata")
    try:
        with pytest.raises(IntegrityError), cat.session() as s:
            s.add(Brand(name="E&", name_key="e&", colors={}))
            s.flush()
    finally:
        cat.engine.dispose()


def test_the_migration_carries_a_frozen_copy():
    """A later edit of builtins.py must not rewrite 0004's history, and the two must agree today."""
    text = PATH.read_text(encoding="utf-8")
    assert "from app" not in text and "import app" not in text
    module = _module()
    frozen = [{k: v for k, v in row.items() if k != "name_key"} for row in module.BUILTIN_ROWS]
    assert frozen == BUILTIN_BRANDS
    assert [row["name_key"] for row in module.BUILTIN_ROWS] == [
        normalise_name(b["name"]) for b in BUILTIN_BRANDS
    ]
    assert module.SEEDED_AT == SEEDED_AT


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

    structural = [d for d in diffs if isinstance(d, tuple) and d[0] in STRUCTURAL and table(d) == "brand"]
    assert structural == []


def test_0004_downgrades_to_0003_and_keeps_every_type(tmp_path):
    data = tmp_path / "appdata"
    _at_0003_with_a_type(data)
    before = _types(data)
    open_catalogue(data).engine.dispose()

    def go(cfg, conn):
        command.downgrade(cfg, "0003")
        assert "brand" not in inspect(conn).get_table_names()
        assert conn.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one() == "0003"

    _run(data, go)
    assert _types(data) == before
