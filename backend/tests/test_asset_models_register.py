# backend/tests/test_asset_models_register.py
"""Register rows and the register CSV (spec §7, plan A1 task 3)."""

import csv

import pytest
from plant_helpers import KIPIC_SITE

from app.asset_models.assemble import CSV_COLUMNS, register_rows, site_label, write_csv
from app.asset_models.builders.base import REGISTRY, load_all
from app.asset_models.spec import AssetSpec, ItemFlag

COWORK_17 = (
    "node,tag,name,type,area,group,plant_E,plant_N,utm39_E,utm39_N,base_EL,height_m,top_EL,"
    "height_source,has_geometry,source_sheet,notes"
).split(",")


def item(id_, **kw):
    return {
        "id": id_,
        "name": id_.upper(),
        "type": "other",
        "footprint": {"kind": "rect", "center": [2408.3, 810.4], "size": [10.0, 4.0]},
        "base_el": 104.5,
        "top_el": 110.5,
        "height_source": "drawing",
        "source": {"kind": "drawing", "id": "d1"},
        **kw,
    }


def spec_of(items, site=KIPIC_SITE):
    return AssetSpec.model_validate({"site": site, "items": items})


def test_columns_are_cowork_order_plus_flags_and_confidence():
    assert CSV_COLUMNS[:17] == COWORK_17
    assert CSV_COLUMNS[17:] == ["flags", "confidence"]


def test_row_values_and_site_columns_match_cowork():
    spec = spec_of([item("10-A-0004", tag="10-A-0004", area="10")])
    [row] = register_rows(spec, {"d1": "P0058LNG-00-40-0-T0005"})
    assert list(row)[: len(CSV_COLUMNS)] == CSV_COLUMNS
    # Cowork register row 10-A-0004: plant (2408.3, 810.4) -> UTM-39 (246878.95, 3179542.26)
    assert row["utm39_E"] == pytest.approx(246878.95, abs=0.05)
    assert row["utm39_N"] == pytest.approx(3179542.26, abs=0.05)
    assert (row["plant_E"], row["plant_N"]) == (2408.3, 810.4)
    assert row["group"] == "Area_10" and row["tag"] == "10-A-0004"
    assert (row["base_EL"], row["height_m"], row["top_EL"]) == (104.5, 6.0, 110.5)
    assert row["height_source"] == "drawing" and row["confidence"] == "medium"
    assert row["source_sheet"] == "P0058LNG-00-40-0-T0005" and row["has_geometry"] is True
    assert 28.0 < row["lat"] < 29.5 and 47.5 < row["lon"] < 49.0


def test_defaulted_height_is_indicative_and_noted():
    load_all()
    d = REGISTRY["other"].default_height_m
    [row] = register_rows(spec_of([item("a", top_el=None, notes="Seen on T0005.")]))
    assert row["height_source"] == "indicative"
    assert row["height_m"] == pytest.approx(d)
    assert row["notes"] == f"Seen on T0005.; Height assumed {d:g} m (type default)."


def test_flags_merge_without_duplicate_codes():
    spec = spec_of([item("a", flags=[{"code": "height_mismatch", "value": 0.8}])])
    extra = {"a": [ItemFlag(code="builder_fallback", note="x"), ItemFlag(code="height_mismatch")]}
    [row] = register_rows(spec, extra_flags=extra, markers={"a"})
    assert [f["code"] for f in row["flags"]] == ["height_mismatch", "builder_fallback"]
    assert row["has_geometry"] is False


def test_group_names():
    rows = register_rows(spec_of([item("a", area="20"), item("b", area="Area_30_HP"), item("c")]))
    assert [r["group"] for r in rows] == ["Area_20", "Area_30_HP", "Area_unassigned"]


def test_no_site_leaves_site_columns_empty():
    [row] = register_rows(spec_of([item("a")], site=None))
    assert row["utm39_E"] is None and row["utm39_N"] is None and row["lon"] is None


def test_non_drawing_source_has_no_sheet():
    [row] = register_rows(spec_of([item("a", source={"kind": "assumed"})]), {"d1": "S"})
    assert row["source_sheet"] is None


def test_site_label():
    assert site_label(spec_of([])) == "utm39"
    assert site_label(spec_of([], site={**KIPIC_SITE, "crs": {"epsg": 2039}})) == "site"
    assert site_label(spec_of([], site=None)) == "site"


def test_write_csv_headers_cells_and_line_ends(tmp_path):
    spec = spec_of([item("a", flags=[{"code": "height_mismatch"}, {"code": "plan_offset", "value": 1.2}])])
    rows = register_rows(spec)
    p = tmp_path / "v1.csv"
    write_csv(rows, p, site_label="utm39")
    raw = p.read_bytes()
    assert raw.startswith(b"node,tag,name,type,area,group,plant_E,plant_N,utm39_E,utm39_N,")
    assert raw.count(b"\r\n") == 2 and not raw.startswith(b"\xef\xbb\xbf")
    [cells] = list(csv.DictReader(p.open(encoding="utf-8", newline="")))
    assert (
        cells["has_geometry"] == "yes"
        and cells["tag"] == ""
        and cells["flags"] == "height_mismatch;plan_offset"
    )
    assert cells["base_EL"] == "104.5" and cells["confidence"] == "medium"
    other = tmp_path / "v2.csv"
    write_csv(rows, other, site_label="site")
    assert other.read_text("utf-8").splitlines()[0].split(",")[8:10] == ["site_E", "site_N"]


def test_formula_like_text_is_neutralised(tmp_path):
    rows = register_rows(spec_of([item("a", name='=HYPERLINK("http://x")', notes="+1 note")]))
    p = tmp_path / "v1.csv"
    write_csv(rows, p)
    [cells] = list(csv.DictReader(p.open(encoding="utf-8", newline="")))
    assert cells["name"] == '\'=HYPERLINK("http://x")' and cells["notes"] == "'+1 note"


def test_quotes_and_commas_round_trip(tmp_path):
    rows = register_rows(spec_of([item("a", name='CONTROL BUILDING, "MAIN"'), item("b")]))
    p = tmp_path / "v1.csv"
    write_csv(rows, p)
    cells = list(csv.DictReader(p.open(encoding="utf-8", newline="")))
    assert [c["node"] for c in cells] == ["a", "b"] and cells[0]["name"] == 'CONTROL BUILDING, "MAIN"'


def test_empty_spec_writes_header_only(tmp_path):
    p = tmp_path / "v1.csv"
    write_csv(register_rows(spec_of([])), p)
    assert p.read_text("utf-8").splitlines() == [",".join(CSV_COLUMNS)]


def test_builder_defaults_go_into_notes():
    spec = spec_of([item("a", notes="Seen.")])
    [row] = register_rows(spec, defaults={"a": ["post", "height"]})
    assert row["notes"] == "Seen.; Defaults: post."
    [only_height] = register_rows(spec, defaults={"a": ["height"]})
    assert only_height["notes"] == "Seen."
    [assumed] = register_rows(spec_of([item("a", top_el=None, notes="Seen.")]), defaults={"a": ["height"]})
    assert assumed["notes"].startswith("Seen.; Height assumed ") and "Defaults" not in assumed["notes"]
