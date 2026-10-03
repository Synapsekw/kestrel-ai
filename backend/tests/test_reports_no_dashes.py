"""No em or en dash in report code (index Global Constraints, coordinator ruling for R1): the preview
is UI copy, so the source strings are fixed, not only the PDF text. Comments are covered too; they
can always be reworded. Code that must name the characters (`undash` and its tests) writes them as
the escapes \u2014 and \u2013, never literally."""

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
TREES = [ROOT / "backend" / "app" / "reports", ROOT / "frontend" / "src" / "reports"]
SUFFIXES = {".py", ".ts", ".tsx", ".css", ".json", ".md"}
DASHES = ("\u2014", "\u2013")


def _files():
    for tree in TREES:
        for path in sorted(tree.rglob("*")):
            if path.is_file() and path.suffix in SUFFIXES:
                yield path


@pytest.mark.parametrize("path", list(_files()), ids=lambda p: str(p.relative_to(ROOT)))
def test_no_em_or_en_dash_in_report_source(path):
    bad = [
        f"{n}: {line.strip()}"
        for n, line in enumerate(path.read_text("utf-8").splitlines(), 1)
        if any(d in line for d in DASHES)
    ]
    assert bad == [], bad
