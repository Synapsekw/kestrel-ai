"""What every drawing reader returns from `inspect_file`: the DrawingInspection's reader fields."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass
class Inspected:
    units: str | None = None
    units_source: str | None = None
    crs_hint: str | None = None
    extent_src: list[float] | None = None
    layers: list[dict] = field(default_factory=list)
    page_count: int | None = None
    pages: list[dict] = field(default_factory=list)
    width: int | None = None
    height: int | None = None
    embedded: dict | None = None
    warnings: list[dict] = field(default_factory=list)

    def to_json(self) -> dict:
        return asdict(self)


def warning(code: str, message: str) -> dict:
    return {"code": code, "message": message}
