"""Asset block fixtures shared by the PDF tests (R1 Tasks 8 and 11): an `asset_map` block and an asset
finding block. A helper module, so no test module is imported by another."""

from __future__ import annotations

from report_docs import finding

from app.reports.asset_drawing import height_locator

MAP_BLOCK = {
    "kind": "asset_map",
    "title": "Tower A",
    "caption": "Each dot is one finding at its height and side of the asset.",
    "width_mm": 174,
    "height_mm": 92,
    "drawing": {
        "width": 760,
        "height": 400,
        "font_size": 11,
        "plot": {"x0": 110, "y0": 10, "x1": 622, "y1": 362},
        "silhouette": [[20, 362], [24, 10], [40, 10], [44, 362]],
        "bands": [
            {"y0": 10, "y1": 120, "label": "Upper floors", "shaded": True},
            {"y0": 120, "y1": 362, "label": "Lower floors", "shaded": False},
        ],
        "levels": [{"x0": 18, "x1": 46, "y": 200}],
        "x_ticks": [{"at": 110, "label": "N"}, {"at": 238, "label": "E"}],
        "y_ticks": [{"at": 362, "label": "0 m"}, {"at": 10, "label": "60 m"}],
        "x_title": "Side of the asset",
        "dots": [{"x": 300, "y": 90, "r": 5.5, "colour": "#FF7A2D", "label": "F-0042"}],
        "marker": None,
    },
}


def asset_finding(n: int = 7, note: str = "Open joint.") -> dict:
    f = finding(n, note=note, photos=0, comments=0)
    f["kv"] = [["Height", "41.2 m above street level"], ["Zone", "Upper floors"]]
    f["asset"] = {
        "kicker": f"Finding F-{n:04d} \u00b7 Upper floors \u00b7 seen in 2 photos",
        "height_locator": height_locator(60.0, [(0.0, 6.0), (60.0, 4.0)], [20.0], 41.2, "#FF7A2D"),
    }
    return f
