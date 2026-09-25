"""pointcloud-selftest (spec §14): the fixture, the manifest check, the whole real path."""

import hashlib
import json

import laspy
import numpy as np
import pytest

from app.pointclouds import converter_path, selftest
from app.pointclouds.lasbounds import read_header_bounds


def test_the_fixture_is_a_pix4d_style_red_green_laz(tmp_path):
    path = selftest.write_fixture(tmp_path / "fixture.laz")
    with laspy.open(path) as r:
        assert r.header.are_points_compressed and r.header.point_count == 50_000
        assert r.header.point_format.id == 3 and r.header.parse_crs().to_epsg() == 32639
        las = r.read()
    x = np.asarray(las.x)
    assert x.max() - read_header_bounds(path)[3] == pytest.approx(0.0003, abs=1e-6)
    west = x < (x.min() + x.max()) / 2
    red, green = np.asarray(las.red), np.asarray(las.green)
    assert (red[west] == 65535).all() and (green[west] == 0).all()
    assert (green[~west] == 65535).all() and (red[~west] == 0).all()


def test_write_fixture_mode_prints_and_exits_0(tmp_path, capsys):
    assert selftest.main(["--write-fixture", str(tmp_path / "f.laz")]) == 0
    assert capsys.readouterr().out.strip() == f"fixture ok {tmp_path / 'f.laz'}"


def _payload(folder, files):
    folder.mkdir()
    entries = []
    for name, data in files.items():
        (folder / name).write_bytes(data)
        entries.append({"name": name, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    (folder / "MANIFEST.json").write_text(
        json.dumps({"converter_version": "2.1.5", "files": entries}), "utf-8"
    )


def test_manifest_verification(tmp_path):
    _payload(tmp_path / "ok", {"PotreeConverter.exe": b"MZ", "vcruntime140.dll": b"dll"})
    assert selftest.verify_manifest(tmp_path / "ok") == 2
    _payload(tmp_path / "bad", {"PotreeConverter.exe": b"MZ", "vcruntime140.dll": b"dll"})
    (tmp_path / "bad" / "vcruntime140.dll").write_bytes(b"tampered")
    with pytest.raises(selftest.SelftestError, match="vcruntime140.dll"):
        selftest.verify_manifest(tmp_path / "bad")
    _payload(tmp_path / "gone", {"msvcp140.dll": b"x"})
    (tmp_path / "gone" / "msvcp140.dll").unlink()
    with pytest.raises(selftest.SelftestError, match="msvcp140.dll is missing"):
        selftest.verify_manifest(tmp_path / "gone")


def test_a_failure_prints_fail_and_exits_1(monkeypatch, capsys):
    def no_converter(tmp):
        raise selftest.SelftestError("no converter")

    monkeypatch.setattr(selftest, "run", no_converter)
    assert selftest.main([]) == 1
    assert capsys.readouterr().out.strip() == "pointcloud FAIL SelftestError: no converter"


@pytest.mark.potreeconverter
@pytest.mark.skipif(converter_path.converter_exe() is None, reason="PotreeConverter payload not fetched")
def test_the_whole_real_path(capsys):
    assert selftest.main([]) == 0
    assert capsys.readouterr().out.strip().splitlines()[-1] == "pointcloud ok 50000 32639 BROTLI laz 50000"
