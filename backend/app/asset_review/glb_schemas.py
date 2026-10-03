"""Request shape of `importAssetModelGlb` (contract: AssetGlbImport)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.asset_review.frame import Origin

FrameConversion = Literal["none", "x_east_minus_z_north", "enu_z_up"]  # = frame_io.CONVERSIONS keys


class GlbImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str = Field(min_length=1, max_length=1024)
    frame_conversion: FrameConversion = "none"
    origin: Origin | None = None
    note: str | None = Field(None, max_length=500)
