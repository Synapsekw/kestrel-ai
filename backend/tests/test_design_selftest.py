"""`kestrel-backend.exe design-selftest` (spec §14.2 U3, U7)."""

from app.__main__ import run
from app.surfaces.design import selftest


def test_selftest_reads_a_dxf_and_triangulates():
    facts = selftest.run()
    assert facts["faces"] == 10 and facts["triangles"] > 0


def test_the_entry_point_dispatches(capsys):
    assert run(["app", "design-selftest"], freeze_support=lambda: None) == 0
    assert "design ok 10" in capsys.readouterr().out
