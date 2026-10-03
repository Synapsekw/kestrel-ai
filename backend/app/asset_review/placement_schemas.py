# backend/app/asset_review/placement_schemas.py
"""Placements (spec 2026-10-02-asset-findings §8): the contract's `Placement`, `PlacementList` and
the compute body."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class PlacementOut(BaseModel):
    sighting_id: str
    finding_id: str | None
    kind: Literal["point", "patch"]
    center: list[float]
    normal: list[float]
    size: float
    severity: int | None
    type_id: str
    has_patch: bool


class PlacementList(BaseModel):
    version: int | None
    items: list[PlacementOut]
    next: str | None


class ComputePlacementsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    only_dirty: bool = False
