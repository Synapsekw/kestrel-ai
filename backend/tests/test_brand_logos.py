"""Brand logos (spec 2026-10-02-asset-findings §5.8: three logos per brand, customer-supplied, never
committed; plan D2 Task 5). App-level files beside catalogue.db, never in a project."""

import re

from PIL import Image

from app.brands import store
from app.brands.builtins import BUILTIN_EAND

BRANDS = "/api/v1/brands"
LOGO_ID = re.compile(r"^logo-[0-9a-f]{16}$")


def _png(path, size=(600, 200), colour="#bc0000"):
    Image.new("RGBA", size, colour).save(path)
    return path


def _put(client, slot, path, brand=BUILTIN_EAND):
    return client.put(f"{BRANDS}/{brand}/logos/{slot}", json={"path": str(path)})


def test_set_logo_stores_an_app_level_png_and_records_its_id(client, tmp_path):
    r = _put(client, "on_dark", _png(tmp_path / "eand white.png"))
    assert r.status_code == 200, r.text
    logo = r.json()["logo_on_dark"]
    assert LOGO_ID.match(logo)
    cat = client.app.state.catalogue
    on_disk = cat.folder / store.LOGO_DIR / f"{logo}.png"
    assert on_disk.is_file()
    with Image.open(on_disk) as im:
        assert (im.format, im.mode, im.size) == ("PNG", "RGBA", (600, 200))
    assert store.logo_path(cat, logo) == on_disk


def test_get_logo_serves_the_png_with_an_immutable_cache(client, tmp_path):
    logo = _put(client, "flat", _png(tmp_path / "flat.png")).json()["logo_flat"]
    r = client.get(f"{BRANDS}/{BUILTIN_EAND}/logos/flat?v={logo}")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert "immutable" in r.headers["cache-control"]
    assert r.content.startswith(b"\x89PNG")


def test_a_big_logo_is_scaled_to_1200_px(client, tmp_path):
    logo = _put(client, "on_light", _png(tmp_path / "big.png", (3000, 1000))).json()["logo_on_light"]
    path = store.logo_path(client.app.state.catalogue, logo)
    with Image.open(path) as im:
        assert im.size == (1200, 400)


def test_the_same_image_twice_is_one_file(client, tmp_path):
    a = _put(client, "on_light", _png(tmp_path / "a.png")).json()["logo_on_light"]
    b = _put(client, "on_dark", _png(tmp_path / "b.png")).json()["logo_on_dark"]
    assert a == b
    files = list((client.app.state.catalogue.folder / store.LOGO_DIR).glob("logo-*.png"))
    assert len(files) == 1


def test_clear_logo_removes_it_from_the_brand_and_get_is_404(client, tmp_path):
    _put(client, "on_dark", _png(tmp_path / "x.png"))
    r = client.delete(f"{BRANDS}/{BUILTIN_EAND}/logos/on_dark")
    assert r.status_code == 200 and r.json()["logo_on_dark"] is None
    assert client.get(f"{BRANDS}/{BUILTIN_EAND}/logos/on_dark").status_code == 404


def test_an_unreadable_file_is_422_asset_invalid(client, tmp_path):
    bad = tmp_path / "not.png"
    bad.write_bytes(b"not an image")
    r = _put(client, "on_light", bad)
    assert r.status_code == 422 and r.json()["error"]["code"] == "asset_invalid"
    r = _put(client, "on_light", "relative/logo.png")
    assert r.status_code == 422 and r.json()["error"]["details"]["reason"] == "not_absolute"


def test_an_unknown_brand_is_404_before_any_file_is_read(client, tmp_path):
    r = _put(client, "on_light", tmp_path / "missing.png", brand="nope")
    assert r.status_code == 404


def test_a_bad_slot_is_a_validation_error(client, tmp_path):
    r = _put(client, "sideways", _png(tmp_path / "x.png"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


def test_logo_path_refuses_malformed_ids_and_vanished_files(client, tmp_path):
    cat = client.app.state.catalogue
    assert store.logo_path(cat, None) is None
    assert store.logo_path(cat, "../../catalogue.db") is None
    assert store.logo_path(cat, "logo-0123456789abcdef") is None  # well formed, no file
    assert store.logo_path(None, "logo-0123456789abcdef") is None
