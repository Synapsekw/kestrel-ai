"""Pydantic shapes of the catalogue schemas in contract/openapi.yaml."""

from dataclasses import asdict
from typing import Literal

from pydantic import BaseModel, Field

from app.catalogue.service import CatalogueTypeRef, SeverityLevelRef

HEX = r"^#[0-9a-fA-F]{6}$"
HOTKEY = r"^[1-9A-Za-z]$"
TypeKind = Literal["defect", "object"]
TypeOrigin = Literal["user", "migrated"]


class CatalogueTypeOut(BaseModel):
    id: str
    name: str
    colour: str
    kind: TypeKind
    default_severity: int | None
    hotkey: str | None
    group: str | None
    archived: bool
    origin: TypeOrigin

    @classmethod
    def from_ref(cls, ref: CatalogueTypeRef) -> "CatalogueTypeOut":
        return cls(**asdict(ref))


class CatalogueTypePatchOut(CatalogueTypeOut):
    backfill_candidates: bool = False


class CatalogueTypePage(BaseModel):
    items: list[CatalogueTypeOut]
    next_cursor: str | None = None
    needs_classification: bool = False


class CatalogueTypeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    colour: str | None = Field(None, pattern=HEX)
    kind: TypeKind = "object"
    default_severity: int | None = Field(None, ge=1, le=9)
    hotkey: str | None = Field(None, pattern=HOTKEY)
    group: str | None = Field(None, max_length=64)


class CatalogueTypePatch(BaseModel):
    """Every field optional; `model_dump(exclude_unset=True)` is the patch. `default_severity`,
    `hotkey` and `group` accept null (clear)."""

    name: str = Field(default=None, min_length=1, max_length=64)
    colour: str = Field(default=None, pattern=HEX)
    kind: TypeKind = Field(default=None)
    default_severity: int | None = Field(None, ge=1, le=9)
    hotkey: str | None = Field(None, pattern=HOTKEY)
    group: str | None = Field(None, max_length=64)
    archived: bool = Field(default=None)


class SeverityLevelOut(BaseModel):
    level: int = Field(ge=1, le=9)
    name: str = Field(min_length=1, max_length=32)
    colour: str = Field(pattern=HEX)

    @classmethod
    def from_ref(cls, ref: SeverityLevelRef) -> "SeverityLevelOut":
        return cls(level=ref.level, name=ref.name, colour=ref.colour)


class SeverityScale(BaseModel):
    levels: list[SeverityLevelOut] = Field(min_length=1, max_length=9)
