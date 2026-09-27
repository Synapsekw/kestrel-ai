"""Fixture writers for the drawings tests (plan 2026-09-27-maps-b3). Nothing binary is committed."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import CRS
from sqlalchemy import delete

from app.db.models import MapWorkspace

BASE = "/api/v1/projects"


def seed_frame(handle, epsg: int | None) -> None:
    """The project's site frame, as M-B1's GET /map-workspace would create it (epsg None = local)."""
    with handle.session() as s:
        s.execute(delete(MapWorkspace))
        s.add(
            MapWorkspace(
                id=1,
                frame_kind="local" if epsg is None else "crs",
                crs_wkt=None if epsg is None else CRS.from_epsg(epsg).to_wkt(),
                epsg=epsg,
                state={},
                planned_surveys=[],
            )
        )


def write_png(path: Path, width: int, height: int, *, mode: str = "RGB", seed: int = 0) -> Path:
    """Seeded noise in PIL `mode` (RGB, RGBA, L, LA, P, I;16)."""
    rng = np.random.default_rng(seed)
    if mode == "P":
        img = Image.fromarray(rng.integers(0, 4, (height, width), dtype=np.uint8), "P")
        img.putpalette([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255] + [0] * (256 * 3 - 12))
    elif mode == "I;16":
        img = Image.fromarray(rng.integers(0, 65535, (height, width), dtype=np.uint16), "I;16")
    else:
        bands = {"RGB": 3, "RGBA": 4, "L": 1, "LA": 2}[mode]
        data = rng.integers(0, 255, (height, width, bands), dtype=np.uint8)
        img = Image.fromarray(data[..., 0] if bands == 1 else data, mode)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
    return path


WORLD_EXT = {".png": ".pgw", ".jpg": ".jgw", ".jpeg": ".jgw", ".tif": ".tfw", ".tiff": ".tfw"}


def write_world_file(image: Path, *, pixel: float, top_left: tuple[float, float]) -> Path:
    """An ESRI world file placing `image` north-up; `top_left` is the outer corner (a world file names
    the centre of the top-left pixel, so half a pixel is added here)."""
    ext = WORLD_EXT[image.suffix.lower()]
    x, y = top_left
    lines = [pixel, 0.0, 0.0, -pixel, x + pixel / 2, y - pixel / 2]
    out = image.with_suffix(ext)
    out.write_text("\n".join(repr(float(v)) for v in lines) + "\n", "ascii")
    return out


def inspect_ready(client, project_id, wait_job, path) -> dict:
    r = client.post(f"{BASE}/{project_id}/drawing-inspections", json={"path": str(path)})
    assert r.status_code == 202, r.text
    body = r.json()
    job = wait_job(project_id, body["job"]["id"])
    assert job["state"] == "succeeded", job
    return client.get(f"{BASE}/{project_id}/drawing-inspections/{body['inspection']['id']}").json()


def build_drawing(client, project_id, wait_job, inspection_id, *, wait=True, **body) -> dict:
    body = {"name": "Plan", "placement": {"method": "none"}, **body, "inspection_id": inspection_id}
    r = client.post(f"{BASE}/{project_id}/drawings", json=body)
    assert r.status_code == 202, r.text
    created = r.json()
    if not wait:
        return created
    job = wait_job(project_id, created["job"]["id"])
    got = client.get(f"{BASE}/{project_id}/drawings/{created['drawing']['id']}").json()
    assert job["state"] == "succeeded", (job, got)
    return got


def write_landxml(path: Path, body: str, *, units: str = 'linearUnit="meter"', ns: bool = True) -> Path:
    """A LandXML 1.2 file around `body` (Surfaces, Alignments, PlanFeatures ...). P/Start/End text is
    northing first, as LandXML has it."""
    xmlns = ' xmlns="http://www.landxml.org/schema/LandXML-1.2"' if ns else ""
    path.write_text(
        f'<?xml version="1.0"?><LandXML{xmlns} version="1.2"><Units><Metric {units}/></Units>'
        f'<CoordinateSystem epsgCode="32633"/>{body}</LandXML>',
        "utf-8",
    )
    return path


def write_pdf(
    path: Path, pages: list[tuple[float, float]], *, encrypt: str | None = None, rotate: int = 0
) -> Path:
    """One page per (width_pt, height_pt): a red line fan, a blue disc and a label. `rotate` sets
    /Rotate (reportlab swaps the MediaBox so the page *displays* at the given size)."""
    from reportlab.lib.colors import blue, red
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(str(path), pagesize=pages[0], encrypt=encrypt)
    for w, h in pages:
        c.setPageSize((w, h))
        if rotate:
            c.setPageRotation(rotate)
        c.setStrokeColor(red)
        c.setLineWidth(0.7)
        for i in range(0, int(w), 23):
            c.line(i, 0, w - i, h)
        c.setFillColor(blue)
        c.circle(w / 3, h / 3, min(w, h) / 6, fill=1)
        c.drawString(12, 12, "Kestrel plan")
        c.showPage()
    c.save()
    return path
