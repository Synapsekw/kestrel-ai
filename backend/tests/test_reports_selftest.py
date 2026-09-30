"""`kestrel-backend.exe reports-selftest` (spec §17 "Frozen"): TTF fonts, a gradient, JPEG passthrough,
a Drawing chart and a write-only XLSX, all inside the bundle."""

from pathlib import Path

from test_packaging_spec import _spec_datas_entries

from app.__main__ import run
from app.reports import selftest

BACKEND = Path(__file__).resolve().parents[1]


def test_selftest_facts():
    facts = selftest.run()
    assert facts["fonts"] == 3 and facts["gradient"] >= 1 and facts["jpeg"] == 1 and facts["chart"] == 1
    assert facts["xlsx"] == "Major" and facts["fill"].endswith("FFE08A") and facts["pdf_bytes"] > 1000


def test_the_entry_point_dispatches(capsys):
    assert run(["app", "reports-selftest"], freeze_support=lambda: None) == 0
    assert capsys.readouterr().out.startswith("reports ok fonts 3 gradient ")


def test_selftest_fails_by_name_without_fonts(monkeypatch, tmp_path, capsys):
    from app.reports.pdf import fonts

    monkeypatch.setattr(fonts, "FONT_DIR", tmp_path)
    monkeypatch.setattr(fonts, "_cache", {})
    assert selftest.main([]) == 1
    assert capsys.readouterr().out.startswith("reports FAILED fonts 0")


def test_the_spec_ships_the_fonts_folder():
    assert ("app/reports/fonts", "app/reports/fonts") in _spec_datas_entries()


def test_smoke_frozen_runs_it_after_the_volumes_selftest():
    text = (BACKEND / "scripts" / "smoke_frozen.ps1").read_text("utf-8")
    assert text.index("volumes-selftest") < text.index("reports-selftest")
    assert '-notmatch "reports ok"' in text
