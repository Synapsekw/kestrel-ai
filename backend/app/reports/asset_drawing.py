"""The asset findings map and the height locator as AssetDrawing primitives (spec
2026-10-02-asset-findings §10). Pure: no session, no PDF library. The PDF (pdf/asset_flowables.py) and
the preview (AssetDrawingSvg.tsx) draw these primitives with the same offsets.

`height_locator` ports the kit's report `locator` (gen.py): a vertical axis with nice ticks, the radial
silhouette mirrored about the axis, the level lines, and the finding's height as a line and a dot.
`map_drawing` is the one reader of P1's `findings_map.geometry` dict, so the PDF map is the Overview
card's map (P1's TS twin draws the same geometry)."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any

from app.asset_review.findings_map import nice_step

__all__ = ["LOC_CX", "LOC_H", "LOC_PLOT", "LOC_W", "MAP_FONT", "height_locator", "map_drawing", "nice_step"]

LOC_W, LOC_H = 64.0, 200.0
LOC_PLOT = (16.0, 8.0, 62.0, 186.0)  # x0, y0, x1, y1
LOC_CX = 39.0
LOC_HALF_MAX = 20.0  # the widest silhouette half-width, drawing units
LOC_K_MAX = 5.2
LOC_FONT = 6.0
LOC_DOT_R = 3.6
MAP_FONT = 11.0


def _r(v: Any) -> float:
    return round(float(v), 2)


def height_locator(
    total_m: float,
    silhouette: Sequence[Sequence[float]],
    levels: Sequence[float],
    height_m: float,
    colour: str,
) -> dict:
    sil = [(float(y), float(r)) for y, r in silhouette]
    ht = float(total_m) if total_m and total_m > 0 else max([y for y, _ in sil] + [1.0])
    x0, y0, x1, y1 = LOC_PLOT
    ph = y1 - y0

    def y_of(v: float) -> float:
        return y0 + (1 - max(0.0, min(ht, float(v))) / ht) * ph

    rmax = max((r for _, r in sil), default=0.0)
    k = min(LOC_K_MAX, LOC_HALF_MAX / rmax) if rmax > 0 else 0.0

    def r_at(h: float) -> float:
        r = 0.0
        for y, rr in sil:
            if y <= h:
                r = rr
        return r or (sil[0][1] if sil else 0.0)

    poly = []
    if len(sil) >= 2:
        poly = [[_r(LOC_CX - r * k), _r(y_of(y))] for y, r in sil]
        poly += [[_r(LOC_CX + r * k), _r(y_of(y))] for y, r in reversed(sil)]
    step = nice_step(ht)
    tick = step * (2 if ht / step > 5 else 1)
    ticks = [{"at": _r(y_of(i * tick)), "label": f"{i * tick:g}"} for i in range(int(ht / tick + 1e-6) + 1)]
    y = _r(y_of(height_m))
    label = f"{float(height_m):.1f} m"
    return {
        "width": LOC_W,
        "height": LOC_H,
        "font_size": LOC_FONT,
        "plot": {"x0": x0, "y0": y0, "x1": x1, "y1": y1},
        "silhouette": poly,
        "bands": [],
        "levels": (
            [
                {"x0": _r(LOC_CX - r_at(z) * k - 3), "x1": _r(LOC_CX + r_at(z) * k + 3), "y": _r(y_of(z))}
                for z in levels
            ]
            if sil
            else []
        ),
        "x_ticks": [],
        "y_ticks": ticks,
        "x_title": label,
        "dots": [{"x": LOC_CX, "y": y, "r": LOC_DOT_R, "colour": colour, "label": label}],
        "marker": {"y": y, "x0": x0 + 2, "x1": x1, "colour": colour},
    }


def map_drawing(
    geom: dict,
    *,
    colour_of: Callable[[int | None], str],
    label_of: Callable[[str], str | None],
) -> dict:
    """P1's findings-map geometry as AssetDrawing primitives. P1 already orders the dots worst last,
    so the worst are drawn on top; unplaced findings are not in `dots` (P1 counts them)."""
    p = geom["plot"]
    return {
        "width": float(geom["width"]),
        "height": float(geom["height"]),
        "font_size": MAP_FONT,
        "plot": {"x0": _r(p["x"]), "y0": _r(p["y"]), "x1": _r(p["x"] + p["w"]), "y1": _r(p["y"] + p["h"])},
        "silhouette": [[_r(x), _r(y)] for x, y in (geom.get("silhouette") or [])],
        "bands": [
            {
                "y0": _r(z["y"]),
                "y1": _r(z["y"] + z["h"]),
                "label": str(z["label"]),
                "shaded": bool(z["shade"]),
            }
            for z in geom.get("zones", [])
        ],
        "levels": [
            {"x0": _r(lv["x1"]), "x1": _r(lv["x2"]), "y": _r(lv["y"])} for lv in geom.get("levels", [])
        ],
        "x_ticks": [{"at": _r(t["x"]), "label": str(t["label"])} for t in geom.get("x_ticks", [])],
        "y_ticks": [{"at": _r(t["y"]), "label": f"{float(t['value']):g} m"} for t in geom.get("y_ticks", [])],
        "x_title": str(geom.get("axis_title") or ""),
        "dots": [
            {
                "x": _r(d["x"]),
                "y": _r(d["y"]),
                "r": float(geom["dot_r"]),
                "colour": colour_of(d.get("severity")),
                "label": label_of(str(d["id"])) or "",
            }
            for d in geom.get("dots", [])
        ],
        "marker": None,
    }
