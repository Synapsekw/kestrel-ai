"""The Overview's migration-warning banner (foundation spec §9.1, §11.4 report)."""

import json
from types import SimpleNamespace

from app.migration import banners
from app.overview import service as overview_service


def _handle(tmp_path, report=None):
    if report is not None:
        (tmp_path / "backups").mkdir()
        (tmp_path / "backups" / "migration-v2.json").write_text(json.dumps(report), "utf-8")
    return SimpleNamespace(folder=tmp_path)


def test_no_report_or_no_warnings_means_no_banner(tmp_path):
    assert banners.migration_banners(_handle(tmp_path)) == []
    assert banners.migration_banners(_handle(tmp_path, {"warnings": []})) == []


def test_warnings_become_one_warn_banner(tmp_path):
    [b] = banners.migration_banners(_handle(tmp_path, {"warnings": ["a", "b"]}))
    assert b == {
        "kind": "migration_warning",
        "tone": "warn",
        "message": (
            "The upgrade finished with 2 notes. "
            "They are listed in backups/migration-v2.json in the project folder."
        ),
        "action": None,
    }


def test_one_warning_is_one_note(tmp_path):
    [b] = banners.migration_banners(_handle(tmp_path, {"warnings": ["a"]}))
    assert b["message"].startswith("The upgrade finished with 1 note.")


def test_an_unreadable_report_is_ignored(tmp_path):
    (tmp_path / "backups").mkdir()
    (tmp_path / "backups" / "migration-v2.json").write_text("{not json", "utf-8")
    assert banners.migration_banners(SimpleNamespace(folder=tmp_path)) == []


def test_it_is_registered_once():
    banners.register()
    banners.register()
    assert overview_service.BANNER_PROVIDERS.count(banners.migration_banners) == 1


def test_the_app_registers_it_on_start(client):
    assert overview_service.BANNER_PROVIDERS.count(banners.migration_banners) == 1
