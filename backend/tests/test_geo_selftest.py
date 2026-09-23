from app.maps import selftest


def test_selftest_writes_reads_and_reprojects(capsys, tmp_path, monkeypatch):
    monkeypatch.setenv("TEMP", str(tmp_path))
    assert selftest.main() == 0
    line = capsys.readouterr().out.strip().splitlines()[-1]
    assert line.startswith("geo ok 32633 ")
    lon, lat = (float(v) for v in line.split()[3:5])
    assert 14.9 < lon < 15.1 and 44.9 < lat < 45.1  # UTM 33N near (500000, 4983000)
