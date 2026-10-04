# backend/app/asset_models/agent/plant/views.py
"""What the plant run renders for the model; every image is <= 1 600 px on its long side.
- drawing_zoom: a page region at up to 600 dpi, with page-fraction ticks and plant grid lines.
- mosaics: the ortho or a placed drawing as site tiles, warped plant-north-up.
- render_site: plan and iso views of the register."""

from __future__ import annotations

import io
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from app.asset_models.look import LookError, clamp_region, to_jpeg
from app.asset_models.look.drawing import _drawing, drawing_view

MAX_PX = 1600
MAX_DPI = 600
RASTER = ("png", "jpg", "tif")
NICE = (1.0, 2.0, 2.5, 5.0)
TICK = (200, 0, 120)
GRID = (0, 120, 255)


@dataclass(frozen=True)
class Zoom:
    jpeg: bytes
    width: int
    height: int
    dpi: int | None
    note: str
    grid_step_m: float | None


def zoom_dpi(w_in: float, h_in: float, requested: int) -> tuple[int, str]:
    """The dpi to render a region of w_in x h_in inches at, and a note when it is below the request."""
    notes = []
    want = int(requested)
    if want > MAX_DPI:
        notes.append(f"{MAX_DPI} dpi is the most a zoom renders.")
        want = MAX_DPI
    fit = int(math.floor(MAX_PX / max(w_in, h_in, 1e-9)))
    if want > fit:
        px = math.ceil(max(w_in, h_in) * want)
        eff = max(fit, 1)
        notes.append(
            f"Rendered at {eff} dpi, not {want}: at {want} dpi this region would be {px} px on its long "
            "side, over the 1 600 px limit. Zoom into a smaller region to read finer detail."
        )
        want = eff
    return want, " ".join(notes)


def _pdf_region(src: Path, page_n: int, region, dpi: int) -> tuple[Image.Image, int, str]:
    import pypdfium2

    from app.drawings.pdf import open_pdf, page_rgb
    from app.jobs.cancellation import JobFailure

    try:
        with open_pdf(src) as doc:
            if not 1 <= page_n <= len(doc):
                raise LookError("That page is no longer in the drawing's source PDF.")
            page = doc[page_n - 1]
            try:
                w_pt, h_pt = page.get_size()
                x0, y0, x1, y1 = region
                eff, note = zoom_dpi((x1 - x0) * w_pt / 72, (y1 - y0) * h_pt / 72, dpi)
                # crop = points trimmed from (left, bottom, right, top)
                crop = (x0 * w_pt, (1 - y1) * h_pt, (1 - x1) * w_pt, y0 * h_pt)
                bitmap = page.render(scale=eff / 72, crop=crop, rev_byteorder=True)
                try:
                    rgb = np.array(page_rgb(bitmap), dtype=np.uint8, copy=True)
                finally:
                    bitmap.close()
            finally:
                page.close()
    except (OSError, JobFailure, pypdfium2.PdfiumError):
        raise LookError("The drawing's source PDF can't be read - read the page with drawing_view.") from None
    return Image.fromarray(rgb, "RGB"), eff, note


def _plan_region(handle, d, region) -> tuple[Image.Image, str]:
    li = drawing_view(handle, d.id, region, max_side=MAX_PX)
    img = Image.open(io.BytesIO(li.jpeg)).convert("RGB")
    note = ""
    if d.width and d.height:
        x0, y0, x1, y1 = region
        native = max((x1 - x0) * d.width, (y1 - y0) * d.height)
        if native > MAX_PX:
            note = (
                f"Shown at {100 * MAX_PX / native:.0f}% of the scan's resolution: zoom into a smaller "
                "region to read finer detail."
            )
    return img, note


def drawing_zoom(
    handle, drawing_id: str, region, dpi: int = 300, *, grid: bool = True, page_to_plant=None
) -> Zoom:
    d = _drawing(handle, drawing_id)
    region, rnote = clamp_region(region if region is not None else [0.0, 0.0, 1.0, 1.0])
    src = Path(d.source_path)
    eff: int | None = None
    if d.format == "pdf" and src.exists():
        img, eff, note = _pdf_region(src, d.page or 1, region, dpi)
    elif d.format == "pdf" or d.format in RASTER:
        img, note = _plan_region(handle, d, region)
        if d.format == "pdf":
            note = f"The source PDF is not reachable, so this is the imported page image. {note}".strip()
    else:
        raise LookError("That drawing has no page image (DXF or LandXML): read it with drawing_text.")
    step = draw_overlay(img, region, page_to_plant) if grid else None
    note = " ".join(x for x in (rnote, note) if x)
    li = to_jpeg(img, MAX_PX, note)
    return Zoom(li.jpeg, li.width, li.height, eff, note, step)


# ------------------------------------------------------------------ overlay
def _nice(x: float) -> float:
    if not (x > 0 and math.isfinite(x)):
        return 1.0
    k = 10 ** math.floor(math.log10(x))
    for m in NICE:
        if m * k >= x:
            return m * k
    return 10 * k


def _segment(a: float, b: float, c: float, value: float, W: int, H: int):
    """The image segment where a*u + b*v + c == value, clipped to the image rectangle, or None."""
    pts = []
    if abs(b) > 1e-12:
        for u in (0.0, float(W)):
            v = (value - c - a * u) / b
            if 0 <= v <= H:
                pts.append((u, v))
    if abs(a) > 1e-12:
        for v in (0.0, float(H)):
            u = (value - c - b * v) / a
            if 0 <= u <= W:
                pts.append((u, v))
    uniq = []
    for p in pts:
        if all(math.dist(p, q) > 0.5 for q in uniq):
            uniq.append(p)
    return (uniq[0], uniq[1]) if len(uniq) >= 2 else None


def _affine_px_to(fn, region, W: int, H: int):
    """(a, b, c, d, e, f): E = a u + b v + c, N = d u + e v + f for image pixel (u, v); exact for the
    similarity transforms in use (page -> drawing georef -> site -> plant)."""
    x0, y0, x1, y1 = region

    def page(u, v):
        return x0 + (x1 - x0) * u / W, y0 + (y1 - y0) * v / H

    vals = []
    for u, v in ((0.0, 0.0), (float(W), 0.0), (0.0, float(H))):
        e, n = fn(*page(u, v))
        vals.append((float(np.asarray(e)), float(np.asarray(n))))
    (e0, n0), (e1, n1), (e2, n2) = vals
    return (e1 - e0) / W, (e2 - e0) / H, e0, (n1 - n0) / W, (n2 - n0) / H, n0


def draw_overlay(img: Image.Image, region, page_to_plant) -> float | None:
    """Page-fraction ticks on the top and left edges; plant E/N grid lines when `page_to_plant` maps
    (fx, fy) page fractions to plant (E, N). Returns the grid step in metres, or None."""
    draw = ImageDraw.Draw(img)
    font = ImageFont.load_default()
    W, H = img.size
    x0, y0, x1, y1 = region
    step = _nice((x1 - x0) / 8)
    v = math.ceil(x0 / step) * step
    while v <= x1 + 1e-9:
        u = (v - x0) / (x1 - x0) * W
        draw.line([(u, 0), (u, 10)], fill=TICK, width=1)
        draw.text((u + 2, 11), f"{v:.3f}", fill=TICK, font=font)
        v += step
    step = _nice((y1 - y0) / 8)
    v = math.ceil(y0 / step) * step
    while v <= y1 + 1e-9:
        w = (v - y0) / (y1 - y0) * H
        draw.line([(0, w), (10, w)], fill=TICK, width=1)
        draw.text((12, w + 1), f"{v:.3f}", fill=TICK, font=font)
        v += step
    if page_to_plant is None:
        return None
    try:
        a, b, c, d, e, f = _affine_px_to(page_to_plant, region, W, H)
        corners = [(0, 0), (W, 0), (0, H), (W, H)]
        es = [a * u + b * w + c for u, w in corners]
        ns = [d * u + e * w + f for u, w in corners]
        if not all(math.isfinite(v) for v in (*es, *ns)):
            return None
    except Exception:  # noqa: BLE001 - a frame that can't map this page (or maps it to NaN/inf) draws no grid
        return None
    gstep = _nice(max(max(es) - min(es), max(ns) - min(ns)) / 6)
    for (p, q, r), lo, hi, axis in (((a, b, c), min(es), max(es), "E"), ((d, e, f), min(ns), max(ns), "N")):
        val = math.ceil(lo / gstep) * gstep
        while val <= hi:
            seg = _segment(p, q, r, val, W, H)
            if seg:
                draw.line(seg, fill=GRID, width=1)
                draw.text((seg[0][0] + 3, seg[0][1] + 3), f"{axis} {val:g}", fill=GRID, font=font)
            val += gstep
    return gstep


# ------------------------------------------------------------------ site mosaics
MAX_TILES = 100
TRI_CAP = 1_500_000
MAX_INSTANCES = 500
BG = (20, 26, 36)
OUTLINE = (0, 220, 255)
FLAGGED = (255, 80, 80)
HILITE = (255, 210, 0)
FILL = {
    "sea": (40, 90, 160, 110),
    "land": (170, 160, 120, 70),
    "road": (90, 90, 90, 120),
    "paved": (130, 130, 130, 90),
    "laydown": (150, 130, 90, 80),
    "slope": (120, 140, 90, 80),
    "revetment": (110, 100, 90, 110),
}
FAMILY_GROUP = {
    "structure": "Support",
    "equipment": "Shell",
    "building": "Head",
    "civil": "Bottom",
    "environment": "Lining",
    "fallback": "Other",
}


def ws_frame(handle):
    from app.workspace.service import get_frame

    return get_frame(handle)


def mosaic(handle, ws, kind: str, layer_id: str, bbox, max_px: int = MAX_PX):
    """Site tiles of one layer over `bbox` (the map frame's CRS) as one RGBA image, at the zoom whose
    pixel fits the box in `max_px`, never more than MAX_TILES tiles. (img, (left, top, res)) or None."""
    from app.workspace import grid as sgrid
    from app.workspace import tiles

    x0, y0, x1, y1 = bbox
    span = max(x1 - x0, y1 - y0, 1e-6)
    z = int(min(max(math.floor(math.log2(sgrid.RES0 * max_px / span)), 0), sgrid.Z_MAX))
    while True:
        tx0, ty0 = sgrid.tile_of(x0, y1, z)
        tx1, ty1 = sgrid.tile_of(x1, y0, z)
        if (tx1 - tx0 + 1) * (ty1 - ty0 + 1) <= MAX_TILES or z == 0:
            break
        z -= 1
    out = Image.new("RGBA", ((tx1 - tx0 + 1) * sgrid.TILE, (ty1 - ty0 + 1) * sgrid.TILE), (0, 0, 0, 0))
    drawn = False
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            body = tiles.serve_site_tile(handle, ws, kind, layer_id, z, tx, ty, tiles.TileStyle())
            if body:
                out.paste(
                    Image.open(io.BytesIO(body)).convert("RGBA"),
                    ((tx - tx0) * sgrid.TILE, (ty - ty0) * sgrid.TILE),
                )
                drawn = True
    if not drawn:
        return None
    left, _, _, top = sgrid.tile_bounds(z, tx0, ty0)
    return out, (left, top, sgrid.res(z))


@dataclass(frozen=True)
class Canvas:
    e0: float
    n1: float
    res: float
    width: int
    height: int

    def px(self, e, n):
        return (np.asarray(e, float) - self.e0) / self.res, (self.n1 - np.asarray(n, float)) / self.res

    def plant(self, u, v):
        return self.e0 + np.asarray(u, float) * self.res, self.n1 - np.asarray(v, float) * self.res


def canvas_for(bbox, max_px: int = MAX_PX) -> Canvas:
    e0, n0, e1, n1 = bbox
    res = max(e1 - e0, n1 - n0, 1e-6) / max_px
    return Canvas(e0, n1, res, max(1, math.ceil((e1 - e0) / res)), max(1, math.ceil((n1 - n0) / res)))


def background(rc, cv: Canvas, kind: str, layer_id: str) -> Image.Image | None:
    """The layer warped onto the plant canvas (plant north up), or None when it can't be placed."""
    from app.asset_models.agent.plant.sitefit import crs_wkt_of
    from app.workspace.frame import transform_xy

    site = rc.site()
    if site is None:
        return None
    ws = ws_frame(rc.handle)
    site_wkt = crs_wkt_of(site)
    if ws.kind == "local" or site_wkt is None:
        return None
    grid = rc.grid()
    us = np.array([0.0, cv.width, 0.0, cv.width])
    vs = np.array([0.0, 0.0, cv.height, cv.height])
    e, n = cv.plant(us, vs)
    X, Y = grid.plant_to_site(e, n)
    X, Y = transform_xy(site_wkt, ws.crs_wkt, X, Y)
    got = mosaic(
        rc.handle, ws, kind, layer_id, (float(X.min()), float(Y.min()), float(X.max()), float(Y.max()))
    )
    if got is None:
        return None
    img, (left, top, res) = got
    p = (X[:3] - left) / res
    q = (top - Y[:3]) / res
    coeffs = (
        (p[1] - p[0]) / cv.width,
        (p[2] - p[0]) / cv.height,
        p[0],
        (q[1] - q[0]) / cv.width,
        (q[2] - q[0]) / cv.height,
        q[0],
    )
    return img.transform(
        (cv.width, cv.height),
        Image.Transform.AFFINE,
        tuple(float(c) for c in coeffs),
        resample=Image.Resampling.BILINEAR,
        fillcolor=(0, 0, 0, 0),
    )


def pick_map(handle) -> str | None:
    from sqlalchemy import select

    from app.db.models import GeoMap

    with handle.session() as s:
        return s.scalar(
            select(GeoMap.id)
            .where(GeoMap.status == "ready", GeoMap.crs_wkt.is_not(None), GeoMap.geotransform.is_not(None))
            .order_by(GeoMap.created_at.desc())
            .limit(1)
        )


def bbox_of(items, env, margin: float = 0.05, min_span: float = 20.0):
    from app.asset_models.siteframe import footprint_polygon

    pts = [footprint_polygon(i.footprint) for i in items] + [np.asarray(f.pts, float) for f in env]
    allp = np.concatenate(pts) if pts else np.zeros((1, 2))
    e0, n0 = allp.min(axis=0)
    e1, n1 = allp.max(axis=0)
    ce, cn = (e0 + e1) / 2, (n0 + n1) / 2
    he = max(e1 - e0, min_span) * (1 + 2 * margin) / 2  # each axis at least min_span, plus the margin
    hn = max(n1 - n0, min_span) * (1 + 2 * margin) / 2
    return (float(ce - he), float(cn - hn), float(ce + he), float(cn + hn))


def plan_image(rc, items, env, bbox, *, bg: Image.Image | None = None, highlight=frozenset()) -> Image.Image:
    from app.asset_models.siteframe import footprint_polygon, footprint_ref

    cv = canvas_for(bbox)
    base = Image.new("RGBA", (cv.width, cv.height), (*BG, 255))
    if bg is not None:
        base.alpha_composite(bg)
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for f in env:
        u, v = cv.px([p[0] for p in f.pts], [p[1] for p in f.pts])
        draw.polygon(
            list(zip(u.tolist(), v.tolist(), strict=True)), fill=FILL.get(f.kind, (128, 128, 128, 80))
        )
    font = ImageFont.load_default()
    for it in items:
        ring = footprint_polygon(it.footprint)
        u, v = cv.px(ring[:, 0], ring[:, 1])
        colour = HILITE if it.id in highlight else FLAGGED if it.flags else OUTLINE
        draw.polygon(list(zip(u.tolist(), v.tolist(), strict=True)), outline=(*colour, 255))
    if len(items) <= 300:
        for it in items:
            if it.tag:
                e, n = footprint_ref(it.footprint)
                u, v = cv.px(e, n)
                draw.text((float(u) + 2, float(v) + 2), it.tag, fill=(255, 255, 255, 255), font=font)
    base.alpha_composite(layer)
    return base.convert("RGB")


def scene_meshes(rc, items, *, lod: float = 0.25):
    """Item meshes in the scene frame (x = N, y = EL - datum, z = E) via the same builders as the GLB.
    Stops at TRI_CAP triangles; expands at most MAX_INSTANCES instances per node."""
    import trimesh

    from app.asset_models.builders.base import BuildCtx, Instanced, build_item, load_all
    from app.asset_models.siteframe import footprint_ref

    load_all()
    ctx = BuildCtx(grid=rc.grid(), lod=lod)
    site = rc.site()
    datum = site.datum.el_m if site is not None else 0.0
    out, tris, skipped, fallbacks = {}, 0, 0, []
    for it in items:
        rc.check_cancelled()
        if tris >= TRI_CAP:
            skipped += 1
            continue
        nodes, flags = build_item(it, ctx)
        if any(f.code == "builder_fallback" for f in flags):
            fallbacks.append(it.id)
        parts = []
        for node in nodes:
            g = node.geometry
            if isinstance(g, Instanced):
                for xf in g.transforms[:MAX_INSTANCES]:
                    m = g.mesh.copy()
                    m.apply_transform(xf)
                    parts.append(m)
            else:
                parts.append(g)
        if not parts:
            continue
        mesh = trimesh.util.concatenate(parts) if len(parts) > 1 else parts[0].copy()
        e, n = footprint_ref(it.footprint)
        base = it.base_el if it.base_el is not None else datum
        mesh.apply_translation([n, base - datum, e])
        out[it.id] = mesh
        tris += len(mesh.faces)
    return out, skipped, fallbacks


def iso_image(rc, items) -> tuple[Image.Image, str]:
    from app.asset_models.builders.base import REGISTRY
    from app.asset_models.raster import View, render

    meshes, skipped, fallbacks = scene_meshes(rc, items)
    notes = []
    if skipped:
        notes.append(f"{skipped} items not drawn: the preview stops at {TRI_CAP:,} triangles.")
    if fallbacks:
        notes.append(f"{len(fallbacks)} items fell back to `other`: {', '.join(fallbacks[:20])}.")
    if not meshes:
        return Image.new("RGB", (1024, 1024), BG), " ".join([*notes, "No item could be meshed."])
    groups = {
        i.id: FAMILY_GROUP.get(getattr(REGISTRY.get(i.type), "family", "fallback"), "Other") for i in items
    }
    return render(meshes, View("iso"), size=1024, groups=groups), " ".join(notes)


def sheet(images, titles) -> Image.Image:
    """Views side by side (2 columns), aspect kept, the whole sheet <= MAX_PX."""
    if len(images) == 1:
        out = images[0].copy()
        out.thumbnail((MAX_PX, MAX_PX))
        return out
    cols, cell = 2, MAX_PX // 2
    rows = math.ceil(len(images) / cols)
    out = Image.new("RGB", (cols * cell, rows * (cell + 20)), BG)
    draw = ImageDraw.Draw(out)
    font = ImageFont.load_default()
    for k, (img, title) in enumerate(zip(images, titles, strict=True)):
        r, c = divmod(k, cols)
        t = img.copy()
        t.thumbnail((cell, cell))
        out.paste(t, (c * cell + (cell - t.width) // 2, r * (cell + 20) + 20 + (cell - t.height) // 2))
        draw.text((c * cell + 6, r * (cell + 20) + 4), title, fill=(230, 230, 230), font=font)
    out.thumbnail((MAX_PX, MAX_PX))
    return out


def jpeg(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=85)
    return buf.getvalue()
