"""Pydantic models for Reports, matching contract/openapi.yaml exactly (spec 2026-09-26-reports
sections 7.1, 7.2, 8, 9.1, 14; plan 2026-09-30-reports-r0).

R0 owns this module. The other R units import from it and never add a model here: a unit that
needs a contract change edits openapi.yaml and this module together, minimally, and lists it as a
hand-off (index, "Rules while Reports is in flight"). The models express exactly what the contract
expresses and no more - no cross-field validators - so a schema-valid body is never answered
`validation_error`; a rule the schema cannot state is its owner's `invalid_report` or
`invalid_template` (R1). Config and request models forbid extra keys; the config models carry the
defaults of a new report. Configs are dumped with `by_alias=True` (`ReportDateFilter.from`).
"""

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

# ------------------------------------------------------------------------------ literals

SectionKey = Literal[
    "cover",
    "summary",
    "findings_table",
    "finding_pages",
    "measurements",
    "comparison",
    "object_counts",
    "appendix",
]
SECTION_KEYS: tuple[SectionKey, ...] = (
    "cover",
    "summary",
    "findings_table",
    "finding_pages",
    "measurements",
    "comparison",
    "object_counts",
    "appendix",
)
FindingStatus = Literal["open", "reviewed", "closed"]
DateRule = Literal["all", "range", "last_days", "since_last_issued"]
FindingsTableColumn = Literal["number", "type", "severity", "status", "data_item", "observed", "note"]
FINDINGS_TABLE_COLUMNS: tuple[FindingsTableColumn, ...] = (
    "number",
    "type",
    "severity",
    "status",
    "data_item",
    "observed",
    "note",
)
FindingsTableSort = Literal["severity_desc", "number", "type", "observed"]
SnapshotSource = Literal["image", "map", "cloud"]
CommentsMode = Literal["none", "last", "all"]
MeasurementKindKey = Literal["length", "area", "height", "lean", "profile", "volume"]
MEASUREMENT_KIND_KEYS: tuple[MeasurementKindKey, ...] = (
    "length",
    "area",
    "height",
    "lean",
    "profile",
    "volume",
)
ComparisonMode = Literal["swipe", "side_by_side", "both"]
ReportVersionState = Literal["rendering", "ready", "failed"]
ReportFileKind = Literal["pdf", "csv", "xlsx"]
ParaStyle = Literal["body", "small", "note"]
ColumnAlign = Literal["left", "center", "right"]
ColumnStyle = Literal["text", "mono"]
KpiTone = Literal["neutral", "good", "bad", "warn"]
ChartKind = Literal["bar", "stacked_bar", "line"]
SnapshotKind = Literal["image_crop", "map", "elevation", "pair", "view3d", "volume_plan", "attachment"]
SNAPSHOT_KINDS: tuple[SnapshotKind, ...] = (
    "image_crop",
    "map",
    "elevation",
    "pair",
    "view3d",
    "volume_plan",
    "attachment",
)
BlockKind = Literal[
    "heading",
    "para",
    "kv",
    "kpis",
    "table",
    "figure",
    "figure_row",
    "chart",
    "finding",
    "page_break",
    "volume",
    "cover",
]
BLOCK_KINDS: tuple[BlockKind, ...] = (
    "heading",
    "para",
    "kv",
    "kpis",
    "table",
    "figure",
    "figure_row",
    "chart",
    "finding",
    "page_break",
    "volume",
    "cover",
)

Colour = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
Sha256 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
SnapshotKey = Annotated[str, Field(pattern=r"^[0-9a-f]{32}$")]
Pixels = Annotated[int, Field(ge=16, le=2400)]
OutSize = Annotated[list[Pixels], Field(min_length=2, max_length=2)]
Point2 = Annotated[list[float], Field(min_length=2, max_length=2)]
Bbox = Annotated[list[float], Field(min_length=4, max_length=4)]
KvRow = Annotated[list[str], Field(min_length=2, max_length=2)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ------------------------------------------------------------------------------ config (spec 7.1, 7.2)


class ReportCover(_Strict):
    title: str = Field("", max_length=200)
    subtitle: str | None = Field(None, max_length=200)
    site: str | None = Field(None, max_length=200)
    client: str | None = Field(None, max_length=200)
    author: str = Field("", max_length=200)
    logo_asset_id: str | None = None
    report_date: date | None = None


class ReportPaper(_Strict):
    size: Literal["A4", "Letter"] = "A4"
    orientation: Literal["portrait"] = "portrait"


class ReportDateFilter(_Strict):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    rule: DateRule = "all"
    from_: date | None = Field(None, alias="from")
    to: date | None = None
    days: int | None = Field(None, ge=1, le=3650)


class ReportFilters(_Strict):
    severity_min: int | None = Field(None, ge=1, le=9)
    include_ungraded: bool = True
    statuses: list[FindingStatus] = Field(default_factory=lambda: ["open", "reviewed"], max_length=3)
    type_ids: list[str] | None = Field(None, max_length=500)
    data_item_ids: list[str] | None = Field(None, max_length=1000)
    date: ReportDateFilter = Field(default_factory=ReportDateFilter)


class CoverOptions(_Strict):
    show_locator: bool = True


class SummaryOptions(_Strict):
    narrative: str = Field("", max_length=20000)
    show_deltas: bool = True


class FindingsTableOptions(_Strict):
    columns: list[FindingsTableColumn] = Field(
        default_factory=lambda: list(FINDINGS_TABLE_COLUMNS), min_length=1, max_length=7
    )
    sort: FindingsTableSort = "severity_desc"


class FindingPagesOptions(_Strict):
    snapshots: list[SnapshotSource] = Field(default_factory=lambda: ["image", "map", "cloud"], max_length=3)
    photos_max: int = Field(4, ge=0, le=6)
    comments: CommentsMode = "last"
    context_inset: bool = True


class MeasurementsOptions(_Strict):
    kinds: list[MeasurementKindKey] = Field(
        default_factory=lambda: list(MEASUREMENT_KIND_KEYS), min_length=1, max_length=6
    )
    snapshots: bool = True
    measurement_ids: list[str] | None = Field(None, max_length=1000)


class ComparisonPair(_Strict):
    item_a: str
    item_b: str
    bbox_wgs84: Bbox | None = None


class ComparisonOptions(_Strict):
    pairs: Literal["auto"] | Annotated[list[ComparisonPair], Field(max_length=20)] = "auto"
    mode: ComparisonMode = "both"
    counts_chart: bool = True


class ObjectCountsOptions(_Strict):
    type_ids: list[str] | None = Field(None, max_length=500)
    per_area: bool = True
    verified_only: bool = False


class AppendixOptions(_Strict):
    include_methods: bool = True


class ReportSectionCover(_Strict):
    key: Literal["cover"] = "cover"
    enabled: bool = True
    options: CoverOptions = Field(default_factory=CoverOptions)


class ReportSectionSummary(_Strict):
    key: Literal["summary"] = "summary"
    enabled: bool = True
    options: SummaryOptions = Field(default_factory=SummaryOptions)


class ReportSectionFindingsTable(_Strict):
    key: Literal["findings_table"] = "findings_table"
    enabled: bool = True
    options: FindingsTableOptions = Field(default_factory=FindingsTableOptions)


class ReportSectionFindingPages(_Strict):
    key: Literal["finding_pages"] = "finding_pages"
    enabled: bool = True
    options: FindingPagesOptions = Field(default_factory=FindingPagesOptions)


class ReportSectionMeasurements(_Strict):
    key: Literal["measurements"] = "measurements"
    enabled: bool = True
    options: MeasurementsOptions = Field(default_factory=MeasurementsOptions)


class ReportSectionComparison(_Strict):
    key: Literal["comparison"] = "comparison"
    enabled: bool = True
    options: ComparisonOptions = Field(default_factory=ComparisonOptions)


class ReportSectionObjectCounts(_Strict):
    key: Literal["object_counts"] = "object_counts"
    enabled: bool = True
    options: ObjectCountsOptions = Field(default_factory=ObjectCountsOptions)


class ReportSectionAppendix(_Strict):
    key: Literal["appendix"] = "appendix"
    enabled: bool = True
    options: AppendixOptions = Field(default_factory=AppendixOptions)


ReportSection = Annotated[
    ReportSectionCover
    | ReportSectionSummary
    | ReportSectionFindingsTable
    | ReportSectionFindingPages
    | ReportSectionMeasurements
    | ReportSectionComparison
    | ReportSectionObjectCounts
    | ReportSectionAppendix,
    Field(discriminator="key"),
]


def default_sections() -> list[ReportSection]:
    """The eight sections in canonical order, every one enabled with its default options."""
    return [
        ReportSectionCover(),
        ReportSectionSummary(),
        ReportSectionFindingsTable(),
        ReportSectionFindingPages(),
        ReportSectionMeasurements(),
        ReportSectionComparison(),
        ReportSectionObjectCounts(),
        ReportSectionAppendix(),
    ]


class ReportConfig(_Strict):
    cover: ReportCover = Field(default_factory=ReportCover)
    paper: ReportPaper = Field(default_factory=ReportPaper)
    filters: ReportFilters = Field(default_factory=ReportFilters)
    sections: list[ReportSection] = Field(default_factory=default_sections, min_length=8, max_length=8)
    # Spec 2026-10-02-asset-findings §5.8: a `Brand` id; None (or a brand since deleted) is the
    # Kestrel theme. Configs saved before it existed read None.
    brand_id: str | None = Field(None, max_length=64)


# ------------------------------------------------------------------------------ snapshots (spec 9.1)


class SnapshotGeometry(_Strict):
    type: Literal["Point", "LineString", "Polygon"]
    coordinates: list


class ImageCropSpec(_Strict):
    kind: Literal["image_crop"] = "image_crop"
    image_id: str
    annotation_id: str | None = None
    ring: Annotated[list[Point2], Field(min_length=1, max_length=4096)]
    colour: Colour
    label: str
    context: float = Field(3.0, ge=1, le=10)
    out: OutSize = Field(default_factory=lambda: [1200, 900])
    inset: bool = False


class MapSpec(_Strict):
    kind: Literal["map"] = "map"
    item_id: str
    geometry: SnapshotGeometry
    colour: Colour
    label: str | None = None
    min_extent_m: float = Field(40.0, ge=1, le=100000)
    out: OutSize = Field(default_factory=lambda: [1200, 900])
    scale_bar: bool = True
    north: bool = True
    inset: bool = False


class ElevationSpec(_Strict):
    kind: Literal["elevation"] = "elevation"
    item_id: str
    geometry: SnapshotGeometry | None = None
    overlay: Literal["none", "diff"] = "none"
    overlay_item_id: str | None = None
    out: OutSize = Field(default_factory=lambda: [1200, 900])


PairSideSpec = Annotated[MapSpec | ElevationSpec, Field(discriminator="kind")]


class PairSpec(_Strict):
    kind: Literal["pair"] = "pair"
    a: PairSideSpec
    b: PairSideSpec
    bbox_wgs84: Bbox | None = None
    mode: Literal["side_by_side", "swipe"] = "swipe"
    split: float = Field(0.5, ge=0.05, le=0.95)


class View3dSpec(_Strict):
    kind: Literal["view3d"] = "view3d"
    subject_kind: Literal["finding", "cloud_measurement"]
    subject_id: str
    cloud_id: str


class VolumePlanSpec(_Strict):
    kind: Literal["volume_plan"] = "volume_plan"
    measurement_id: str


class AttachmentSpec(_Strict):
    kind: Literal["attachment"] = "attachment"
    finding_id: str
    attachment_id: str
    out: OutSize = Field(default_factory=lambda: [800, 600])


SnapshotSpec = Annotated[
    ImageCropSpec | MapSpec | ElevationSpec | PairSpec | View3dSpec | VolumePlanSpec | AttachmentSpec,
    Field(discriminator="kind"),
]


class SnapshotRef(BaseModel):
    key: SnapshotKey
    spec: SnapshotSpec
    width_px: int = Field(ge=1)
    height_px: int = Field(ge=1)
    missing_reason: str | None = None


# ------------------------------------------------------------------------------ blocks (spec 8.1)


class Heading(BaseModel):
    kind: Literal["heading"] = "heading"
    level: int = Field(ge=1, le=3)
    text: str


class Para(BaseModel):
    kind: Literal["para"] = "para"
    text: str
    style: ParaStyle = "body"


class Kv(BaseModel):
    kind: Literal["kv"] = "kv"
    rows: list[KvRow]


class KpiItem(BaseModel):
    label: str
    value: str
    delta: str | None = None
    tone: KpiTone = "neutral"
    colour: Colour | None = None


class Kpis(BaseModel):
    kind: Literal["kpis"] = "kpis"
    items: list[KpiItem]


class TableColumn(BaseModel):
    key: str
    label: str
    align: ColumnAlign = "left"
    width_mm: float | None = None
    style: ColumnStyle = "text"


class TableDotCell(BaseModel):
    text: str
    dot: Colour


TableCell = str | TableDotCell


class Table(BaseModel):
    kind: Literal["table"] = "table"
    columns: list[TableColumn]
    rows: list[list[TableCell]]
    repeat_header: bool = True


class Figure(BaseModel):
    kind: Literal["figure"] = "figure"
    snapshot: SnapshotRef
    caption: str = ""
    width_mm: float = Field(gt=0, le=300)
    height_mm: float = Field(gt=0, le=300)


class FigureRow(BaseModel):
    kind: Literal["figure_row"] = "figure_row"
    figures: list[Figure] = Field(min_length=1, max_length=4)


class ChartSeries(BaseModel):
    name: str
    values: list[float | None]
    colour: Colour | None = None


class Chart(BaseModel):
    kind: Literal["chart"] = "chart"
    chart: ChartKind
    title: str | None = None
    series: list[ChartSeries]
    x_labels: list[str]
    unit: str | None = None


class FindingHead(BaseModel):
    type_name: str
    type_colour: Colour
    severity_level: int | None = None
    severity_name: str | None = None
    severity_colour: Colour | None = None
    status: FindingStatus


class Comment(BaseModel):
    author: str
    text: str
    created_at: datetime


class FindingBlock(BaseModel):
    kind: Literal["finding"] = "finding"
    finding_id: str
    number: int = Field(ge=1)
    head: FindingHead
    figures: list[Figure] = Field(default_factory=list)
    kv: list[KvRow] = Field(default_factory=list)
    note: str = ""
    photos: list[Figure] = Field(default_factory=list)
    comments: list[Comment] = Field(default_factory=list)


class PageBreakBlock(BaseModel):
    kind: Literal["page_break"] = "page_break"


class VolumeBlock(BaseModel):
    kind: Literal["volume"] = "volume"
    measurement_id: str
    title: str
    rows: list[KvRow]
    figure: Figure | None = None
    stale: bool = False


class CoverLogo(BaseModel):
    asset_id: str
    path: str  # project-relative, forward slashes: reports/assets/logo-<sha8>.png
    width_px: int = Field(ge=1)
    height_px: int = Field(ge=1)


class CoverBlock(BaseModel):
    """The cover section's one block (plans R2 ruling 2, R4 ruling 4): the band title, the rows
    Project, Site, Client, Author, Report date, Period, Version and Status, the logo and the locator."""

    kind: Literal["cover"] = "cover"
    title: str
    subtitle: str | None = None
    rows: list[KvRow]
    logo: CoverLogo | None = None
    locator: Figure | None = None


Block = Annotated[
    Heading
    | Para
    | Kv
    | Kpis
    | Table
    | Figure
    | FigureRow
    | Chart
    | FindingBlock
    | PageBreakBlock
    | VolumeBlock
    | CoverBlock,
    Field(discriminator="kind"),
]


# ------------------------------------------------------------------------------ documents and outline


class ReportSectionDoc(BaseModel):
    key: SectionKey
    title: str
    blocks: list[Block]


class ReportDocument(BaseModel):
    report_id: str
    version: int | None = None
    generated_at: datetime
    theme_version: str
    paper: ReportPaper = Field(default_factory=ReportPaper)
    sections: list[ReportSectionDoc]


class BlockPage(BaseModel):
    items: list[Block] = Field(max_length=50)
    next_cursor: str | None = None


class ReportDocumentPage(BaseModel):
    report_id: str
    version: int | None = None
    generated_at: datetime
    theme_version: str
    sections: list[ReportSectionDoc]
    next_cursor: str | None = None


class ReportWarning(BaseModel):
    code: str
    message: str
    count: int | None = None
    link: str | None = None


class ReportBaseline(BaseModel):
    version_id: str
    report_id: str
    report_title: str
    number: int = Field(ge=1)
    issued_at: datetime


class DeltaSummary(BaseModel):
    baseline: ReportBaseline | None = None
    new: int = Field(0, ge=0)
    closed: int = Field(0, ge=0)
    escalated: int = Field(0, ge=0)
    deescalated: int = Field(0, ge=0)
    reopened: int = Field(0, ge=0)
    left: int = Field(0, ge=0)


class OutlineSection(BaseModel):
    key: SectionKey
    title: str
    block_count: int = Field(ge=0)
    etag: str
    estimated_pages: int = Field(ge=0)


class ReportOutline(BaseModel):
    report_id: str
    sections: list[OutlineSection]
    finding_count: int = Field(ge=0)
    warnings: list[ReportWarning] = Field(default_factory=list)
    deltas: DeltaSummary = Field(default_factory=DeltaSummary)


# ------------------------------------------------------------------------------ reports and versions


class ReportVersionSummary(BaseModel):
    number: int | None = None
    state: ReportVersionState
    issued_at: datetime | None = None
    pages: int | None = None


class ReportListItem(BaseModel):
    id: str
    title: str
    template_id: str | None = None
    archived: bool = False
    created_at: datetime
    updated_at: datetime
    last_version: ReportVersionSummary | None = None


class ReportPage(BaseModel):
    items: list[ReportListItem]
    next_cursor: str | None = None


class Report(BaseModel):
    id: str
    title: str
    template_id: str | None = None
    archived: bool = False
    config: ReportConfig
    created_at: datetime
    updated_at: datetime
    last_version: ReportVersionSummary | None = None


class ReportCreate(_Strict):
    title: str = Field(min_length=1, max_length=200)
    template_id: str | None = None


class ReportPatch(_Strict):
    title: str | None = Field(None, min_length=1, max_length=200)
    config: ReportConfig | None = None


class ReportFile(BaseModel):
    name: str
    kind: ReportFileKind
    bytes: int = Field(ge=0)
    sha256: Sha256
    pages: int | None = None


class ReportVersionStats(BaseModel):
    finding_count: int | None = None
    page_count: int | None = None
    part_count: int | None = None
    warnings: list[ReportWarning] = Field(default_factory=list)
    label: str | None = None
    error: str | None = None


class ReportVersion(BaseModel):
    id: str
    report_id: str
    number: int | None = None
    state: ReportVersionState
    issued_at: datetime | None = None
    job_id: str | None = None
    folder: str | None = None
    files: list[ReportFile] = Field(default_factory=list)
    config: ReportConfig
    baseline_version_id: str | None = None
    stats: ReportVersionStats = Field(default_factory=ReportVersionStats)
    created_at: datetime


class ReportVersionPage(BaseModel):
    items: list[ReportVersion]
    next_cursor: str | None = None


class ReportVersionPatch(_Strict):
    issued: bool


class RenderRequest(_Strict):
    formats: list[ReportFileKind] = Field(min_length=1, max_length=3)
    label: str | None = Field(None, max_length=100)


# ------------------------------------------------------------------------------ templates and assets


class ReportTemplate(BaseModel):
    id: str
    name: str
    description: str = ""
    builtin: bool = False
    config: ReportConfig
    created_at: datetime
    updated_at: datetime


class ReportTemplatePage(BaseModel):
    items: list[ReportTemplate]
    next_cursor: str | None = None


class ReportTemplateCreate(_Strict):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field("", max_length=500)
    config: ReportConfig


class ReportTemplatePatch(_Strict):
    name: str | None = Field(None, min_length=1, max_length=120)
    description: str | None = Field(None, max_length=500)
    config: ReportConfig | None = None


class ReportAsset(BaseModel):
    id: str
    kind: Literal["logo"] = "logo"
    path: str
    sha256: Sha256
    width: int = Field(ge=1)
    height: int = Field(ge=1)
    created_at: datetime


class ReportAssetCreate(_Strict):
    path: str = Field(min_length=1)
