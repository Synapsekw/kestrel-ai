"""Report fonts (spec §5, §16 "Fonts failed to register"): the committed TTFs, their licences, the
registration and the Helvetica fallback."""

import hashlib
import logging

from app.reports.pdf import fonts


def test_committed_fonts_match_their_recorded_sha256():
    for name, sha in fonts.FONT_SHA256.items():
        assert hashlib.sha256((fonts.FONT_DIR / name).read_bytes()).hexdigest() == sha, name
    assert fonts.verify_fonts() == 3


def test_the_ofl_licences_ship_next_to_the_fonts():
    for name in ("OFL-SpaceGrotesk.txt", "OFL-JetBrainsMono.txt"):
        assert "SIL Open Font License" in (fonts.FONT_DIR / name).read_text("utf-8")


def test_register_fonts_embeds_the_three_faces():
    from reportlab.pdfbase import pdfmetrics

    fonts._cache.clear()
    got = fonts.register_fonts()
    assert got == fonts.EMBEDDED and got.embedded
    for name in fonts.FACES:
        assert pdfmetrics.getFont(name).fontName == name
    assert fonts.register_fonts() is got  # cached


def test_missing_fonts_fall_back_to_helvetica_and_log(tmp_path, caplog):
    with caplog.at_level(logging.WARNING, logger="app.reports.pdf.fonts"):
        got = fonts.register_fonts(tmp_path)
    assert got == fonts.FALLBACK and not got.embedded
    assert got.sans == "Helvetica" and got.mono == "Courier"
    assert "Helvetica" in caplog.text
    assert fonts.verify_fonts(tmp_path) == 0


def test_a_corrupt_font_file_falls_back(tmp_path):
    for name in fonts.FACES.values():
        (tmp_path / name).write_bytes(b"not a font")
    assert fonts.register_fonts(tmp_path) == fonts.FALLBACK
