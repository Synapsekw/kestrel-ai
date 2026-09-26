"""A data item: a view over one row of a type's own table (spec 2026-09-26-foundation section 6.3,
contract `DataItem`). Nothing is stored for it."""

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel

DataItemType = Literal["image_set", "map", "elevation", "point_cloud", "drawing"]
DataItemStatus = Literal["importing", "ready", "failed"]


class DataItem(BaseModel):
    id: str
    type: DataItemType
    label: str
    captured_on: date | None
    status: DataItemStatus
    created_at: datetime
    summary: dict[str, Any]


class DataItemPage(BaseModel):
    items: list[DataItem]
    next_cursor: str | None
