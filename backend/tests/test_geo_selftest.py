from app.maps import selftest


def test_run_produces_a_real_display_raster(tmp_path, monkeypatch):
    monkeypatch.setenv("TEMP", str(tmp_path))
    facts = selftest.run()
    assert facts["block_shapes"] == (512, 512)
    assert facts["overviews"]  # non-empty: write_display_raster actually built zoom levels
    assert facts["mask_shape"] == (selftest.SIZE, selftest.SIZE)
    assert facts["mask_full"]
    assert facts["rgb_shape"] == (64, 64, 3)
    assert facts["valid_shape"] == (64, 64)
    assert 14.9 < facts["lon"] < 15.1 and 44.9 < facts["lat"] < 45.1  # UTM 33N near (500000, 4983000)


def test_selftest_writes_reads_and_reprojects(capsys, tmp_path, monkeypatch):
    monkeypatch.setenv("TEMP", str(tmp_path))
    assert selftest.main() == 0
    line = capsys.readouterr().out.strip().splitlines()[-1]
    assert line.startswith("geo ok 32633 ")
    lon, lat = (float(v) for v in line.split()[3:5])
    assert 14.9 < lon < 15.1 and 44.9 < lat < 45.1  # UTM 33N near (500000, 4983000)
