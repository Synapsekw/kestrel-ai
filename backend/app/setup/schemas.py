"""Pydantic shapes of the project-setup schemas in contract/openapi.yaml (spec
2026-09-30-project-setup sections 5, 7 and 9; plan 2026-09-30-setup-u1).

The models state exactly what the contract states. A rule the schema cannot express (a slot key or
a type name twice, two types with one hotkey) is the owner's own 422 (`invalid_template`, unit U2),
never pydantic's `validation_error`. The catalogue-facing shapes (`CatalogueTypeSpec`, the ensure
request and result) live in app/catalogue/schemas.py.
"""

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_serializer

from app.catalogue.schemas import NOT_BLANK, CatalogueTypeSpec

SlotRoute = Literal["images", "map", "elevation", "pointcloud", "drawing", "video"]
SLOT_ROUTES: tuple[str, ...] = ("images", "map", "elevation", "pointcloud", "drawing", "video")
RasterMatch = Literal["ortho", "elevation"]
SLOT_KEY = r"^[a-z][a-z0-9_]{0,31}$"
EXTENSION = r"^[a-z0-9]{1,10}$"
# Bounds (spec section 10, index "Budget").
MAX_SLOTS = 16
MAX_TEMPLATE_TYPES = 64
MAX_INSPECT_PATHS = 16
MAX_BUCKET_FILES = 200
MAX_BUCKET_SAMPLES = 200
MAX_NOT_RECOGNISED_SAMPLES = 50
MAX_INSPECT_BUCKETS = 500

Extension = Annotated[str, StringConstraints(pattern=EXTENSION)]
PathText = Annotated[str, StringConstraints(min_length=1)]


class SlotMatch(BaseModel):
    """Both keys are optional and never null in the contract: an absent key matches either value.
    `None` means absent, and the serializer drops it, so `SlotMatch(raster="ortho")` and
    `SlotMatch(raster="ortho", thermal=None)` both dump as `{"raster": "ortho"}` wherever they are
    nested (a template's slots, an inspect bucket, a FastAPI answer)."""

    model_config = ConfigDict(extra="forbid")

    raster: RasterMatch | None = None
    thermal: bool | None = None

    @model_serializer(mode="wrap")
    def _drop_absent(self, handler) -> dict[str, Any]:
        return {k: v for k, v in handler(self).items() if v is not None}


class TemplateSlot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(pattern=SLOT_KEY)
    label: str = Field(min_length=1, max_length=48)
    route: SlotRoute
    required: bool
    accepts: list[Extension] = Field(min_length=1, max_length=12)
    match: SlotMatch | None


class TemplateConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    config_version: Literal[1]
    slots: list[TemplateSlot] = Field(max_length=MAX_SLOTS)
    types: list[CatalogueTypeSpec] = Field(max_length=MAX_TEMPLATE_TYPES)


class ProjectTemplateOut(BaseModel):
    """Contract schema `ProjectTemplate`. Named `...Out` like `CatalogueTypeOut`, so it never shadows
    the ORM class `app.catalogue.db.ProjectTemplate`."""

    id: str
    name: str
    description: str
    builtin: bool
    config: TemplateConfig
    created_at: datetime
    updated_at: datetime


class ProjectTemplatePage(BaseModel):
    items: list[ProjectTemplateOut]


class ProjectTemplateCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80, pattern=NOT_BLANK)
    description: str = Field("", max_length=300)
    config: TemplateConfig


class ProjectTemplatePatch(BaseModel):
    """Every field optional; `model_dump(exclude_unset=True)` is the patch. None is nullable."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(default=None, min_length=1, max_length=80, pattern=NOT_BLANK)
    description: str = Field(default=None, max_length=300)
    config: TemplateConfig = Field(default=None)


class SetupInspectRequest(BaseModel):
    """`paths` are meant to be absolute, but a relative, missing or unreadable one is listed under
    `not_recognised` by the job (U3), never refused here."""

    model_config = ConfigDict(extra="forbid")

    paths: list[PathText] = Field(min_length=1, max_length=MAX_INSPECT_PATHS)
    template_id: str = Field(default=None, min_length=1)


class InspectBucket(BaseModel):
    route: SlotRoute
    match: SlotMatch
    slot_key: str | None
    folder: str
    files: list[str] = Field(max_length=MAX_BUCKET_FILES)
    count: int = Field(ge=0)
    bytes: int = Field(ge=0)
    samples: list[str] = Field(max_length=MAX_BUCKET_SAMPLES)
    crs: str | None


class InspectSkipped(BaseModel):
    name: str
    reason: str


class InspectNotRecognised(BaseModel):
    count: int = Field(ge=0)
    samples: list[InspectSkipped] = Field(max_length=MAX_NOT_RECOGNISED_SAMPLES)


class InspectResult(BaseModel):
    """The `result` of a `setup_inspect` job: U3 stores `InspectResult(...).model_dump(mode="json")`."""

    buckets: list[InspectBucket] = Field(max_length=MAX_INSPECT_BUCKETS)
    not_recognised: InspectNotRecognised
    suggested_template_id: str | None
    truncated: bool
