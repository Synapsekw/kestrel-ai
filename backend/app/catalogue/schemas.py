"""Pydantic shapes of the catalogue schemas in contract/openapi.yaml."""

from dataclasses import asdict
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.catalogue.service import CatalogueTypeRef, SeverityLevelRef

HEX = r"^#[0-9a-fA-F]{6}$"
HOTKEY = r"^[1-9A-Za-z]$"
NOT_BLANK = r"\S"
TypeKind = Literal["defect", "object"]
TypeOrigin = Literal["user", "migrated", "template"]
TYPE_ORIGINS: tuple[str, ...] = ("user", "migrated", "template")
# Project setup (spec 2026-09-30-project-setup section 5, plan 2026-09-30-setup-u1).
DEFINITION_MAX = 1000
MAX_SEVERITY_RULES = 8


class SeverityRule(BaseModel):
    """One of a type's ordered severity rules. Whether `severity` is a level on the current scale is
    the service's own 422 (`invalid_severity_rule`, unit U2), never pydantic's."""

    model_config = ConfigDict(extra="forbid")

    when: str = Field(min_length=1, max_length=200, pattern=NOT_BLANK)
    severity: int = Field(ge=1, le=9)


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
    # Defaulted until U2 adds both fields to CatalogueTypeRef (plan 2026-09-30-setup-u2); `from_ref`
    # then passes them through. A default is always serialised, so every answer carries the two keys
    # the contract requires.
    definition: str | None = Field(None, max_length=DEFINITION_MAX)
    severity_rules: list[SeverityRule] = Field(default_factory=list, max_length=MAX_SEVERITY_RULES)

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
    definition: str | None = Field(None, max_length=DEFINITION_MAX)
    severity_rules: list[SeverityRule] = Field(default_factory=list, max_length=MAX_SEVERITY_RULES)


class CatalogueTypePatch(BaseModel):
    """Every field optional; `model_dump(exclude_unset=True)` is the patch. `default_severity`,
    `hotkey`, `group` and `definition` accept null (clear)."""

    name: str = Field(default=None, min_length=1, max_length=64)
    colour: str = Field(default=None, pattern=HEX)
    kind: TypeKind = Field(default=None)
    default_severity: int | None = Field(None, ge=1, le=9)
    hotkey: str | None = Field(None, pattern=HOTKEY)
    group: str | None = Field(None, max_length=64)
    archived: bool = Field(default=None)
    definition: str | None = Field(None, max_length=DEFINITION_MAX)
    severity_rules: list[SeverityRule] = Field(default=None, max_length=MAX_SEVERITY_RULES)


class SeverityLevelOut(BaseModel):
    level: int = Field(ge=1, le=9)
    name: str = Field(min_length=1, max_length=32)
    colour: str = Field(pattern=HEX)

    @classmethod
    def from_ref(cls, ref: SeverityLevelRef) -> "SeverityLevelOut":
        return cls(level=ref.level, name=ref.name, colour=ref.colour)


class SeverityScale(BaseModel):
    levels: list[SeverityLevelOut] = Field(min_length=1, max_length=9)


# ------------------------------------------------------------------------------ project setup (S1)
# `POST /catalogue/types/ensure` (spec 2026-09-30-project-setup section 6). U2 builds the route.
MAX_ENSURE_TYPES = 64


class CatalogueTypeSpec(BaseModel):
    """A type as a project template names it. A request needs only `name` and `kind`; the defaults
    make a dump carry every key, as a `ProjectTemplate` answer must."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=64, pattern=NOT_BLANK)
    kind: TypeKind
    colour: str | None = Field(None, pattern=HEX)
    default_severity: int | None = Field(None, ge=1, le=9)
    hotkey: str | None = Field(None, pattern=HOTKEY)
    definition: str | None = Field(None, max_length=DEFINITION_MAX)
    severity_rules: list[SeverityRule] = Field(default_factory=list, max_length=MAX_SEVERITY_RULES)


class EnsureTypesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    types: list[CatalogueTypeSpec] = Field(min_length=1, max_length=MAX_ENSURE_TYPES)
    dry_run: bool = False


class TypeConflict(BaseModel):
    kind: TypeKind
    colour: str = Field(pattern=HEX)


class EnsuredType(BaseModel):
    name: str
    id: str | None
    created: bool
    conflict: TypeConflict | None


class EnsureTypesResult(BaseModel):
    items: list[EnsuredType] = Field(max_length=MAX_ENSURE_TYPES)
