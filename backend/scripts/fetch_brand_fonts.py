"""Fetch the brand fonts once (spec 2026-10-02-asset-findings §5.8; plan D2 Task 2).

Downloads Nunito Sans and Inter (variable TTFs) and Poppins SemiBold and Bold (static TTFs), all SIL
OFL 1.1, from the Google Fonts repository at the commit fetch_report_fonts.py pins, checks their
sha256, cuts static Regular and Bold instances of the variable fonts with fontTools (every other axis
at its default; reportlab cannot pick a variable-font weight) and writes them, with the OFL texts, to
app/brands/fonts/. The outputs are committed; run this only to reproduce or update them:

    <backend>\\.venv\\Scripts\\python.exe scripts\\fetch_brand_fonts.py
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

from app.brands.fonts import FONT_DIR, FONT_SHA256  # noqa: E402

COMMIT = "00a38a53f92aef923b9353f40128e8f4552ddae4"
BASE = f"https://raw.githubusercontent.com/google/fonts/{COMMIT}/ofl"
SOURCES = {
    "NunitoSans[YTLC,opsz,wdth,wght].ttf": (
        "nunitosans/NunitoSans%5BYTLC%2Copsz%2Cwdth%2Cwght%5D.ttf",
        "f934d7142fb4784bf828da485b7dcbd90c0c80d514e9d49a5da0ed3a1ae2491d",
    ),
    "Inter[opsz,wght].ttf": (
        "inter/Inter%5Bopsz%2Cwght%5D.ttf",
        "29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031",
    ),
    "Poppins-SemiBold.ttf": (
        "poppins/Poppins-SemiBold.ttf",
        "d3bf1bdaf0550e83da9ac0b1d1d9fe6db086835a83aa28578e609a394b9a0286",
    ),
    "Poppins-Bold.ttf": (
        "poppins/Poppins-Bold.ttf",
        "983676516167748b74de6f4771fb384c664fd913acb8b471122ecacf5da5ea6c",
    ),
    "OFL-NunitoSans.txt": (
        "nunitosans/OFL.txt",
        "efbb0c9e864cef973982d9a17567e6be5c3d1759695574586f3f18c7ecca064b",
    ),
    "OFL-Poppins.txt": (
        "poppins/OFL.txt",
        "6be04893d770899a015649c7aa3b582f871b272f8747a92b78b17c3e5c8b2573",
    ),
    "OFL-Inter.txt": (
        "inter/OFL.txt",
        "5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57",
    ),
}
COPIED = (
    "Poppins-SemiBold.ttf",
    "Poppins-Bold.ttf",
    "OFL-NunitoSans.txt",
    "OFL-Poppins.txt",
    "OFL-Inter.txt",
)
INSTANCES = [
    ("NunitoSans[YTLC,opsz,wdth,wght].ttf", "NunitoSans-Regular.ttf", 400),
    ("NunitoSans[YTLC,opsz,wdth,wght].ttf", "NunitoSans-Bold.ttf", 700),
    ("Inter[opsz,wght].ttf", "Inter-Regular.ttf", 400),
    ("Inter[opsz,wght].ttf", "Inter-Bold.ttf", 700),
]


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    FONT_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="kestrel-brand-fonts-") as tmp:
        work = Path(tmp)
        for name, (rel, sha) in SOURCES.items():
            dest = work / name
            urllib.request.urlretrieve(f"{BASE}/{rel}", dest)
            if _sha(dest) != sha:
                print(f"{name}: sha256 {_sha(dest)} != {sha}", file=sys.stderr)
                return 1
            if name in COPIED:
                (FONT_DIR / name).write_bytes(dest.read_bytes())
        for src, out, weight in INSTANCES:
            font = TTFont(work / src, recalcTimestamp=False)
            limits = {axis.axisTag: axis.defaultValue for axis in font["fvar"].axes}
            limits["wght"] = weight
            inst = instancer.instantiateVariableFont(font, limits, updateFontNames=True)
            inst.save(FONT_DIR / out)
        for name, sha in FONT_SHA256.items():
            got = _sha(FONT_DIR / name)
            if got != sha:
                print(f"{name}: sha256 {got} != recorded {sha}", file=sys.stderr)
                return 1
            print(f"{name} {got}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
