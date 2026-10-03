"""Brand request and response models (contract `Brand`, `BrandCreate`, `BrandPatch`,
`BrandLogoImport`; spec 2026-10-02-asset-findings §5.8)."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Hex = Annotated[str, Field(pattern=r"^#[0-9A-Fa-f]{6}$")]
LogoSlot = Literal["on_light", "on_dark", "flat"]
SLOTS: tuple[LogoSlot, ...] = ("on_light", "on_dark", "flat")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BrandColors(_Strict):
    accent: Hex
    accent_dark: Hex
    navy: Hex
    ink: Hex
    pale: Hex
    line: Hex


class BrandOut(BaseModel):
    id: str
    name: str
    colors: BrandColors
    font_text: str | None
    font_numerals: str | None
    logo_on_light: str | None
    logo_on_dark: str | None
    logo_flat: str | None
    website: str
    owner: str
    confidentiality: str
    pdf_author: str
    builtin: bool
    created_at: datetime
    updated_at: datetime


class BrandList(BaseModel):
    items: list[BrandOut]


class BrandCreate(_Strict):
    name: str = Field(min_length=1, max_length=80)
    colors: BrandColors | None = None
    font_text: str | None = Field(None, max_length=80)
    font_numerals: str | None = Field(None, max_length=80)
    website: str = Field("", max_length=200)
    owner: str = Field("", max_length=120)
    confidentiality: str = Field("", max_length=1000)
    pdf_author: str = Field("", max_length=120)


class BrandPatch(_Strict):
    name: str | None = Field(None, min_length=1, max_length=80)
    colors: BrandColors | None = None
    font_text: str | None = Field(None, max_length=80)
    font_numerals: str | None = Field(None, max_length=80)
    website: str | None = Field(None, max_length=200)
    owner: str | None = Field(None, max_length=120)
    confidentiality: str | None = Field(None, max_length=1000)
    pdf_author: str | None = Field(None, max_length=120)


class BrandLogoImport(_Strict):
    path: str = Field(min_length=1, max_length=1024)
