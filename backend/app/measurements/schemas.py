"""One row of the project's Measurements list (contract MeasurementItem / MeasurementPage; spec
2026-09-26-map-workspace §12 `GET /measurements`; M-C0 Rulings 8 and 9). A view over one row of a
kind's own table; nothing is stored for it."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.data_items.schemas import DataItemType

MeasurementKind = Literal["cloud", "volume", "map"]
MeasurementSubKind = Literal["point", "distance", "height", "vertical", "area", "profile", "volume"]
MeasurementUnit = Literal["m", "m2", "m3", "deg", "mm_per_m"]
MeasurementStatus = Literal["ready", "computing", "stale", "failed"]


class MeasurementItem(BaseModel):
    kind: MeasurementKind
    sub_kind: MeasurementSubKind
    id: str
    name: str
    headline: float | None
    unit: MeasurementUnit | None
    data_type: DataItemType | None
    data_id: str | None
    status: MeasurementStatus
    created_at: datetime
    updated_at: datetime


class MeasurementPage(BaseModel):
    items: list[MeasurementItem]
    next_cursor: str | None
