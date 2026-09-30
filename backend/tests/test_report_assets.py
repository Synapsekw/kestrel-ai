"""Report logos (plan R1 Task 5; spec §6.1 report_asset, §15 20 MB refusal; ledger Ruling P5 adds
`getReportAsset`)."""

import hashlib
from pathlib import Path

import pytest
from PIL import Image

from app.reports import assets

URL = "/api/v1/projects/{pid}/report-assets"
ASSET_URL = "/api/v1/projects/{pid}/report-assets/{aid}"


def _post(client, pid, path):
    return client.post(URL.format(pid=pid), json={"path": str(path)})


def test_imports_and_downscales_a_large_jpeg(client, project_id, handle, make_jpeg, tmp_path):
    src = make_jpeg(tmp_path / "logo big.jpg", 3000, 1500)
    r = _post(client, project_id, src)
    assert r.status_code == 201, r.text
    body = r.json()
    assert (body["kind"], body["width"], body["height"]) == ("logo", 1200, 600)
    on_disk = handle.folder / body["path"]
    assert body["path"] == f"reports/assets/logo-{body['sha256'][:8]}.png"
    assert hashlib.sha256(on_disk.read_bytes()).hexdigest() == body["sha256"]
    with Image.open(on_disk) as im:
        assert (im.format, im.size) == ("PNG", (1200, 600))


def test_small_logo_keeps_its_size(client, project_id, tmp_path):
    src = tmp_path / "small.png"
    Image.new("RGB", (300, 100), "#6a5cff").save(src)
    body = _post(client, project_id, src).json()
    assert (body["width"], body["height"]) == (300, 100)


def test_palette_png_with_transparency_keeps_alpha(client, project_id, handle, tmp_path):
    src = tmp_path / "pal.png"
    im = Image.new("P", (40, 20), 0)
    im.putpalette([255, 255, 255, 106, 92, 255] + [0] * 762)
    im.info["transparency"] = 0
    im.save(src, transparency=0)
    body = _post(client, project_id, src).json()
    with Image.open(handle.folder / body["path"]) as out:
        assert out.mode == "RGBA" and out.getpixel((0, 0))[3] == 0


def test_exif_rotation_is_applied(client, project_id, make_jpeg, tmp_path):
    src = make_jpeg(tmp_path / "rot.jpg", 400, 200, exif={"orientation": 6})
    body = _post(client, project_id, src).json()
    assert (body["width"], body["height"]) == (200, 400)


def test_same_logo_twice_is_one_asset(client, project_id, tmp_path, handle):
    src = tmp_path / "a.png"
    Image.new("RGB", (50, 50), "#0f8f76").save(src)
    first = _post(client, project_id, src).json()
    (handle.folder / first["path"]).unlink()  # healed on re-import
    second = _post(client, project_id, src).json()
    assert second["id"] == first["id"] and (handle.folder / second["path"]).is_file()


@pytest.mark.parametrize(
    ("make", "reason"),
    [
        (lambda d: d / "missing.png", "not_found"),
        (lambda d: Path("relative/logo.png"), "not_absolute"),
        (lambda d: (d / "fake.png").write_text("not an image") and d / "fake.png", "not_an_image"),
    ],
)
def test_refusals_carry_a_reason(client, project_id, tmp_path, make, reason):
    r = _post(client, project_id, make(tmp_path))
    assert (r.status_code, r.json()["error"]["code"]) == (422, "asset_invalid")
    assert r.json()["error"]["details"]["reason"] == reason


def test_over_20_mb_is_refused_before_decoding(client, project_id, tmp_path, monkeypatch):
    src = tmp_path / "huge.png"
    Image.new("RGB", (10, 10)).save(src)
    monkeypatch.setattr(assets, "MAX_BYTES", 10)
    decoded = []
    monkeypatch.setattr(assets, "_encode", lambda path: decoded.append(path))
    r = _post(client, project_id, src)
    assert r.json()["error"]["details"]["reason"] == "too_large" and decoded == []


def test_decompression_bomb_is_422_not_500(client, project_id, tmp_path, monkeypatch):
    src = tmp_path / "bomb.png"
    Image.new("RGB", (400, 400)).save(src)
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 100)  # 160k px > 2 x 100: DecompressionBombError
    r = _post(client, project_id, src)
    assert (r.status_code, r.json()["error"]["details"]["reason"]) == (422, "not_an_image")


def test_asset_path(client, project_id, handle, tmp_path):
    src = tmp_path / "a.png"
    Image.new("RGB", (5, 5)).save(src)
    body = _post(client, project_id, src).json()
    assert assets.asset_path(handle, body["id"]) == handle.folder / body["path"]
    assert assets.asset_path(handle, "nope") is None


def test_get_report_asset_returns_the_png(client, project_id, handle, tmp_path):
    src = tmp_path / "a.png"
    Image.new("RGB", (5, 5)).save(src)
    body = _post(client, project_id, src).json()
    r = client.get(ASSET_URL.format(pid=project_id, aid=body["id"]))
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.headers["cache-control"] == "private, max-age=31536000, immutable"
    assert r.content == (handle.folder / body["path"]).read_bytes()


def test_get_report_asset_unknown_id_is_404(client, project_id):
    r = client.get(ASSET_URL.format(pid=project_id, aid="nope"))
    assert (r.status_code, r.json()["error"]["code"]) == (404, "not_found")


def test_get_report_asset_after_file_deleted_is_404(client, project_id, handle, tmp_path):
    src = tmp_path / "a.png"
    Image.new("RGB", (5, 5)).save(src)
    body = _post(client, project_id, src).json()
    (handle.folder / body["path"]).unlink()
    r = client.get(ASSET_URL.format(pid=project_id, aid=body["id"]))
    assert (r.status_code, r.json()["error"]["code"]) == (404, "not_found")
