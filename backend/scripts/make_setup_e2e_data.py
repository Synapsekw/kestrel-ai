"""A small DJI delivery folder for the project-setup real-backend flow (plan 2026-09-30-setup-u6):
one visual/thermal photo pair in one folder (the M30T/H20T naming, `_V` and `_T`, with DJI XMP), a
one-page PDF drawing, and a file Kestrel does not recognise. Nothing binary is committed.

Usage: python scripts/make_setup_e2e_data.py <out-dir>
Prints one JSON line: {"delivery", "photos", "visual", "thermal", "drawing", "junk"}.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from reportlab.pdfgen import canvas


def _xmp(source: str) -> bytes:
    return f"""<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
 <rdf:Description rdf:about="DJI Meta Data" xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/"
  drone-dji:ImageSource="{source}" drone-dji:RelativeAltitude="+45.20"
  drone-dji:GimbalPitchDegree="-30.40" drone-dji:GimbalYawDegree="+101.70"
  drone-dji:GimbalRollDegree="+0.00" drone-dji:FlightYawDegree="+99.90"/>
</rdf:RDF></x:xmpmeta>""".encode()


def write_jpeg(path: Path, size: tuple[int, int], seed: int, xmp: bytes) -> Path:
    """Seeded noise (distinct per seed, so the import's de-duplication keeps both) with a DJI XMP packet."""
    rng = np.random.default_rng(seed)
    pixels = rng.integers(0, 255, size=(size[1], size[0], 3), dtype=np.uint8)
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels, "RGB").save(path, "JPEG", quality=90, xmp=xmp)
    return path


def write_pdf(path: Path) -> Path:
    """One A3-landscape page with a few lines and a label: a stand-in for a tower elevation drawing."""
    path.parent.mkdir(parents=True, exist_ok=True)
    width, height = 1191.0, 842.0
    c = canvas.Canvas(str(path), pagesize=(width, height))
    for x in range(100, int(width) - 100, 60):
        c.line(x, 80, width / 2, height - 80)
    c.drawString(24, 24, "Tower 14 elevation")
    c.showPage()
    c.save()
    return path


def main(argv: list[str]) -> int:
    out = Path(argv[1])
    photos = out / "DCIM" / "DJI_202609301015_001"
    visual = write_jpeg(photos / "DJI_20260930101500_0001_V.JPG", (800, 600), 1, _xmp("WideCamera"))
    thermal = write_jpeg(photos / "DJI_20260930101500_0001_T.JPG", (640, 512), 2, _xmp("InfraredCamera"))
    drawing = write_pdf(out / "drawings" / "tower-elevation.pdf")
    junk = out / "Thumbs.db"
    junk.write_bytes(b"\x00" * 64)
    print(
        json.dumps(
            {
                "delivery": str(out),
                "photos": str(photos),
                "visual": str(visual),
                "thermal": str(thermal),
                "drawing": str(drawing),
                "junk": str(junk),
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
