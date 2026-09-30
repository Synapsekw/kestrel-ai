"""The print theme (spec 2026-09-26-reports §10.1): one source, contract/fixtures/report-theme.json,
pinned here for the backend and by R6's printTheme test for the preview."""

import json
import re
from pathlib import Path

from app.reports import theme

FIXTURE = Path(__file__).resolve().parents[2] / "contract" / "fixtures" / "report-theme.json"
HEX = re.compile(r"^#[0-9A-F]{6}$")


def test_theme_equals_the_contract_fixture():
    assert theme.THEME == json.loads(FIXTURE.read_text("utf-8"))
    assert theme.THEME_VERSION == theme.THEME["version"] == 1


def test_spec_colours_and_sizes_are_verbatim():
    c = theme.THEME["colours"]
    assert (c["ink"], c["muted"], c["rule"], c["head_fill"]) == ("#15142B", "#5E5C7A", "#DAD8EA", "#F3F1FC")
    assert (c["violet"], c["violet_print"], c["teal"], c["teal_print"]) == (
        "#6A5CFF",
        "#8F7BFF",
        "#0F8F76",
        "#5FE3C0",
    )
    assert theme.THEME["cover"]["gradient"] == ["#3B2A7A", "#6A5CFF", "#0F5B66"]
    assert theme.THEME["cover"]["band_fraction"] == 0.38 and theme.THEME["cover"]["title_pt"] == 30
    t = theme.THEME["type"]
    assert (t["body_pt"], t["body_leading_pt"], t["h1_pt"], t["h2_pt"], t["h3_pt"], t["mono_pt"]) == (
        9.5,
        13,
        18,
        14,
        11,
        8.5,
    )
    assert theme.THEME["page"]["margin_mm"] == 18 and theme.THEME["page"]["radius_mm"] == 3
    assert theme.THEME["severity"]["pill_tint"] == 0.12
    assert theme.THEME["finding"]["main_mm"] == [170, 105]


def test_every_colour_is_an_uppercase_hex():
    values = list(theme.THEME["colours"].values()) + theme.THEME["cover"]["gradient"]
    values += theme.THEME["chart"]["palette"]
    assert values and all(HEX.match(v) for v in values), [v for v in values if not HEX.match(v)]


def test_theme_module_does_not_import_reportlab():
    assert "reportlab" not in Path(theme.__file__).read_text("utf-8")
