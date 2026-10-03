"""The report brand (spec 2026-10-02-asset-findings §5.8, §10), resolved through D2."""

from PIL import Image
from reports_rows import GEN, config

from app.brands import store
from app.brands.builtins import BUILTIN_EAND
from app.reports.brand import resolve_brand
from app.reports.outline import build_outline
from app.reports.theme import THEME, with_brand


def _cfg(brand_id=BUILTIN_EAND):
    cfg = config(sections=("cover",), cover={"client": "Client X"})
    return cfg.model_copy(update={"brand_id": brand_id})


def test_no_brand_id_is_no_brand(handle):
    assert resolve_brand(handle, config(), GEN) is None


def test_an_unknown_brand_is_no_brand(handle):
    assert resolve_brand(handle, _cfg("no-such-brand"), GEN) is None


def test_a_builtin_brand_resolves_through_d2(handle):
    b = resolve_brand(handle, _cfg(), GEN)
    row = store.get_brand(handle.catalogue, BUILTIN_EAND)
    assert (b.id, b.name) == (row.id, row.name)
    assert b.theme == with_brand(THEME, row)
    assert b.footer_left == store.confidentiality_line(row, GEN.year, "Client X")
    assert b.footer_right == row.website
    assert b.text_family == b.theme["fonts"]["sans"]
    assert b.numerals_family == b.theme["fonts"].get("numerals", b.text_family)
    assert b.author == (row.pdf_author or row.owner)
    assert b.cover_logo is None and b.header_logo is None


def test_logos_resolve_to_the_app_level_files(handle, tmp_path):
    png = tmp_path / "logo.png"
    Image.new("RGBA", (200, 80), (200, 0, 0, 255)).save(png)
    store.set_logo(handle.catalogue, BUILTIN_EAND, "on_dark", str(png))
    store.set_logo(handle.catalogue, BUILTIN_EAND, "flat", str(png))
    b = resolve_brand(handle, _cfg(), GEN)
    assert b.cover_logo.is_file() and b.cover_logo.parent.name == store.LOGO_DIR
    assert b.header_logo.is_file()


def test_the_outline_warns_when_the_brand_is_gone(handle):
    out = build_outline(handle, "r-test", _cfg("no-such-brand"), generated_at=GEN)
    assert "brand_missing" in [w.code for w in out.warnings]
    out = build_outline(handle, "r-test", _cfg(), generated_at=GEN)
    assert "brand_missing" not in [w.code for w in out.warnings]
