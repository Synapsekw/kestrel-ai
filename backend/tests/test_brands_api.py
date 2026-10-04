"""Report brands (spec 2026-10-02-asset-findings §5.8, §8; plan D2 Task 4): the app-level CRUD over
catalogue.db, the built-ins, and the helpers R1 prints with."""

from app.brands import store
from app.brands.builtins import BUILTIN_EAND, BUILTIN_WHITE_LABEL, DEFAULT_COLORS
from app.reports.schemas import ReportConfig

BRANDS = "/api/v1/brands"
RED = {
    "accent": "#aa0000",
    "accent_dark": "#880000",
    "navy": "#101820",
    "ink": "#111111",
    "pale": "#ffeeee",
    "line": "#dddddd",
}


def _post(client, name="Partner", **body):
    return client.post(BRANDS, json={"name": name, **body})


def _items(client) -> list[dict]:
    r = client.get(BRANDS)
    assert r.status_code == 200, r.text
    return r.json()["items"]


def _error(r) -> dict:
    return r.json()["error"]


def test_the_list_has_the_two_built_ins_first_then_by_name(client):
    for name in ("Zain", "Orbit Aerials"):
        assert _post(client, name).status_code == 201
    items = _items(client)
    assert [b["id"] for b in items[:2]] == [BUILTIN_EAND, BUILTIN_WHITE_LABEL]
    assert [b["name"] for b in items[2:]] == ["Orbit Aerials", "Zain"]
    eand = items[0]
    assert eand["builtin"] is True and eand["logo_on_dark"] is None
    assert eand["colors"]["accent"] == "#BC0000"


def test_create_starts_from_white_label_colours_and_the_theme_fonts(client):
    r = _post(client, "  Orbit   Aerials ")
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["name"] == "Orbit Aerials"
    assert b["colors"] == DEFAULT_COLORS
    assert (b["font_text"], b["font_numerals"]) == (None, None)
    assert (b["website"], b["owner"], b["confidentiality"], b["pdf_author"]) == ("", "", "", "")
    assert b["builtin"] is False
    assert next(i for i in _items(client) if i["id"] == b["id"]) == b


def test_colours_are_stored_upper_case(client):
    b = _post(client, colors=RED, font_text="Inter", font_numerals="Poppins").json()
    assert b["colors"] == {k: v.upper() for k, v in RED.items()}
    assert (b["font_text"], b["font_numerals"]) == ("Inter", "Poppins")


def test_a_name_is_unique_by_normalised_name_including_built_ins(client):
    first = _post(client, "Orbit Aerials").json()
    r = _post(client, "orbit_aerials")
    assert r.status_code == 409 and _error(r)["code"] == "brand_name_taken"
    assert _error(r)["details"]["brand_id"] == first["id"]
    r = _post(client, "E&")
    assert r.status_code == 409 and _error(r)["details"]["brand_id"] == BUILTIN_EAND


def test_a_name_that_normalises_to_nothing_is_422(client):
    r = _post(client, " _-_ ")
    assert r.status_code == 422 and _error(r)["code"] == "invalid_brand"
    assert _error(r)["details"]["errors"][0]["path"] == "name"


def test_an_unknown_font_is_422(client):
    r = _post(client, font_text="Comic Sans")
    assert r.status_code == 422 and _error(r)["code"] == "unknown_font"
    assert _error(r)["details"] == {"path": "font_text", "fonts": ["Nunito Sans", "Poppins", "Inter"]}
    b = _post(client).json()
    r = client.patch(f"{BRANDS}/{b['id']}", json={"font_numerals": "Space Grotesk"})
    assert r.status_code == 422 and _error(r)["details"]["path"] == "font_numerals"


def test_patch_edits_a_built_in_and_null_clears_a_font(client):
    r = client.patch(
        f"{BRANDS}/{BUILTIN_EAND}", json={"website": "www.eand.com/drones", "font_numerals": None}
    )
    assert r.status_code == 200, r.text
    b = r.json()
    assert (b["website"], b["font_numerals"], b["font_text"]) == ("www.eand.com/drones", None, "Nunito Sans")
    assert b["builtin"] is True


def test_patch_renames_and_refuses_a_taken_name(client):
    a = _post(client, "Zain").json()
    r = client.patch(f"{BRANDS}/{a['id']}", json={"name": "ZAIN"})  # its own name, recased
    assert r.status_code == 200 and r.json()["name"] == "ZAIN"
    r = client.patch(f"{BRANDS}/{a['id']}", json={"name": "White label"})
    assert r.status_code == 409 and _error(r)["code"] == "brand_name_taken"


def test_delete_removes_a_custom_brand_and_refuses_a_built_in(client):
    b = _post(client).json()
    assert client.delete(f"{BRANDS}/{b['id']}").status_code == 204
    assert all(i["id"] != b["id"] for i in _items(client))
    r = client.delete(f"{BRANDS}/{BUILTIN_WHITE_LABEL}")
    assert r.status_code == 409 and _error(r)["code"] == "brand_builtin"


def test_an_unknown_brand_is_404(client):
    assert client.patch(f"{BRANDS}/nope", json={"website": ""}).status_code == 404
    assert client.delete(f"{BRANDS}/nope").status_code == 404


def test_brands_answer_503_without_the_catalogue(client):
    client.app.state.catalogue = None
    r = client.get(BRANDS)
    assert r.status_code == 503 and _error(r)["code"] == "catalogue_unavailable"


def test_get_brand_is_a_session_free_snapshot_or_none(client):
    cat = client.app.state.catalogue
    row = store.get_brand(cat, BUILTIN_EAND)
    assert row is not None and row.colors["navy"] == "#141D2D" and row.font_text == "Nunito Sans"
    assert store.get_brand(cat, None) is None
    assert store.get_brand(cat, "deleted-brand") is None
    assert store.get_brand(None, BUILTIN_EAND) is None


def test_confidentiality_line_fills_year_and_customer(client):
    cat = client.app.state.catalogue
    eand = store.get_brand(cat, BUILTIN_EAND)
    assert store.confidentiality_line(eand, 2026, "DAMAC").startswith("© 2026 e&. All rights reserved.")
    white = store.get_brand(cat, BUILTIN_WHITE_LABEL)
    assert store.confidentiality_line(white, 2026, "DAMAC") == (
        "Confidential. Prepared for DAMAC. Do not distribute without written consent."
    )
    assert "Prepared for the client." in store.confidentiality_line(white, 2026, None)
    assert "Prepared for the client." in store.confidentiality_line(white, 2026, "   ")


def test_report_config_carries_a_nullable_brand_id():
    assert ReportConfig().brand_id is None
    assert ReportConfig.model_validate({"brand_id": BUILTIN_EAND}).brand_id == BUILTIN_EAND
