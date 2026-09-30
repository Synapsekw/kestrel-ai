"""Fetch the report fonts once (spec 2026-09-26-reports §5; plan 2026-09-30-reports-r4 ruling 1).

Downloads Space Grotesk and JetBrains Mono (SIL OFL 1.1) as variable TTFs from the Google Fonts repo at
a pinned commit, checks their sha256, cuts static instances with fontTools (reportlab cannot pick a
variable-font weight) and writes them, with the OFL texts, to app/reports/fonts/. The outputs are
committed; run this only to reproduce or update them:

    <backend>\\.venv\\Scripts\\python.exe scripts\\fetch_report_fonts.py
"""

from __future__ import annotations

import hashlib
import sys
import tempfile
import urllib.request
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from fontTools.ttLib import TTFont  # noqa: E402
from fontTools.varLib import instancer  # noqa: E402

from app.reports.pdf.fonts import FONT_DIR, FONT_SHA256  # noqa: E402

COMMIT = "00a38a53f92aef923b9353f40128e8f4552ddae4"
BASE = f"https://raw.githubusercontent.com/google/fonts/{COMMIT}/ofl"
SOURCES = {
    "SpaceGrotesk[wght].ttf": (
        "spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf",
        "acad6de1fc93436f5c0f1f4137751ef04f1aea3063e7036535970ffcfbd79f72",
    ),
    "JetBrainsMono[wght].ttf": (
        "jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf",
        "48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda",
    ),
    "OFL-SpaceGrotesk.txt": (
        "spacegrotesk/OFL.txt",
        "564ce565c371c5e5bbf286006565a7c9aa55a9f56e7ca58d56e05d649dd61a72",
    ),
    "OFL-JetBrainsMono.txt": (
        "jetbrainsmono/OFL.txt",
        "b2fe5e8987594e9ffd1d2ca52a2f5d73eb8335243893c5d6254b5ad69269591d",
    ),
}
INSTANCES = [
    ("SpaceGrotesk[wght].ttf", "SpaceGrotesk-Regular.ttf", 400),
    ("SpaceGrotesk[wght].ttf", "SpaceGrotesk-Bold.ttf", 700),
    ("JetBrainsMono[wght].ttf", "JetBrainsMono-Regular.ttf", 400),
]


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    FONT_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="kestrel-fonts-") as tmp:
        work = Path(tmp)
        for name, (rel, sha) in SOURCES.items():
            dest = work / name
            urllib.request.urlretrieve(f"{BASE}/{rel}", dest)
            if _sha(dest) != sha:
                print(f"{name}: sha256 {_sha(dest)} != {sha}", file=sys.stderr)
                return 1
            if name.endswith(".txt"):
                (FONT_DIR / name).write_bytes(dest.read_bytes())
        for src, out, weight in INSTANCES:
            font = TTFont(work / src, recalcTimestamp=False)
            inst = instancer.instantiateVariableFont(font, {"wght": weight}, updateFontNames=True)
            inst.save(FONT_DIR / out)
            got = _sha(FONT_DIR / out)
            if got != FONT_SHA256[out]:
                print(f"{out}: sha256 {got} != recorded {FONT_SHA256[out]}", file=sys.stderr)
                return 1
            print(f"{out} {got}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
