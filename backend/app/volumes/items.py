"""What an export knows about one measurement, and how its numbers are labelled (spec §6.1, §10).

The same fill/cut/net are labelled by base kind everywhere; the stored names travel alongside, so a
reader can always tell which is which.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from shapely.geometry import Polygon

BASE_KIND_TEXT = {
    "toe_plane": "Stockpile toe — plane",
    "toe_surface": "Stockpile toe — fitted surface",
    "flat": "Flat level",
    "surface": "Another surface",
}


@dataclass(frozen=True)
class Labels:
    fill: str
    cut: str
    headline: str  # "fill" | "net" | "both"


def labels(base_kind: str, base_surface: dict | None = None) -> Labels:
    """§6.1: toe and flat bases measure a stockpile; an earlier survey gives change since its
    date; a design gives what is still to cut and to fill."""
    if base_kind != "surface":
        return Labels("Stockpile volume (above base)", "Below base", "fill")
    if base_surface and base_surface.get("kind") == "design":
        return Labels("Above design (to cut)", "Below design (to fill)", "both")
    when = (base_surface or {}).get("captured_on") or "the earlier survey"
    return Labels(f"Added since {when} (fill)", f"Removed since {when} (cut)", "net")


@dataclass
class ExportItem:
    """One ready measurement, flattened for the writers."""

    id: str
    name: str
    status: str
    polygon: list[list[float]]
    base: dict
    masks: dict
    alignment: dict
    results: dict
    epsg: int | None
    crs_wkt: str | None
    plan_png: bytes | None = None
    clutter_rings: list[list[list[float]]] = field(default_factory=list)

    @property
    def labels(self) -> Labels:
        return labels(self.base["kind"], self.results.get("base_surface"))

    @property
    def base_detail(self) -> str:
        kind = self.base["kind"]
        if kind == "flat":
            return f"flat at {self.base['z']:.3f} m"
        if kind == "surface":
            ref = self.results.get("base_surface") or {}
            return f"surface {ref.get('name', '?')} ({ref.get('captured_on') or 'no date'})"
        return BASE_KIND_TEXT[kind]

    @property
    def centroid(self) -> tuple[float, float]:
        c = Polygon(self.polygon).centroid
        return (c.x, c.y)
