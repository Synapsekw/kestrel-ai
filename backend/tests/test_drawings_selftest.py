"""`kestrel-backend.exe drawings-selftest` (spec risk 3: PDFium in the frozen sidecar; plan Task 15)."""

from app.__main__ import run
from app.drawings import selftest


def test_selftest_renders_a_pdf_page_and_flattens_a_dxf():
    assert selftest.run() == {"plan": "200x100", "runs": 2, "layers": 1}


def test_the_entry_point_dispatches(capsys):
    assert run(["app", "drawings-selftest"], freeze_support=lambda: None) == 0
    assert "drawings ok 200x100 2" in capsys.readouterr().out
