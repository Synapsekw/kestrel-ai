# backend/tests/test_plant_score.py
"""The plant register scorer against Cowork's KIPIC register (spec 2026-10-03 §13, K1)."""

import copy
import json
import math
from pathlib import Path

import pytest

from app.asset_models import score as sc

DATA = Path(__file__).parent / "data" / "plant"
REGISTER = DATA / "kipic_register.csv"
LANDMASK = DATA / "kipic_landmask.json"


@pytest.fixture(scope="module")
def ref() -> list[dict]:
    return sc.read_register(REGISTER)


def _tagged(rows):
    return [r for r in rows if r["tag"]]


def test_fixture_is_the_cowork_register(ref):
    assert len(ref) == 885
    assert len(_tagged(ref)) == 404
    assert list(ref[0])[:17] == [
        "node", "tag", "name", "type", "area", "group", "plant_E", "plant_N", "utm39_E", "utm39_N",
        "base_EL", "height_m", "top_EL", "height_source", "has_geometry", "source_sheet", "notes",
    ]  # fmt: skip
    assert {r["type"] for r in ref} <= set(sc.TYPE_FAMILY)


def test_tags_normalise_case_spaces_and_dashes():
    assert sc.normalise_tag("20-T-0001") == sc.normalise_tag(" 20 – t – 0001 ") == "20T0001"
    assert sc.normalise_tag("70-S-0001A/B") == "70S0001A/B"
    assert sc.normalise_tag(None) == sc.normalise_tag("  ") == ""


def test_type_match_rules():
    assert sc.types_match("pump", "pump")
    assert sc.types_match("package", "pump") and sc.types_match("compressor", "package")
    assert not sc.types_match("package", "building")
    assert sc.types_match("other", "building") and sc.types_match("trestle", "other")
    assert sc.types_match("composite", "tank_lng")
    assert not sc.types_match("fence", "pump")


def test_cowork_against_itself_is_100_percent(ref):
    rep = sc.score(ref, ref)
    assert (rep.tagged_ref, rep.tagged_found, rep.type_match) == (404, 404, 404)
    assert rep.recall == rep.type_accuracy == rep.within_tol == 1.0
    assert rep.pos_err_p50_m == rep.pos_err_p95_m == 0.0
    assert rep.missing == [] and rep.extra == []
    assert len(rep.required_present) == 12 and all(rep.required_present.values())
    assert rep.landmask_hausdorff_m is None
    assert all(a["recall"] == 1.0 for a in rep.by_area.values())


def _shift(row, de, dn=0.0):
    row["plant_E"] = f"{float(row['plant_E']) + de:.2f}"
    row["plant_N"] = f"{float(row['plant_N']) + dn:.2f}"


def test_perturbed_copy_gives_the_expected_numbers(ref):
    gen = copy.deepcopy(ref)
    pool = [r for r in _tagged(gen) if not r["tag"].startswith("20-T-") and r["plant_E"]]
    dropped = pool[:10]
    retyped = [r for r in pool[10:] if sc.TYPE_FAMILY[r["type"]] == "equipment" and r["type"] != "package"][
        :5
    ]
    as_package = [r for r in pool[10:] if r["type"] in ("pump", "vessel_v") and r not in retyped][:3]
    as_other = [r for r in pool[10:] if r["type"] == "building"][:2]
    rest = [r for r in pool[10:] if r not in retyped + as_package + as_other]
    near, far, restyled = rest[:20], rest[20:30], rest[30:60]
    for r in retyped:
        r["type"] = "fence"
    for r in as_package:
        r["type"] = "package"
    for r in as_other:
        r["type"] = "other"
    for r in near:
        _shift(r, 3.0)  # within the 5 m tolerance (no footprint sizes)
    for r in far:
        _shift(r, 6.0)
    for r in restyled:
        r["tag"] = " " + r["tag"].lower().replace("-", " – ") + " "
    drop_tags = {r["tag"] for r in dropped}
    gen = [r for r in gen if r["tag"] not in drop_tags and r["tag"] != "20-T-0003"]
    gen += [
        {"node": "x1", "tag": "99-X-0001", "type": "pump", "plant_E": "1", "plant_N": "1"},
        {"node": "x2", "tag": "99-X-0002", "type": "pump", "plant_E": "", "plant_N": ""},
    ]
    rep = sc.score(gen, ref)
    assert rep.tagged_found == 404 - 11
    assert rep.recall == pytest.approx(393 / 404)
    assert rep.type_match == 393 - 5
    assert rep.type_accuracy == pytest.approx(388 / 404)
    assert rep.missing == sorted(drop_tags | {"20-T-0003"})
    assert rep.extra == ["99-X-0001", "99-X-0002"]
    positioned = sum(1 for r in _tagged(ref) if r["plant_E"] and r["tag"] not in drop_tags | {"20-T-0003"})
    assert rep.within_tol == pytest.approx((positioned - 10) / positioned)
    assert rep.pos_err_p50_m == 0.0
    assert rep.pos_err_p95_m == pytest.approx(3.0, abs=0.01)
    assert rep.required_present["20-T-0003"] is False
    assert all(v for k, v in rep.required_present.items() if k != "20-T-0003")
    area = dropped[0]["area"] or "(none)"
    lost = sum(1 for r in dropped if (r["area"] or "(none)") == area)
    assert rep.by_area[area]["found"] == rep.by_area[area]["ref"] - lost


def test_rows_without_coordinates_count_as_found_not_positioned(ref):
    gen = copy.deepcopy(ref)
    for r in _tagged(gen)[:5]:
        r["plant_E"] = r["plant_N"] = ""
    rep = sc.score(gen, ref)
    assert rep.tagged_found == 404 and rep.within_tol == 1.0


def test_footprint_size_sets_the_2_m_tolerance():
    assert sc.tolerance_m({}) == 5.0
    assert sc.tolerance_m({"footprint_m": 4.0}) == 5.0
    assert sc.tolerance_m({"footprint_m": 90.0}) == 2.0
    gen = [{"tag": "A-1", "type": "pump", "plant_E": "0", "plant_N": "3", "footprint_m": 12.0}]
    rep = sc.score(gen, [{"tag": "A-1", "type": "pump", "plant_E": "0", "plant_N": "0"}])
    assert rep.within_tol == 0.0 and rep.pos_err_p50_m == 3.0


def test_required_present_tracks_jetties_trestles_and_dolphins(ref):
    gen = copy.deepcopy(ref)
    head = next(r for r in gen if r["node"] == "jetty1-loading-platform")
    _shift(head, 40.0)
    dolphin = next(r for r in gen if r["type"] == "dolphin")
    _shift(dolphin, 0.0, 30.0)
    gen = [r for r in gen if r["node"] != "trestle-shore"]
    req = sc.required_present(gen, ref)
    assert req["jetty_head_1"] is False and req["jetty_head_2"] is True
    assert req["dolphins"] is False and req["trestles"] is False
    assert all(req[f"20-T-000{k}"] for k in range(1, 9))


def test_required_present_skips_what_the_reference_lacks():
    ref = [{"node": "a", "tag": "P-1", "type": "pump", "plant_E": "0", "plant_N": "0"}]
    assert sc.required_present(ref, ref) == {}


def test_cowork_land_against_itself_is_zero(ref):
    land = sc.read_land(LANDMASK)
    assert sc.score(ref, ref, gen_land=land, ref_land=land).landmask_hausdorff_m == 0.0


def test_landmask_fixture_is_in_plant_coordinates(ref):
    import shapely

    land = shapely.unary_union([shapely.Polygon(p) for p in sc.read_land(LANDMASK)])
    tanks = [r for r in ref if r["type"] == "tank_lng"]
    assert len(tanks) == 8
    assert all(land.contains(shapely.Point(float(r["plant_E"]), float(r["plant_N"]))) for r in tanks)
    heads = [r for r in ref if r["node"].endswith("-loading-platform")]
    assert len(heads) == 2
    assert not any(land.contains(shapely.Point(float(r["plant_E"]), float(r["plant_N"]))) for r in heads)


def test_landmask_hausdorff_measures_a_shift(ref):
    land = sc.read_land(LANDMASK)
    moved = [[[e + 8.0, n] for e, n in ring] for ring in land]
    box = sc.extent(ref)
    assert 7.0 <= sc.landmask_hausdorff(moved, land, box) <= 8.6
    assert sc.landmask_hausdorff([], land, box) == math.inf
    assert sc.landmask_hausdorff([], [], box) == 0.0
    assert sc.score(ref, ref).landmask_hausdorff_m is None


def test_land_from_a_spec_environment():
    env = [
        {"id": "l1", "kind": "land", "pts": [[0, 0], [10, 0], [10, 10]], "el": 104.5},
        {"id": "s1", "kind": "sea", "pts": [[0, 0], [5, 0], [5, 5]], "el": 100.0},
    ]
    assert sc.land_from_environment(env) == [[[0, 0], [10, 0], [10, 10]]]


def test_footprint_sizes_come_from_the_spec():
    spec = {
        "items": [
            {"id": "tank-1", "tag": "20-T-0001", "footprint": {"kind": "circle", "center": [0, 0], "d": 90}},
            {"id": "p1", "tag": None, "footprint": {"kind": "rect", "center": [0, 0], "size": [3, 2]}},
            {"id": "r1", "footprint": {"kind": "line", "pts": [[0, 0], [30, 40]], "width": 6}},
        ]
    }
    rows = [{"node": "tank-1", "tag": "20-T-0001"}, {"node": "p1", "tag": ""}, {"node": "zz", "tag": ""}]
    sized = sc.with_footprint_sizes(rows, spec)
    assert [r.get("footprint_m") for r in sized] == [90.0, 3.0, None]
    assert sc.footprint_size_m(spec["items"][2]["footprint"]) == 46.0


def test_report_json_has_no_nan_and_markdown_names_the_measures():
    rep = sc.score([], [{"tag": "A-1", "type": "pump", "plant_E": "", "plant_N": ""}])
    d = sc.report_dict(rep)
    assert d["pos_err_p50_m"] is None
    json.dumps(d, allow_nan=False)
    md = sc.report_markdown(rep)
    assert "Tagged items found | 0 of 1" in md and "A-1" in md


def test_cli_writes_json_and_prints_markdown(ref, tmp_path, capsys):
    out = tmp_path / "score.json"
    assert sc.main([str(REGISTER), str(REGISTER), "--ref-land", str(LANDMASK), "--gen-land", str(LANDMASK),
                    "--json", str(out)]) == 0  # fmt: skip
    d = json.loads(out.read_text(encoding="utf-8"))
    assert d["recall"] == 1.0 and d["landmask_hausdorff_m"] == 0.0
    assert "# Plant model score" in capsys.readouterr().out
