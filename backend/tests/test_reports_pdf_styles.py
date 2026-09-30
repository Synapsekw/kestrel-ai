"""Report paragraph styles (spec §10.1): fonts and sizes from the theme, colour helpers."""

from reportlab.lib import colors

from app.reports.pdf import fonts, styles


def test_styles_use_the_theme_sizes_and_the_embedded_fonts():
    st = styles.build_styles(fonts.EMBEDDED)
    assert (st.body.fontName, st.body.fontSize, st.body.leading) == ("KestrelSans", 9.5, 13)
    assert (st.h1.fontSize, st.h2.fontSize, st.h3.fontSize) == (18, 14, 11)
    assert st.h1.fontName == "KestrelSans-Bold"
    assert (st.mono.fontName, st.mono.fontSize) == ("KestrelMono", 8.5)
    assert st.cover_title.fontSize == 30 and st.cover_title.textColor == colors.white
    assert st.body.textColor == colors.HexColor("#15142B")


def test_fallback_styles_use_helvetica():
    st = styles.build_styles(fonts.FALLBACK)
    assert st.body.fontName == "Helvetica" and st.h1.fontName == "Helvetica-Bold"
    assert st.cell_mono.fontName == "Courier"


def test_safe_colour_accepts_hex_and_falls_back_on_anything_else():
    assert styles.safe_colour("#F59E0B") == colors.HexColor("#F59E0B")
    for bad in (None, "", "red", "#12345", "#GGGGGG", 7):
        assert styles.safe_colour(bad) == styles.colour("ungraded")


def test_tint_mixes_towards_white():
    t = styles.tint(styles.colour("violet"), 0.12)
    assert t.red > 0.9 and t.green > 0.9 and t.blue > 0.95
    assert styles.tint(colors.black, 1.0) == colors.Color(0, 0, 0)


def test_tone_style_colours_the_delta_and_defaults_to_neutral():
    st = styles.build_styles(fonts.EMBEDDED)
    assert styles.tone_style(st, "bad").textColor == styles.colour("tone_bad")
    assert styles.tone_style(st, "nonsense").textColor == styles.colour("tone_neutral")
