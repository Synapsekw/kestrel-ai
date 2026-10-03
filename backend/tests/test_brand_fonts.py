"""Brand fonts (spec 2026-10-02-asset-findings §5.8: Nunito Sans, Poppins and Inter, SIL OFL 1.1,
licence files shipped; plan D2 Task 2)."""

import hashlib
import logging
from pathlib import Path

from app.brands import fonts

SPEC_FILE = Path(__file__).resolve().parents[1] / "kestrel_backend.spec"


def test_committed_brand_fonts_match_their_recorded_sha256():
    for name, sha in fonts.FONT_SHA256.items():
        assert hashlib.sha256((fonts.FONT_DIR / name).read_bytes()).hexdigest() == sha, name
    assert fonts.verify_fonts() == 6


def test_every_family_ships_its_ofl_licence():
    assert set(fonts.FAMILIES) == {"Nunito Sans", "Poppins", "Inter"}
    for family in fonts.FAMILIES.values():
        text = (fonts.FONT_DIR / family.licence).read_text("utf-8")
        assert "SIL Open Font License" in text
        assert family.regular in fonts.FONT_SHA256 and family.bold in fonts.FONT_SHA256


def test_font_files_resolves_a_family_and_refuses_the_rest(tmp_path):
    regular, bold = fonts.font_files("Poppins")
    assert (regular.name, bold.name) == ("Poppins-SemiBold.ttf", "Poppins-Bold.ttf")
    assert fonts.font_files(None) is None
    assert fonts.font_files("Space Grotesk") is None  # the theme's own font, not a brand font
    assert fonts.font_files("Comic Sans") is None
    assert fonts.font_files("Inter", font_dir=tmp_path) is None  # files missing


def test_register_family_embeds_regular_and_bold():
    from reportlab.pdfbase import pdfmetrics

    fonts._registered.clear()
    names = fonts.register_family("Nunito Sans")
    assert names == ("Brand-NunitoSans", "Brand-NunitoSans-Bold")
    for name in names:
        assert pdfmetrics.getFont(name).fontName == name
    assert fonts.register_family("Nunito Sans") is names  # cached


def test_register_family_returns_none_for_a_theme_font_or_a_broken_file(tmp_path, caplog):
    assert fonts.register_family(None) is None
    assert fonts.register_family("Space Grotesk") is None
    family = fonts.FAMILIES["Inter"]
    (tmp_path / family.regular).write_bytes(b"not a font")
    (tmp_path / family.bold).write_bytes(b"not a font")
    with caplog.at_level(logging.WARNING, logger="app.brands.fonts"):
        assert fonts.register_family("Inter", font_dir=tmp_path) is None
    assert "Inter" in caplog.text


def test_the_frozen_bundle_carries_the_brand_fonts():
    text = SPEC_FILE.read_text("utf-8")
    assert '(str(Path(SPECPATH) / "app" / "brands" / "fonts"), "app/brands/fonts")' in text
