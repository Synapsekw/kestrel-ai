"""Keyless public tile servers (spec 2026-10-02-site-basemap B2). No source may need an API key."""

from dataclasses import dataclass
from typing import Literal

SourceName = Literal["satellite", "streets"]
MAX_ZOOM = 19


@dataclass(frozen=True)
class Source:
    url: str  # `{z}`, `{x}`, `{y}` placeholders
    media_type: str
    ext: str


SOURCES: dict[str, Source] = {
    # Esri's REST tile path is row before column.
    "satellite": Source(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "image/jpeg",
        "jpg",
    ),
    "streets": Source("https://tile.openstreetmap.org/{z}/{x}/{y}.png", "image/png", "png"),
}
