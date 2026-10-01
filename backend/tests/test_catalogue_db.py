"""catalogue.db (spec 2026-09-26-foundation section 7.1): its own file next to library.db, its own
Alembic history at 0001, D4's severity scale seeded once, and live names and hotkeys unique in the
database itself, not only in Python."""

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.catalogue.db import CatalogueType, SeverityLevel
from app.catalogue.handle import MIGRATIONS, open_catalogue
from app.catalogue.paths import catalogue_root

AUTH = {"Authorization": "Bearer test-token"}


@pytest.fixture
def cat(tmp_path):
    handle = open_catalogue(tmp_path)
    yield handle
    handle.engine.dispose()


def _type(name: str, key: str, **kw) -> CatalogueType:
    return CatalogueType(
        name=name, name_key=key, colour=kw.pop("colour", "#ff0000"), kind=kw.pop("kind", "defect"), **kw
    )


def test_the_catalogue_lives_next_to_library_db(tmp_path):
    assert catalogue_root(tmp_path) == tmp_path / "library"


def test_first_open_creates_the_file_and_seeds_the_default_scale(cat, tmp_path):
    assert (tmp_path / "library" / "catalogue.db").is_file()
    with cat.session() as s:
        rows = s.execute(select(SeverityLevel).order_by(SeverityLevel.level)).scalars()
        levels = [(r.level, r.name, r.colour) for r in rows]
    assert levels == [
        (1, "Minor", "#3fb68e"),
        (2, "Moderate", "#e2bf2e"),
        (3, "Major", "#ff9c3a"),
        (4, "Critical", "#ff5a4f"),
    ]


def test_reopening_keeps_an_edited_scale(tmp_path):
    first = open_catalogue(tmp_path)
    with first.session() as s:
        s.get(SeverityLevel, 4).name = "Urgent"
    first.engine.dispose()
    again = open_catalogue(tmp_path)
    try:
        with again.session() as s:
            names = [r.name for r in s.execute(select(SeverityLevel).order_by(SeverityLevel.level)).scalars()]
    finally:
        again.engine.dispose()
    assert names == ["Minor", "Moderate", "Major", "Urgent"]


def test_live_names_are_unique_but_an_archived_name_may_return(cat):
    with cat.session() as s:
        s.add(_type("Crack", "crack", archived=True))
        s.add(_type("crack", "crack"))
    with pytest.raises(IntegrityError), cat.session() as s:
        s.add(_type("CRACK", "crack"))
        s.flush()


def test_live_hotkeys_are_unique(cat):
    with cat.session() as s:
        s.add(_type("Crack", "crack", hotkey="c"))
        s.add(_type("Spall", "spall", hotkey="c", archived=True))
    with pytest.raises(IntegrityError), cat.session() as s:
        s.add(_type("Corrosion", "corrosion", hotkey="c"))
        s.flush()


def test_kind_is_defect_or_object(cat):
    with pytest.raises(IntegrityError), cat.session() as s:
        s.add(_type("Thing", "thing", kind="thing"))
        s.flush()


def test_the_catalogue_history_has_one_head_and_0003_is_on_it():
    """0002 is Reports' `report_template` (plan 2026-09-30-reports-r0); 0003 is project setup's type
    fields and `project_template` (plan 2026-09-30-setup-u1). A later revision keeps this passing."""
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    script = ScriptDirectory.from_config(cfg)
    heads = script.get_heads()
    assert len(heads) == 1, heads
    assert "0003" in {rev.revision for rev in script.walk_revisions(base="base", head=heads[0])}


def test_the_app_opens_the_catalogue(client):
    state = client.app.state
    assert state.catalogue is not None and state.catalogue_error is None
    assert state.jobs.catalogue is state.catalogue
    assert state.projects.catalogue is state.catalogue


def test_the_app_starts_when_the_catalogue_cannot_open(app, monkeypatch):
    def broken(data_dir):
        raise OSError("disk says no")

    monkeypatch.setattr("app.catalogue.handle.open_catalogue", broken)
    with TestClient(app, headers=AUTH) as c:
        assert c.get("/api/v1/health").status_code == 200
        assert app.state.catalogue is None
        assert "disk says no" in app.state.catalogue_error
        assert app.state.jobs.catalogue is None
