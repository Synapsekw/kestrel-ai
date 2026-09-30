"""Migration 0014 (spec 2026-09-26-reports section 6.1): report, report_version,
report_version_finding, report_asset. New tables only: a project at 0013 upgrades untouched; the
foreign keys and checks hold with foreign_keys=ON; the ORM and the migration agree."""

import importlib.util
import sqlite3

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy.exc import IntegrityError

from app.db.base import Base
from app.db.session import MIGRATIONS, make_session_factory, open_project_db
from app.reports.models import (
    REPORT_ASSET_KIND_CHECK,
    REPORT_VERSION_STATE_CHECK,
    Report,
    ReportAsset,
    ReportVersion,
    ReportVersionFinding,
)

REVISION = "0014"
PATH = MIGRATIONS / "versions" / "0014_reports.py"
TABLES = {
    "report": Report,
    "report_version": ReportVersion,
    "report_version_finding": ReportVersionFinding,
    "report_asset": ReportAsset,
}
STRUCTURAL = {"add_table", "remove_table", "add_column", "remove_column", "add_index", "remove_index"}


def _module():
    spec = importlib.util.spec_from_file_location("rev_0014", PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


DOWN = _module().down_revision


def _cfg(folder=None) -> Config:
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    if folder is not None:
        cfg.set_main_option("sqlalchemy.url", f"sqlite:///{(folder / 'project.db').as_posix()}")
    return cfg


def _tables(con) -> set[str]:
    return {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


def _table(diff) -> str:
    kind = diff[0]
    if kind in ("add_table", "remove_table"):
        return diff[1].name
    if kind in ("add_column", "remove_column"):
        return diff[2]
    if kind in ("add_index", "remove_index"):
        return diff[1].table.name
    return ""


@pytest.fixture
def engine(tmp_path):
    folder = tmp_path / "p"
    folder.mkdir()
    eng = open_project_db(folder)  # head, with PRAGMA foreign_keys=ON
    yield eng
    eng.dispose()


@pytest.fixture
def factory(engine):
    factory = make_session_factory(engine)
    with factory() as s:
        s.add(Report(id="r1", title="Harbour wall", config={}))
        s.add(Report(id="r2", title="Quay", config={}))
        s.commit()
    return factory


def _version(**kw) -> ReportVersion:
    base = dict(report_id="r1", number=None, state="rendering", files=[], config={}, stats={})
    return ReportVersion(**{**base, **kw})


def test_the_chain_has_one_head_and_0014_is_on_it():
    script = ScriptDirectory.from_config(_cfg())
    heads = script.get_heads()
    assert len(heads) == 1, heads
    assert REVISION in {rev.revision for rev in script.walk_revisions(base="base", head=heads[0])}


def test_0014_sits_on_the_cloud_workspace_revision():
    script = ScriptDirectory.from_config(_cfg())
    assert DOWN == "0013"
    assert script.get_revision(DOWN).down_revision == "0012"


def test_a_project_at_0013_upgrades_and_keeps_its_rows(tmp_path):
    folder = tmp_path / "old"
    folder.mkdir()
    command.upgrade(_cfg(folder), DOWN)
    con = sqlite3.connect(folder / "project.db")
    con.execute(
        "INSERT INTO point_cloud (id, name, status, source_path, source_size, created_at)"
        " VALUES ('c1', 'C', 'ready', 'C:/c.las', 1, '2026-01-01 00:00:00.000000')"
    )
    con.commit()
    con.close()

    command.upgrade(_cfg(folder), REVISION)

    con = sqlite3.connect(folder / "project.db")
    try:
        assert con.execute("SELECT id, name FROM point_cloud").fetchall() == [("c1", "C")]
        assert set(TABLES) <= _tables(con)
        for table in TABLES:
            assert con.execute(f"SELECT COUNT(*) FROM {table}").fetchone() == (0,)
    finally:
        con.close()


def test_0014_downgrades_to_0013(tmp_path):
    folder = tmp_path / "p"
    folder.mkdir()
    command.upgrade(_cfg(folder), REVISION)
    command.downgrade(_cfg(folder), DOWN)
    con = sqlite3.connect(folder / "project.db")
    try:
        assert not set(TABLES) & _tables(con)
        assert "point_cloud" in _tables(con)
    finally:
        con.close()


@pytest.mark.parametrize("table", sorted(TABLES))
def test_every_model_column_exists(engine, table):
    with engine.connect() as c:
        have = {r[1] for r in c.exec_driver_sql(f"PRAGMA table_info({table})")}
    assert {col.name for col in TABLES[table].__table__.columns} == have


def test_the_orm_and_the_migration_describe_the_same_tables(engine):
    with engine.connect() as conn:
        diffs = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    structural = [d for d in diffs if isinstance(d, tuple) and d[0] in STRUCTURAL and _table(d) in TABLES]
    assert structural == []


def test_new_rows_take_their_defaults(factory):
    with factory() as s:
        s.add(_version(id="v1"))
        s.commit()
    with factory() as s:
        report, version = s.get(Report, "r1"), s.get(ReportVersion, "v1")
        assert (report.archived, report.template_id) == (False, None)
        assert report.created_at is not None and report.updated_at is not None
        assert (version.state, version.number, version.issued_at, version.folder) == (
            "rendering",
            None,
            None,
            None,
        )


def test_many_rendering_rows_have_no_number_but_numbers_are_unique_per_report(factory):
    with factory() as s:
        s.add_all([_version(id="v1"), _version(id="v2"), _version(id="v3", number=1, state="ready")])
        s.add(_version(id="w1", report_id="r2", number=1, state="ready"))  # same number, other report
        s.commit()
    with factory() as s, pytest.raises(IntegrityError):
        s.add(_version(id="v4", number=1, state="ready"))
        s.commit()


def test_a_version_state_is_rendering_ready_or_failed(factory):
    with factory() as s, pytest.raises(IntegrityError):
        s.add(_version(id="v1", state="done"))
        s.commit()


def test_deleting_a_report_deletes_its_versions_and_their_findings(factory):
    with factory() as s:
        s.add(_version(id="v1", number=1, state="ready"))
        s.flush()
        s.add(ReportVersionFinding(version_id="v1", finding_id="f1", type_id="t1", severity=3, status="open"))
        s.commit()
    with factory() as s:
        s.delete(s.get(Report, "r1"))
        s.commit()
    with factory() as s:
        assert s.get(ReportVersion, "v1") is None
        assert s.get(ReportVersionFinding, ("v1", "f1")) is None


def test_deleting_a_baseline_version_unlinks_it(factory):
    with factory() as s:
        s.add(_version(id="v1", number=1, state="ready"))
        s.flush()
        s.add(_version(id="v2", number=2, state="ready", baseline_version_id="v1"))
        s.commit()
    with factory() as s:
        s.delete(s.get(ReportVersion, "v1"))
        s.commit()
    with factory() as s:
        assert s.get(ReportVersion, "v2").baseline_version_id is None  # ON DELETE SET NULL


def test_a_version_finding_outlives_its_finding(factory):
    """No FK to `finding`: a baseline must survive a finding deleted after the render."""
    with factory() as s:
        s.add(_version(id="v1", number=1, state="ready"))
        s.flush()
        s.add(
            ReportVersionFinding(
                version_id="v1", finding_id="gone", type_id="t1", severity=None, status="closed"
            )
        )
        s.commit()
    with factory() as s:
        assert s.get(ReportVersionFinding, ("v1", "gone")).status == "closed"


def test_an_asset_is_a_logo_and_unique_by_sha256(factory):
    def asset(id_, **kw):
        base = dict(
            id=id_, kind="logo", path=f"reports/assets/logo-{id_}.png", sha256="a" * 64, width=10, height=5
        )
        return ReportAsset(**{**base, **kw})

    with factory() as s:
        s.add(asset("a1"))
        s.commit()
    with factory() as s, pytest.raises(IntegrityError):
        s.add(asset("a2"))  # same sha256
        s.commit()
    with factory() as s, pytest.raises(IntegrityError):
        s.add(asset("a3", sha256="b" * 64, kind="banner"))
        s.commit()


def test_0014_freezes_its_checks_instead_of_importing_the_models():
    """A later model edit must not rewrite 0014's history: the revision carries its own copies."""
    assert "from app" not in PATH.read_text(encoding="utf-8")
    module = _module()
    assert module.REPORT_VERSION_STATE_CHECK == REPORT_VERSION_STATE_CHECK
    assert module.REPORT_ASSET_KIND_CHECK == REPORT_ASSET_KIND_CHECK
