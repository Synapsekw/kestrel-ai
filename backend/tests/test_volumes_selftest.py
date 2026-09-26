"""The frozen-bundle selftest for the volume exports (plan Task 13)."""

from app.volumes import selftest


def test_selftest_writes_a_pdf_and_an_xlsx_and_triangulates(capsys):
    assert selftest.main([]) == 0
    out = capsys.readouterr().out
    assert out.startswith("volumes ok pdf ") and "xlsx 523.6" in out and "delaunay 2" in out
