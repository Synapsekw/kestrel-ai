"""The Reports e2e data script writes real inputs and prints where they are (plan 2026-09-30-reports-r10)."""

import importlib.util
import json
from pathlib import Path

import rasterio
from PIL import Image

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "make_reports_e2e_data.py"


def _load():
    spec = importlib.util.spec_from_file_location("make_reports_e2e_data", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_writes_photos_two_orthos_a_cloud_and_an_attachment(tmp_path, capsys):
    script = _load()
    assert script.main([str(SCRIPT), str(tmp_path / "data"), "--images", "3", "--image-size", "800x600"]) == 0
    out = json.loads(capsys.readouterr().out.strip().splitlines()[-1])

    photos = sorted(Path(out["photos"]).glob("*.jpg"))
    assert [p.name for p in photos] == ["IMG_0000.jpg", "IMG_0001.jpg", "IMG_0002.jpg"]
    with Image.open(photos[0]) as im:
        assert im.size == (800, 600)
    assert out["image_size"] == [800, 600]

    assert len(out["orthos"]) == 2
    for path in out["orthos"]:
        with rasterio.open(path) as src:
            assert src.crs.to_epsg() == 32633
    assert out["ortho_epsg"] == 32633
    assert out["ortho_origin"] == [500000.0, 4983000.0]

    assert Path(out["cloud"]).suffix == ".laz" and Path(out["cloud"]).stat().st_size > 0
    assert out["cloud_origin"] == [243500.0, 3178000.0, 0.0]
    with Image.open(out["attachment"]) as im:
        assert im.format == "JPEG"


def test_defaults_are_two_small_photos(tmp_path, capsys):
    script = _load()
    assert script.main([str(SCRIPT), str(tmp_path / "d")]) == 0
    out = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert len(list(Path(out["photos"]).glob("*.jpg"))) == 2
    assert out["image_size"] == [1600, 1200]
