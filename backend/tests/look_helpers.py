"""Small drawings, clouds and photos for the look tests (U4)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from reportlab.pdfgen import canvas


def vector_pdf(path: Path) -> Path:
    """A 400 x 200 pt page with a title block text and a dimension."""
    c = canvas.Canvas(str(path), pagesize=(400, 200))
    c.setFont("Helvetica", 10)
    c.drawString(300, 20, "P-00212-DW-MD-143TD1")
    c.drawString(40, 150, "ID 4000")
    c.line(40, 140, 200, 140)
    c.showPage()
    c.save()
    return path


def raster_pdf(path: Path) -> Path:
    """A page carrying only an image (a scan): no text layer."""
    from PIL import Image

    img = path.with_suffix(".png")
    Image.new("RGB", (400, 200), (255, 255, 255)).save(img)
    c = canvas.Canvas(str(path), pagesize=(400, 200))
    c.drawImage(str(img), 0, 0, 400, 200)
    c.showPage()
    c.save()
    return path


def las_cylinder(
    path: Path,
    n: int,
    radius: float = 2.0,
    height: float = 8.0,
    origin=(500000.0, 4000000.0, 10.0),
    seed: int = 0,
) -> Path:
    import laspy

    rng = np.random.default_rng(seed)
    a = rng.uniform(0, 2 * np.pi, n)
    z = rng.uniform(0, height, n)
    r = radius + rng.normal(0, 0.003, n)
    header = laspy.LasHeader(point_format=3, version="1.2")
    header.scales = [0.001, 0.001, 0.001]
    header.offsets = list(origin)
    las = laspy.LasData(header)
    las.x = origin[0] + r * np.cos(a)
    las.y = origin[1] + r * np.sin(a)
    las.z = origin[2] + z
    las.write(str(path))
    return path
