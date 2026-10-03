# Asset findings R1: Report sections, 3D locator, CSV layout, brand in the PDF

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A report over an asset model reads like the EBSM and DAMAC kit reports:
- an `asset_summary` section with tiles, the findings map (vector) and zone and side tables;
- one page per asset finding with a kicker, the photo with its polygon, a close-up, a 3D locator rendered on the server, a height locator on the silhouette, the facts in profile order and the note;
- `finding_pages.min_severity` (DAMAC prints severity 2 and above; the register lists all);
- four new findings table columns (zone, side, height, sightings);
- a `asset_sightings` CSV in the kit's 21 columns, byte for byte;
- the chosen brand on the PDF (cover gradient, the brand's on-dark logo bottom left of the cover band, header logo, footer website and confidentiality line, brand fonts) and the brand's table and band fills in the preview (U6 already brands the preview cover);
- the kit's PDF rules: no em or en dash in the text, zero `/SMask`, every font embedded, `qpdf --check` when qpdf is installed.

**Architecture:**
- **Contract first (Task 1).** R1 adds the shapes no other unit declares: an `asset_map` block, a `FindingBlock.asset` panel, a shared `AssetDrawing` primitive set, and an `asset_locator` snapshot kind. `app/reports/schemas.py` mirrors them one to one, as `tests/test_reports_contract.py` demands.
- **Drawings as primitives.** Both the findings map and the height locator travel in the document as `AssetDrawing` (rectangles, lines, ticks, a silhouette polygon, dots, all in drawing units). Python builds them once (`app/reports/asset_drawing.py`, the map from P1's `findings_map.geometry`); the PDF (`pdf/asset_flowables.py`, reportlab vector) and the preview (`AssetDrawingSvg.tsx`, SVG) draw the same primitives with the same offsets, so the preview matches the PDF without a TypeScript twin.
- **3D locator.** A new snapshot kind `asset_locator`. Its renderer (`snapshots/asset_locator.py`) loads the mesh through J1's cached `load_version_mesh` and calls `app/asset_models/raster.py`, which gains a framing `window` and `markers` (a pin, or a patch outline read from J3's `.bin`).
- **Brand.** `app/reports/brand.py` resolves `config.brand_id` through D2's `get_brand(handle.catalogue, id)`, `with_brand`, `logo_path` and `confidentiality_line` into one `ResolvedBrand` (theme dict, the two font families, logo files, footer text). The PDF draws with it through a per-render active theme (`pdf/active.py`) and fonts registered by D2's `register_family`. The preview's cover is U6's (`CoverBrand` through D2's TypeScript `withBrand`); R1 adds the brand's head fill to that `CoverBrand` so tables and finding bands match the PDF.
- **CSV.** `writers/asset_csv.py` is a pure writer that ports the kit's `csv_text` quoting exactly; `writers/asset_rows.py` streams sighting rows, then photo rows, in pages of 500.

**Tech Stack:** FastAPI, SQLAlchemy, pydantic, reportlab 5.0.1 (vector `reportlab.graphics`), numpy, trimesh (through J1), Pillow, pypdfium2 (tests read text), pytest; React 18 + TypeScript, Vitest and Testing Library.

**Spec sections covered:** §10 (all rows, including the report config pieces C0's Appendix A hands to R1), §12 "CSV: byte-exact against a fixture", §12 acceptance item 4 preconditions (PDF rules), decision A9. §5.8 brand is consumed, not built (D2).

**Index and Global Constraints:** `docs/superpowers/plans/2026-10-03-asset-findings.md`

**Needs (merged to `main` first):** C0 (`ReportConfig.brand_id`, and the asset schemas `AssetFrame`, `AssetReviewConfig`, `FindingSighting`; C0's Appendix A gives R1 the YAML for the rest of the report config, which R1 lands in Task 4), D1 (ORM `FindingSighting`, `ImagePose`, `ImageReview`, `Finding` asset columns, `AssetModel.frame` and `.review`), D2 (`app.brands.store.get_brand(cat, brand_id)`, `logo_path(cat, logo_id)`, `confidentiality_line(brand, year, customer)`, `app.brands.fonts.register_family(family)`, `app.reports.theme.with_brand`, TS `withBrand`), U6 (`PreviewEnv.brand?: CoverBrand | null`, `coverBrandOf`, the brand picker in `ReportSettings.tsx`), P1 (`Frame`, `ReviewConfig` with `facts` and `focus.frustum`, `resolve`, `derive`, `findings_map.geometry`, `MapDot(id, height_m, bearing_deg, severity)`, `contract/fixtures/asset-findings-map.json`), J1 (`app.asset_review.meshes.load_version_mesh`; Task 6 only), J4 (findings carry `sighting_count`, `height_m`, `zone`, `side`; the tests write rows directly, so J4 is needed for real data, not for the tests).

**Worktree:** `scripts\start-task.ps1 -Name af-r1`

---

## Budget

- **Background jobs:** only the existing `report_render`. Every new piece of work runs inside it (3D locators, the CSV, the branded PDF) or inside a bounded request (outline, section blocks, one snapshot).
- **Bounded reads:**
  - The findings map reads placed findings of one asset model in pages of 2,000 (`id, number, height_m, bearing_deg, severity` tuples only).
  - The zone and side tables and the tiles are SQL aggregates.
  - A finding page reads one representative sighting, its box, its image row and one pose row.
  - The 3D locator holds one mesh (J1's per-process cache, keyed by GLB sha256) and reads one patch `.bin` of at most 64 KB. The window culls every triangle outside the frame before sampling, so a page never samples the whole building.
  - Photos are printed through the existing `image_crop` snapshot (JPEG draft decoding); no original is read.
  - The CSV streams sightings, then photos without findings, 500 rows per query (`OFFSET` paging inside one job; the job is the only writer of the file).
  - Brand logos are flattened and capped at 600 px a side before they are embedded.
- **Cost on the DAMAC job:** 182 locators at about 1 to 2 s each (6 M samples cap) is under 6 minutes of the render job; the snapshot cache keeps them for the next render.

## Execution DAG

Units inside R1 (one worktree, one implementer, but the order matters):

```
T1 block and snapshot contract ──> T2 compose plumbing ──> T3 drawings ──> T4 config contract,
                                                                            findings table, asset_summary
T5 raster markers ──> T6 asset_locator ──────────────────────────────────> T7 asset finding pages (needs T4)
T3 ──> T8 source dash sweep, PDF asset blocks, PDF text rules
T2 ──> T9 brand resolve ──> T10 brand in PDF ──> T11 PDF rules tests
T4 ──> T12 asset_sightings CSV
T1 ──> T13 preview (asset panel, brand head fill)
T4 ──> T14 builder UI (CSV layout, min severity, columns, asset summary options)
all ──> T15 gate
```

- **Independent:** T5 → T6 needs nothing from T1 to T4 and can run beside them; {T9 → T10}, T12 and T13 are independent of each other once their inputs land. A second implementer may take T5, T6 and T9 while the first takes T1 to T4.
- **Critical path:** T1, T2, T3, T4, T7 (needs T6), T8, T10, T11, T15. Task 8 opens with the source dash sweep (coordinator ruling), committed on its own.

---

### Task 1: Preconditions and R1's contract additions

**Files:**
- Modify: `contract/openapi.yaml`
- Regenerate: `contract/client/schema.d.ts`
- Modify: `contract/fixtures/report-document.json`
- Modify: `backend/app/reports/schemas.py`
- Modify: `backend/app/reports/blocks.py`
- Modify: `backend/tests/test_reports_contract.py` (the index kind sets)
- Create: `frontend/src/reports/preview/blocks/AssetDrawingSvg.tsx`
- Create: `frontend/src/reports/preview/blocks/AssetMapBlock.tsx`
- Modify: `frontend/src/reports/preview/blocks/BlockView.tsx`
- Modify: `frontend/src/reports/preview/fixtures.ts`
- Modify: `frontend/src/api/reports.ts` (`versionOutline`, type aliases)
- Test: `frontend/src/reports/preview/blocks/assetBlocks.test.tsx`

**Interfaces:**
- Consumes (C0, already on `main`): `ReportConfig.brand_id: str | None` only. The other report config changes (`csv_layout`, `asset_summary`, the table columns, `min_severity`) are R1's, in Task 4, from C0's Appendix A.
- Produces (contract and `app.reports.schemas`):
  - `AssetDrawing {width, height, font_size, plot: AssetDrawingRect, silhouette: [[x, y]], bands: AssetDrawingBand[], levels: AssetDrawingLevel[], x_ticks: AssetDrawingTick[], y_ticks: AssetDrawingTick[], x_title, dots: AssetDrawingDot[], marker: AssetDrawingMarker | null}`
  - `AssetMapBlock {kind: "asset_map", title, drawing, caption, width_mm, height_mm}` in the `Block` union
  - `FindingAsset {kicker, height_locator: AssetDrawing | null}`; `FindingBlock.asset: FindingAsset | null`
  - `AssetLocatorSpec {kind: "asset_locator", asset_model_id, version, sighting_id, mark: "pin" | "patch", center[3], normal[3], half_extent_m, oblique_deg, colour, out[2]}` in the `SnapshotSpec` union
  - `app.reports.blocks.asset_map(drawing: dict, *, title: str, caption: str, width_mm: float, height_mm: float) -> Block`; `blocks.finding(..., asset: dict | None = None)`; `blocks.kpi(..., colour: str | None = None)`
  - TS: `AssetDrawingSvg({drawing, label, widthMm})`, `AssetMapBlock({block})`; `api/reports.ts` exports `AssetDrawing`

- [ ] **Step 1: Check the units R1 needs are on `main`**

Run from the worktree root (PowerShell):

```powershell
Select-String -Path contract/openapi.yaml -Pattern "brand_id:","AssetReviewConfig:","FindingSighting:" | Select-Object -First 6
Select-String -Path backend/app/reports/schemas.py -Pattern "brand_id"
Select-String -Path backend/app/db/models.py -Pattern "class FindingSighting","class ImagePose","class ImageReview","sighting_count"
Test-Path backend/app/asset_review/findings_map.py, backend/app/asset_review/derive.py, backend/app/brands/store.py, backend/app/asset_review/meshes.py
Select-String -Path backend/app/reports/theme.py -Pattern "def with_brand"
Select-String -Path backend/app/brands/store.py -Pattern "def logo_path","def confidentiality_line"
Select-String -Path frontend/src/reports/preview/PreviewContext.ts -Pattern "CoverBrand"
```

Expected: every pattern is found and the first three `Test-Path` values are `True` (`meshes.py` may be `False` until J1 merges: Tasks 1 to 5 do not need it, Task 6 does). If any C0, D1, D2, P1 or U6 item is missing, stop and report to the controller: R1 does not add another unit's contract.

- [ ] **Step 2: Extend the backend contract test's index sets (failing test)**

In `backend/tests/test_reports_contract.py`, add `"asset_map"` to `INDEX_BLOCK_KINDS` and `"asset_locator"` to `INDEX_SNAPSHOT_KINDS`, and add this test at the end of the "Task 2: schemas" block:

```python
def test_the_asset_shapes_are_in_the_contract(spec):
    s = _schemas(spec)
    for name in ("AssetDrawing", "AssetMapBlock", "FindingAsset", "AssetLocatorSpec"):
        assert name in s, name
    assert s["FindingBlock"]["properties"]["asset"]["oneOf"][1] == {"type": "null"}
    assert s["AssetLocatorSpec"]["properties"]["mark"]["enum"] == ["pin", "patch"]
```

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_reports_contract.py -q`
Expected: FAIL (`test_the_asset_shapes_are_in_the_contract`, the union mapping tests and the fixture-kinds test).

- [ ] **Step 3: Add the schemas to `contract/openapi.yaml`**

Under `components/schemas`, directly after `CoverBlock`, add:

```yaml
    AssetDrawingRect:
      type: object
      required: [x0, y0, x1, y1]
      properties:
        x0: { type: number }
        y0: { type: number }
        x1: { type: number }
        y1: { type: number }
    AssetDrawingBand:
      type: object
      description: "a zone band across the plot; y0 is its top edge (drawing units, y grows down)"
      required: [y0, y1, label, shaded]
      properties:
        y0: { type: number }
        y1: { type: number }
        label: { type: string }
        shaded: { type: boolean }
    AssetDrawingLevel:
      type: object
      required: [x0, x1, y]
      properties:
        x0: { type: number }
        x1: { type: number }
        y: { type: number }
    AssetDrawingTick:
      type: object
      description: "a grid line at `at` (x for x_ticks, y for y_ticks) with its label"
      required: [at, label]
      properties:
        at: { type: number }
        label: { type: string }
    AssetDrawingDot:
      type: object
      required: [x, y, r, colour, label]
      properties:
        x: { type: number }
        y: { type: number }
        r: { type: number, exclusiveMinimum: 0 }
        colour: { type: string, pattern: "^#[0-9a-fA-F]{6}$" }
        label: { type: string }
    AssetDrawingMarker:
      type: object
      description: "the height locator's level line"
      required: [y, x0, x1, colour]
      properties:
        y: { type: number }
        x0: { type: number }
        x1: { type: number }
        colour: { type: string, pattern: "^#[0-9a-fA-F]{6}$" }
    AssetDrawing:
      type: object
      description: "vector primitives in drawing units (y grows down) that the PDF and the preview draw the same way: the asset findings map and the height locator"
      required: [width, height, font_size, plot, silhouette, bands, levels, x_ticks, y_ticks, x_title, dots, marker]
      properties:
        width: { type: number, exclusiveMinimum: 0 }
        height: { type: number, exclusiveMinimum: 0 }
        font_size: { type: number, exclusiveMinimum: 0 }
        plot: { $ref: "#/components/schemas/AssetDrawingRect" }
        silhouette: { type: array, items: { type: array, minItems: 2, maxItems: 2, items: { type: number } } }
        bands: { type: array, items: { $ref: "#/components/schemas/AssetDrawingBand" } }
        levels: { type: array, items: { $ref: "#/components/schemas/AssetDrawingLevel" } }
        x_ticks: { type: array, items: { $ref: "#/components/schemas/AssetDrawingTick" } }
        y_ticks: { type: array, items: { $ref: "#/components/schemas/AssetDrawingTick" } }
        x_title: { type: string }
        dots: { type: array, items: { $ref: "#/components/schemas/AssetDrawingDot" } }
        marker:
          oneOf:
            - $ref: "#/components/schemas/AssetDrawingMarker"
            - type: "null"
    AssetMapBlock:
      type: object
      description: "the asset findings map (spec 2026-10-02-asset-findings §10): x is the side, y the height"
      required: [kind, title, drawing, caption, width_mm, height_mm]
      properties:
        kind: { type: string, enum: [asset_map] }
        title: { type: string }
        drawing: { $ref: "#/components/schemas/AssetDrawing" }
        caption: { type: string }
        width_mm: { type: number, exclusiveMinimum: 0, maximum: 300 }
        height_mm: { type: number, exclusiveMinimum: 0, maximum: 300 }
    FindingAsset:
      type: object
      description: "an asset finding page's extras: the kicker line and the height locator on the silhouette"
      required: [kicker, height_locator]
      properties:
        kicker: { type: string }
        height_locator:
          oneOf:
            - $ref: "#/components/schemas/AssetDrawing"
            - type: "null"
    AssetLocatorSpec:
      type: object
      additionalProperties: false
      description: "a finding on its asset model, rendered on the server: orthographic along the normal, a pin or the patch outline (decision A9)"
      required: [kind, asset_model_id, version, sighting_id, mark, center, normal, half_extent_m, oblique_deg, colour, out]
      properties:
        kind: { type: string, enum: [asset_locator] }
        asset_model_id: { type: string }
        version: { type: integer, minimum: 1 }
        sighting_id: { type: [string, "null"] }
        mark: { type: string, enum: [pin, patch] }
        center: { type: array, minItems: 3, maxItems: 3, items: { type: number } }
        normal: { type: array, minItems: 3, maxItems: 3, items: { type: number } }
        half_extent_m: { type: number, exclusiveMinimum: 0, maximum: 10000 }
        oblique_deg: { type: number, minimum: -89, maximum: 89 }
        colour: { type: string, pattern: "^#[0-9a-fA-F]{6}$" }
        out: { type: array, minItems: 2, maxItems: 2, items: { type: integer, minimum: 16, maximum: 2400 } }
```

Edit the existing schemas:
- `FindingBlock`: add `asset` to `required` (after `comments`) and to `properties`:
  ```yaml
        asset:
          oneOf:
            - $ref: "#/components/schemas/FindingAsset"
            - type: "null"
  ```
- `Block`: add `- $ref: "#/components/schemas/AssetMapBlock"` to `oneOf` and `asset_map: "#/components/schemas/AssetMapBlock"` to `discriminator.mapping`.
- `SnapshotSpec`: add `- $ref: "#/components/schemas/AssetLocatorSpec"` to `oneOf` and `asset_locator: "#/components/schemas/AssetLocatorSpec"` to the mapping.

- [ ] **Step 4: Mirror them in `backend/app/reports/schemas.py`**

Add `"asset_map"` to `BlockKind` and to `BLOCK_KINDS` (last), and `"asset_locator"` to `SnapshotKind` and `SNAPSHOT_KINDS` (last).

After `class AttachmentSpec`, add:

```python
Vec3 = Annotated[list[float], Field(min_length=3, max_length=3)]


class AssetLocatorSpec(_Strict):
    kind: Literal["asset_locator"] = "asset_locator"
    asset_model_id: str
    version: int = Field(ge=1)
    sighting_id: str | None = None
    mark: Literal["pin", "patch"]
    center: Vec3
    normal: Vec3
    half_extent_m: float = Field(gt=0, le=10000)
    oblique_deg: float = Field(0.0, ge=-89, le=89)
    colour: Colour
    out: OutSize = Field(default_factory=lambda: [900, 900])
```

and add `| AssetLocatorSpec` as the last member of `SnapshotSpec`.

After `class CoverBlock`, add:

```python
class AssetDrawingRect(BaseModel):
    x0: float
    y0: float
    x1: float
    y1: float


class AssetDrawingBand(BaseModel):
    y0: float
    y1: float
    label: str
    shaded: bool


class AssetDrawingLevel(BaseModel):
    x0: float
    x1: float
    y: float


class AssetDrawingTick(BaseModel):
    at: float
    label: str


class AssetDrawingDot(BaseModel):
    x: float
    y: float
    r: float = Field(gt=0)
    colour: Colour
    label: str


class AssetDrawingMarker(BaseModel):
    y: float
    x0: float
    x1: float
    colour: Colour


class AssetDrawing(BaseModel):
    """Vector primitives in drawing units, y down: the PDF and the preview draw the same ones."""

    width: float = Field(gt=0)
    height: float = Field(gt=0)
    font_size: float = Field(gt=0)
    plot: AssetDrawingRect
    silhouette: list[Point2] = Field(default_factory=list)
    bands: list[AssetDrawingBand] = Field(default_factory=list)
    levels: list[AssetDrawingLevel] = Field(default_factory=list)
    x_ticks: list[AssetDrawingTick] = Field(default_factory=list)
    y_ticks: list[AssetDrawingTick] = Field(default_factory=list)
    x_title: str = ""
    dots: list[AssetDrawingDot] = Field(default_factory=list)
    marker: AssetDrawingMarker | None = None


class AssetMapBlock(BaseModel):
    kind: Literal["asset_map"] = "asset_map"
    title: str = ""
    drawing: AssetDrawing
    caption: str = ""
    width_mm: float = Field(gt=0, le=300)
    height_mm: float = Field(gt=0, le=300)


class FindingAsset(BaseModel):
    kicker: str
    height_locator: AssetDrawing | None = None
```

`FindingAsset` and the drawing classes must be defined before `FindingBlock`; move the `FindingBlock` class below them if needed, and add to it:

```python
    asset: FindingAsset | None = None
```

Add `| AssetMapBlock` as the last member of the `Block` union.

- [ ] **Step 5: Block constructors in `backend/app/reports/blocks.py`**

Replace `kpi` and `finding`, and add `asset_map`:

```python
def kpi(
    label: str, value: str, *, tone: str = "neutral", delta: str | None = None, colour: str | None = None
) -> dict:
    out = {"label": label, "value": value, "tone": tone, "delta": delta}
    if colour:
        out["colour"] = colour
    return out


def asset_map(drawing: dict, *, title: str, caption: str, width_mm: float, height_mm: float) -> Block:
    return _block(
        "asset_map", title=title, drawing=drawing, caption=caption, width_mm=width_mm, height_mm=height_mm
    )


def finding(row: FindingRow, *, figures, kv_rows, photos, comments, asset: dict | None = None) -> Block:
    head = {
        "type_name": row.type_name,
        "type_colour": row.type_colour,
        "status": row.status,
        "severity_name": row.severity_name,
        "severity_colour": row.severity_colour,
    }
    if row.severity is not None:
        head["severity_level"] = row.severity
    return _block(
        "finding",
        finding_id=row.id,
        number=row.number,
        head=head,
        figures=list(figures),
        kv=[[a, b] for a, b in kv_rows],
        note=row.note,
        photos=list(photos),
        comments=[dict(c) for c in comments],
        asset=asset,
    )
```

- [ ] **Step 6: The fixture document gains every new kind**

Edit `contract/fixtures/report-document.json`:
1. In the existing `finding` block add `"asset": {"kicker": "Finding F-0042 · Upper floors · West elevation · seen in 3 photos", "height_locator": LOCATOR}` where `LOCATOR` is the object below, and append this figure to its `figures` array:
   ```json
   {"kind": "figure", "snapshot": {"key": "a1b2c3d4e5f60718293a4b5c6d7e8f90", "spec": {"kind": "asset_locator", "asset_model_id": "am000000-1111-4000-8000-000000000001", "version": 1, "sighting_id": "s0000000-1111-4000-8000-000000000001", "mark": "patch", "center": [1.5, 41.2, -3.0], "normal": [0.0, 0.0, -1.0], "half_extent_m": 10.4, "oblique_deg": 28.0, "colour": "#FF7A2D", "out": [900, 900]}, "width_px": 900, "height_px": 900, "missing_reason": null}, "caption": "3D model, focused on this finding. Placement is approximate.", "width_mm": 62, "height_mm": 62}
   ```
   `LOCATOR`:
   ```json
   {"width": 64, "height": 200, "font_size": 6, "plot": {"x0": 16, "y0": 8, "x1": 62, "y1": 186}, "silhouette": [[29.0, 186.0], [31.0, 8.0], [47.0, 8.0], [49.0, 186.0]], "bands": [], "levels": [{"x0": 26.0, "x1": 52.0, "y": 97.0}], "x_ticks": [], "y_ticks": [{"at": 186.0, "label": "0"}, {"at": 8.0, "label": "60"}], "x_title": "41.2 m", "dots": [{"x": 39.0, "y": 63.8, "r": 3.6, "colour": "#FF7A2D", "label": "41.2 m"}], "marker": {"y": 63.8, "x0": 18.0, "x1": 62.0, "colour": "#FF7A2D"}}
   ```
2. Append this block to the `summary` section's `blocks` (Task 4 moves it into an `asset_summary` section once that key exists):
   ```json
   {"kind": "asset_map", "title": "Tower A", "drawing": {"width": 760, "height": 400, "font_size": 11, "plot": {"x0": 110, "y0": 10, "x1": 622, "y1": 362}, "silhouette": [], "bands": [{"y0": 10, "y1": 120, "label": "Upper floors", "shaded": true}, {"y0": 120, "y1": 362, "label": "Lower floors", "shaded": false}], "levels": [], "x_ticks": [{"at": 110, "label": "N"}, {"at": 238, "label": "E"}], "y_ticks": [{"at": 362, "label": "0 m"}, {"at": 10, "label": "60 m"}], "x_title": "Side of the asset", "dots": [{"x": 300, "y": 90, "r": 5.5, "colour": "#FF7A2D", "label": "F-0042"}], "marker": null}, "caption": "Each dot is one finding at its height and side of the asset.", "width_mm": 174, "height_mm": 92}
   ```
Every other finding block in the file (if any) gets `"asset": null`.

- [ ] **Step 7: Regenerate the client and run the backend contract test**

```powershell
pnpm -C contract generate
pnpm -C contract check
cd backend; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_reports_contract.py -q
```

Expected: `contract check` clean (Spectral: no unused component), pytest PASS.

- [ ] **Step 8: Write the failing preview test for the map block**

Create `frontend/src/reports/preview/blocks/assetBlocks.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BlockOf } from "@/api/reports";
import { AssetMapBlock } from "./AssetMapBlock";
import { BlockView } from "./BlockView";

export const MAP_BLOCK: BlockOf<"asset_map"> = {
  kind: "asset_map",
  title: "Tower A",
  caption: "Each dot is one finding at its height and side of the asset.",
  width_mm: 174,
  height_mm: 92,
  drawing: {
    width: 760,
    height: 400,
    font_size: 11,
    plot: { x0: 110, y0: 10, x1: 622, y1: 362 },
    silhouette: [
      [20, 362],
      [24, 10],
      [40, 10],
      [44, 362],
    ],
    bands: [
      { y0: 10, y1: 120, label: "Upper floors", shaded: true },
      { y0: 120, y1: 362, label: "Lower floors", shaded: false },
    ],
    levels: [{ x0: 18, x1: 46, y: 200 }],
    x_ticks: [
      { at: 110, label: "N" },
      { at: 238, label: "E" },
    ],
    y_ticks: [
      { at: 362, label: "0 m" },
      { at: 10, label: "60 m" },
    ],
    x_title: "Side of the asset",
    dots: [
      { x: 300, y: 90, r: 5.5, colour: "#FF7A2D", label: "F-0042" },
      { x: 400, y: 200, r: 5.5, colour: "#FAD34B", label: "F-0043" },
    ],
    marker: null,
  },
};

describe("AssetMapBlock", () => {
  it("draws the bands, ticks, silhouette and one dot per finding, with the caption", () => {
    const { container } = render(<AssetMapBlock block={MAP_BLOCK} />);
    const svg = screen.getByRole("img", { name: "Findings map of Tower A" });
    expect(svg.getAttribute("viewBox")).toBe("0 0 760 400");
    expect(container.querySelectorAll("[data-dot]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-band]")).toHaveLength(2);
    expect(container.querySelector("polygon")).not.toBeNull();
    expect(screen.getByText("Upper floors")).toBeInTheDocument();
    expect(screen.getByText("F-0042")).toBeInTheDocument(); // the dot's <title>
    expect(screen.getByText(MAP_BLOCK.caption)).toBeInTheDocument();
  });

  it("is reachable through BlockView", () => {
    const { container } = render(<BlockView block={MAP_BLOCK} />);
    expect(container.querySelector('[data-block="asset_map"]')).not.toBeNull();
  });
});
```

Run: `pnpm -C frontend exec vitest run src/reports/preview/blocks/assetBlocks.test.tsx`
Expected: FAIL (module `./AssetMapBlock` not found).

- [ ] **Step 9: The SVG drawing and the map block**

Create `frontend/src/reports/preview/blocks/AssetDrawingSvg.tsx` (the offsets are the PDF's, `pdf/asset_flowables.py`, Task 8):

```tsx
import type { AssetDrawing } from "@/api/reports";
import { PRINT, mm } from "../../printTheme";

/**
 * Spec 2026-10-02-asset-findings §10: the findings map and the height locator, drawn from the
 * server's primitives. Every offset below equals pdf/asset_flowables.py so the preview matches the PDF.
 */
export function AssetDrawingSvg({
  drawing,
  label,
  widthMm,
}: {
  drawing: AssetDrawing;
  label: string;
  widthMm: number;
}) {
  const d = drawing;
  const p = d.plot;
  const fs = d.font_size;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${d.width} ${d.height}`}
      style={{ width: mm(widthMm), maxWidth: "100%", height: "auto", display: "block" }}
    >
      <title>{label}</title>
      {d.bands.map((b, i) => (
        <g key={`band-${i}`} data-band>
          <rect
            x={p.x0}
            y={b.y0}
            width={p.x1 - p.x0}
            height={b.y1 - b.y0}
            fill={b.shaded ? PRINT.head : PRINT.paper}
          />
          <text x={p.x1 + fs * 0.8} y={(b.y0 + b.y1) / 2 + fs * 0.35} fontSize={fs * 0.9} fill={PRINT.ink}>
            {b.label}
          </text>
        </g>
      ))}
      {d.y_ticks.map((t, i) => (
        <g key={`y-${i}`}>
          <line x1={p.x0} x2={p.x1} y1={t.at} y2={t.at} stroke={PRINT.rule} strokeWidth={0.5} />
          <text
            x={p.x0 - fs * 0.6}
            y={t.at + fs * 0.35}
            textAnchor="end"
            fontSize={fs * 0.85}
            fill={PRINT.muted}
          >
            {t.label}
          </text>
        </g>
      ))}
      {d.x_ticks.map((t, i) => (
        <g key={`x-${i}`}>
          <line
            x1={t.at}
            x2={t.at}
            y1={p.y0}
            y2={p.y1}
            stroke={PRINT.rule}
            strokeWidth={0.5}
            strokeDasharray="2 4"
          />
          <text x={t.at} y={p.y1 + fs * 1.3} textAnchor="middle" fontSize={fs * 0.9} fill={PRINT.ink}>
            {t.label}
          </text>
        </g>
      ))}
      {d.silhouette.length > 2 ? (
        <polygon
          points={d.silhouette.map(([x, y]) => `${x},${y}`).join(" ")}
          fill={PRINT.placeholder}
          stroke={PRINT.muted}
          strokeWidth={0.6}
        />
      ) : null}
      {d.levels.map((l, i) => (
        <line key={`l-${i}`} x1={l.x0} x2={l.x1} y1={l.y} y2={l.y} stroke={PRINT.muted} strokeWidth={0.5} />
      ))}
      {d.marker ? (
        <line
          x1={d.marker.x0}
          x2={d.marker.x1}
          y1={d.marker.y}
          y2={d.marker.y}
          stroke={d.marker.colour}
          strokeWidth={1.4}
        />
      ) : null}
      {d.dots.map((dot, i) => (
        <circle
          key={`d-${i}`}
          data-dot
          cx={dot.x}
          cy={dot.y}
          r={dot.r}
          fill={dot.colour}
          stroke={PRINT.paper}
          strokeWidth={dot.r * 0.25}
        >
          <title>{dot.label}</title>
        </circle>
      ))}
      {d.x_title ? (
        <text
          x={(p.x0 + p.x1) / 2}
          y={d.height - fs * 0.3}
          textAnchor="middle"
          fontSize={fs * 0.85}
          fill={PRINT.muted}
        >
          {d.x_title}
        </text>
      ) : null}
    </svg>
  );
}
```

Create `frontend/src/reports/preview/blocks/AssetMapBlock.tsx`:

```tsx
import type { BlockOf } from "@/api/reports";
import { PRINT, mm, textStyle } from "../../printTheme";
import { AssetDrawingSvg } from "./AssetDrawingSvg";

/** The asset findings map (spec 2026-10-02-asset-findings §10): title, vector map, caption. */
export function AssetMapBlock({ block }: { block: BlockOf<"asset_map"> }) {
  const subject = block.title || "the asset";
  return (
    <figure data-block="asset_map" style={{ margin: `0 0 ${mm(4)}` }}>
      {block.title ? (
        <p style={{ ...textStyle(PRINT.size.h3), fontWeight: 600, margin: `0 0 ${mm(1.5)}` }}>{block.title}</p>
      ) : null}
      <AssetDrawingSvg drawing={block.drawing} label={`Findings map of ${subject}`} widthMm={block.width_mm} />
      {block.caption ? (
        <figcaption style={{ ...textStyle(PRINT.size.small, PRINT.muted), marginTop: mm(1) }}>
          {block.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
```

In `BlockView.tsx` import `AssetMapBlock` and add before `default:`:

```tsx
    case "asset_map":
      return <AssetMapBlock block={block} />;
```

In `frontend/src/api/reports.ts` add next to the other aliases:

```ts
export type AssetDrawing = S["AssetDrawing"];
```


In `frontend/src/reports/preview/fixtures.ts`: add `asset_map: true,` to `ALL_BLOCK_KINDS`; add `asset: null,` to `finding42` and `finding43`; move the `MAP_BLOCK` constant from the test into `fixtures.ts` as `export const MAP_FIXTURE` (same value) and append it to `FIXTURE_BLOCKS.summary` (Task 4 moves it to `asset_summary`); in the test replace the constant with `import { MAP_FIXTURE as MAP_BLOCK } from "../fixtures";`.

- [ ] **Step 10: Type-check and fix every missing `asset`**

Run: `pnpm -C frontend exec tsc --noEmit -p .`
Expected: errors only of the form "Property 'asset' is missing" (a hand-written finding block). Add `asset: null` at each reported line; spreads of the fixtures need nothing. Re-run until clean.

- [ ] **Step 11: Run the preview tests**

Run: `pnpm -C frontend exec vitest run src/reports`
Expected: PASS (the every-kind test now renders `asset_map` too).

- [ ] **Step 12: Commit**

```powershell
git add contract/openapi.yaml contract/client/schema.d.ts contract/fixtures/report-document.json backend/app/reports/schemas.py backend/app/reports/blocks.py backend/tests/test_reports_contract.py frontend/src/reports/preview/blocks/AssetDrawingSvg.tsx frontend/src/reports/preview/blocks/AssetMapBlock.tsx frontend/src/reports/preview/blocks/BlockView.tsx frontend/src/reports/preview/blocks/assetBlocks.test.tsx frontend/src/reports/preview/fixtures.ts frontend/src/api/reports.ts
git commit -m @'
feat(reports): asset map block, finding asset panel, asset_locator spec

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

Also stage, by path, each file Step 10 touched (`git status --short` lists them).

---

### Task 2: Compose plumbing for asset findings

**Files:**
- Create: `backend/app/reports/asset_info.py`
- Modify: `backend/app/reports/context.py`
- Modify: `backend/app/reports/observed.py`
- Create: `backend/tests/reports_asset_rows.py` (test helper, not a test module)
- Test: `backend/tests/test_reports_asset_context.py`

**Interfaces:**
- Consumes: D1 `Finding` columns `asset_model_id, asset_version, ax, ay, az, an_x, an_y, an_z, placement, height_m, bearing_deg, side, zone, component, sighting_count`; `FindingSighting`, `ImagePose`, `ImageReview`; `AssetModel.frame`, `AssetModel.review`. P1 `Frame`, `ReviewConfig`, `resolve`.
- Produces:
  - `app.reports.asset_info.AssetInfo(id, name, current_version, frame: Frame | None, review: ReviewConfig | None)` with `.zone_label(zone_id) -> str | None`
  - `load_asset_models(handle) -> dict[str, AssetInfo]`
  - `representative(s, finding_id) -> FindingSighting | None` (max severity, then placed, then largest coverage, then oldest)
  - `PLACED = ("point", "patch")`
  - `FindingRow` gains `asset_model_id, asset_version, height_m, bearing_deg, side, zone, component, placement, sighting_count, ax, ay, az, an_x, an_y, an_z` (all default `None`, `sighting_count` 0)
  - `ComposeContext.asset_models: dict[str, AssetInfo]` (cached per context)
  - `findings_page(ctx, order, cursor, limit, *, where=None)`, `count_findings(ctx, *, where=None)`: `where` is ANDed with the filters
  - SQL observed date and data label know `data_type = 'asset_model'`

- [ ] **Step 1: The test helper that seeds asset findings**

Create `backend/tests/reports_asset_rows.py`:

```python
"""Asset findings straight into the project DB for the report tests (spec 2026-10-02-asset-findings
§5). Synthetic numbers only: no customer data (index Global Constraints)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select

from app.asset_review.frame import Frame
from app.asset_review.profiles import resolve
from app.db.base import new_id
from app.db.models import (
    AssetModel,
    AssetModelVersion,
    Box,
    Finding,
    FindingSighting,
    Image,
    ImagePose,
    ImageReview,
    Source,
)

T0 = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)
HEIGHT = 60.0


def frame_of(height: float = HEIGHT) -> Frame:
    return Frame.model_validate(
        {
            "origin": None,
            "north_offset_deg": 0.0,
            "height_m": height,
            "datum_label": "street level",
            "datum_note": "",
            "line_azimuth_deg": None,
            "silhouette": [[0.0, 6.0], [height / 2, 5.0], [height, 4.0]],
            "levels": [height / 3, 2 * height / 3],
            "presets": [],
        }
    )


def add_asset_model(handle, *, name: str = "Tower A", profile: str = "building_facade", height: float = HEIGHT):
    """(model_id, review, frame) with version 1 recorded as imported."""
    frame = frame_of(height)
    review = resolve(profile, height)
    with handle.session() as s:
        m = AssetModel(
            name=name,
            status="ready",
            current_version=1,
            frame=frame.model_dump(mode="json"),
            review=review.model_dump(mode="json"),
        )
        s.add(m)
        s.flush()
        s.add(AssetModelVersion(model_id=m.id, version=1, spec={}, kind="imported", glb_status="ready", meta={}))
        return m.id, review, frame


def add_asset_image(
    handle,
    *,
    name: str,
    lat: float | None = 25.08,
    lon: float | None = 55.14,
    alt: float | None = 120.5,
    capture: datetime | None = T0,
) -> str:
    with handle.session() as s:
        src = s.execute(select(Source).where(Source.label == "Facade")).scalar_one_or_none()
        if src is None:
            src = Source(folder="D:/flights/facade", site="Tower", label="Facade")
            s.add(src)
            s.flush()
        img = Image(
            path=f"images/{uuid.uuid4().hex}.jpg",
            width=4000,
            height=3000,
            source_id=src.id,
            capture_time=capture,
            lat=lat,
            lon=lon,
            alt=alt,
            original_name=name,
        )
        s.add(img)
        s.flush()
        return img.id


def add_pose(handle, image_id: str, model_id: str, *, target=(0.0, 38.0, 0.0), sequence: str | None = "1") -> None:
    with handle.session() as s:
        s.add(
            ImagePose(
                image_id=image_id,
                asset_model_id=model_id,
                position=[30.0, 38.0, 0.0],
                target=list(target),
                up=[0.0, 1.0, 0.0],
                hfov_deg=70.0,
                vfov_deg=52.0,
                source="kit",
                accuracy_m=None,
                sequence=sequence,
                updated_at=T0,
            )
        )


def add_review(handle, image_id: str, status: str, *, note: str = "", coverage: float | None = None) -> None:
    with handle.session() as s:
        s.add(
            ImageReview(
                image_id=image_id,
                status=status,
                note=note,
                coverage=coverage,
                uncertain_coverage=None,
                updated_at=T0,
            )
        )


def add_asset_finding(
    handle,
    model_id: str,
    type_id: str,
    *,
    sightings: list[dict],
    severity: int | None = 2,
    status: str = "open",
    note: str = "",
    zone: str | None = None,
    side: str | None = None,
    height: float | None = None,
    bearing: float | None = None,
    placement: str = "patch",
    center: tuple[float, float, float] | None = None,
    normal: tuple[float, float, float] | None = None,
    component: str | None = None,
    number: int | None = None,
) -> str:
    """One asset finding and its sightings. A sighting dict: image_id, and optional severity,
    placement, center, normal, coverage, part, created_at, points (a polygon in image px)."""
    with handle.session() as s:
        top = s.execute(select(func.coalesce(func.max(Finding.number), 0))).scalar_one()
        f = Finding(
            number=number or top + 1,
            type_id=type_id,
            severity=severity,
            status=status,
            note=note,
            anchor_kind="asset",
            asset_model_id=model_id,
            asset_version=1,
            ax=center[0] if center else None,
            ay=center[1] if center else None,
            az=center[2] if center else None,
            an_x=normal[0] if normal else None,
            an_y=normal[1] if normal else None,
            an_z=normal[2] if normal else None,
            placement=placement,
            height_m=height,
            bearing_deg=bearing,
            side=side,
            zone=zone,
            component=component,
            sighting_count=len(sightings),
            data_type="asset_model",
            data_id=model_id,
            created_at=T0,
            updated_at=T0,
        )
        s.add(f)
        s.flush()
        for i, sg in enumerate(sightings):
            pts = sg.get("points") or [[100.0, 80.0], [140.0, 80.0], [140.0, 110.0], [100.0, 110.0]]
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            box = Box(
                image_id=sg["image_id"],
                class_id=type_id,
                x=min(xs),
                y=min(ys),
                w=max(xs) - min(xs),
                h=max(ys) - min(ys),
                shape="polygon",
                points=pts,
                provenance_kind="person",
                review_state="accepted",
            )
            s.add(box)
            s.flush()
            c, n = sg.get("center"), sg.get("normal")
            s.add(
                FindingSighting(
                    id=sg.get("id") or new_id(),
                    finding_id=f.id,
                    image_id=sg["image_id"],
                    annotation_id=box.id,
                    severity=sg.get("severity", severity),
                    group_tag=None,
                    placement=sg.get("placement", placement),
                    cx=c[0] if c else None,
                    cy=c[1] if c else None,
                    cz=c[2] if c else None,
                    nx=n[0] if n else None,
                    ny=n[1] if n else None,
                    nz=n[2] if n else None,
                    part=sg.get("part"),
                    coverage=sg.get("coverage"),
                    patch_path=None,
                    placed_version=1 if c else None,
                    created_at=sg.get("created_at", T0.replace(minute=i)),
                )
            )
        return f.id
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_reports_asset_context.py`:

```python
"""Compose plumbing for asset findings: the row fields, the asset model cache, the representative
sighting, the extra WHERE and the observed date and label of `asset_model` findings."""

from reports_asset_rows import T0, add_asset_finding, add_asset_image, add_asset_model
from reports_rows import add_type, config, ctx_for

from app.db.models import Finding
from app.reports.asset_info import representative
from app.reports.context import count_findings, findings_page


def test_a_finding_row_carries_the_asset_fields(handle):
    crack = add_type(handle, "crack")
    mid, review, _ = add_asset_model(handle)
    img = add_asset_image(handle, name="DJI_0001.JPG")
    zone = review.zones[0].id
    add_asset_finding(
        handle,
        mid,
        crack,
        sightings=[{"image_id": img, "center": (1.0, 41.2, -3.0), "normal": (0.0, 0.0, -1.0)}],
        zone=zone,
        side="West elevation",
        height=41.2,
        bearing=270.0,
        center=(1.0, 41.2, -3.0),
        normal=(0.0, 0.0, -1.0),
        component="Panel",
    )
    ctx = ctx_for(handle, config(sections=("finding_pages",)))
    [row], _ = findings_page(ctx)
    assert (row.anchor_kind, row.asset_model_id, row.asset_version) == ("asset", mid, 1)
    assert (row.height_m, row.bearing_deg, row.side, row.zone) == (41.2, 270.0, "West elevation", zone)
    assert (row.placement, row.sighting_count, row.component) == ("patch", 1, "Panel")
    assert (row.ax, row.ay, row.az, row.an_z) == (1.0, 41.2, -3.0, -1.0)
    assert row.data_label == "Tower A"
    assert row.observed_on == T0.date()


def test_the_context_caches_asset_models_with_their_frame_and_review(handle):
    mid, review, frame = add_asset_model(handle, name="Stack 3", profile="stack")
    ctx = ctx_for(handle, config())
    info = ctx.asset_models[mid]
    assert (info.name, info.current_version) == ("Stack 3", 1)
    assert info.frame.height_m == frame.height_m
    assert info.zone_label(review.zones[0].id) == review.zones[0].label
    assert info.zone_label("gone") == "gone" and info.zone_label(None) is None
    assert ctx.asset_models is ctx.asset_models  # read once per context


def test_the_representative_is_worst_then_placed_then_largest(handle):
    crack = add_type(handle, "crack")
    mid, _, _ = add_asset_model(handle)
    a, b, c = (add_asset_image(handle, name=f"DJI_000{i}.JPG") for i in (1, 2, 3))
    fid = add_asset_finding(
        handle,
        mid,
        crack,
        sightings=[
            {"image_id": a, "severity": 1, "center": (0.0, 1.0, 0.0), "coverage": 0.9, "id": "s-a"},
            {"image_id": b, "severity": 2, "placement": "none", "coverage": 0.5, "id": "s-b"},
            {"image_id": c, "severity": 2, "center": (0.0, 2.0, 0.0), "coverage": 0.1, "id": "s-c"},
        ],
    )
    with handle.session() as s:
        assert representative(s, fid).id == "s-c"


def test_an_extra_where_narrows_the_page_and_the_count(handle):
    crack = add_type(handle, "crack")
    mid, _, _ = add_asset_model(handle)
    img = add_asset_image(handle, name="DJI_0001.JPG")
    add_asset_finding(handle, mid, crack, sightings=[{"image_id": img}], severity=1)
    add_asset_finding(handle, mid, crack, sightings=[{"image_id": img}], severity=2)
    ctx = ctx_for(handle, config(sections=("finding_pages",)))
    where = Finding.severity >= 2
    rows, nxt = findings_page(ctx, "number", None, 50, where=where)
    assert [r.severity for r in rows] == [2] and nxt is None
    assert count_findings(ctx, where=where) == 1 and count_findings(ctx) == 2
```

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_reports_asset_context.py -q`
Expected: FAIL (`ModuleNotFoundError: app.reports.asset_info`).

- [ ] **Step 3: `backend/app/reports/asset_info.py`**

```python
"""Asset models as compose reads them (spec 2026-10-02-asset-findings §5.1, §10): one small dict per
compose context (tens of rows, never findings), and the representative sighting of a finding."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select

from app.asset_review.frame import Frame
from app.asset_review.profiles import ReviewConfig
from app.db.models import AssetModel, FindingSighting

log = logging.getLogger(__name__)
PLACED = ("point", "patch")


@dataclass(frozen=True)
class AssetInfo:
    id: str
    name: str
    current_version: int | None
    frame: Frame | None
    review: ReviewConfig | None

    def zone_label(self, zone_id: str | None) -> str | None:
        if zone_id is None or self.review is None:
            return zone_id
        for z in self.review.zones:
            if z.id == zone_id:
                return z.label
        return zone_id


def _parse(model: Any, raw: Any, model_id: str, what: str):
    if raw is None:
        return None
    try:
        return model.model_validate(raw)
    except Exception:
        log.warning("asset model %s has an unreadable %s; reports leave it out", model_id, what)
        return None


def load_asset_models(handle) -> dict[str, AssetInfo]:
    with handle.session() as s:
        rows = s.execute(
            select(AssetModel.id, AssetModel.name, AssetModel.current_version, AssetModel.frame, AssetModel.review)
        ).all()
    return {
        mid: AssetInfo(mid, name, cur, _parse(Frame, frame, mid, "frame"), _parse(ReviewConfig, review, mid, "review"))
        for mid, name, cur, frame, review in rows
    }


def representative(s, finding_id: str) -> FindingSighting | None:
    """Spec §6.4: maximum severity, then placed, then largest coverage; oldest, then id, breaks ties."""
    q = (
        select(FindingSighting)
        .where(FindingSighting.finding_id == finding_id)
        .order_by(
            FindingSighting.severity.is_(None),
            FindingSighting.severity.desc(),
            FindingSighting.placement.not_in(PLACED),
            FindingSighting.coverage.is_(None),
            FindingSighting.coverage.desc(),
            FindingSighting.created_at,
            FindingSighting.id,
        )
        .limit(1)
    )
    return s.execute(q).scalar_one_or_none()
```

- [ ] **Step 4: `context.py` gains the asset fields, the cache and the extra WHERE**

In `FindingRow`, after `closed_at: datetime | None`, add:

```python
    asset_model_id: str | None = None
    asset_version: int | None = None
    height_m: float | None = None
    bearing_deg: float | None = None
    side: str | None = None
    zone: str | None = None
    component: str | None = None
    placement: str | None = None
    sighting_count: int = 0
    ax: float | None = None
    ay: float | None = None
    az: float | None = None
    an_x: float | None = None
    an_y: float | None = None
    an_z: float | None = None
```

In `FindingRow.build`, after `closed_at=src.closed_at,`, add:

```python
            asset_model_id=getattr(src, "asset_model_id", None),
            asset_version=getattr(src, "asset_version", None),
            height_m=getattr(src, "height_m", None),
            bearing_deg=getattr(src, "bearing_deg", None),
            side=getattr(src, "side", None),
            zone=getattr(src, "zone", None),
            component=getattr(src, "component", None),
            placement=getattr(src, "placement", None),
            sighting_count=int(getattr(src, "sighting_count", 0) or 0),
            ax=getattr(src, "ax", None),
            ay=getattr(src, "ay", None),
            az=getattr(src, "az", None),
            an_x=getattr(src, "an_x", None),
            an_y=getattr(src, "an_y", None),
            an_z=getattr(src, "an_z", None),
```

In `ComposeContext`, after `project_name`, add:

```python
    @cached_property
    def asset_models(self):
        """{id: AssetInfo} for every asset model of the project (tens), read once per context."""
        from app.reports.asset_info import load_asset_models  # lazy: P1 loads only when asked

        return load_asset_models(self.handle)
```

Append to `_COLUMNS` (after `Finding.closed_at,`):

```python
    Finding.asset_model_id,
    Finding.asset_version,
    Finding.height_m,
    Finding.bearing_deg,
    Finding.side,
    Finding.zone,
    Finding.component,
    Finding.placement,
    Finding.sighting_count,
    Finding.ax,
    Finding.ay,
    Finding.az,
    Finding.an_x,
    Finding.an_y,
    Finding.an_z,
```

Replace `count_findings` and the first lines of `findings_page`:

```python
def _scope(ctx: ComposeContext, where):
    return ctx.where if where is None else and_(ctx.where, where)


def count_findings(ctx: ComposeContext, *, where=None) -> int:
    with ctx.session() as s:
        return s.execute(select(func.count()).select_from(Finding).where(_scope(ctx, where))).scalar_one()


def findings_page(
    ctx: ComposeContext,
    order: str = "number",
    cursor: str | None = None,
    limit: int = PAGE,
    *,
    where=None,
) -> tuple[list[FindingRow], str | None]:
```

and inside `findings_page` change `).where(ctx.where)` on the base query to `).where(_scope(ctx, where))`.

- [ ] **Step 5: `observed.py` knows `asset_model`**

Add `AssetModel` to the `app.db.models` import. In `observed_on`, add to `item_day` before `else_=None`:

```python
        (Finding.data_type == "asset_model", _by_data_id(func.date(AssetModel.captured_on), AssetModel.id)),
```

In `data_label`, add before `else_=None`:

```python
            (Finding.data_type == "asset_model", _by_data_id(AssetModel.name, AssetModel.id)),
```

In `_host`, extend the map: `{"image_set": Source, "map": GeoMap, "point_cloud": PointCloud, "asset_model": AssetModel}`.

- [ ] **Step 6: Run the tests**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_reports_asset_context.py tests/test_reports_context.py tests/test_reports_filters.py -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add backend/app/reports/asset_info.py backend/app/reports/context.py backend/app/reports/observed.py backend/tests/reports_asset_rows.py backend/tests/test_reports_asset_context.py
git commit -m @'
feat(reports): asset fields on finding rows, asset model cache, representative sighting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 3: Drawings as primitives (height locator, map adapter)

**Files:**
- Create: `backend/app/reports/asset_drawing.py`
- Test: `backend/tests/test_reports_asset_drawing.py`

**Interfaces:**
- Consumes: P1 `app.asset_review.findings_map.geometry(review, frame, dots) -> dict` with keys `width, height, plot {x, y, w, h}, dot_r, silhouette ([[x, y]] | null), levels [{value, y, x1, x2}], zones [{id, label, y, h, label_y, shade}], y_ticks [{value, y}], x_ticks [{label, x}], axis_title, dots [{id, x, y, severity}] (already ordered worst last), unplaced`; `MapDot(id, height_m, bearing_deg, severity)`; `contract/fixtures/asset-findings-map.json` (`cases[].expected` is a `geometry` result).
- Produces:
  - `nice_step(total: float) -> float` (kit `gen.py` `nice_step`)
  - `height_locator(total_m: float, silhouette: Sequence[tuple[float, float]], levels: Sequence[float], height_m: float, colour: str) -> dict` (an `AssetDrawing` as JSON)
  - `map_drawing(geom: dict, *, colour_of: Callable[[int | None], str], label_of: Callable[[str], str]) -> dict` (an `AssetDrawing` as JSON; the only code that reads P1's dict)
  - constants `LOC_W = 64.0`, `LOC_H = 200.0`, `LOC_PLOT = (16.0, 8.0, 62.0, 186.0)`, `LOC_CX = 39.0`, `MAP_FONT = 11.0`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_reports_asset_drawing.py`:

```python
"""The height locator (a port of the kit's gen.py locator) and the adapter from P1's findings-map
geometry to AssetDrawing primitives (spec 2026-10-02-asset-findings §10)."""

import json
from pathlib import Path

import pytest
from reports_asset_rows import frame_of

from app.asset_review.findings_map import MapDot, geometry
from app.asset_review.profiles import resolve
from app.reports.asset_drawing import LOC_CX, height_locator, map_drawing, nice_step
from app.reports.schemas import AssetDrawing

SIL = [(0.0, 6.0), (30.0, 5.0), (60.0, 4.0)]
MAP_FIXTURE = Path(__file__).resolve().parents[2] / "contract" / "fixtures" / "asset-findings-map.json"
COLOURS = {None: "#9A98B0", 1: "#FAD34B", 2: "#FF7A2D", 3: "#EE3F4B"}


@pytest.mark.parametrize(("total", "step"), [(60.0, 10.0), (74.4, 10.0), (100.0, 10.0), (8.0, 1.0), (300.0, 50.0)])
def test_nice_step_matches_the_kit(total, step):
    assert nice_step(total) == pytest.approx(step)


def test_the_height_locator_marks_the_height_on_the_silhouette():
    d = AssetDrawing.model_validate(height_locator(60.0, SIL, [20.0, 40.0], 30.0, "#FF7A2D"))
    assert (d.width, d.height, d.font_size) == (64.0, 200.0, 6.0)
    assert d.marker.y == pytest.approx(97.0) and d.marker.colour == "#FF7A2D"
    [dot] = d.dots
    assert (dot.x, dot.y, dot.label) == (LOC_CX, pytest.approx(97.0), "30.0 m")
    assert [t.label for t in d.y_ticks] == ["0", "20", "40", "60"]
    assert d.y_ticks[0].at == pytest.approx(186.0) and d.y_ticks[-1].at == pytest.approx(8.0)
    assert len(d.silhouette) == 2 * len(SIL)
    assert d.levels[0].x0 == pytest.approx(16.0)  # 39 - 6 * (20 / 6) - 3
    assert d.x_title == "30.0 m"


def test_a_height_above_the_asset_is_clamped_to_the_top():
    d = AssetDrawing.model_validate(height_locator(60.0, SIL, [], 80.0, "#FF7A2D"))
    assert d.marker.y == pytest.approx(8.0)
    assert d.dots[0].label == "80.0 m"


def test_no_silhouette_draws_the_axis_and_the_marker_only():
    d = AssetDrawing.model_validate(height_locator(60.0, [], [], 10.0, "#FF7A2D"))
    assert d.silhouette == [] and d.levels == [] and len(d.dots) == 1


def test_the_map_adapter_reads_the_shared_fixture():
    case = json.loads(MAP_FIXTURE.read_text("utf-8"))["cases"][0]
    geom = case["expected"]
    d = AssetDrawing.model_validate(
        map_drawing(geom, colour_of=lambda s: COLOURS[s], label_of=lambda i: f"label {i}")
    )
    p = geom["plot"]
    assert (d.plot.x0, d.plot.y0, d.plot.x1, d.plot.y1) == (p["x"], p["y"], p["x"] + p["w"], p["y"] + p["h"])
    assert [b.label for b in d.bands] == [z["label"] for z in geom["zones"]]
    assert [b.shaded for b in d.bands] == [z["shade"] for z in geom["zones"]]
    assert [t.at for t in d.x_ticks] == [t["x"] for t in geom["x_ticks"]]
    assert d.y_ticks[0].label == f"{geom['y_ticks'][0]['value']:g} m"
    assert [x.label for x in d.dots] == [f"label {x['id']}" for x in geom["dots"]]  # P1's order, worst last
    assert all(x.r == geom["dot_r"] for x in d.dots)
    assert d.x_title == geom["axis_title"]
    assert len(d.levels) == len(geom["levels"])


def test_the_map_adapter_on_a_live_geometry():
    review = resolve("stack", 60.0)
    dots = [
        MapDot(id="f1", height_m=50.0, bearing_deg=90.0, severity=2),
        MapDot(id="f2", height_m=10.0, bearing_deg=200.0, severity=1),
    ]
    labels = {"f1": "F-0001", "f2": "F-0002"}
    d = AssetDrawing.model_validate(
        map_drawing(geometry(review, frame_of(60.0), dots), colour_of=lambda s: COLOURS[s], label_of=labels.get)
    )
    assert [x.label for x in d.dots] == ["F-0002", "F-0001"]
    hi, lo = d.dots[1], d.dots[0]
    assert hi.y < lo.y  # higher on the asset is higher on the page
    assert all(d.plot.x0 <= x.x <= d.plot.x1 for x in d.dots)
```

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_reports_asset_drawing.py -q`
Expected: FAIL (`ModuleNotFoundError: app.reports.asset_drawing`).

- [ ] **Step 2: `backend/app/reports/asset_drawing.py`**

```python
"""The asset findings map and the height locator as AssetDrawing primitives (spec
2026-10-02-asset-findings §10). Pure: no session, no PDF library. The PDF (pdf/asset_flowables.py) and
the preview (AssetDrawingSvg.tsx) draw these primitives with the same offsets.

`height_locator` ports the kit's report `locator` (gen.py): a vertical axis with nice ticks, the radial
silhouette mirrored about the axis, the level lines, and the finding's height as a line and a dot.
`map_drawing` is the one reader of P1's `findings_map.geometry` dict, so the PDF map is the Overview
card's map (P1's TS twin draws the same geometry)."""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from typing import Any

LOC_W, LOC_H = 64.0, 200.0
LOC_PLOT = (16.0, 8.0, 62.0, 186.0)  # x0, y0, x1, y1
LOC_CX = 39.0
LOC_HALF_MAX = 20.0  # the widest silhouette half-width, drawing units
LOC_K_MAX = 5.2
LOC_FONT = 6.0
LOC_DOT_R = 3.6
MAP_FONT = 11.0


def _r(v: Any) -> float:
    return round(float(v), 2)


def nice_step(total: float) -> float:
    raw = max(float(total), 1e-6) / 8
    p = 10 ** math.floor(math.log10(raw))
    m = raw / p
    return (1 if m < 1.5 else 2 if m < 3.5 else 5 if m < 7.5 else 10) * p


def height_locator(
    total_m: float,
    silhouette: Sequence[Sequence[float]],
    levels: Sequence[float],
    height_m: float,
    colour: str,
) -> dict:
    sil = [(float(y), float(r)) for y, r in silhouette]
    ht = float(total_m) if total_m and total_m > 0 else max([y for y, _ in sil] + [1.0])
    x0, y0, x1, y1 = LOC_PLOT
    ph = y1 - y0

    def y_of(v: float) -> float:
        return y0 + (1 - max(0.0, min(ht, float(v))) / ht) * ph

    rmax = max((r for _, r in sil), default=0.0)
    k = min(LOC_K_MAX, LOC_HALF_MAX / rmax) if rmax > 0 else 0.0

    def r_at(h: float) -> float:
        r = 0.0
        for y, rr in sil:
            if y <= h:
                r = rr
        return r or (sil[0][1] if sil else 0.0)

    poly = []
    if len(sil) >= 2:
        poly = [[_r(LOC_CX - r * k), _r(y_of(y))] for y, r in sil]
        poly += [[_r(LOC_CX + r * k), _r(y_of(y))] for y, r in reversed(sil)]
    step = nice_step(ht)
    tick = step * (2 if ht / step > 5 else 1)
    ticks = [{"at": _r(y_of(i * tick)), "label": f"{i * tick:g}"} for i in range(int(ht / tick + 1e-6) + 1)]
    y = _r(y_of(height_m))
    label = f"{float(height_m):.1f} m"
    return {
        "width": LOC_W,
        "height": LOC_H,
        "font_size": LOC_FONT,
        "plot": {"x0": x0, "y0": y0, "x1": x1, "y1": y1},
        "silhouette": poly,
        "bands": [],
        "levels": (
            [{"x0": _r(LOC_CX - r_at(z) * k - 3), "x1": _r(LOC_CX + r_at(z) * k + 3), "y": _r(y_of(z))} for z in levels]
            if sil
            else []
        ),
        "x_ticks": [],
        "y_ticks": ticks,
        "x_title": label,
        "dots": [{"x": LOC_CX, "y": y, "r": LOC_DOT_R, "colour": colour, "label": label}],
        "marker": {"y": y, "x0": x0 + 2, "x1": x1, "colour": colour},
    }


def map_drawing(
    geom: dict,
    *,
    colour_of: Callable[[int | None], str],
    label_of: Callable[[str], str | None],
) -> dict:
    """P1's findings-map geometry as AssetDrawing primitives. P1 already orders the dots worst last,
    so the worst are drawn on top; unplaced findings are not in `dots` (P1 counts them)."""
    p = geom["plot"]
    return {
        "width": float(geom["width"]),
        "height": float(geom["height"]),
        "font_size": MAP_FONT,
        "plot": {"x0": _r(p["x"]), "y0": _r(p["y"]), "x1": _r(p["x"] + p["w"]), "y1": _r(p["y"] + p["h"])},
        "silhouette": [[_r(x), _r(y)] for x, y in (geom.get("silhouette") or [])],
        "bands": [
            {"y0": _r(z["y"]), "y1": _r(z["y"] + z["h"]), "label": str(z["label"]), "shaded": bool(z["shade"])}
            for z in geom.get("zones", [])
        ],
        "levels": [{"x0": _r(lv["x1"]), "x1": _r(lv["x2"]), "y": _r(lv["y"])} for lv in geom.get("levels", [])],
        "x_ticks": [{"at": _r(t["x"]), "label": str(t["label"])} for t in geom.get("x_ticks", [])],
        "y_ticks": [{"at": _r(t["y"]), "label": f"{float(t['value']):g} m"} for t in geom.get("y_ticks", [])],
        "x_title": str(geom.get("axis_title") or ""),
        "dots": [
            {
                "x": _r(d["x"]),
                "y": _r(d["y"]),
                "r": float(geom["dot_r"]),
                "colour": colour_of(d.get("severity")),
                "label": label_of(str(d["id"])) or "",
            }
            for d in geom.get("dots", [])
        ],
        "marker": None,
    }
```

- [ ] **Step 3: Run the tests**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_reports_asset_drawing.py -q`
Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add backend/app/reports/asset_drawing.py backend/tests/test_reports_asset_drawing.py
git commit -m @'
feat(reports): height locator and findings-map primitives for the asset report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 4: Report config additions (C0 Appendix A), findings table columns and the `asset_summary` section

One commit, because the repo forces it (C0 Index note 1): `test_reports_contract.py` mirrors the contract in `schemas.py`; the 0002 frozen-copy pin reads the built-in templates; `compose.SECTION_MODULES` needs a module for every `SectionKey`.

**Files:**
- Modify: `contract/openapi.yaml`, regenerate `contract/client/schema.d.ts`
- Modify: `contract/fixtures/report-document.json` (the map block moves to an `asset_summary` section)
- Modify: `backend/app/reports/schemas.py`
- Modify: `backend/app/reports/templates/builtins.py`
- Create: `backend/app/reports/sections/asset_summary.py`
- Modify: `backend/app/reports/compose.py`
- Modify: `backend/app/reports/sections/findings_table.py`
- Modify: `backend/tests/test_reports_contract.py`, `backend/tests/test_report_builtins.py`, `backend/tests/test_catalogue_migration_0002.py`
- Modify: `frontend/src/reports/builderModel.ts` (`SECTION_LABEL`), `frontend/src/api/reports.ts` (`SECTION_TITLES`), `frontend/src/reports/preview/fixtures.ts`, `frontend/src/test/reportBuilderFixtures.ts` and any config literal `tsc` names
- Test: `backend/tests/test_reports_config_asset.py`, `backend/tests/test_reports_findings_table_asset.py`, `backend/tests/test_reports_asset_summary.py`

**Interfaces:**
- Consumes: C0 Appendix A (binding YAML); Task 2 (`ctx.asset_models`, `FindingRow` asset fields); Task 3 (`map_drawing`); P1 `MapDot`, `geometry`; D1 `ImagePose`, `ImageReview`.
- Produces:
  - `SectionKey` / `SECTION_KEYS` = `cover, summary, asset_summary, findings_table, finding_pages, measurements, comparison, object_counts, appendix`
  - `AssetSummaryOptions(asset_model_id: str | None = None, show_map: bool = True, show_tables: bool = True)`, `ReportSectionAssetSummary` (default `enabled=False`)
  - `FindingsTableColumn` += `zone, side, height, sightings` (the default columns stay the seven); `FindingPagesOptions.min_severity: int | None = None` (1 to 9); `ReportConfig.csv_layout: Literal["findings", "asset_sightings"] = "findings"`; `ReportConfig.sections` 8 to 9 items (a config saved before `asset_summary` lists eight and simply has no such section)
  - `app.reports.sections.asset_summary` (`KEY`, `TITLE = "Asset summary"`, `compose`, `outline`, `fingerprint`, `EMPTY`, `NO_FRAME`, `NOT_PLACED`, `MAP_CAPTION`, `chosen_model(ctx) -> str | None`)
  - `findings_table.cell(row, key, ctx=None)`, `ALIGN`, `NOT_PLACED`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_reports_config_asset.py`:

```python
"""C0 Appendix A, landed by R1: the report config's asset additions."""

from app.reports.schemas import SECTION_KEYS, ReportConfig
from app.reports.templates.builtins import BUILTIN_TEMPLATES


def test_the_default_config_has_the_asset_additions():
    c = ReportConfig()
    assert SECTION_KEYS[2] == "asset_summary" and len(c.sections) == 9
    summary = next(s for s in c.sections if s.key == "asset_summary")
    assert summary.enabled is False
    assert summary.options.model_dump() == {"asset_model_id": None, "show_map": True, "show_tables": True}
    assert c.csv_layout == "findings"
    pages = next(s for s in c.sections if s.key == "finding_pages")
    assert pages.options.min_severity is None
    table = next(s for s in c.sections if s.key == "findings_table")
    assert "zone" not in table.options.columns  # the defaults stay the seven


def test_a_config_saved_before_asset_summary_still_reads():
    raw = ReportConfig().model_dump(mode="json", by_alias=True)
    raw["sections"] = [s for s in raw["sections"] if s["key"] != "asset_summary"]
    del raw["csv_layout"]
    c = ReportConfig.model_validate(raw)
    assert len(c.sections) == 8 and c.csv_layout == "findings"


def test_the_table_takes_the_asset_columns_and_pages_take_min_severity():
    raw = ReportConfig().model_dump(mode="json", by_alias=True)
    for s in raw["sections"]:
        if s["key"] == "findings_table":
            s["options"]["columns"] = ["number", "zone", "side", "height", "sightings"]
        if s["key"] == "finding_pages":
            s["options"]["min_severity"] = 2
    c = ReportConfig.model_validate(raw)
    assert next(s for s in c.sections if s.key == "finding_pages").options.min_severity == 2


def test_no_builtin_template_turns_the_asset_summary_on():
    for t in BUILTIN_TEMPLATES:
        assert [s.key for s in t.config.sections].count("asset_summary") == 1
        assert not next(s for s in t.config.sections if s.key == "asset_summary").enabled
```

Create `backend/tests/test_reports_findings_table_asset.py`:

```python
"""The findings table's asset columns (spec 2026-10-02-asset-findings §10)."""

from reports_asset_rows import add_asset_finding, add_asset_image, add_asset_model
from reports_rows import add_cloud, add_findings, add_type, config, ctx_for

from app.reports.sections import findings_table

COLS = ["number", "zone", "side", "height", "sightings"]


def _table(handle):
    cfg = config(sections=("findings_table",), options={"findings_table": {"columns": COLS, "sort": "number"}})
    [table] = findings_table.compose(ctx_for(handle, cfg)).blocks
    return table


def test_asset_findings_print_zone_side_height_and_sightings(handle):
    crack = add_type(handle, "crack")
    mid, review, _ = add_asset_model(handle)
    imgs = [add_asset_image(handle, name=f"DJI_000{i}.JPG") for i in range(3)]
    zone = review.zones[0]
    add_asset_finding(
        handle,
        mid,
        crack,
        sightings=[{"image_id": i} for i in imgs],
        zone=zone.id,
        side="West elevation",
        height=41.24,
        bearing=270.0,
        center=(-5.0, 41.24, 0.0),
    )
    add_asset_finding(handle, mid, crack, sightings=[{"image_id": imgs[0], "placement": "none"}], placement="none")
    table = _table(handle)
    assert [c.label for c in table.columns] == ["No.", "Zone", "Side", "Height", "Sightings"]
    assert [str(c.align) for c in table.columns] == ["left", "left", "left", "right", "right"]
    assert table.rows == [
        ["F-0001", zone.label, "West elevation", "41.2 m", "3"],
        ["F-0002", "Not placed", "Not placed", "Not placed", "1"],
    ]


def test_the_asset_columns_are_blank_for_other_anchors(handle):
    t = add_type(handle, "crack")
    add_findings(handle, [{"type_id": t, "anchor": "cloud", "target": add_cloud(handle)}])
    assert _table(handle).rows == [["F-0001", "", "", "", ""]]
```

Create `backend/tests/test_reports_asset_summary.py`:

```python
"""asset_summary (spec 2026-10-02-asset-findings §10): tiles, the map, zone and side breakdowns, for
one asset model (the chosen one, else the first with findings in the filter)."""

from reports_asset_rows import add_asset_finding, add_asset_image, add_asset_model, add_pose, add_review
from reports_rows import add_cloud, add_findings, add_type, config, ctx_for

from app.db.models import AssetModel
from app.reports import compose
from app.reports.sections import asset_summary


def _seed(handle):
    crack, rust = add_type(handle, "crack"), add_type(handle, "rust")
    mid, review, _ = add_asset_model(handle)
    z0, z1 = review.zones[0].id, review.zones[1].id
    imgs = [add_asset_image(handle, name=f"DJI_{i:04d}.JPG") for i in range(4)]
    for i in imgs:
        add_pose(handle, i, mid)
    add_review(handle, imgs[1], "none")
    add_review(handle, imgs[2], "uncertain")
    add_review(handle, imgs[3], "uncertain")
    add_asset_finding(
        handle,
        mid,
        crack,
        sightings=[{"image_id": imgs[0]}, {"image_id": imgs[1]}],
        severity=2,
        zone=z0,
        side="North elevation",
        height=55.0,
        bearing=10.0,
        center=(5.0, 55.0, 1.0),
    )
    add_asset_finding(
        handle,
        mid,
        rust,
        sightings=[{"image_id": imgs[0]}],
        severity=1,
        zone=z1,
        side="West elevation",
        height=40.0,
        bearing=270.0,
        center=(-5.0, 40.0, 0.0),
    )
    add_asset_finding(handle, mid, crack, sightings=[{"image_id": imgs[2]}], severity=1, placement="none")
    return mid, review


def _compose(handle, **opts):
    ctx = ctx_for(handle, config(sections=("asset_summary",), options={"asset_summary": opts}))
    return ctx, asset_summary.compose(ctx)


def test_the_section_is_registered():
    assert compose.SECTION_MODULES["asset_summary"] is asset_summary
    assert compose.section_title("asset_summary") == "Asset summary"


def test_tiles_count_findings_severities_sightings_and_uncertain_photos(handle):
    _seed(handle)
    ctx, doc = _compose(handle)
    assert (doc.blocks[0].kind, doc.blocks[0].text) == ("heading", "Tower A")
    tiles = {i.label: i.value for i in doc.blocks[1].items}
    assert (tiles["Findings"], tiles["Sightings"], tiles["Uncertain photos"]) == ("3", "4", "2")
    assert (tiles[ctx.level(2).name], tiles[ctx.level(1).name]) == ("1", "2")
    colours = {i.label: i.colour for i in doc.blocks[1].items}
    assert colours[ctx.level(2).name] == ctx.level(2).colour


def test_the_map_has_one_dot_per_placed_finding(handle):
    _seed(handle)
    _, doc = _compose(handle)
    [m] = [b for b in doc.blocks if b.kind == "asset_map"]
    assert m.title == "" and m.caption == asset_summary.MAP_CAPTION
    assert {d.label for d in m.drawing.dots} == {"F-0001", "F-0002"}


def test_zone_and_side_tables(handle):
    _, review = _seed(handle)
    _, doc = _compose(handle)
    zones, sides = [b for b in doc.blocks if b.kind == "table"]
    totals = {r[0]: r[-1] for r in zones.rows}
    assert len(zones.rows) == len(review.zones) + 1
    assert (totals[review.zones[0].label], totals[review.zones[1].label], totals["Not placed"]) == ("1", "1", "1")
    labels = [r[0] for r in sides.rows]
    assert labels[-1] == "Not placed" and set(labels[:-1]) == {"North elevation", "West elevation"}
    assert [c.label for c in zones.columns][-1] == "Total"


def test_the_options_switch_the_map_and_the_tables_off(handle):
    _seed(handle)
    _, doc = _compose(handle, show_map=False, show_tables=False)
    assert [b.kind for b in doc.blocks] == ["heading", "kpis"]


def test_the_chosen_model_wins_over_the_first(handle):
    _seed(handle)
    other, _, _ = add_asset_model(handle, name="Annex")
    img = add_asset_image(handle, name="DJI_0999.JPG")
    add_asset_finding(handle, other, add_type(handle, "dent"), sightings=[{"image_id": img}], placement="none")
    _, doc = _compose(handle, asset_model_id=other)
    assert doc.blocks[0].text == "Annex"
    assert {i.label: i.value for i in doc.blocks[1].items}["Findings"] == "1"


def test_no_asset_findings_prints_the_empty_line(handle):
    t = add_type(handle, "crack")
    add_findings(handle, [{"type_id": t, "anchor": "cloud", "target": add_cloud(handle)}])
    _, doc = _compose(handle)
    assert [(b.kind, b.text) for b in doc.blocks] == [("para", asset_summary.EMPTY)]


def test_a_model_without_a_frame_prints_a_note_instead_of_the_map(handle):
    mid, _ = _seed(handle)
    with handle.session() as s:
        s.get(AssetModel, mid).frame = None
    _, doc = _compose(handle)
    assert not [b for b in doc.blocks if b.kind == "asset_map"]
    assert any(b.kind == "para" and b.text == asset_summary.NO_FRAME for b in doc.blocks)


def test_outline_is_one_page(handle):
    _seed(handle)
    ctx, doc = _compose(handle)
    stats = asset_summary.outline(ctx)
    assert (stats.block_count, stats.estimated_pages) == (len(doc.blocks), 1)
```

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_reports_config_asset.py tests/test_reports_findings_table_asset.py tests/test_reports_asset_summary.py -q`
Expected: FAIL (`IndexError`/`AttributeError` on the config, `KeyError: 'zone'`, `ImportError: asset_summary`).

- [ ] **Step 2: The contract (C0 Appendix A, verbatim)**

In `contract/openapi.yaml`:
1. `SectionKey`: `enum: [cover, summary, asset_summary, findings_table, finding_pages, measurements, comparison, object_counts, appendix]`.
2. Add, next to the other section schemas:

```yaml
    AssetSummaryOptions:
      type: object
      additionalProperties: false
      required: [asset_model_id, show_map, show_tables]
      properties:
        asset_model_id: { type: [string, "null"], description: "the asset model to summarise; null is the first asset model with findings in the filter" }
        show_map: { type: boolean, description: "the asset findings map" }
        show_tables: { type: boolean, description: "the zone and side breakdown tables" }
    ReportSectionAssetSummary:
      type: object
      additionalProperties: false
      required: [key, enabled, options]
      properties:
        key: { type: string, enum: [asset_summary] }
        enabled: { type: boolean }
        options: { $ref: "#/components/schemas/AssetSummaryOptions" }
```

   `ReportSection` gains `- $ref: "#/components/schemas/ReportSectionAssetSummary"` and the mapping `asset_summary: "#/components/schemas/ReportSectionAssetSummary"`.
3. `FindingsTableOptions.columns`: `maxItems: 11`, `items.enum: [number, type, severity, status, data_item, observed, note, zone, side, height, sightings]`.
4. `FindingPagesOptions`: `required: [snapshots, photos_max, comments, context_inset, min_severity]`, and `min_severity: { type: [integer, "null"], minimum: 1, maximum: 9, description: "only findings at this severity or above get a page; null is every finding" }`.
5. `ReportConfig`: `required: [cover, paper, filters, sections, brand_id, csv_layout]`; the property `csv_layout: { type: string, enum: [findings, asset_sightings], description: "`asset_sightings`: the kit's 21 columns, UTF-8 with BOM, CRLF, then photos without findings" }`; `sections`: `minItems: 8, maxItems: 9`, description `"a config saved before asset_summary existed lists eight; it reads as disabled"`. The `example` gains `csv_layout: findings`, the section `{ key: asset_summary, enabled: false, options: { asset_model_id: null, show_map: true, show_tables: true } }` after `summary`, and `min_severity: null` in the `finding_pages` options.

In `contract/fixtures/report-document.json`, take the `asset_map` block Task 1 appended to the `summary` section out of it and put it in a new section after `summary`: `{"key": "asset_summary", "title": "Asset summary", "blocks": [<that block>]}`.

Run: `pnpm -C contract generate; pnpm -C contract check`
Expected: clean.

- [ ] **Step 3: The pydantic mirror in `backend/app/reports/schemas.py`**

- `SectionKey` and `SECTION_KEYS`: insert `"asset_summary"` after `"summary"`.
- `FindingsTableColumn`: add `"zone", "side", "height", "sightings"` to the Literal; `FINDINGS_TABLE_COLUMNS` stays the seven (it is the default list).
- `FindingsTableOptions.columns`: `max_length=11`.
- `FindingPagesOptions`: add `min_severity: int | None = Field(None, ge=1, le=9)`.
- Add after `SummaryOptions` and after `ReportSectionSummary` respectively:

```python
class AssetSummaryOptions(_Strict):
    asset_model_id: str | None = None
    show_map: bool = True
    show_tables: bool = True
```

```python
class ReportSectionAssetSummary(_Strict):
    key: Literal["asset_summary"] = "asset_summary"
    enabled: bool = False
    options: AssetSummaryOptions = Field(default_factory=AssetSummaryOptions)
```

- `ReportSection`: add `| ReportSectionAssetSummary` after `ReportSectionSummary`.
- `default_sections()`: insert `ReportSectionAssetSummary(),` after `ReportSectionSummary(),`; its docstring reads "The nine sections in canonical order with default options; asset_summary starts disabled."
- `ReportConfig`: add `csv_layout: Literal["findings", "asset_sightings"] = "findings"` after `brand_id`, and `sections: ... min_length=8, max_length=9`.

- [ ] **Step 4: Built-ins and the pinned tests**

In `backend/app/reports/templates/builtins.py`, the full template stays as it was (the asset summary is opt in, like its default):

```python
        _config(tuple(k for k in SECTION_KEYS if k != "asset_summary")),
```

and change the module docstring's "eight sections" to "every section".

In `backend/tests/test_report_builtins.py`, line 15 becomes `"builtin-full": [k for k in SECTION_KEYS if k != "asset_summary"],`.

In `backend/tests/test_reports_contract.py`, `test_a_config_always_lists_the_eight_sections` asserts `(8, 9)` (rename it `test_a_config_lists_eight_or_nine_sections`).

In `backend/tests/test_catalogue_migration_0002.py`, replace C0's `ADDED_AFTER_0002` line and the `code = [...]` comprehension with:

```python
# Report config pieces added after 0002, each read back by a seeded row as its default: the frozen 0002
# seed never carries them and must not be rewritten to (C0 Task 3b; R1 adds its own here).
ADDED_AFTER_0002 = {"brand_id", "csv_layout"}
SECTIONS_AFTER_0002 = {"asset_summary"}
OPTIONS_AFTER_0002 = {"finding_pages": {"min_severity"}}


def _as_of_0002(config: dict) -> dict:
    out = {k: v for k, v in config.items() if k not in ADDED_AFTER_0002}
    out["sections"] = [
        {**s, "options": {k: v for k, v in s["options"].items() if k not in OPTIONS_AFTER_0002.get(s["key"], set())}}
        for s in config["sections"]
        if s["key"] not in SECTIONS_AFTER_0002
    ]
    return out
```

```python
    code = [
        {
            "id": t.id,
            "name": t.name,
            "description": t.description,
            "config": _as_of_0002(t.config.model_dump(mode="json", by_alias=True)),
        }
        for t in BUILTIN_TEMPLATES
    ]
```

- [ ] **Step 5: The findings table columns**

In `backend/app/reports/sections/findings_table.py`, replace the `COLUMNS` comment and dict, `cell`, and `_table`, and pass `ctx` from `page`:

```python
COLUMNS = {  # key -> (label, relative width); _table scales the chosen ones to 174 mm
    "number": ("No.", 16.0),
    "type": ("Type", 30.0),
    "severity": ("Severity", 22.0),
    "status": ("Status", 18.0),
    "data_item": ("Data item", 32.0),
    "observed": ("Observed", 22.0),
    "note": ("Note", 34.0),
    "zone": ("Zone", 26.0),
    "side": ("Side", 24.0),
    "height": ("Height", 16.0),
    "sightings": ("Sightings", 16.0),
}
ALIGN = {"height": "right", "sightings": "right"}
ASSET_KEYS = ("zone", "side", "height", "sightings")
NOT_PLACED = "Not placed"


def _asset_cell(row: FindingRow, key: str, ctx: ComposeContext | None) -> str:
    """Spec 2026-10-02-asset-findings §10. Blank for image, map and cloud findings; an unplaced asset
    finding says so rather than printing a camera-derived height (index Data rules)."""
    if row.anchor_kind != "asset":
        return ""
    if key == "sightings":
        return str(row.sighting_count)
    if key == "height":
        return f"{row.height_m:.1f} m" if row.height_m is not None else NOT_PLACED
    if key == "side":
        return row.side or NOT_PLACED
    if row.zone is None:
        return NOT_PLACED
    info = ctx.asset_models.get(row.asset_model_id) if ctx is not None and row.asset_model_id else None
    return (info.zone_label(row.zone) if info is not None else row.zone) or NOT_PLACED


def cell(row: FindingRow, key: str, ctx: ComposeContext | None = None) -> str:
    if key in ASSET_KEYS:
        return _asset_cell(row, key, ctx)
    return {
        "number": lambda: row.label,
        "type": lambda: row.type_name,
        "severity": lambda: row.severity_name,
        "status": lambda: row.status.capitalize(),
        "data_item": lambda: row.data_label or blocks.NONE,
        "observed": lambda: blocks.fmt_date(row.observed_on),
        "note": lambda: excerpt(row.note),
    }[key]()


def _table(ctx: ComposeContext, keys: list[str], rows: list[FindingRow]) -> Block:
    total = sum(COLUMNS[k][1] for k in keys)
    cols = [
        blocks.column(k, COLUMNS[k][0], COLUMNS[k][1] * blocks.CONTENT_WIDTH_MM / total, ALIGN.get(k, "left"))
        for k in keys
    ]
    return blocks.table(cols, [[cell(r, k, ctx) for k in keys] for r in rows])
```

In `page`, the comprehension becomes `[_table(ctx, keys, rows[i : i + ROWS_PER_BLOCK]) for i in ...]`. Add `NONE = "-"  # a missing value (no em dash: index Global Constraints)` to `backend/app/reports/blocks.py` here; Task 8 Step 2 moves every other missing-value site onto it.

- [ ] **Step 6: `backend/app/reports/sections/asset_summary.py`**

```python
"""Asset summary (spec 2026-10-02-asset-findings §10): for one asset model (the options' choice, else
the first with asset findings in the filter), the tiles, the findings map and the zone and side
breakdowns. Every number is a SQL aggregate; the map reads placed findings in pages of 2,000 (§11), as
small tuples."""

from __future__ import annotations

from sqlalchemy import and_, func, select

from app.db.models import AssetModel, Finding, ImagePose, ImageReview
from app.findings.numbers import format_number
from app.reports import blocks
from app.reports.asset_drawing import map_drawing
from app.reports.context import ComposeContext, SectionStats
from app.reports.schemas import Block, ReportSectionDoc

KEY = "asset_summary"
TITLE = "Asset summary"
USES_FINDINGS = True
EMPTY = "No asset findings match the filters"
NOT_PLACED = "Not placed"
NO_FRAME = "This asset model has no frame or review profile yet, so its findings map is not drawn."
MAP_CAPTION = (
    "Each dot is one finding at its height and side of the asset. Findings not placed on the model are"
    " left off the map."
)
MAP_MM = (174.0, 92.0)
KEY_COL_MM = 54.0
DOT_PAGE = 2000
ASSET = Finding.anchor_kind == "asset"


def chosen_model(ctx: ComposeContext) -> str | None:
    """The options' asset model, else the first (by name, then id) with asset findings in the filter."""
    wanted = ctx.options(KEY).asset_model_id
    if wanted:
        return wanted
    with ctx.session() as s:
        found = [
            m
            for m in s.execute(
                select(Finding.asset_model_id).where(ctx.where, ASSET).group_by(Finding.asset_model_id)
            ).scalars()
            if m is not None
        ]
    infos = ctx.asset_models
    return min(found, key=lambda m: (infos[m].name if m in infos else "", m), default=None)


def _where(ctx: ComposeContext, model_id: str):
    return and_(ctx.where, ASSET, Finding.asset_model_id == model_id)


def severity_counts(ctx: ComposeContext, model_id: str) -> dict[int | None, int]:
    with ctx.session() as s:
        rows = s.execute(
            select(Finding.severity, func.count()).where(_where(ctx, model_id)).group_by(Finding.severity)
        ).all()
    return {sev: n for sev, n in rows}


def sightings_total(ctx: ComposeContext, model_id: str) -> int:
    with ctx.session() as s:
        return int(
            s.execute(
                select(func.coalesce(func.sum(Finding.sighting_count), 0)).where(_where(ctx, model_id))
            ).scalar_one()
        )


def uncertain_photos(ctx: ComposeContext, model_id: str) -> int:
    """Photos posed on this asset model whose review status is `uncertain` (spec §5.4)."""
    posed = select(ImagePose.image_id).where(ImagePose.asset_model_id == model_id)
    with ctx.session() as s:
        return s.execute(
            select(func.count())
            .select_from(ImageReview)
            .where(ImageReview.status == "uncertain", ImageReview.image_id.in_(posed))
        ).scalar_one()


def _levels(ctx: ComposeContext, sevs) -> list[int]:
    return sorted({lv.level for lv in ctx.scale if lv.level is not None} | {s for s in sevs if s is not None}, reverse=True)


def _tiles(ctx: ComposeContext, counts: dict, sightings: int, uncertain: int) -> Block:
    items = [blocks.kpi("Findings", str(sum(counts.values())))]
    for lv in _levels(ctx, counts):
        level = ctx.level(lv)
        items.append(blocks.kpi(level.name, str(counts.get(lv, 0)), colour=level.colour))
    if counts.get(None):
        items.append(blocks.kpi("Ungraded", str(counts[None])))
    items += [blocks.kpi("Sightings", str(sightings)), blocks.kpi("Uncertain photos", str(uncertain))]
    return blocks.kpis(items)


def map_rows(ctx: ComposeContext, model_id: str) -> list[tuple]:
    """(id, number, height_m, bearing_deg, severity) of the placed findings, keyset pages of 2,000."""
    out: list[tuple] = []
    after = 0
    while True:
        with ctx.session() as s:
            rows = s.execute(
                select(Finding.id, Finding.number, Finding.height_m, Finding.bearing_deg, Finding.severity)
                .where(
                    _where(ctx, model_id),
                    Finding.height_m.is_not(None),
                    Finding.bearing_deg.is_not(None),
                    Finding.number > after,
                )
                .order_by(Finding.number)
                .limit(DOT_PAGE)
            ).all()
        out.extend(tuple(r) for r in rows)
        if len(rows) < DOT_PAGE:
            return out
        after = rows[-1][1]


def _map(ctx: ComposeContext, info) -> Block:
    from app.asset_review.findings_map import MapDot, geometry  # P1; lazy like the other P1 reads

    rows = map_rows(ctx, info.id)
    dots = [MapDot(id=i, height_m=h, bearing_deg=b, severity=sev) for i, _, h, b, sev in rows]
    labels = {i: format_number(n) for i, n, *_ in rows}
    drawing = map_drawing(
        geometry(info.review, info.frame, dots),
        colour_of=lambda sev: ctx.level(sev).colour,
        label_of=labels.get,
    )
    return blocks.asset_map(drawing, title="", caption=MAP_CAPTION, width_mm=MAP_MM[0], height_mm=MAP_MM[1])


def breakdown(ctx: ComposeContext, model_id: str, column) -> dict[tuple, int]:
    with ctx.session() as s:
        rows = s.execute(
            select(column, Finding.severity, func.count()).where(_where(ctx, model_id)).group_by(column, Finding.severity)
        ).all()
    return {(k, sev): n for k, sev, n in rows}


def _breakdown_table(ctx: ComposeContext, head: str, keys: list, label_of, counts: dict) -> Block:
    sevs = {sev for _, sev in counts}
    names = [(lv, ctx.level(lv).name) for lv in _levels(ctx, sevs)]
    if None in sevs:
        names.append((None, "Ungraded"))
    share = (blocks.CONTENT_WIDTH_MM - KEY_COL_MM) / (len(names) + 1)
    cols = [blocks.column("key", head, KEY_COL_MM)]
    cols += [blocks.column(f"s{lv}", name, share, "right") for lv, name in names]
    cols.append(blocks.column("total", "Total", share, "right"))
    rows = []
    for k in keys:
        cells = [counts.get((k, lv), 0) for lv, _ in names]
        rows.append([label_of(k), *map(str, cells), str(sum(cells))])
    return blocks.table(cols, rows)


def _zone_keys(info, counts: dict) -> list:
    listed = [z.id for z in info.review.zones] if info is not None and info.review is not None else []
    seen = {k for k, _ in counts}
    keys = listed + sorted(k for k in seen if k is not None and k not in listed)
    return keys + ([None] if None in seen else [])


def _side_keys(counts: dict) -> list:
    totals: dict = {}
    for (k, _), n in counts.items():
        totals[k] = totals.get(k, 0) + n
    keys = sorted((k for k in totals if k is not None), key=lambda k: (-totals[k], k))
    return keys + ([None] if None in totals else [])


def compose(ctx: ComposeContext) -> ReportSectionDoc:
    opts = ctx.options(KEY)
    mid = chosen_model(ctx)
    counts = severity_counts(ctx, mid) if mid else {}
    if not counts:
        return ReportSectionDoc(key=KEY, title=TITLE, blocks=[blocks.para(EMPTY, style="note")])
    info = ctx.asset_models.get(mid)
    out: list[Block] = [
        blocks.heading(info.name if info is not None else "Asset model", 2),
        _tiles(ctx, counts, sightings_total(ctx, mid), uncertain_photos(ctx, mid)),
    ]
    if opts.show_map:
        ready = info is not None and info.frame is not None and info.review is not None
        out.append(_map(ctx, info) if ready else blocks.para(NO_FRAME, style="note"))
    if opts.show_tables:
        zones = breakdown(ctx, mid, Finding.zone)
        out.append(blocks.heading("Findings by zone", 3))
        out.append(
            _breakdown_table(
                ctx,
                "Zone",
                _zone_keys(info, zones),
                lambda k: (info.zone_label(k) if info is not None else k) if k is not None else NOT_PLACED,
                zones,
            )
        )
        sides = breakdown(ctx, mid, Finding.side)
        out.append(blocks.heading("Findings by side", 3))
        out.append(_breakdown_table(ctx, "Side", _side_keys(sides), lambda k: k or NOT_PLACED, sides))
    return ReportSectionDoc(key=KEY, title=TITLE, blocks=out)


def outline(ctx: ComposeContext) -> SectionStats:
    return SectionStats(block_count=len(compose(ctx).blocks), estimated_pages=1)


def fingerprint(ctx: ComposeContext) -> str:
    """Frames, reviews and photo statuses change no finding row, so they join the etag here."""
    with ctx.session() as s:
        models = s.execute(select(func.max(AssetModel.updated_at), func.count()).select_from(AssetModel)).one()
        reviews = s.execute(select(func.max(ImageReview.updated_at), func.count()).select_from(ImageReview)).one()
    return f"{tuple(models)}|{tuple(reviews)}"
```

In `backend/app/reports/compose.py`, add `asset_summary` to the `from app.reports.sections import (...)` list and put it after `summary` in the `SECTION_MODULES` tuple.

- [ ] **Step 7: The frontend records**

- `frontend/src/reports/builderModel.ts`, `SECTION_LABEL`: add `asset_summary: "Asset summary",` after `summary`.
- `frontend/src/api/reports.ts`, `SECTION_TITLES`: add `asset_summary: "Asset summary",` after `summary`.
- `frontend/src/reports/preview/fixtures.ts`: take `MAP_FIXTURE` out of `FIXTURE_BLOCKS.summary` and add `asset_summary: [MAP_FIXTURE],` after `summary`.
- Run `pnpm -C frontend exec tsc --noEmit -p .`. For each config literal it names (`frontend/src/test/reportBuilderFixtures.ts` `reportConfig()` among them): add `csv_layout: "findings"`; add `min_severity: null` to a `finding_pages` options literal; add `{ key: "asset_summary", enabled: false, options: { asset_model_id: null, show_map: true, show_tables: true } }` after the `summary` section of a full sections list. Re-run until clean.

- [ ] **Step 8: Run**

```powershell
cd backend
& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_reports_config_asset.py tests/test_reports_findings_table_asset.py tests/test_reports_asset_summary.py tests/test_reports_contract.py tests/test_report_builtins.py tests/test_catalogue_migration_0002.py tests/test_reports_findings_table.py tests/test_reports_compose.py tests/test_reports_outline_api.py tests/test_reports_crud.py tests/test_report_templates.py -q
cd ..
pnpm -C frontend exec vitest run src/reports
```

Expected: PASS. If a backend test compares a whole stored config with a dict literal, add the new keys to that literal (`"csv_layout": "findings"`, the `asset_summary` section, `"min_severity": None`); never drop them from the dump.

- [ ] **Step 9: Commit**

```powershell
git add contract/openapi.yaml contract/client/schema.d.ts contract/fixtures/report-document.json backend/app/reports/schemas.py backend/app/reports/templates/builtins.py backend/app/reports/sections/asset_summary.py backend/app/reports/compose.py backend/app/reports/sections/findings_table.py backend/tests/test_reports_contract.py backend/tests/test_report_builtins.py backend/tests/test_catalogue_migration_0002.py backend/tests/test_reports_config_asset.py backend/tests/test_reports_findings_table_asset.py backend/tests/test_reports_asset_summary.py frontend/src/reports/builderModel.ts frontend/src/api/reports.ts frontend/src/reports/preview/fixtures.ts frontend/src/test/reportBuilderFixtures.ts
git commit -m @'
feat(reports): asset summary section, table asset columns, min_severity and csv_layout in the config

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

Also stage, by path, every other file Steps 7 and 8 touched (`git status --short`).

---

### Task 5: The rasterizer frames a window and draws a pin or an outline

**Files:**
- Modify: `backend/app/asset_models/raster.py`
- Test: `backend/tests/test_asset_model_raster_markers.py`

**Interfaces:**
- Produces (in `app.asset_models.raster`):
  - `Marker(kind: Literal["pin", "outline"], points: tuple[tuple[float, float, float], ...], rgb: tuple[int, int, int])` (frozen dataclass)
  - `basis(view: View) -> tuple[np.ndarray, np.ndarray, np.ndarray]` (forward, right, up; the public name of `_basis`)
  - `render(meshes, view, *, size=1024, labels=False, groups=None, highlight=None, window=None, markers=None) -> Image.Image`
    - `window: tuple[tuple[float, float, float], float] | None`: frame a square of half-width `window[1]` metres centred on `window[0]` instead of the whole mesh; triangles outside it are dropped before sampling.
    - `markers`: drawn last, in the same projection (a pin: a filled disc with a white rim; an outline: a closed polyline with a white halo).
  - Calls without `window` and `markers` are byte-identical to today (the M1 goldens hold).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_asset_model_raster_markers.py`:

```python
"""The rasterizer's framing window and markers (spec 2026-10-02-asset-findings §10, decision A9)."""

import numpy as np
import trimesh

from app.asset_models.raster import BG, Marker, View, render

BOX = {"asset": trimesh.creation.box(extents=(2.0, 2.0, 2.0))}
LOOK = View("custom", direction=(-1.0, 0.0, 0.0))  # from +X towards the face at x = 1
RED = (255, 0, 0)


def test_calls_without_window_or_markers_are_unchanged():
    a = render(BOX, View("iso"), size=128)
    b = render(BOX, View("iso"), size=128, window=None, markers=None)
    assert np.array_equal(np.asarray(a), np.asarray(b))


def test_a_pin_lands_on_its_point_when_framed_on_it():
    img = render(BOX, LOOK, size=256, window=((1.0, 0.0, 0.0), 2.0), markers=[Marker("pin", ((1.0, 0.0, 0.0),), RED)])
    assert img.getpixel((128, 128)) == RED


def test_a_pin_off_centre_follows_the_projection():
    # scale = 256 * 0.88 / 4 = 56.32 px per metre; one metre up is 56 px higher on the image
    img = render(BOX, LOOK, size=256, window=((1.0, 0.0, 0.0), 2.0), markers=[Marker("pin", ((1.0, 1.0, 0.0),), RED)])
    assert img.getpixel((128, 72)) == RED
    assert img.getpixel((128, 128)) != RED


def test_an_outline_is_drawn_through_its_points():
    square = ((1.0, -0.5, -0.5), (1.0, -0.5, 0.5), (1.0, 0.5, 0.5), (1.0, 0.5, -0.5))
    img = render(BOX, LOOK, size=256, window=((1.0, 0.0, 0.0), 2.0), markers=[Marker("outline", square, RED)])
    column = [img.getpixel((128, y)) for y in range(96, 104)]  # the top edge, y = 0.5 m, at row ~100
    assert RED in column
    assert img.getpixel((128, 128)) != RED  # the inside stays the model


def test_the_window_zooms_in():
    whole = render(BOX, LOOK, size=128)
    close = render(BOX, LOOK, size=128, window=((1.0, 0.0, 0.0), 0.5))
    assert whole.getpixel((0, 0)) == BG
    assert close.getpixel((0, 0)) != BG


def test_a_window_with_nothing_in_it_is_background_and_markers():
    img = render(BOX, LOOK, size=128, window=((50.0, 50.0, 50.0), 1.0), markers=[Marker("pin", ((50.0, 50.0, 50.0),), RED)])
    assert img.getpixel((0, 0)) == BG and img.getpixel((64, 64)) == RED


def test_a_framed_render_is_deterministic():
    kw = dict(size=200, window=((1.0, 0.2, 0.1), 1.5), markers=[Marker("pin", ((1.0, 0.2, 0.1),), RED)])
    assert np.array_equal(np.asarray(render(BOX, LOOK, **kw)), np.asarray(render(BOX, LOOK, **kw)))
```

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_model_raster_markers.py -q`
Expected: FAIL (`ImportError: cannot import name 'Marker'`).

- [ ] **Step 2: Implement**

In `backend/app/asset_models/raster.py`:
- add `from collections.abc import Sequence` to the imports;
- after `class View`, add:

```python
@dataclass(frozen=True)
class Marker:
    """A finding drawn over a render (spec 2026-10-02-asset-findings A9): a pin at one point, or a
    closed outline through several, in the asset frame."""

    kind: Literal["pin", "outline"]
    points: tuple[tuple[float, float, float], ...]
    rgb: tuple[int, int, int]


Window = tuple[tuple[float, float, float], float]  # (centre, half-width in metres)
```

- after `_basis`, add:

```python
def basis(view: View) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """forward, right, up for `view` (the report's 3D locator projects patch outlines with it)."""
    return _basis(view)


def _draw_markers(img: Image.Image, markers: Sequence[Marker] | None, project, size: int) -> Image.Image:
    if not markers:
        return img
    draw = ImageDraw.Draw(img)
    for mk in markers:
        pts = [project(np.asarray(p, dtype=float)) for p in mk.points]
        if mk.kind == "pin" and pts:
            x, y = pts[0]
            r = max(5, round(size * 0.018))
            draw.ellipse([x - r - 2, y - r - 2, x + r + 2, y + r + 2], fill=(255, 255, 255))
            draw.ellipse([x - r, y - r, x + r, y + r], fill=mk.rgb)
        elif mk.kind == "outline" and len(pts) >= 2:
            w = max(2, round(size * 0.004))
            ring = [*pts, pts[0]]
            draw.line(ring, fill=(255, 255, 255), width=w + 4, joint="curve")
            draw.line(ring, fill=mk.rgb, width=w, joint="curve")
    return img
```

- replace `render` with:

```python
def render(
    meshes,
    view: View,
    *,
    size: int = 1024,
    labels: bool = False,
    groups=None,
    highlight=None,
    window: Window | None = None,
    markers: Sequence[Marker] | None = None,
) -> Image.Image:
    size = int(min(max(size, 64), MAX_SIZE))
    groups = groups or {}
    highlight = highlight or set()
    ids = list(meshes)
    if not ids:
        return Image.new("RGB", (size, size), BG)
    tris = np.concatenate([meshes[i].triangles for i in ids])
    owner = np.concatenate([np.full(len(meshes[i].faces), k, dtype=np.int32) for k, i in enumerate(ids)])
    normals = np.concatenate([meshes[i].face_normals for i in ids])
    f, right, up = _basis(view)
    if view.kind == "section":  # keep what lies beyond the vertical plane through the axis
        keep = (tris.mean(axis=1) @ f) >= 0
        tris, owner, normals = tris[keep], owner[keep], normals[keep]
        if len(tris) == 0:
            return Image.new("RGB", (size, size), BG)
    sx, sy, sd = tris @ right, tris @ up, tris @ f  # (T,3) each
    if window is not None:
        c = np.asarray(window[0], dtype=float)
        half = float(window[1])
        cx, cy = float(c @ right), float(c @ up)
        lo = np.array([cx - half, cy - half])
        hi = np.array([cx + half, cy + half])
        keep = (sx.max(axis=1) >= lo[0]) & (sx.min(axis=1) <= hi[0]) & (sy.max(axis=1) >= lo[1]) & (sy.min(axis=1) <= hi[1])
        tris, owner, normals = tris[keep], owner[keep], normals[keep]
        sx, sy, sd = sx[keep], sy[keep], sd[keep]
    else:
        lo = np.array([sx.min(), sy.min()])
        hi = np.array([sx.max(), sy.max()])
    span = float(max(hi - lo)) or 1.0
    scale = size * (1 - 2 * MARGIN) / span
    off = (size - (hi - lo) * scale) / 2

    def project(p: np.ndarray) -> tuple[float, float]:
        return (
            float((p @ right - lo[0]) * scale + off[0]),
            float(size - ((p @ up - lo[1]) * scale + off[1])),
        )

    if len(tris) == 0:
        return _draw_markers(Image.new("RGB", (size, size), BG), markers, project, size)
    px = (sx - lo[0]) * scale + off[0]
    py = size - ((sy - lo[1]) * scale + off[1])  # image y grows downward
    area = 0.5 * np.abs(
        (px[:, 1] - px[:, 0]) * (py[:, 2] - py[:, 0]) - (px[:, 2] - px[:, 0]) * (py[:, 1] - py[:, 0])
    )
    counts = np.maximum(1, np.ceil(area * SAMPLES_PER_PX)).astype(np.int64)
    if counts.sum() > MAX_SAMPLES:
        counts = np.maximum(1, (counts * (MAX_SAMPLES / counts.sum())).astype(np.int64))
    tri_of = np.repeat(np.arange(len(tris)), counts)
    rng = np.random.default_rng(SEED)
    u, v = rng.random(len(tri_of)), rng.random(len(tri_of))
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    w = 1 - u - v

    def interp(q):
        return w * q[tri_of, 0] + u * q[tri_of, 1] + v * q[tri_of, 2]

    fx, fy, depth = interp(px), interp(py), interp(sd)
    if window is not None:  # a sample outside the frame is dropped, never clamped onto its border
        inside = (fx >= 0) & (fx < size) & (fy >= 0) & (fy < size)
        tri_of, fx, fy, depth = tri_of[inside], fx[inside], fy[inside], depth[inside]
        if len(tri_of) == 0:
            return _draw_markers(Image.new("RGB", (size, size), BG), markers, project, size)
    ix = np.clip(fx.astype(np.int64), 0, size - 1)
    iy = np.clip(fy.astype(np.int64), 0, size - 1)
    pix = iy * size + ix
    d0, d1 = float(depth.min()), float(depth.max())
    dq = ((depth - d0) / ((d1 - d0) or 1.0) * ((1 << 20) - 1)).astype(np.int64)
    order = np.argsort(pix * (1 << 20) + dq, kind="stable")  # by pixel, then nearest first
    pix_sorted = pix[order]
    first = np.ones(len(order), dtype=bool)
    first[1:] = pix_sorted[1:] != pix_sorted[:-1]
    win = order[first]
    wp = pix[win]
    shade = 0.35 + 0.65 * np.abs(normals[tri_of[win]] @ f)
    base = np.array([GROUP_RGB.get(groups.get(i, "Other"), GROUP_RGB["Other"]) for i in ids], dtype=float)
    part = owner[tri_of[win]]
    rgb = base[part] * shade[:, None]
    for k, pid in enumerate(ids):
        if pid in highlight:
            rgb[part == k] = HIGHLIGHT
    img = np.empty((size * size, 3), dtype=np.uint8)
    img[:] = BG
    img[wp] = np.clip(rgb, 0, 255).astype(np.uint8)
    idmap = np.full(size * size, -1, dtype=np.int32)
    idmap[wp] = part
    dmap = np.full(size * size, np.inf)
    dmap[wp] = depth[win]
    img, idmap, dmap = img.reshape(size, size, 3), idmap.reshape(size, size), dmap.reshape(size, size)
    edge = np.zeros((size, size), dtype=bool)
    jump = span * 0.01
    for a, b in (
        ((slice(None), slice(1, None)), (slice(None), slice(None, -1))),
        ((slice(1, None), slice(None)), (slice(None, -1), slice(None))),
    ):
        id_change = idmap[a] != idmap[b]
        with np.errstate(invalid="ignore"):
            depth_jump = np.abs(dmap[a] - dmap[b]) > jump
        e = id_change | depth_jump
        edge[a] |= e & (idmap[a] >= 0)
    img[edge] = OUTLINE
    out = Image.fromarray(img, "RGB")
    if labels:
        draw = ImageDraw.Draw(out)
        font = ImageFont.load_default()
        for k, pid in enumerate(ids):
            ys, xs = np.nonzero(idmap == k)
            if len(xs) > 30:
                draw.text(
                    (int(xs.mean()), int(ys.mean())),
                    pid,
                    fill=(255, 255, 255),
                    font=font,
                    stroke_width=2,
                    stroke_fill=(0, 0, 0),
                    anchor="mm",
                )
    return _draw_markers(out, markers, project, size)
```

The only changes against today's body: the `window` branch, `project`, `fx, fy, depth` computed before `ix, iy` (same values), the inside filter under `window`, and the final `_draw_markers`.

- [ ] **Step 3: Run the new tests and the M1 goldens**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_asset_model_raster_markers.py tests/test_asset_model_raster.py -q`
Expected: PASS (the goldens are untouched).

- [ ] **Step 4: Commit**

```powershell
git add backend/app/asset_models/raster.py backend/tests/test_asset_model_raster_markers.py
git commit -m @'
feat(asset-models): raster framing window and pin or outline markers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 6: The `asset_locator` snapshot

**Files:**
- Create: `backend/app/reports/snapshots/asset_locator.py`
- Modify: `backend/app/reports/snapshots/render.py`
- Test: `backend/tests/test_report_snapshot_asset_locator.py`

**Interfaces:**
- Consumes: J1 `app.asset_review.meshes.load_version_mesh(handle, asset_model_id, version) -> (trimesh.Trimesh, np.ndarray)`; `app.asset_models.store.version_glb_path`, `model_dir`; Task 5 `raster.render(window=, markers=)`, `Marker`, `basis`; J3's patch file layout `asset_models/<id>/placements/v<n>/<sighting>.bin` (spec §5.7: little-endian float32 positions, then uvs, so `n = bytes // 20`).
- Produces: renderer module `app.reports.snapshots.asset_locator` (`source_version(handle, spec) -> str`, `render(handle, spec) -> PIL.Image`, `JPEG_QUALITY = 88`, `view_direction(normal, oblique_deg) -> tuple[float, float, float]`, `patch_outline(path, direction) -> list[tuple[float, float, float]]`, `_load_mesh(handle, model_id, version)` as the test seam); `RENDERERS["asset_locator"]`; `check_limits` refuses a non-square or over-1024 px `out`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_report_snapshot_asset_locator.py`:

```python
"""asset_locator snapshots (spec 2026-10-02-asset-findings §10, decision A9)."""

import struct

import numpy as np
import pytest
import trimesh

from app.asset_models.store import model_dir, version_glb_path
from app.db.base import new_id
from app.reports.schemas import AssetLocatorSpec
from app.reports.snapshots import MISSING, asset_locator
from app.reports.snapshots import render as render_mod

BOX = trimesh.creation.box(extents=(2.0, 2.0, 2.0))
RED = (255, 0, 0)


def _spec(mid: str, **kw) -> AssetLocatorSpec:
    base = {
        "kind": "asset_locator",
        "asset_model_id": mid,
        "version": 1,
        "sighting_id": None,
        "mark": "pin",
        "center": [1.0, 0.0, 0.0],
        "normal": [1.0, 0.0, 0.0],
        "half_extent_m": 2.0,
        "oblique_deg": 0.0,
        "colour": "#FF0000",
        "out": [256, 256],
    }
    return AssetLocatorSpec.model_validate({**base, **kw})


def _glb(handle, mid: str) -> None:
    p = version_glb_path(handle, mid, 1)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"glTF-test")


def _patch(handle, mid: str, sid: str, pts) -> None:
    folder = model_dir(handle, mid) / "placements" / "v1"
    folder.mkdir(parents=True, exist_ok=True)
    pos = b"".join(struct.pack("<3f", *p) for p in pts)
    uvs = b"".join(struct.pack("<2f", 0.0, 0.0) for _ in pts)
    (folder / f"{sid}.bin").write_bytes(pos + uvs)


SQUARE = [(1.0, -0.5, -0.5), (1.0, -0.5, 0.5), (1.0, 0.5, 0.5), (1.0, 0.5, -0.5)]


@pytest.fixture
def box_mesh(monkeypatch):
    monkeypatch.setattr(asset_locator, "_load_mesh", lambda handle, mid, version: BOX)


def test_source_version_follows_the_glb_and_the_patch(handle):
    mid, sid = new_id(), new_id()
    assert asset_locator.source_version(handle, _spec(mid)).startswith(MISSING)
    _glb(handle, mid)
    pin = asset_locator.source_version(handle, _spec(mid))
    assert not pin.startswith(MISSING)
    patch = _spec(mid, mark="patch", sighting_id=sid)
    assert asset_locator.source_version(handle, patch) == pin  # no patch file yet
    _patch(handle, mid, sid, SQUARE)
    assert asset_locator.source_version(handle, patch).startswith(pin + "|")


def test_a_bad_model_id_is_a_missing_source(handle):
    assert asset_locator.source_version(handle, _spec("../x")).startswith(MISSING)


def test_a_pin_renders_in_the_severity_colour(handle, box_mesh):
    _glb(handle, new_id())
    img = asset_locator.render(handle, _spec(new_id()))
    assert img.size == (256, 256) and img.getpixel((128, 128)) == RED


def test_a_patch_draws_its_outline_not_a_pin(handle, box_mesh):
    mid, sid = new_id(), new_id()
    _patch(handle, mid, sid, SQUARE)
    img = asset_locator.render(handle, _spec(mid, mark="patch", sighting_id=sid))
    assert RED in [img.getpixel((128, y)) for y in range(96, 104)]
    assert img.getpixel((128, 128)) != RED


def test_a_missing_patch_file_falls_back_to_the_pin(handle, box_mesh):
    img = asset_locator.render(handle, _spec(new_id(), mark="patch", sighting_id=new_id()))
    assert img.getpixel((128, 128)) == RED


def test_view_direction_looks_against_the_normal_and_turns_by_the_oblique_angle():
    assert asset_locator.view_direction([1.0, 0.0, 0.0], 0.0) == pytest.approx((-1.0, 0.0, 0.0))
    assert asset_locator.view_direction([1.0, 0.0, 0.0], 90.0) == pytest.approx((0.0, 0.0, 1.0), abs=1e-9)
    assert asset_locator.view_direction([0.0, 0.0, 0.0], 0.0) == pytest.approx((-1.0, 0.0, 0.0))


def test_the_kind_is_registered_and_square(handle):
    assert render_mod.RENDERERS["asset_locator"] is asset_locator
    with pytest.raises(ValueError):
        render_mod.check_limits(_spec(new_id(), out=[300, 200]))
    with pytest.raises(ValueError):
        render_mod.check_limits(_spec(new_id(), out=[2000, 2000]))


def test_render_result_caches_a_jpeg(handle, box_mesh):
    mid = new_id()
    _glb(handle, mid)
    result = render_mod.render_result(handle, _spec(mid))
    assert result.missing_reason is None and result.path.suffix == ".jpg"
    from PIL import Image

    with Image.open(result.path) as im:
        assert im.size == (256, 256)
        assert np.asarray(im.convert("RGB"))[128, 128, 0] > 200
```

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_report_snapshot_asset_locator.py -q`
Expected: FAIL (`ImportError: cannot import name 'asset_locator'`).

- [ ] **Step 2: `backend/app/reports/snapshots/asset_locator.py`**

```python
"""asset_locator: a finding on its asset model, drawn on the server (spec 2026-10-02-asset-findings
§10, decision A9). Orthographic along the finding's normal turned by the profile's oblique angle,
framed on a square of `half_extent_m` around the finding, with a pin or the patch outline in the
severity colour. The mesh comes from J1's per-process cache; one patch file (at most 64 KB) is read.
Nothing heavy loads at import: the snapshot dispatcher imports this module eagerly."""

from __future__ import annotations

import math

import numpy as np

from app.reports.snapshots import MISSING, SnapshotUnavailable
from app.surfaces.design.store import ID_RE

JPEG_QUALITY = 88
GONE = "The asset model version for this finding no longer exists"
NOT_READY = "The asset model has no 3D model file for this version yet"
MAX_OUT = 1024  # the rasterizer's own cap


def _glb(handle, spec):
    from app.asset_models.store import version_glb_path

    return version_glb_path(handle, spec.asset_model_id, int(spec.version))


def patch_bin(handle, spec):
    """J3's patch file for the spec's sighting, or None for a pin or an id that is not an id."""
    if spec.mark != "patch" or not spec.sighting_id or not ID_RE.fullmatch(spec.sighting_id):
        return None
    from app.asset_models.store import model_dir

    return model_dir(handle, spec.asset_model_id) / "placements" / f"v{int(spec.version)}" / f"{spec.sighting_id}.bin"


def _stamp(path) -> str:
    st = path.stat()
    return f"{st.st_size}:{st.st_mtime_ns}"


def source_version(handle, spec) -> str:
    """The GLB's size and mtime (versions are never rewritten), plus the patch file's for a patch."""
    try:
        glb = _glb(handle, spec)
    except Exception:  # not_found for an id that is not an id
        return MISSING + GONE
    if not glb.is_file():
        return MISSING + NOT_READY
    sv = _stamp(glb)
    try:
        patch = patch_bin(handle, spec)
    except Exception:
        patch = None
    if patch is not None and patch.is_file():
        sv += "|" + _stamp(patch)
    return sv


def view_direction(normal, oblique_deg: float) -> tuple[float, float, float]:
    """Looking against the normal (onto the surface), turned about the vertical by `oblique_deg`."""
    n = np.asarray(normal, dtype=float)
    norm = float(np.linalg.norm(n))
    n = n / norm if norm > 1e-9 else np.array([1.0, 0.0, 0.0])
    f = -n
    a = math.radians(float(oblique_deg))
    c, s = math.cos(a), math.sin(a)
    turned = (c * f[0] + s * f[2], f[1], -s * f[0] + c * f[2])
    return tuple(0.0 if abs(v) < 1e-12 else float(v) for v in turned)


def _hull(pts: np.ndarray) -> list[int]:
    """Indices of the 2D convex hull, counter-clockwise (monotone chain; deterministic)."""
    order = sorted(range(len(pts)), key=lambda i: (float(pts[i][0]), float(pts[i][1]), i))

    def cross(o: int, a: int, b: int) -> float:
        return float(
            (pts[a][0] - pts[o][0]) * (pts[b][1] - pts[o][1]) - (pts[a][1] - pts[o][1]) * (pts[b][0] - pts[o][0])
        )

    lower: list[int] = []
    for i in order:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], i) <= 0:
            lower.pop()
        lower.append(i)
    upper: list[int] = []
    for i in reversed(order):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], i) <= 0:
            upper.pop()
        upper.append(i)
    return lower[:-1] + upper[:-1]


def patch_outline(path, direction) -> list[tuple[float, float, float]]:
    """The patch's outline as seen along `direction`: the hull of its vertices in the view plane."""
    from app.asset_models.raster import View, basis

    raw = path.read_bytes()
    n = len(raw) // 20
    if n < 3:
        return []
    pos = np.frombuffer(raw[: n * 12], dtype="<f4").reshape(n, 3).astype(float)
    _, right, up = basis(View("custom", direction=tuple(direction)))
    hull = _hull(np.c_[pos @ right, pos @ up])
    return [tuple(float(v) for v in pos[i]) for i in hull]


def _load_mesh(handle, model_id: str, version: int):
    from app.asset_review.meshes import load_version_mesh  # J1: cached per process by GLB sha256

    mesh, _face_node = load_version_mesh(handle, model_id, version)
    return mesh


def _rgb(hex_colour: str) -> tuple[int, int, int]:
    v = int(hex_colour[1:7], 16)
    return (v >> 16) & 255, (v >> 8) & 255, v & 255


def render(handle, spec):
    from app.asset_models.raster import Marker, View
    from app.asset_models.raster import render as raster_render

    try:
        mesh = _load_mesh(handle, spec.asset_model_id, int(spec.version))
    except FileNotFoundError as e:
        raise SnapshotUnavailable(NOT_READY) from e
    direction = view_direction(spec.normal, float(spec.oblique_deg))
    rgb = _rgb(spec.colour)
    markers = []
    patch = patch_bin(handle, spec)
    if patch is not None and patch.is_file():
        ring = patch_outline(patch, direction)
        if len(ring) >= 3:
            markers.append(Marker("outline", tuple(ring), rgb))
    if not markers:
        markers.append(Marker("pin", (tuple(float(v) for v in spec.center),), rgb))
    size = int(spec.out[0])
    return raster_render(
        {"asset": mesh},
        View("custom", direction=direction),
        size=size,
        window=(tuple(float(v) for v in spec.center), float(spec.half_extent_m)),
        markers=markers,
    )
```

- [ ] **Step 3: Register it in `backend/app/reports/snapshots/render.py`**

Add `asset_locator` to the `from app.reports.snapshots import (...)` list, add `"asset_locator": asset_locator,` to `RENDERERS`, and in `check_limits`, after the `out` check, add:

```python
    if kind == "asset_locator":
        w, h = (int(v) for v in out)
        if w != h or w > asset_locator.MAX_OUT:
            raise ValueError(f"an asset locator is square, at most {asset_locator.MAX_OUT} px")
```

- [ ] **Step 4: Run**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_report_snapshot_asset_locator.py tests/test_report_snapshot_render.py tests/test_report_snapshot_keys.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/reports/snapshots/asset_locator.py backend/app/reports/snapshots/render.py backend/tests/test_report_snapshot_asset_locator.py
git commit -m @'
feat(reports): asset_locator snapshot rendered server side with the rasterizer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 7: Finding pages for asset findings, and `min_severity`

**Files:**
- Create: `backend/app/reports/sections/asset_pages.py`
- Modify: `backend/app/reports/sections/finding_pages.py`
- Test: `backend/tests/test_reports_finding_pages_asset.py`

**Interfaces:**
- Consumes: Task 2 (`representative`, `PLACED`, `ctx.asset_models`), Task 3 (`height_locator`), Task 6 (`AssetLocatorSpec` keyed through `ctx.ref`), `app.reports.figures.image.photos`, `.comments`, `app.reports.snapshots.image_crop.ring_of`, P1 `ReviewConfig.facts` and `focus`, Task 4 `FindingPagesOptions.min_severity`.
- Produces:
  - `app.reports.sections.asset_pages.asset_finding_block(ctx, row) -> Block`
  - `kicker(row, info) -> str` (`"Finding F-0042 · Upper floors · West elevation · seen in 3 photos"`)
  - `facts_order(info) -> tuple[str, ...]` (the review's `facts`, else `DEFAULT_FACTS`)
  - `asset_facts(row, info, rep) -> list[tuple[str, str]]`
  - `half_extent_of(info) -> float`, `oblique_of(info) -> float`
  - `fingerprint(ctx) -> str`
  - constants `WIDE_CONTEXT = 10.0`, `CLOSE_CONTEXT = 2.0`, `NOT_PLACED_TEXT = "Not placed on the model"`, `DEFAULT_FACTS`
  - `finding_pages.page/outline` honour `min_severity` (ungraded findings are left out when it is set)

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_reports_finding_pages_asset.py`:

```python
"""Asset finding pages (spec 2026-10-02-asset-findings §10) and finding_pages.min_severity."""

from reports_asset_rows import add_asset_finding, add_asset_image, add_asset_model, add_pose
from reports_rows import add_findings, add_image, add_type, config, ctx_for

from app.reports.sections import asset_pages, finding_pages


def _seed(handle):
    crack = add_type(handle, "crack")
    mid, review, _ = add_asset_model(handle)
    zone = review.zones[1]
    a = add_asset_image(handle, name="DJI_0101.JPG")
    b = add_asset_image(handle, name="DJI_0102.JPG")
    add_pose(handle, a, mid, sequence="3")
    add_pose(handle, b, mid)
    add_asset_finding(
        handle,
        mid,
        crack,
        severity=2,
        note="Open joint.",
        zone=zone.id,
        side="West elevation",
        height=41.2,
        bearing=271.0,
        center=(-5.0, 41.2, 0.5),
        normal=(-1.0, 0.0, 0.0),
        component="Panel",
        sightings=[
            {"image_id": a, "center": (-5.0, 41.2, 0.5), "normal": (-1.0, 0.0, 0.0), "coverage": 0.0125, "id": "s-rep"},
            {"image_id": b, "severity": 1, "center": (-5.1, 41.0, 0.4), "coverage": 0.3},
        ],
    )
    return crack, mid, zone, a


def _ctx(handle, **opts):
    cfg = config(
        sections=("finding_pages",),
        options={"finding_pages": {"photos_max": 0, "comments": "none", **opts}},
    )
    return ctx_for(handle, cfg)


def test_the_kicker_names_number_zone_side_and_sightings(handle):
    _, _, zone, _ = _seed(handle)
    [b] = finding_pages.compose(_ctx(handle)).blocks
    assert b.asset.kicker == f"Finding F-0001 · {zone.label} · West elevation · seen in 2 photos"


def test_figures_are_the_photo_the_3d_locator_and_the_close_up(handle):
    _, mid, _, a = _seed(handle)
    ctx = _ctx(handle)
    [b] = finding_pages.compose(ctx).blocks
    wide, loc, close = (f.snapshot.spec for f in b.figures)
    assert (wide.kind, loc.kind, close.kind) == ("image_crop", "asset_locator", "image_crop")
    assert (wide.context, close.context) == (asset_pages.WIDE_CONTEXT, asset_pages.CLOSE_CONTEXT)
    assert wide.image_id == close.image_id == a  # the representative (worst) sighting's photo
    info = ctx.asset_models[mid]
    assert (loc.asset_model_id, loc.version, loc.mark, loc.sighting_id) == (mid, 1, "patch", "s-rep")
    assert loc.center == [-5.0, 41.2, 0.5] and loc.normal == [-1.0, 0.0, 0.0]
    assert loc.colour == b.head.severity_colour
    assert (loc.oblique_deg, loc.half_extent_m) == (asset_pages.oblique_of(info), asset_pages.half_extent_of(info))
    assert [f.caption for f in b.figures][1] == asset_pages.LOCATOR_CAPTION


def test_snapshot_options_switch_the_photo_and_the_locator_off(handle):
    _seed(handle)
    [b] = finding_pages.compose(_ctx(handle, snapshots=["image"])).blocks
    assert [f.snapshot.spec.kind for f in b.figures] == ["image_crop", "image_crop"]
    [b] = finding_pages.compose(_ctx(handle, snapshots=["cloud"])).blocks
    assert [f.snapshot.spec.kind for f in b.figures] == ["asset_locator"]


def test_the_height_locator_and_the_facts(handle):
    _, _, zone, _ = _seed(handle)
    [b] = finding_pages.compose(_ctx(handle)).blocks
    assert b.asset.height_locator.x_title == "41.2 m"
    kv = dict(b.kv)
    assert b.kv[0][0] == "Severity"
    assert kv["Height"] == "41.2 m above street level"
    assert kv["Zone"] == zone.label
    assert kv["Source photo"] == "DJI_0101.JPG · flight 3"
    assert kv["Side"].startswith("West elevation · ") and "271" in kv["Side"]
    assert b.note == "Open joint."


def test_an_unplaced_finding_has_no_locator_and_says_so(handle):
    crack = add_type(handle, "rust")
    mid, _, _ = add_asset_model(handle)
    a = add_asset_image(handle, name="DJI_0200.JPG")
    add_asset_finding(handle, mid, crack, placement="none", sightings=[{"image_id": a, "placement": "none"}])
    [b] = finding_pages.compose(_ctx(handle)).blocks
    assert [f.snapshot.spec.kind for f in b.figures] == ["image_crop", "image_crop"]
    assert b.asset.height_locator is None and "not placed on the model" in b.asset.kicker
    assert dict(b.kv)["Height"] == asset_pages.NOT_PLACED_TEXT


def test_min_severity_prints_only_the_worse_findings(handle):
    crack, mid, _, a = _seed(handle)  # F-0001, severity 2
    add_asset_finding(handle, mid, crack, severity=1, sightings=[{"image_id": a}])  # F-0002
    add_asset_finding(handle, mid, crack, severity=None, sightings=[{"image_id": a}])  # F-0003
    ctx = _ctx(handle, min_severity=2)
    assert [b.number for b in finding_pages.compose(ctx).blocks] == [1]
    assert finding_pages.outline(ctx).estimated_pages == 1
    assert len(finding_pages.compose(_ctx(handle)).blocks) == 3


def test_image_findings_keep_the_image_page(handle):
    t = add_type(handle, "crack")
    img, _ = add_image(handle)
    add_findings(handle, [{"type_id": t, "anchor": "image", "target": img}])
    [b] = finding_pages.compose(_ctx(handle)).blocks
    assert b.asset is None
```

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_reports_finding_pages_asset.py -q`
Expected: FAIL (`ImportError: cannot import name 'asset_pages'`).

- [ ] **Step 2: `backend/app/reports/sections/asset_pages.py`**

```python
"""An asset finding's page (spec 2026-10-02-asset-findings §10): the kicker; the representative
sighting's photo with its polygon and a close-up (image_crop snapshots); the 3D locator (an
asset_locator snapshot, decision A9); the height locator on the silhouette; the facts in the profile's
`facts` order; the note. Reads one sighting, its box, image and pose; the session closes before any
snapshot is keyed (figures/image.py's pattern)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import PurePosixPath

from sqlalchemy import func, select

from app.db.models import AssetModel, Box, Finding, FindingSighting, Image, ImagePose
from app.reports import blocks
from app.reports.asset_drawing import height_locator
from app.reports.asset_info import PLACED, AssetInfo, representative
from app.reports.context import ComposeContext, FindingRow
from app.reports.figures import image as image_figures
from app.reports.schemas import AssetLocatorSpec, Block, ImageCropSpec

WIDE_CONTEXT = 10.0  # the widest the image_crop spec allows (spec §9.2 bounds)
CLOSE_CONTEXT = 2.0
WIDE_OUT, WIDE_MM = (1200, 900), (120.0, 90.0)
CLOSE_OUT, CLOSE_MM = (800, 600), (83.0, 62.0)
LOCATOR_OUT, LOCATOR_MM = (900, 900), (62.0, 62.0)
LOCATOR_CAPTION = "3D model, focused on this finding. Placement is approximate."
CLOSE_CAPTION = "Close-up"
NOT_PLACED_TEXT = "Not placed on the model"
DEFAULT_FACTS = ("severity", "class", "defect", "height", "zone", "component", "side", "photo", "captured")
MIN_HALF_M = 2.0
FALLBACK_HALF_M = 10.0


@dataclass(frozen=True)
class Rep:
    """The representative sighting and what its page needs, read in one short session."""

    sighting_id: str
    placed_version: int | None
    coverage: float | None
    image_id: str
    image_name: str
    capture_time: datetime | None
    lat: float | None
    lon: float | None
    alt: float | None
    annotation_id: str
    ring: list
    sequence: str | None
    hfov: float | None
    vfov: float | None


def read_rep(ctx: ComposeContext, row: FindingRow) -> Rep | None:
    from app.reports.snapshots.image_crop import ring_of  # lazy: compose must not need PIL/shapely

    with ctx.session() as s:
        sg = representative(s, row.id)
        if sg is None:
            return None
        box = s.get(Box, sg.annotation_id)
        img = s.get(Image, sg.image_id)
        if box is None or img is None:
            return None
        pose = None
        if row.asset_model_id:
            pose = s.execute(
                select(ImagePose).where(ImagePose.image_id == img.id, ImagePose.asset_model_id == row.asset_model_id)
            ).scalar_one_or_none()
        return Rep(
            sighting_id=sg.id,
            placed_version=sg.placed_version,
            coverage=sg.coverage,
            image_id=img.id,
            image_name=img.original_name or PurePosixPath(img.path).name,
            capture_time=img.capture_time,
            lat=img.lat,
            lon=img.lon,
            alt=img.alt,
            annotation_id=box.id,
            ring=ring_of(box.shape, box.x, box.y, box.w, box.h, box.angle, box.points),
            sequence=pose.sequence if pose is not None else None,
            hfov=pose.hfov_deg if pose is not None else None,
            vfov=pose.vfov_deg if pose is not None else None,
        )


def _placed(row: FindingRow) -> bool:
    return row.placement in PLACED and row.height_m is not None


def _photos(n: int) -> str:
    return f"seen in {n} photo" + ("" if n == 1 else "s")


def kicker(row: FindingRow, info: AssetInfo | None) -> str:
    parts = [f"Finding {row.label}"]
    if row.zone:
        parts.append((info.zone_label(row.zone) if info is not None else row.zone) or row.zone)
    if row.side:
        parts.append(row.side)
    if not _placed(row):
        parts.append("not placed on the model")
    parts.append(_photos(max(row.sighting_count, 1)))
    return " · ".join(parts)


def facts_order(info: AssetInfo | None) -> tuple[str, ...]:
    """The resolved review's `facts` (P1 copies the profile's list onto `asset_model.review`)."""
    facts = info.review.facts if info is not None and info.review is not None else None
    return tuple(facts) if facts else DEFAULT_FACTS


def half_extent_of(info: AssetInfo | None) -> float:
    """Half the locator's frame in metres: the tighter end of the review's `focus.frustum` (P1: a
    `(min, max)` pair of half-height fractions of the asset height, kit convention); never under 2 m."""
    if info is None or info.frame is None or info.review is None:
        return FALLBACK_HALF_M
    frac = float(info.review.focus.frustum[0])
    return round(max(MIN_HALF_M, frac * float(info.frame.height_m)), 3)


def oblique_of(info: AssetInfo | None) -> float:
    raw = info.review.focus.oblique_deg if info is not None and info.review is not None else 0.0
    return round(max(-89.0, min(89.0, float(raw))), 3)


def _captured(t: datetime) -> str:
    return f"{blocks.fmt_date(t)}, {t:%H:%M}"


def asset_facts(row: FindingRow, info: AssetInfo | None, rep: Rep | None) -> list[tuple[str, str]]:
    basis = info.review.sides.basis if info is not None and info.review is not None else None
    datum = info.frame.datum_label if info is not None and info.frame is not None and info.frame.datum_label else "ground"
    out: list[tuple[str, str]] = []
    for key in facts_order(info):
        if key == "severity":
            out.append(("Severity", f"{row.severity} · {row.severity_name}" if row.severity is not None else row.severity_name))
        elif key == "class":
            out.append(("Type", row.type_name))
        elif key == "defect":
            out.append(("Finding", f"{row.label} · {_photos(max(row.sighting_count, 1))}"))
        elif key == "height":
            out.append(("Height", f"{row.height_m:.1f} m above {datum}" if _placed(row) else NOT_PLACED_TEXT))
        elif key == "zone" and row.zone:
            out.append(("Zone", (info.zone_label(row.zone) if info is not None else row.zone) or row.zone))
        elif key == "component" and row.component:
            out.append(("Component", row.component))
        elif key == "side":
            if row.side and row.bearing_deg is not None:
                tail = f"faces {row.bearing_deg:.0f}°" if basis == "normal" else f"{row.bearing_deg:.0f}° bearing"
                out.append(("Side", f"{row.side} · {tail}"))
            else:
                out.append(("Side", NOT_PLACED_TEXT))
        elif key == "coverage" and rep is not None and rep.coverage is not None:
            out.append(("Marked area", f"{rep.coverage * 100:.2f}% of photo pixels"))
        elif key == "photo" and rep is not None:
            out.append(("Source photo", rep.image_name + (f" · flight {rep.sequence}" if rep.sequence else "")))
        elif key == "captured" and rep is not None and rep.capture_time is not None:
            out.append(("Captured", _captured(rep.capture_time)))
        elif key == "position" and rep is not None and rep.lat is not None and rep.lon is not None:
            alt = f" · {rep.alt:.1f} m GPS" if rep.alt is not None else ""
            out.append(("Drone position", f"{rep.lat:.6f}, {rep.lon:.6f}{alt}"))
        elif key == "camera" and rep is not None and rep.hfov is not None and rep.vfov is not None:
            out.append(("Camera", f"{rep.hfov:.1f}° × {rep.vfov:.1f}° field of view"))
        elif key == "confidence" and row.confidence is not None:
            out.append(("Confidence", f"{row.confidence:.0%}"))
    return out


def _crop(ctx: ComposeContext, row: FindingRow, rep: Rep, context: float, out, mm, caption: str):
    spec = ImageCropSpec(
        kind="image_crop",
        image_id=rep.image_id,
        annotation_id=rep.annotation_id,
        ring=rep.ring,
        colour=row.severity_colour,
        label=f"{row.label} · {row.type_name}",
        context=context,
        out=list(out),
        inset=False,
    )
    return blocks.figure(ctx.ref(spec, width_px=out[0], height_px=out[1]), caption, mm[0], mm[1])


def _normal(row: FindingRow) -> list[float]:
    if row.an_x is not None and row.an_y is not None and row.an_z is not None:
        return [round(row.an_x, 4), round(row.an_y, 4), round(row.an_z, 4)]
    h = (row.ax or 0.0, row.az or 0.0)  # no normal: look at the point from outside the axis
    return [1.0, 0.0, 0.0] if h == (0.0, 0.0) else [round(h[0], 4), 0.0, round(h[1], 4)]


def _locator(ctx: ComposeContext, row: FindingRow, info: AssetInfo | None, rep: Rep | None):
    if not _placed(row) or row.ax is None or row.ay is None or row.az is None or not row.asset_model_id:
        return None
    version = (rep.placed_version if rep is not None else None) or row.asset_version or (info.current_version if info else None)
    if not version:
        return None
    mark = "patch" if row.placement == "patch" else "pin"
    spec = AssetLocatorSpec(
        kind="asset_locator",
        asset_model_id=row.asset_model_id,
        version=int(version),
        sighting_id=rep.sighting_id if mark == "patch" and rep is not None else None,
        mark=mark,
        center=[round(row.ax, 3), round(row.ay, 3), round(row.az, 3)],
        normal=_normal(row),
        half_extent_m=half_extent_of(info),
        oblique_deg=oblique_of(info),
        colour=row.severity_colour,
        out=list(LOCATOR_OUT),
    )
    ref = ctx.ref(spec, width_px=LOCATOR_OUT[0], height_px=LOCATOR_OUT[1])
    return blocks.figure(ref, LOCATOR_CAPTION, *LOCATOR_MM)


def asset_finding_block(ctx: ComposeContext, row: FindingRow) -> Block:
    opts = ctx.options("finding_pages")
    kinds = {str(k) for k in opts.snapshots}
    info = ctx.asset_models.get(row.asset_model_id) if row.asset_model_id else None
    rep = read_rep(ctx, row)
    wide = close = None
    if "image" in kinds and rep is not None:
        wide = _crop(ctx, row, rep, WIDE_CONTEXT, WIDE_OUT, WIDE_MM, f"Source photograph {rep.image_name}")
        close = _crop(ctx, row, rep, CLOSE_CONTEXT, CLOSE_OUT, CLOSE_MM, CLOSE_CAPTION)
    locator = _locator(ctx, row, info, rep) if "cloud" in kinds else None
    figures = [f for f in (wide, locator, close) if f is not None]
    loc = None
    if _placed(row) and info is not None and info.frame is not None:
        loc = height_locator(
            info.frame.height_m, info.frame.silhouette, info.frame.levels, row.height_m, row.severity_colour
        )
    photos = image_figures.photos(ctx, row, opts.photos_max) if opts.photos_max > 0 else []
    comments = image_figures.comments(ctx, row, str(opts.comments)) if str(opts.comments) != "none" else []
    return blocks.finding(
        row,
        figures=figures,
        kv_rows=asset_facts(row, info, rep),
        photos=photos,
        comments=comments,
        asset={"kicker": kicker(row, info), "height_locator": loc},
    )


def fingerprint(ctx: ComposeContext) -> str:
    """Sightings, frames and poses change no finding row; their latest change joins the etag."""
    ids = select(Finding.id).where(ctx.where, Finding.anchor_kind == "asset")
    with ctx.session() as s:
        n, last = s.execute(
            select(func.count(), func.max(FindingSighting.created_at)).where(FindingSighting.finding_id.in_(ids))
        ).one()
        models = s.execute(select(func.max(AssetModel.updated_at))).scalar()
        poses = s.execute(select(func.max(ImagePose.updated_at))).scalar()
    stamp = [v.isoformat() if v is not None else "" for v in (last, models, poses)]
    return f"asset:{n}:{':'.join(stamp)}"
```

- [ ] **Step 3: `finding_pages.py` dispatches asset findings and honours `min_severity`**

Add `from app.reports.sections import asset_pages` to the imports. Add above `finding_block`:

```python
def min_where(ctx: ComposeContext):
    """`min_severity` (spec 2026-10-02-asset-findings §10): pages only for severity >= n; ungraded
    findings are left out while it is set. The findings table still lists every finding."""
    m = getattr(ctx.options(KEY), "min_severity", None)
    return None if m is None else Finding.severity >= int(m)
```

At the top of `finding_block` add:

```python
    if row.anchor_kind == "asset":
        return asset_pages.asset_finding_block(ctx, row)
```

In `page`, change the read to `rows, nxt = findings_page(ctx, "number", cursor, limit, where=min_where(ctx))`. In `outline`, change the count to `n = count_findings(ctx, where=min_where(ctx))`. In `fingerprint`, change the return to:

```python
    return f"{tuple(com)}|{tuple(att)}|{'|'.join(extra)}|{asset_pages.fingerprint(ctx)}"
```

- [ ] **Step 4: Run**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_reports_finding_pages_asset.py tests/test_reports_finding_pages.py tests/test_reports_finding_pages_image.py tests/test_reports_finding_pages_cloud.py tests/test_reports_preview_staleness.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/reports/sections/asset_pages.py backend/app/reports/sections/finding_pages.py backend/tests/test_reports_finding_pages_asset.py
git commit -m @'
feat(reports): asset finding pages with kicker, 3D locator, height locator and facts; min_severity

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 8: The PDF draws the asset blocks; no dash and no unembedded font reaches the page

**Files:**
- Create: `backend/app/reports/pdf/active.py`
- Create: `backend/app/reports/pdf/asset_flowables.py`
- Modify: `backend/app/reports/pdf/flowables_text.py` (`undash`)
- Modify: `backend/app/reports/pdf/flowables.py` (`asset_map` handler, the asset finding page, chart labels)
- Modify: `backend/app/reports/pdf/styles.py` (`colour` reads the active theme)
- Modify: `backend/app/reports/pdf/charts.py` (`initialFontName`, palette from the active theme)
- Modify: `backend/app/reports/pdf/primitives.py` (placeholder and severity tag text)
- Modify: `backend/app/reports/pdf/canvas.py` (header and footer text)
- Modify: `backend/app/reports/pdf/document.py` (`render_pdf` builds inside the active theme, one build at a time)
- Test: `backend/tests/test_reports_no_dashes.py`, `backend/tests/test_reports_pdf_asset.py`
- Modify (Step 2, the source dash sweep): every file `rg` lists under `backend/app/reports/` and `frontend/src/reports/`, and the ten report tests named in Step 2

**Interfaces:**
- Consumes: Task 1 schemas (`AssetMapBlock`, `FindingAsset`, `AssetDrawing`); Task 3 `height_locator`.
- Produces:
  - `app.reports.pdf.flowables_text.undash(s: str) -> str`: a lone dash is `-`, `" – "` reads `" to "`, `" — "` reads `", "`, any other em dash `", "`, any other en dash `-` (the kit's `clean`). `text()` applies it before escaping.
  - `app.reports.pdf.active.theme() -> dict`; `active.using(theme: dict, font: str)` (a context manager: the theme `colour()` reads, and reportlab's default table cell font, for one build).
  - `app.reports.pdf.asset_flowables.drawing_flowable(d: AssetDrawing, width: float, styles) -> Drawing`; `asset_map_flowables(block, ctx) -> list`.
  - `flowables.HANDLERS["asset_map"]`; an asset finding page prints the kicker above the band and the facts beside an 18 mm height locator.
  - `document.render_pdf(...)` unchanged in signature; it serialises builds (`_BUILD_LOCK`) and restores the theme afterwards.

- [ ] **Step 1: Write the failing source test (coordinator ruling: the preview is UI, so no dash in the source either)**

Create `backend/tests/test_reports_no_dashes.py`:

```python
"""No em or en dash in report code (index Global Constraints, coordinator ruling for R1): the preview
is UI copy, so the source strings are fixed, not only the PDF text. Comments are covered too; they
can always be reworded. Code that must name the characters (`undash` and its tests) writes them as
the escapes \u2014 and \u2013, never literally."""

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
TREES = [ROOT / "backend" / "app" / "reports", ROOT / "frontend" / "src" / "reports"]
SUFFIXES = {".py", ".ts", ".tsx", ".css", ".json", ".md"}
DASHES = ("\u2014", "\u2013")


def _files():
    for tree in TREES:
        for path in sorted(tree.rglob("*")):
            if path.is_file() and path.suffix in SUFFIXES:
                yield path


@pytest.mark.parametrize("path", list(_files()), ids=lambda p: str(p.relative_to(ROOT)))
def test_no_em_or_en_dash_in_report_source(path):
    bad = [
        f"{n}: {line.strip()}"
        for n, line in enumerate(path.read_text("utf-8").splitlines(), 1)
        if any(d in line for d in DASHES)
    ]
    assert bad == [], bad
```

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_reports_no_dashes.py -q`
Expected: FAIL, listing about 46 lines in about 30 files (counted 2026-10-03 over both trees), plus any that Tasks 1 to 7 added.

- [ ] **Step 2: Fix every source string**

List them with `rg -n "[—–]" backend/app/reports frontend/src/reports`. Apply one rule per kind of use:
- **A missing value shown alone** (`blocks.fmt_date(None)`, `blocks.fmt_lat_lon`, `row.data_label or ...` in `finding_pages.py`, the bare returns in `appendix.py`, `measure_rows.py`, `survey_counts.py`, `volume_block.py`, `cover.period`, and any preview fallback): print `"-"`. Backend sites use one constant, `blocks.NONE = "-"` (added in Task 4); the preview uses the literal `"-"`.
- **A range** (`cover.period`, `f"{a} – {b}"`): `f"{a} to {b}"`.
- **A heading joining two parts** (`object_counts.py`: "Per survey — {unit}", "Per site area — {label}", "Photo batches — detections"): a colon, `"Per survey: {unit}"`, `"Per site area: {label}"`, `"Photo batches: detections"`.
- **A caption joining a label and a reason** (`survey_pairs.py`, `f"{_label(m)} — {NO_COMMON}"`): `f"{_label(m)}: {NO_COMMON}"`.
- **A comment or docstring**: reword with a comma, a colon or parentheses.
- `flowables_text.undash` (Step 4) and `test_reports_pdf_asset.py` (Step 3) name the characters as `\u2014` and `\u2013` only, as written below.

Then update the tests that pinned the old text (one or two literals each): `tests/reports_cloud_rows.py`, `tests/test_reports_appendix.py`, `tests/test_reports_context.py`, `tests/test_reports_cover.py`, `tests/test_reports_m_counts.py`, `tests/test_reports_m_measure_rows.py`, `tests/test_reports_m_object_counts.py`, `tests/test_reports_m_pairs.py`, `tests/test_reports_m_volume_block.py`, `tests/test_reports_writers.py`, and any `frontend/src/reports/**/*.test.tsx` the `rg` lists. A missing value becomes `"-"`, a range `"to"`, a heading the colon form.

Run:

```powershell
& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests -q -k "report"
pnpm -C frontend exec vitest run src/reports
```

Expected: PASS, `test_reports_no_dashes.py` included. Commit this step on its own (check `git status --short` first and stage only these paths):

```powershell
git add backend/tests/test_reports_no_dashes.py backend/app/reports frontend/src/reports backend/tests/reports_cloud_rows.py backend/tests/test_reports_appendix.py backend/tests/test_reports_context.py backend/tests/test_reports_cover.py backend/tests/test_reports_m_counts.py backend/tests/test_reports_m_measure_rows.py backend/tests/test_reports_m_object_counts.py backend/tests/test_reports_m_pairs.py backend/tests/test_reports_m_volume_block.py backend/tests/test_reports_writers.py
git commit -m @'
fix(reports): no em or en dash in report source or preview copy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

- [ ] **Step 3: Write the failing PDF tests**

Create `backend/tests/test_reports_pdf_asset.py`:

```python
"""The asset blocks in the PDF (spec 2026-10-02-asset-findings §10) and the kit's text rules: no em or
en dash in the page text, every font an embedded subset."""

import re

from report_docs import Snapshots, document, finding, section, standard_doc
from report_pdf_helpers import pdf_pages_text

from app.reports.asset_drawing import height_locator
from app.reports.pdf import active
from app.reports.pdf import document as pdf_document
from app.reports.pdf.flowables_text import text, undash
from app.reports.theme import THEME

MAP_BLOCK = {
    "kind": "asset_map",
    "title": "Tower A",
    "caption": "Each dot is one finding at its height and side of the asset.",
    "width_mm": 174,
    "height_mm": 92,
    "drawing": {
        "width": 760,
        "height": 400,
        "font_size": 11,
        "plot": {"x0": 110, "y0": 10, "x1": 622, "y1": 362},
        "silhouette": [[20, 362], [24, 10], [40, 10], [44, 362]],
        "bands": [
            {"y0": 10, "y1": 120, "label": "Upper floors", "shaded": True},
            {"y0": 120, "y1": 362, "label": "Lower floors", "shaded": False},
        ],
        "levels": [{"x0": 18, "x1": 46, "y": 200}],
        "x_ticks": [{"at": 110, "label": "N"}, {"at": 238, "label": "E"}],
        "y_ticks": [{"at": 362, "label": "0 m"}, {"at": 10, "label": "60 m"}],
        "x_title": "Side of the asset",
        "dots": [{"x": 300, "y": 90, "r": 5.5, "colour": "#FF7A2D", "label": "F-0042"}],
        "marker": None,
    },
}


def _render(tmp_path, doc, name="out"):
    return pdf_document.render_pdf(
        doc,
        tmp_path / name,
        "asset-report-v001",
        snapshot_path=Snapshots(tmp_path / "snaps"),
        volume_flowables=None,
        progress=lambda f: None,
        check_cancelled=lambda: None,
    )


def asset_finding(n: int = 7, note: str = "Open joint.") -> dict:
    f = finding(n, note=note, photos=0, comments=0)
    f["kv"] = [["Height", "41.2 m above street level"], ["Zone", "Upper floors"]]
    f["asset"] = {
        "kicker": f"Finding F-{n:04d} · Upper floors · seen in 2 photos",
        "height_locator": height_locator(60.0, [(0.0, 6.0), (60.0, 4.0)], [20.0], 41.2, "#FF7A2D"),
    }
    return f


def test_undash_follows_the_kit():
    assert undash("\u2014") == "-" and undash(" \u2013 ") == "-"
    assert undash("1 Sep 2026 \u2013 3 Sep 2026") == "1 Sep 2026 to 3 Sep 2026"
    assert undash("Per survey \u2014 counts") == "Per survey, counts"
    assert undash("a\u2014b") == "a, b" and undash("x\u2013y") == "x-y"
    assert undash("Crack · F-0001") == "Crack · F-0001"


def test_text_undashes_before_escaping():
    assert text("a \u2014 <b>") == "a, &lt;b&gt;"


def test_an_asset_map_prints_as_vectors_with_its_labels(tmp_path):
    [part] = _render(tmp_path, document([section("asset_summary", "Asset summary", [MAP_BLOCK])]))
    page = pdf_pages_text(part.path)[0]
    for label in ("Tower A", "Upper floors", "Side of the asset", "60 m", MAP_BLOCK["caption"]):
        assert label in page, label
    assert b"/Subtype /Image" not in part.path.read_bytes()  # vector, no raster


def test_an_asset_finding_prints_its_kicker_and_facts_beside_the_height_locator(tmp_path):
    [part] = _render(tmp_path, document([section("finding_pages", "Finding pages", [asset_finding()])]))
    page = pdf_pages_text(part.path)[0]
    assert "Finding F-0007 · Upper floors · seen in 2 photos" in page
    assert "41.2 m above street level" in page and "41.2 m" in page


def test_no_em_or_en_dash_reaches_the_page_text(tmp_path):
    table = {
        "kind": "table",
        "columns": [{"key": "a", "label": "Data item"}, {"key": "b", "label": "Period"}],
        "rows": [["\u2014", "1 Sep 2026 \u2013 3 Sep 2026"]],
    }
    doc = document(
        [
            section("findings_table", "Findings \u2014 all", [table]),
            section("finding_pages", "Finding pages", [asset_finding(note="Crack \u2014 wide \u2013 long")]),
        ]
    )
    [part] = _render(tmp_path, doc)
    joined = "".join(pdf_pages_text(part.path))
    assert not re.search("[\u2013\u2014]", joined)
    assert "1 Sep 2026 to 3 Sep 2026" in joined and "Crack, wide to long" in joined


def test_every_font_is_an_embedded_subset(tmp_path):
    [part] = _render(tmp_path, standard_doc())  # tables, a chart, KPIs, findings
    names = re.findall(rb"/BaseFont /([\w+-]+)", part.path.read_bytes())
    assert names and all(b"+" in n for n in names), names


def test_the_theme_is_restored_after_a_render(tmp_path):
    _render(tmp_path, standard_doc())
    assert active.theme() is THEME
```


Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_reports_pdf_asset.py -q`
Expected: FAIL (`ImportError: cannot import name 'undash'`).

- [ ] **Step 4: `undash` in `backend/app/reports/pdf/flowables_text.py`**

```python
_LONE_DASH = ("\u2014", "\u2013")


def undash(value: str) -> str:
    """The kit's house rule for PDF text (gen.py `clean`): no em or en dash. A lone dash (an empty
    cell) prints as a hyphen, a spaced en dash (a range) as "to", an em dash as a comma."""
    s = str(value)
    if s.strip() in _LONE_DASH:
        return "-"
    return (
        s.replace(" \u2013 ", " to ")
        .replace(" \u2014 ", ", ")
        .replace("\u2014", ", ")
        .replace("\u2013", "-")
    )


def text(value: object, limit: int | None = None) -> str:
    """Control characters dropped, dashes undone, XML escaped, newlines kept as <br/>, optionally cut
    with an ellipsis."""
    s = undash(_CONTROL.sub("", "" if value is None else str(value)))
    if limit is not None and len(s) > limit:
        s = s[: limit - 1] + "…"
    return escape(s).replace("\n", "<br/>")
```

- [ ] **Step 5: `backend/app/reports/pdf/active.py`**

```python
"""The theme one PDF build draws with (spec 2026-10-02-asset-findings §10): THEME, or a brand overlay
of it (D2's `with_brand`). `styles.colour` and the cover band read it, so no style call needs a theme
argument. `using` also points reportlab's default table cell font at the report's sans: a plain-string
cell otherwise references Helvetica, an unembedded standard font (the kit's "fonts embedded" rule).
document.render_pdf holds a lock around `using`, because the cell font is a process-wide default."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

from reportlab.platypus import tables

from app.reports.theme import THEME

_THEME: ContextVar[dict] = ContextVar("report_pdf_theme", default=THEME)


def theme() -> dict:
    return _THEME.get()


@contextmanager
def using(theme_dict: dict, font: str) -> Iterator[None]:
    token = _THEME.set(theme_dict)
    old_font = tables.CellStyle.fontname
    tables.CellStyle.fontname = font
    try:
        yield
    finally:
        tables.CellStyle.fontname = old_font
        _THEME.reset(token)
```

- [ ] **Step 6: The style, chart, primitive and canvas reads**

- `styles.py`: `from app.reports.pdf import active`; `colour` becomes `return colors.HexColor(active.theme()["colours"][name])`.
- `charts.py`: `from app.reports.pdf import active`; after `d = Drawing(width, height)` add `d.initialFontName = font`; `_series_colour` becomes:
  ```python
  def _series_colour(s: ChartSeries, i: int):
      palette = active.theme()["chart"]["palette"]
      return safe_colour(s.colour, "violet") if s.colour else safe_colour(palette[i % len(palette)])
  ```
  (`PALETTE` stays for importers.)
- `primitives.py`: `from app.reports.pdf.flowables_text import text, undash`; in `Placeholder.draw`, `simpleSplit(undash(self.reason), ...)`; in `SeverityTag.__init__`, `self.label = undash(label)`.
- `canvas.py`: `from app.reports.pdf.flowables_text import undash`; in `_furniture` wrap the header string `undash(override or meta.title)` (inside `fit_width`) and the footer string `undash(f"{who} · page {local + meta.page_offset} / {total}")`.
- `flowables.py`, `_chart`: the series names, the x labels and the unit go through `undash` (`charts.ChartSeries(undash(str(s.name)), ...)`, `[undash(str(x)) for x in block.x_labels]`, `undash(block.unit or "")`).

- [ ] **Step 7: `backend/app/reports/pdf/asset_flowables.py`**

```python
"""AssetDrawing primitives as reportlab vector drawings (spec 2026-10-02-asset-findings §10). The
order and every offset equal frontend/src/reports/preview/blocks/AssetDrawingSvg.tsx, so the preview
matches the PDF. Drawing units are y down; the PDF is y up, so y flips once, in `Y`."""

from __future__ import annotations

from typing import Any

from reportlab.graphics.shapes import Circle, Drawing, Line, Polygon, Rect, String
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, Spacer

from app.reports.pdf.flowables_text import text, undash
from app.reports.pdf.styles import Styles, colour, safe_colour


def drawing_flowable(d: Any, width: float, styles: Styles) -> Drawing:
    s = width / float(d.width)
    h = float(d.height) * s
    out = Drawing(width, h)
    out.initialFontName = styles.fonts.sans
    font, fs, p = styles.fonts.sans, float(d.font_size), d.plot
    ink, muted, rule = colour("ink"), colour("muted"), colour("rule")
    head, paper, fill = colour("head_fill"), colour("paper"), colour("placeholder_fill")

    def X(x: float) -> float:  # noqa: N802 - the SVG twin's names
        return float(x) * s

    def Y(y: float) -> float:  # noqa: N802
        return h - float(y) * s

    def label(x: float, y: float, value: str, size: float, fill_colour, anchor: str = "start") -> None:
        out.add(String(X(x), Y(y), undash(value), fontName=font, fontSize=size * s, fillColor=fill_colour, textAnchor=anchor))

    for b in d.bands:
        out.add(Rect(X(p.x0), Y(b.y1), (p.x1 - p.x0) * s, (b.y1 - b.y0) * s, fillColor=head if b.shaded else paper, strokeColor=None))
        label(p.x1 + fs * 0.8, (b.y0 + b.y1) / 2 + fs * 0.35, b.label, fs * 0.9, ink)
    for t in d.y_ticks:
        out.add(Line(X(p.x0), Y(t.at), X(p.x1), Y(t.at), strokeColor=rule, strokeWidth=0.5 * s))
        label(p.x0 - fs * 0.6, t.at + fs * 0.35, t.label, fs * 0.85, muted, "end")
    for t in d.x_ticks:
        out.add(Line(X(t.at), Y(p.y0), X(t.at), Y(p.y1), strokeColor=rule, strokeWidth=0.5 * s, strokeDashArray=[2 * s, 4 * s]))
        label(t.at, p.y1 + fs * 1.3, t.label, fs * 0.9, ink, "middle")
    if len(d.silhouette) > 2:
        pts = [v for x, y in d.silhouette for v in (X(x), Y(y))]
        out.add(Polygon(pts, fillColor=fill, strokeColor=muted, strokeWidth=0.6 * s))
    for lv in d.levels:
        out.add(Line(X(lv.x0), Y(lv.y), X(lv.x1), Y(lv.y), strokeColor=muted, strokeWidth=0.5 * s))
    if d.marker is not None:
        m = d.marker
        out.add(Line(X(m.x0), Y(m.y), X(m.x1), Y(m.y), strokeColor=safe_colour(m.colour), strokeWidth=1.4 * s))
    for dot in d.dots:
        out.add(Circle(X(dot.x), Y(dot.y), dot.r * s, fillColor=safe_colour(dot.colour), strokeColor=paper, strokeWidth=dot.r * 0.25 * s))
    if d.x_title:
        label((p.x0 + p.x1) / 2, d.height - fs * 0.3, d.x_title, fs * 0.85, muted, "middle")
    return out


def asset_map_flowables(block: Any, ctx: Any) -> list:
    st = ctx.styles
    out: list = [Paragraph(text(block.title), st.h3)] if block.title else []
    out.append(drawing_flowable(block.drawing, min(block.width_mm * mm, ctx.frame_width), st))
    if block.caption:
        out.append(Paragraph(text(block.caption), st.caption))
    return [*out, Spacer(1, 4 * mm)]
```

- [ ] **Step 8: `flowables.py` prints the map and the asset finding page**

Add `from app.reports.pdf.asset_flowables import asset_map_flowables, drawing_flowable` and `LOCATOR_W = 18 * mm` at the top. Add:

```python
def _facts_with_locator(block: Any, drawing: Any, ctx: RenderContext) -> Table:
    """An asset finding's facts beside its height locator (the kit's finding page row)."""
    st, fw = ctx.styles, ctx.frame_width
    inner = fw - LOCATOR_W - 4 * mm
    rows = [
        [Paragraph(text(r[0], MAX_CELL_CHARS), st.cell_label), Paragraph(text(r[1], MAX_CELL_CHARS), st.cell)]
        for r in block.kv
    ] or [["", ""]]
    kv = Table(rows, colWidths=[inner * 0.34, inner * 0.66], hAlign="LEFT", splitInRow=1)
    kv.setStyle(table_style(header=False))
    t = Table([[drawing_flowable(drawing, LOCATOR_W, st), kv]], colWidths=[LOCATOR_W + 4 * mm, inner], hAlign="LEFT")
    t.setStyle(TableStyle(_NO_PAD))
    return t
```

In `_finding`, replace the first two body lines and the kv line:

```python
    asset = getattr(block, "asset", None)
    body: list = []
    if asset is not None and asset.kicker:
        body.append(_keep_with_next(Paragraph(text(asset.kicker), st.small)))
    body += [_finding_band(block, ctx), Spacer(1, 3 * mm)]
    if figs:
        body += _figure(figs[0], ctx)
    body += _figure_grid(figs[1:], ctx, 2)
    if asset is not None and asset.height_locator is not None:
        body += [Spacer(1, 3 * mm), _facts_with_locator(block, asset.height_locator, ctx), Spacer(1, 3 * mm)]
    else:
        body += [Spacer(1, 3 * mm), *kv_table(block.kv, ctx)]
```

and register the map: `HANDLERS["asset_map"] = asset_map_flowables`.

- [ ] **Step 9: `document.py` builds inside the active theme**

Add `import threading`, `from app.reports.pdf import active`, and rename today's `render_pdf` body to `_render_parts` with a `styles` parameter in place of its first line:

```python
_BUILD_LOCK = threading.Lock()  # reportlab's font registry and default cell font are process-wide


def render_pdf(
    doc: ReportDocument,
    out_dir: Path,
    base_name: str,
    *,
    snapshot_path: Callable[[SnapshotRef], Path],
    volume_flowables: Callable[[VolumeBlock], list] | None,
    progress: Callable[[float], None],
    check_cancelled: Callable[[], None],
    part_budget: int = PART_BUDGET,
) -> list[PdfPart]:
    with _BUILD_LOCK:
        fonts = register_fonts()
        with active.using(THEME, fonts.sans):
            return _render_parts(
                doc,
                out_dir,
                base_name,
                styles=build_styles(fonts),
                snapshot_path=snapshot_path,
                volume_flowables=volume_flowables,
                progress=progress,
                check_cancelled=check_cancelled,
                part_budget=part_budget,
            )


def _render_parts(
    doc, out_dir, base_name, *, styles, snapshot_path, volume_flowables, progress, check_cancelled, part_budget
) -> list[PdfPart]:
    meta = doc_meta(doc)
    # ... the rest of today's render_pdf body, unchanged from `sizes: dict[str, int] = {}` on
```

- [ ] **Step 10: Run the PDF suite**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_reports_pdf_asset.py tests/test_reports_pdf_document.py tests/test_reports_pdf_flowables.py tests/test_reports_pdf_finding.py tests/test_reports_pdf_parts.py tests/test_reports_pdf_primitives.py tests/test_reports_pdf_charts.py tests/test_reports_pdf_canvas.py tests/test_reports_pdf_styles.py tests/test_reports_fonts.py -q`
Expected: PASS. After Step 2 no report source prints a dash; `undash` stays as the safety net for user text (notes, titles, type names).

- [ ] **Step 11: Commit**

```powershell
git add backend/app/reports/pdf/active.py backend/app/reports/pdf/asset_flowables.py backend/app/reports/pdf/flowables_text.py backend/app/reports/pdf/flowables.py backend/app/reports/pdf/styles.py backend/app/reports/pdf/charts.py backend/app/reports/pdf/primitives.py backend/app/reports/pdf/canvas.py backend/app/reports/pdf/document.py backend/tests/test_reports_pdf_asset.py
git commit -m @'
feat(reports): asset map and asset finding page in the PDF; no dashes, every font embedded

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 9: Resolve the report brand

**Files:**
- Create: `backend/app/reports/brand.py`
- Modify: `backend/app/reports/outline.py` (the `brand_missing` warning)
- Test: `backend/tests/test_reports_brand.py`

**Interfaces:**
- Consumes: D2 `app.brands.store.get_brand(cat, brand_id) -> BrandRow | None`, `logo_path(cat, logo_id) -> Path | None`, `confidentiality_line(brand, year, customer) -> str`, `set_logo` (tests), `LOGO_DIR`; `app.brands.builtins.BUILTIN_EAND`; `app.reports.theme.with_brand(theme, brand) -> dict` (fonts `{sans, mono, numerals}` when branded).
- Produces:
  - `app.reports.brand.ResolvedBrand(id, name, theme, text_family, numerals_family, cover_logo, header_logo, footer_left, footer_right, author)` (frozen)
  - `resolve_brand(handle, config, generated_at) -> ResolvedBrand | None` (never raises; None for no `brand_id`, an unknown brand, or an unreadable catalogue)
  - `BRAND_MISSING` (warning text); the outline warns `brand_missing` when `brand_id` is set but does not resolve.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_reports_brand.py`:

```python
"""The report brand (spec 2026-10-02-asset-findings §5.8, §10), resolved through D2."""

from PIL import Image
from reports_rows import GEN, config

from app.brands import store
from app.brands.builtins import BUILTIN_EAND
from app.reports.brand import resolve_brand
from app.reports.outline import build_outline
from app.reports.theme import THEME, with_brand


def _cfg(brand_id=BUILTIN_EAND):
    cfg = config(sections=("cover",), cover={"client": "Client X"})
    return cfg.model_copy(update={"brand_id": brand_id})


def test_no_brand_id_is_no_brand(handle):
    assert resolve_brand(handle, config(), GEN) is None


def test_an_unknown_brand_is_no_brand(handle):
    assert resolve_brand(handle, _cfg("no-such-brand"), GEN) is None


def test_a_builtin_brand_resolves_through_d2(handle):
    b = resolve_brand(handle, _cfg(), GEN)
    row = store.get_brand(handle.catalogue, BUILTIN_EAND)
    assert (b.id, b.name) == (row.id, row.name)
    assert b.theme == with_brand(THEME, row)
    assert b.footer_left == store.confidentiality_line(row, GEN.year, "Client X")
    assert b.footer_right == row.website
    assert b.text_family == b.theme["fonts"]["sans"]
    assert b.numerals_family == b.theme["fonts"].get("numerals", b.text_family)
    assert b.author == (row.pdf_author or row.owner)
    assert b.cover_logo is None and b.header_logo is None


def test_logos_resolve_to_the_app_level_files(handle, tmp_path):
    png = tmp_path / "logo.png"
    Image.new("RGBA", (200, 80), (200, 0, 0, 255)).save(png)
    store.set_logo(handle.catalogue, BUILTIN_EAND, "on_dark", str(png))
    store.set_logo(handle.catalogue, BUILTIN_EAND, "flat", str(png))
    b = resolve_brand(handle, _cfg(), GEN)
    assert b.cover_logo.is_file() and b.cover_logo.parent.name == store.LOGO_DIR
    assert b.header_logo.is_file()


def test_the_outline_warns_when_the_brand_is_gone(handle):
    out = build_outline(handle, "r-test", _cfg("no-such-brand"), generated_at=GEN)
    assert "brand_missing" in [w.code for w in out.warnings]
    out = build_outline(handle, "r-test", _cfg(), generated_at=GEN)
    assert "brand_missing" not in [w.code for w in out.warnings]
```

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_reports_brand.py -q`
Expected: FAIL (`ModuleNotFoundError: app.reports.brand`).

- [ ] **Step 2: `backend/app/reports/brand.py`**

```python
"""The report brand (spec 2026-10-02-asset-findings §5.8, §10): `config.brand_id` resolved once per
render or outline into the theme overlay, the two font families, the logo files and the footer text.
No PDF library here (routers import it). A brand that cannot be read costs the brand, never the
report: the caller prints in the Kestrel theme and warns `brand_missing`."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from app.brands.store import confidentiality_line, get_brand, logo_path
from app.reports.theme import THEME, with_brand

log = logging.getLogger(__name__)
BRAND_MISSING = "The report brand could not be found, so the report prints in the Kestrel theme."


@dataclass(frozen=True)
class ResolvedBrand:
    id: str
    name: str
    theme: dict
    text_family: str
    numerals_family: str
    cover_logo: Path | None  # on_dark, bottom left of the cover band
    header_logo: Path | None  # flat (no alpha), else on_light, in the running header
    footer_left: str  # the confidentiality line, {year} and {customer} filled
    footer_right: str  # the website
    author: str


def resolve_brand(handle, config, generated_at: datetime) -> ResolvedBrand | None:
    brand_id = getattr(config, "brand_id", None)
    if not brand_id:
        return None
    cat = getattr(handle, "catalogue", None)
    try:
        row = get_brand(cat, brand_id)
        if row is None:
            return None
        theme = with_brand(THEME, row)
        cover = logo_path(cat, row.logo_on_dark)
        header = logo_path(cat, row.logo_flat) or logo_path(cat, row.logo_on_light)
        footer = confidentiality_line(row, generated_at.year, config.cover.client)
    except Exception:
        log.exception("brand %s could not be read; the report prints in the Kestrel theme", brand_id)
        return None
    fonts = theme["fonts"]
    return ResolvedBrand(
        id=row.id,
        name=row.name,
        theme=theme,
        text_family=fonts["sans"],
        numerals_family=fonts.get("numerals", fonts["sans"]),
        cover_logo=cover,
        header_logo=header,
        footer_left=footer,
        footer_right=row.website or "",
        author=row.pdf_author or row.owner or "Kestrel AI",
    )
```

- [ ] **Step 3: The outline warns**

In `backend/app/reports/outline.py` `build_outline`, after `_warn_common(ctx, n)`, add:

```python
    if getattr(config, "brand_id", None):
        from app.reports.brand import BRAND_MISSING, resolve_brand

        if resolve_brand(handle, config, generated_at) is None:
            ctx.warn("brand_missing", BRAND_MISSING)
```

- [ ] **Step 4: Run**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_reports_brand.py tests/test_reports_outline_api.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/reports/brand.py backend/app/reports/outline.py backend/tests/test_reports_brand.py
git commit -m @'
feat(reports): resolve the report brand through D2, warn brand_missing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 10: The brand on the PDF

**Files:**
- Create: `backend/app/reports/pdf/logos.py`
- Modify: `backend/app/reports/pdf/fonts.py` (`brand_fonts`)
- Modify: `backend/app/reports/pdf/canvas.py` (`Furniture`, the branded header and footer, the cover band logos)
- Modify: `backend/app/reports/pdf/document.py` (`render_pdf(..., brand=None)`, cover frames, author)
- Modify: `backend/app/reports/render_job.py` (resolve once, pass it, warn)
- Test: `backend/tests/test_reports_pdf_brand.py`

**Interfaces:**
- Consumes: Task 9 `ResolvedBrand`; D2 `app.brands.fonts.register_family(family) -> (regular, bold) | None`; Task 8 `active.using`.
- Produces:
  - `app.reports.pdf.logos.flat_logo(path: Path | None, background: str = "#FFFFFF", max_px: int = 600) -> ImageReader | None` (alpha composited onto `background`, so no `/SMask`)
  - `app.reports.pdf.fonts.brand_fonts(text_family: str | None, numerals_family: str | None, base: FontSet) -> FontSet` (`sans` = the text family's regular, `sans_bold` = the numerals family's bold; "Space Grotesk" keeps `KestrelSans`)
  - `app.reports.pdf.canvas.Furniture(footer_left="", footer_right="", header_logo=None, cover_logo=None)`; `PageMeta.furniture`
  - `document.render_pdf(..., brand: ResolvedBrand | None = None)`; `DocMeta.author`
  - The cover: the brand's on-dark logo bottom left of the band (10 mm high, at most 60 mm wide, one margin in), as U6's preview draws it; the report's own logo chip stays top right and is flattened on white.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_reports_pdf_brand.py`:

```python
"""The brand on the PDF (spec 2026-10-02-asset-findings §10): cover band and logo, header logo,
footer website and confidentiality line, brand fonts, author."""

from dataclasses import replace
from types import SimpleNamespace

from PIL import Image
from report_docs import Snapshots, cover_section, document, standard_doc
from report_pdf_helpers import pdf_pages_text, pixel

from app.reports.brand import ResolvedBrand
from app.reports.pdf import document as pdf_document
from app.reports.theme import THEME, with_brand

ROW = SimpleNamespace(
    colors={
        "accent": "#BC0000",
        "accent_dark": "#9E0000",
        "navy": "#141D2D",
        "ink": "#1A1A1A",
        "pale": "#FFE5E5",
        "line": "#E7E4DE",
    },
    font_text="Nunito Sans",
    font_numerals="Poppins",
)


def brand(tmp_path, *, logos: bool = True) -> ResolvedBrand:
    logo = tmp_path / "logo.png"
    Image.new("RGBA", (400, 160), (230, 20, 20, 200)).save(logo)  # translucent: must not make an SMask
    theme = with_brand(THEME, ROW)
    return ResolvedBrand(
        id="b-test",
        name="Example Co",
        theme=theme,
        text_family=theme["fonts"]["sans"],
        numerals_family=theme["fonts"]["numerals"],
        cover_logo=logo if logos else None,
        header_logo=logo if logos else None,
        footer_left="© 2026 Example Co. For the recipient only.",
        footer_right="www.example.com",
        author="Example Drones",
    )


def _render(tmp_path, doc, b, name="out"):
    return pdf_document.render_pdf(
        doc,
        tmp_path / name,
        "branded-v001",
        snapshot_path=Snapshots(tmp_path / "snaps"),
        volume_flowables=None,
        progress=lambda f: None,
        check_cancelled=lambda: None,
        brand=b,
    )


def test_the_footer_carries_the_website_and_the_confidentiality_line(tmp_path):
    [part] = _render(tmp_path, standard_doc(), brand(tmp_path))
    page2 = pdf_pages_text(part.path)[1]
    assert "www.example.com · page 2 / " in page2
    assert "For the recipient only." in page2
    assert "Kestrel AI ·" not in page2


def test_the_cover_band_is_the_brand_navy_with_the_logo_bottom_left(tmp_path):
    [part] = _render(tmp_path, standard_doc(), brand(tmp_path))
    r, g, b = pixel(part.path, 0, 0.02, 0.02)
    assert r < 60 and g < 60 and b < 80  # navy, not Kestrel violet
    band_bottom = 0.38
    r, g, _ = pixel(part.path, 0, (18 + 5) / 210, band_bottom - (18 + 5) / 297)
    assert r > 150 and g < 120  # the red logo, flattened on navy


def test_the_header_logo_sits_left_of_the_title(tmp_path):
    [part] = _render(tmp_path, standard_doc(), brand(tmp_path))
    r, g, _ = pixel(part.path, 1, (18 + 2) / 210, (10 - 1.5) / 297)
    assert r > 150 and g < 120


def test_brand_fonts_are_embedded_and_the_author_is_the_brands(tmp_path):
    [part] = _render(tmp_path, standard_doc(), brand(tmp_path))
    raw = part.path.read_bytes()
    assert b"NunitoSans" in raw and b"Poppins" in raw
    assert b"/Author (Example Drones)" in raw


def test_no_brand_logo_leaves_the_band_and_header_plain(tmp_path):
    [part] = _render(tmp_path, standard_doc(), brand(tmp_path, logos=False))
    assert "www.example.com · page 2 / " in pdf_pages_text(part.path)[1]


def test_an_unbranded_render_is_unchanged(tmp_path):
    [part] = _render(tmp_path, standard_doc(), None)
    assert "Kestrel AI · Kuwait yard · page 2 / 5" in pdf_pages_text(part.path)[1]


def test_a_customer_logo_with_alpha_is_flattened(tmp_path):
    logo = tmp_path / "reports" / "assets" / "logo-cust.png"
    logo.parent.mkdir(parents=True)
    Image.new("RGBA", (200, 100), (20, 120, 200, 128)).save(logo)
    doc = document([cover_section(logo_path="reports/assets/logo-cust.png")])
    [part] = _render(tmp_path, doc, replace(brand(tmp_path), cover_logo=None))
    assert b"/SMask" not in part.path.read_bytes()
```

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_reports_pdf_brand.py -q`
Expected: FAIL (`TypeError: render_pdf() got an unexpected keyword argument 'brand'`).

- [ ] **Step 2: `backend/app/reports/pdf/logos.py`**

```python
"""Logos for the PDF without an alpha channel (the kit's "zero /SMask" rule): a PNG with transparency
is composited onto the colour it sits on, then embedded as RGB. Capped at `max_px` a side, so a logo
costs kilobytes. A bad file costs the logo, never the report."""

from __future__ import annotations

import logging
from pathlib import Path

from PIL import Image as PILImage
from reportlab.lib.utils import ImageReader

log = logging.getLogger(__name__)


def flat_logo(path: Path | None, background: str = "#FFFFFF", max_px: int = 600) -> ImageReader | None:
    if path is None:
        return None
    bg = tuple(int(background[i : i + 2], 16) for i in (1, 3, 5))
    try:
        with PILImage.open(path) as im:
            im.load()
            if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
                rgba = im.convert("RGBA")
                flat = PILImage.new("RGB", rgba.size, bg)
                flat.paste(rgba, mask=rgba.getchannel("A"))
            else:
                flat = im.convert("RGB")
    except Exception as exc:
        log.warning("logo %s could not be read: %s", path, exc)
        return None
    flat.thumbnail((max_px, max_px), PILImage.Resampling.LANCZOS)
    return ImageReader(flat)
```

- [ ] **Step 3: `brand_fonts` in `backend/app/reports/pdf/fonts.py`**

```python
THEME_SANS = "Space Grotesk"  # the theme's own family: KestrelSans, never a brand registration


def brand_fonts(text_family: str | None, numerals_family: str | None, base: FontSet) -> FontSet:
    """The brand's text family for body text and its numerals family (bold) for headings and figures,
    registered by D2 (`app.brands.fonts.register_family`). Falls back face by face to `base`."""
    if not base.embedded:
        return base
    from app.brands.fonts import register_family

    text = register_family(text_family) if text_family and text_family != THEME_SANS else None
    nums = register_family(numerals_family) if numerals_family and numerals_family != THEME_SANS else None
    sans = text[0] if text else base.sans
    bold = nums[1] if nums else (text[1] if text else base.sans_bold)
    return FontSet(sans, bold, base.mono, True)
```

- [ ] **Step 4: `canvas.py`: the branded furniture and cover band**

Add `from typing import Any`, `from reportlab.lib.utils import simpleSplit`, `from app.reports.pdf import active`, and:

```python
HEADER_LOGO_MM = 5
FOOTER_LINES = 3
COVER_LOGO_MM = (60, 10)  # max width, height: U6's preview draws the same box


@dataclass(frozen=True)
class Furniture:
    """A brand's page furniture (spec 2026-10-02-asset-findings §10); the default prints Kestrel's."""

    footer_left: str = ""
    footer_right: str = ""
    header_logo: Any = None  # a flattened ImageReader
    cover_logo: Any = None  # a flattened ImageReader, flattened on the band's first stop
```

`PageMeta` gains `furniture: Furniture = field(default_factory=Furniture)`. Replace `_furniture`:

```python
def _furniture(canv: rl_canvas.Canvas, meta: PageMeta, styles: Styles, local: int, total: int) -> None:
    w, h = canv._pagesize
    m = THEME["page"]["margin_mm"] * mm
    off = THEME["page"]["furniture_offset_mm"] * mm
    size = THEME["type"]["furniture_pt"]
    fur = meta.furniture
    override = meta.header_overrides.get(local)
    head_font = styles.fonts.sans_bold if override else styles.fonts.sans
    x0 = m
    canv.saveState()
    if fur.header_logo is not None:
        iw, ih = fur.header_logo.getSize()
        lh = HEADER_LOGO_MM * mm
        lw = lh * iw / ih
        canv.drawImage(fur.header_logo, m, h - off - 0.8 * mm, lw, lh)
        x0 = m + lw + HEADER_GAP_MM * mm
    room = w - m - x0 - stringWidth(meta.version_label, styles.fonts.sans, size) - HEADER_GAP_MM * mm
    canv.setFont(head_font, size)
    canv.setFillColor(colour("ink") if override else colour("muted"))
    canv.drawString(x0, h - off, fit_width(undash(override or meta.title), head_font, size, room))
    canv.setFont(styles.fonts.sans, size)
    canv.setFillColor(colour("muted"))
    canv.drawRightString(w - m, h - off, meta.version_label)
    canv.setStrokeColor(colour("rule"))
    canv.setLineWidth(0.5)
    canv.line(m, h - off - 2 * mm, w - m, h - off - 2 * mm)
    page = f"page {local + meta.page_offset} / {total}"
    if fur.footer_left or fur.footer_right:
        right = undash(f"{fur.footer_right} · {page}" if fur.footer_right else page)
        canv.drawRightString(w - m, off, right)
        if fur.footer_left:
            small = size - 1
            room_left = max(w - 2 * m - stringWidth(right, styles.fonts.sans, size) - 6 * mm, 20 * mm)
            lines = simpleSplit(undash(fur.footer_left), styles.fonts.sans, small, room_left)[:FOOTER_LINES]
            canv.setFont(styles.fonts.sans, small)
            y = off + (len(lines) - 1) * (small + 1.5)
            for line in lines:
                canv.drawString(m, y, line)
                y -= small + 1.5
    else:
        who = f"Kestrel AI · {meta.project}" if meta.project else "Kestrel AI"
        canv.drawRightString(w - m, off, undash(f"{who} · {page}"))
    canv.restoreState()
```

Replace `draw_cover_band` (it now reads the active theme's gradient, flattens the report's logo on white, and draws the brand logo bottom left):

```python
def draw_cover_band(canv: rl_canvas.Canvas, logo_path: Path | None, brand_logo: Any = None) -> None:
    """The cover's full-bleed band: a linear gradient through the active theme's three cover stops,
    clipped to the top 38 % of the page; the report's logo top right on a white chip; the brand's
    on-dark logo bottom left on the band (spec 2026-10-02-asset-findings §10, U6's preview)."""
    from app.reports.pdf.logos import flat_logo

    w, h = canv._pagesize
    y0 = h - band_height(h)
    m = THEME["page"]["margin_mm"] * mm
    stops = [colors.HexColor(c) for c in active.theme()["cover"]["gradient"]]
    canv.saveState()
    clip = canv.beginPath()
    clip.rect(0, y0, w, h - y0)
    canv.clipPath(clip, stroke=0, fill=0)
    canv.linearGradient(0, h, w, y0, stops, (0, 0.5, 1), extend=False)
    canv.restoreState()
    if brand_logo is not None:
        iw, ih = brand_logo.getSize()
        max_w, lh = (v * mm for v in COVER_LOGO_MM)
        lw = min(max_w, lh * iw / ih)
        canv.drawImage(brand_logo, m, y0 + m, lw, lw * ih / iw)
    logo = flat_logo(logo_path) if logo_path is not None else None
    if logo is None:
        return
    cw, ch = (v * mm for v in THEME["cover"]["logo_chip_mm"])
    x, y, pad = w - m - cw, h - m - ch, 2 * mm
    canv.saveState()
    try:
        canv.setFillColor(colors.white)
        canv.roundRect(x, y, cw, ch, THEME["page"]["radius_mm"] * mm, stroke=0, fill=1)
        canv.drawImage(logo, x + pad, y + pad, cw - 2 * pad, ch - 2 * pad, preserveAspectRatio=True, anchor="c")
    except Exception as exc:  # a bad logo costs the logo, never the report
        log.warning("cover logo %s could not be drawn: %s", logo_path, exc)
    finally:
        canv.restoreState()
```

- [ ] **Step 5: `document.py` takes the brand**

- `DocMeta` gains `author: str = "Kestrel AI"`; `_Doc(..., author=meta.author, ...)` in `_build`.
- Import `COVER_LOGO_MM`, `Furniture` from `canvas`, and replace `_cover_frames` so the title never runs over the brand logo:

```python
def _cover_frames(w: float, h: float, brand_logo: bool = False) -> tuple[Frame, Frame]:
    m = THEME["page"]["margin_mm"] * mm
    chip_h = THEME["cover"]["logo_chip_mm"][1] * mm
    y0 = h - band_height(h)
    pad = dict(leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    bottom = y0 + (m + COVER_LOGO_MM[1] * mm + 4 * mm if brand_logo else 6 * mm)
    band = Frame(m, bottom, w - 2 * m, h - bottom - m - chip_h - 4 * mm, id="band", **pad)
    below = Frame(m, m, w - 2 * m, y0 - 8 * mm - m, id="below", **pad)
    return band, below
```
- `_build(..., furniture: Furniture)`: `page_meta.furniture = furniture`; `band, below = _cover_frames(w, h, furniture.cover_logo is not None)`; the cover template's `onPage` is `lambda canv, _doc: draw_cover_band(canv, logo, furniture.cover_logo)`.
- `render_pdf` gains `brand: ResolvedBrand | None = None` (import under `TYPE_CHECKING` from `app.reports.brand`) and becomes:

```python
    with _BUILD_LOCK:
        fonts = register_fonts()
        theme = THEME
        if brand is not None:
            fonts = brand_fonts(brand.text_family, brand.numerals_family, fonts)
            theme = brand.theme
        with active.using(theme, fonts.sans):
            furniture = Furniture()
            if brand is not None:
                furniture = Furniture(
                    footer_left=brand.footer_left,
                    footer_right=brand.footer_right,
                    header_logo=flat_logo(brand.header_logo),
                    cover_logo=flat_logo(brand.cover_logo, theme["cover"]["gradient"][0]),
                )
            return _render_parts(
                doc,
                out_dir,
                base_name,
                styles=build_styles(fonts),
                furniture=furniture,
                author=brand.author if brand is not None else "Kestrel AI",
                snapshot_path=snapshot_path,
                volume_flowables=volume_flowables,
                progress=progress,
                check_cancelled=check_cancelled,
                part_budget=part_budget,
            )
```

  `_render_parts` takes `furniture` and `author`, sets `meta = replace(doc_meta(doc), author=author)` (`from dataclasses import replace`) and adds `furniture=furniture` to its `common` dict.

- [ ] **Step 6: `render_job.py` resolves the brand once**

In `_run_pipeline`, after `doc = compose_in(...)` and `warnings = [...]`:

```python
    from app.reports.brand import BRAND_MISSING, resolve_brand

    brand = resolve_brand(handle, config, generated_at)
    if config.brand_id and brand is None:
        warnings.append({"code": "brand_missing", "message": BRAND_MISSING, "count": 1, "link": None})
```

`_render_pdf` gains a `brand` parameter, passed through to `pdf_document.render_pdf(..., brand=brand)`; the call in `_run_pipeline` passes `brand=brand`.

- [ ] **Step 7: Run**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_reports_pdf_brand.py tests/test_reports_pdf_document.py tests/test_reports_pdf_canvas.py tests/test_reports_render_job.py tests/test_reports_fonts.py -q`
Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add backend/app/reports/pdf/logos.py backend/app/reports/pdf/fonts.py backend/app/reports/pdf/canvas.py backend/app/reports/pdf/document.py backend/app/reports/render_job.py backend/tests/test_reports_pdf_brand.py
git commit -m @'
feat(reports): brand cover, header logo, footer and fonts in the PDF; logos flattened

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 11: The kit's PDF rules, end to end

**Files:**
- Test: `backend/tests/test_reports_pdf_rules.py`

**Interfaces:**
- Consumes: Tasks 8 and 10. Pins, on one branded document with every new block: no em or en dash in the text, zero `/SMask`, every font embedded, `qpdf --check` when qpdf is on PATH, byte-identical output twice.
- Note: neither `pikepdf` nor `pypdf` is in the venv (checked 2026-10-03), and reportlab writes no object streams, so a raw byte scan for `/SMask` sees every object dictionary. The helper uses pikepdf when it is importable.

- [ ] **Step 1: Write the tests**

Create `backend/tests/test_reports_pdf_rules.py`:

```python
"""The PDF rules the inspection kit enforced (spec 2026-10-02-asset-findings §10, §12 acceptance 4):
no em or en dash in the text, zero /SMask, every font embedded, qpdf --check when qpdf is present,
and the output byte-identical twice."""

import hashlib
import re
import shutil
import subprocess

import pytest
from PIL import Image
from report_docs import Snapshots, cover_section, document, section, summary_section
from report_pdf_helpers import pdf_pages_text
from test_reports_pdf_asset import MAP_BLOCK, asset_finding
from test_reports_pdf_brand import brand

from app.reports.pdf import document as pdf_document


def _doc(tmp_path):
    logo = tmp_path / "reports" / "assets" / "logo-cust.png"
    logo.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", (200, 100), (20, 120, 200, 128)).save(logo)
    table = {
        "kind": "table",
        "columns": [{"key": "a", "label": "Data item"}, {"key": "b", "label": "Period"}],
        "rows": [["\u2014", "1 Sep 2026 \u2013 3 Sep 2026"]],
    }
    return document(
        [
            cover_section(logo_path="reports/assets/logo-cust.png"),
            summary_section(),
            section("asset_summary", "Asset summary", [MAP_BLOCK]),
            section("findings_table", "Findings \u2014 all", [table]),
            section("finding_pages", "Finding pages", [asset_finding(7, "Crack \u2014 wide \u2013 long"), asset_finding(8)]),
        ]
    )


@pytest.fixture
def pdf(tmp_path):
    [part] = pdf_document.render_pdf(
        _doc(tmp_path),
        tmp_path / "out",
        "rules-v001",
        snapshot_path=Snapshots(tmp_path / "snaps"),
        volume_flowables=None,
        progress=lambda f: None,
        check_cancelled=lambda: None,
        brand=brand(tmp_path),
    )
    return part


def smask_count(path) -> int:
    try:
        import pikepdf
    except ImportError:
        return path.read_bytes().count(b"/SMask")
    with pikepdf.open(path) as pdf:
        return sum(1 for obj in pdf.objects if isinstance(obj, pikepdf.Dictionary) and "/SMask" in obj)


def test_no_em_or_en_dash_in_the_text(pdf):
    assert not re.search("[\u2013\u2014]", "".join(pdf_pages_text(pdf.path)))


def test_zero_soft_masks(pdf):
    assert smask_count(pdf.path) == 0


def test_every_font_is_embedded(pdf):
    raw = pdf.path.read_bytes()
    names = set(re.findall(rb"/BaseFont /([\w+-]+)", raw))
    assert names and all(b"+" in n for n in names), names
    assert raw.count(b"/FontFile2") >= len(names)


def test_qpdf_check_passes(pdf):
    qpdf = shutil.which("qpdf")
    if qpdf is None:
        pytest.skip("qpdf is not on PATH")
    run = subprocess.run([qpdf, "--check", str(pdf.path)], capture_output=True, text=True)
    assert run.returncode == 0, run.stdout + run.stderr


def test_a_branded_render_is_byte_identical_twice(tmp_path, pdf):
    [again] = pdf_document.render_pdf(
        _doc(tmp_path),
        tmp_path / "again",
        "rules-v001",
        snapshot_path=Snapshots(tmp_path / "snaps"),
        volume_flowables=None,
        progress=lambda f: None,
        check_cancelled=lambda: None,
        brand=brand(tmp_path),
    )
    assert hashlib.sha256(again.path.read_bytes()).hexdigest() == pdf.sha256
```

- [ ] **Step 2: Run**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_reports_pdf_rules.py tests/test_reports_pdf_document.py -q`
Expected: PASS (`test_qpdf_check_passes` SKIPPED on a machine without qpdf). These pin Tasks 8 and 10 together; a failure names the module to fix (`flowables_text.undash` for a dash, `pdf/logos.py` or `draw_cover_band` for an SMask, `active.using` or a `Drawing.initialFontName` for a font).

- [ ] **Step 3: Commit**

```powershell
git add backend/tests/test_reports_pdf_rules.py
git commit -m @'
test(reports): pin the kit's PDF rules on a branded asset report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 12: The `asset_sightings` CSV layout

**Files:**
- Create: `backend/app/reports/writers/asset_csv.py`
- Create: `backend/app/reports/writers/asset_rows.py`
- Modify: `backend/app/reports/render_job.py` (`write_csv_file`; `_write_tables` takes `where`)
- Create: `backend/tests/data/reports/asset_sightings_fixture.py` (makes the fixture; committed so its bytes are explained)
- Create: `backend/tests/data/reports/asset_sightings.csv` (generated, committed)
- Modify: `.gitattributes` (the fixture keeps its CRLF and BOM)
- Test: `backend/tests/test_reports_asset_csv.py`

**Interfaces:**
- Consumes: kit `records.csv_text` (`C:\Users\D\Claude_Workspace\outputs\Kestrel AI Reference Pack\asset-inspection-kit\kit\records.py`, read 2026-10-03): the 21 columns, the `q` quoting (quote only when the value holds `"`, `,` or `\n`; double inner quotes; `None` is empty), BOM, CRLF after every row including the last, then the photos without findings with empty ids. Task 4 `ReportConfig.csv_layout`; P1 `derive`; Task 2 `load_asset_models`.
- Produces:
  - `app.reports.writers.asset_csv.HEAD` (the 21 names), `q(value) -> str`, `line(values) -> str`, `write_asset_sightings(path, rows, *, on_row=None) -> int`
  - `app.reports.writers.asset_rows.sighting_rows(handle, where, *, scale) -> Iterator[list]`, `photo_rows(handle, where) -> Iterator[list]`, `csv_rows(handle, where, *, scale) -> Iterator[list]`, `PAGE = 500`
  - `app.reports.render_job.write_csv_file(handle, partial, config, *, where, ids, scale, number, on_row) -> Path` (`sightings.csv` for `asset_sightings`, else today's `findings.csv`)
- Column values for a sighting row, in kit order: `finding_id` = `F` + the row number zero-filled to `max(2, len(str(total)))` (kit `fid`); `defect_id` = the Kestrel finding label (`F-0042`); `photo_id` = the image id; `file_name` = `original_name`; `severity` = the sighting's, else the finding's; `severity_label` = the scale name; `class` = the type name; `component` = the sighting's `part`, else the finding's `component`; `zone` = the derived zone's label; `height_m_approx` `%.2f`; `side_approx` (unplaced: `Not placed`, the kit's text); `bearing_deg_approx` `%.0f`; `placed_on_model` `yes`/`no`; `coverage_pct_of_photo` = coverage x 100, `%.4f`; `note`; `subject` (empty: Kestrel has no photo subject); `flight` = the pose's `sequence`; `captured` `YYYY-MM-DD HH:MM:SS` UTC; `gps_lat`, `gps_lon`, `gps_alt_m`. Unplaced sightings have an empty height and zone (index Data rules; the kit printed the camera target height there).

- [ ] **Step 1: Keep the fixture's bytes**

Append to `.gitattributes`:

```
backend/tests/data/reports/*.csv binary
```

Create `backend/tests/data/reports/asset_sightings_fixture.py`:

```python
"""Writes asset_sightings.csv, the byte-exact expectation for the asset_sightings layout. The text is
written by hand from the kit's records.csv_text rules, never by the writer under test: BOM, the 21
columns, CRLF after every row, quotes only around values holding a quote, a comma or a newline.
Run it once from backend/: python tests/data/reports/asset_sightings_fixture.py"""

from pathlib import Path

LINES = [
    "finding_id,defect_id,photo_id,file_name,severity,severity_label,class,component,zone,height_m_approx,"
    "side_approx,bearing_deg_approx,placed_on_model,coverage_pct_of_photo,note,subject,flight,captured,"
    "gps_lat,gps_lon,gps_alt_m",
    'F01,F-0007,img-1,DJI_0001.JPG,2,Moderate,Sealant failure,"Panel, east",Level 07,41.20,West elevation,268,'
    'yes,1.2500,"Gap ""wide"", 3 mm",,1,2026-02-14 10:22:31,25.08,55.14,120.5',
    "F02,F-0007,img-2,DJI_0002.JPG,1,Minor,Sealant failure,,,,Not placed,,no,0.5000,"
    '"line one\nline two",,1,2026-02-14 10:23:00,25.081,55.141,121.0',
    ",,img-3,DJI_0003.JPG,,Uncertain,,,,38.00,,,no,0.0000,,,2,,,,",
]

if __name__ == "__main__":
    out = Path(__file__).with_name("asset_sightings.csv")
    out.write_bytes(("\ufeff" + "\r\n".join(LINES) + "\r\n").encode("utf-8"))
```

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe tests/data/reports/asset_sightings_fixture.py` (from `backend/`).
Expected: `backend/tests/data/reports/asset_sightings.csv` exists, starts with `EF BB BF`, and its rows end in `0D 0A` (check with `Format-Hex -Path tests/data/reports/asset_sightings.csv | Select-Object -First 2`).

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_reports_asset_csv.py`:

```python
"""The asset_sightings CSV (spec 2026-10-02-asset-findings §10, §12 "CSV: byte-exact against a
fixture"): the kit's records.csv_text, byte for byte."""

from pathlib import Path

import pytest
from reports_asset_rows import add_asset_finding, add_asset_image, add_asset_model, add_pose, add_review
from reports_rows import add_type, config, ctx_for

from app.asset_review.derive import derive
from app.reports import render_job
from app.reports.writers import asset_csv, asset_rows

FIXTURE = Path(__file__).parent / "data" / "reports" / "asset_sightings.csv"
ROWS = [
    ["F01", "F-0007", "img-1", "DJI_0001.JPG", 2, "Moderate", "Sealant failure", "Panel, east", "Level 07", "41.20",
     "West elevation", "268", "yes", "1.2500", 'Gap "wide", 3 mm', None, "1", "2026-02-14 10:22:31", 25.08, 55.14, 120.5],
    ["F02", "F-0007", "img-2", "DJI_0002.JPG", 1, "Minor", "Sealant failure", "", "", "", "Not placed", "", "no",
     "0.5000", "line one\nline two", None, "1", "2026-02-14 10:23:00", 25.081, 55.141, 121.0],
    ["", "", "img-3", "DJI_0003.JPG", "", "Uncertain", "", "", "", "38.00", "", "", "no", "0.0000", None, None, "2",
     "", None, None, None],
]  # fmt: skip


def test_the_writer_matches_the_fixture_byte_for_byte(tmp_path):
    out = tmp_path / "sightings.csv"
    assert asset_csv.write_asset_sightings(out, ROWS) == 3
    assert out.read_bytes() == FIXTURE.read_bytes()


def test_quoting_follows_the_kit_not_python_csv():
    assert asset_csv.q(None) == "" and asset_csv.q(2) == "2" and asset_csv.q(25.08) == "25.08"
    assert asset_csv.q('a"b') == '"a""b"' and asset_csv.q("a,b") == '"a,b"'
    assert asset_csv.q("a\rb") == "a\rb"  # the kit quotes on " , and \n only
    assert len(asset_csv.HEAD) == 21


def test_a_row_of_the_wrong_length_is_refused(tmp_path):
    with pytest.raises(ValueError):
        asset_csv.write_asset_sightings(tmp_path / "x.csv", [["F01"]])


def _seed(handle):
    crack = add_type(handle, "crack")
    mid, review, frame = add_asset_model(handle)
    a = add_asset_image(handle, name="DJI_0001.JPG")
    b = add_asset_image(handle, name="DJI_0002.JPG")
    c = add_asset_image(handle, name="DJI_0003.JPG", lat=None, lon=None, alt=None)
    add_pose(handle, a, mid, sequence="2")
    add_pose(handle, b, mid)
    add_pose(handle, c, mid, target=(0.0, 38.0, 0.0))
    add_review(handle, c, "uncertain", note="Glare")
    add_asset_finding(
        handle,
        mid,
        crack,
        severity=2,
        note="Open joint, east",
        sightings=[
            {"image_id": a, "center": (-5.0, 41.2, 0.5), "normal": (-1.0, 0.0, 0.0), "coverage": 0.0125, "part": "Panel"},
            {"image_id": b, "center": (-5.1, 30.0, 0.4), "normal": (-1.0, 0.0, 0.0), "coverage": 0.005},
        ],
    )
    add_asset_finding(handle, mid, crack, severity=1, placement="none", sightings=[{"image_id": a, "placement": "none"}])
    return mid, review, frame, (a, b, c)


def test_rows_from_the_project(handle):
    _, review, frame, (a, b, c) = _seed(handle)
    ctx = ctx_for(handle, config(sections=("findings_table",)))
    scale = {lv.level: lv for lv in ctx.scale}
    rows = list(asset_rows.csv_rows(handle, ctx.where, scale=scale))
    assert [r[0] for r in rows] == ["F01", "F02", "F03", ""]
    assert [r[3] for r in rows] == ["DJI_0001.JPG", "DJI_0002.JPG", "DJI_0001.JPG", "DJI_0003.JPG"]
    d = derive((-5.0, 41.2, 0.5), (-1.0, 0.0, 0.0), review, frame)
    zone = next(z.label for z in review.zones if z.id == d.zone)
    assert rows[0] == [
        "F01", "F-0001", a, "DJI_0001.JPG", 2, ctx.level(2).name, "crack", "Panel", zone, "41.20",
        d.side, f"{d.bearing_deg:.0f}", "yes", "1.2500", "Open joint, east", None, "2", "2026-09-01 12:00:00",
        25.08, 55.14, 120.5,
    ]  # fmt: skip
    unplaced = rows[2]
    assert (unplaced[1], unplaced[8], unplaced[9], unplaced[10], unplaced[11], unplaced[12]) == (
        "F-0002", "", "", "Not placed", "", "no"
    )
    assert rows[3] == [
        "", "", c, "DJI_0003.JPG", "", "Uncertain", "", "", "", "38.00", "", "", "no", "0.0000", "Glare", None,
        "1", "2026-09-01 12:00:00", None, None, None,
    ]  # fmt: skip


def test_the_render_job_writes_sightings_csv_for_the_layout(handle, tmp_path):
    _seed(handle)
    cfg = config(sections=("findings_table",)).model_copy(update={"csv_layout": "asset_sightings"})
    ctx = ctx_for(handle, cfg)
    path = render_job.write_csv_file(
        handle, tmp_path, cfg, where=ctx.where, ids=[], scale={lv.level: lv for lv in ctx.scale}, number=1, on_row=None
    )
    assert path.name == "sightings.csv"
    raw = path.read_bytes()
    assert raw.startswith(b"\xef\xbb\xbffinding_id,defect_id,") and raw.count(b"\r\n") == 5
```

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_reports_asset_csv.py -q`
Expected: FAIL (`ImportError: cannot import name 'asset_csv'`).

- [ ] **Step 3: `backend/app/reports/writers/asset_csv.py`**

```python
"""The asset_sightings CSV (spec 2026-10-02-asset-findings §10): the inspection kit's
`records.csv_text`, byte for byte. UTF-8 with a BOM, CRLF after every row, and the kit's own quoting
(a value is quoted only when it holds a double quote, a comma or a newline; Python's csv module also
quotes a carriage return, so it is not used). Streamed row by row."""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path

HEAD = (
    "finding_id",
    "defect_id",
    "photo_id",
    "file_name",
    "severity",
    "severity_label",
    "class",
    "component",
    "zone",
    "height_m_approx",
    "side_approx",
    "bearing_deg_approx",
    "placed_on_model",
    "coverage_pct_of_photo",
    "note",
    "subject",
    "flight",
    "captured",
    "gps_lat",
    "gps_lon",
    "gps_alt_m",
)
_NEEDS_QUOTES = re.compile(r'[",\n]')


def q(value) -> str:
    if value is None:
        return ""
    s = str(value)
    return '"' + s.replace('"', '""') + '"' if _NEEDS_QUOTES.search(s) else s


def line(values: Sequence) -> str:
    return ",".join(q(v) for v in values)


def write_asset_sightings(
    path: Path, rows: Iterable[Sequence], *, on_row: Callable[[int], None] | None = None
) -> int:
    n = 0
    with Path(path).open("w", encoding="utf-8", newline="") as f:
        f.write("\ufeff" + ",".join(HEAD) + "\r\n")
        for row in rows:
            if len(row) != len(HEAD):
                raise ValueError(f"an asset_sightings row has {len(HEAD)} values, not {len(row)}")
            f.write(line(row) + "\r\n")
            n += 1
            if on_row is not None:
                on_row(n)
    return n
```

- [ ] **Step 4: `backend/app/reports/writers/asset_rows.py`**

```python
"""Rows for the asset_sightings CSV (spec 2026-10-02-asset-findings §10): every sighting of the
filtered asset findings, highest first (the kit's order: height down, severity down, photo), then the
posed photos of those asset models with no sighting in the report, with empty ids. Read 500 rows per
query; nothing holds every sighting at once."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC
from pathlib import PurePosixPath

from sqlalchemy import and_, func, select

from app.db.models import Finding, FindingSighting, Image, ImagePose, ImageReview, ProjectType
from app.findings.numbers import format_number
from app.reports.asset_info import PLACED, load_asset_models
from app.reports.context import UNGRADED

PAGE = 500
ASSET = Finding.anchor_kind == "asset"
NOT_PLACED = "Not placed"
REVIEW_LABEL = {"finding": "Finding", "none": "No finding", "uncertain": "Uncertain", "not_assessed": "Not assessed"}


def _name(img: Image) -> str:
    return img.original_name or PurePosixPath(img.path).name


def _captured(img: Image) -> str:
    t = img.capture_time
    if t is None:
        return ""
    t = t if t.tzinfo is not None else t.replace(tzinfo=UTC)
    return t.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S")


def _level_name(scale: dict, sev: int | None) -> str:
    if sev is None:
        return UNGRADED
    level = scale.get(sev)
    return level.name if level is not None else f"Level {sev}"


def _sighting_values(sg, f, img, pose, info, types: dict, scale: dict) -> list:
    from app.asset_review.derive import derive  # P1

    sev = sg.severity if sg.severity is not None else f.severity
    center = (sg.cx, sg.cy, sg.cz) if sg.cx is not None and sg.cy is not None and sg.cz is not None else None
    normal = (sg.nx, sg.ny, sg.nz) if sg.nx is not None and sg.ny is not None and sg.nz is not None else None
    d = derive(center, normal, info.review, info.frame) if center and info and info.review and info.frame else None
    height = d.height_m if d is not None else (center[1] if center else None)
    return [
        "",
        format_number(f.number),
        img.id,
        _name(img),
        sev,
        _level_name(scale, sev),
        types.get(f.type_id, f.type_id),
        sg.part or f.component or "",
        (info.zone_label(d.zone) or "") if d is not None and d.zone and info is not None else "",
        f"{height:.2f}" if height is not None else "",
        d.side if d is not None and d.side else NOT_PLACED,
        f"{d.bearing_deg:.0f}" if d is not None and d.bearing_deg is not None else "",
        "yes" if sg.placement in PLACED else "no",
        f"{(sg.coverage or 0.0) * 100:.4f}",
        f.note or None,
        None,
        pose.sequence if pose is not None else None,
        _captured(img),
        img.lat,
        img.lon,
        img.alt,
    ]


def sighting_rows(handle, where, *, scale: dict) -> Iterator[list]:
    infos = load_asset_models(handle)
    with handle.session() as s:
        types = {t.type_id: t.name for t in s.execute(select(ProjectType)).scalars()}
        total = s.execute(
            select(func.count())
            .select_from(FindingSighting)
            .join(Finding, Finding.id == FindingSighting.finding_id)
            .where(where, ASSET)
        ).scalar_one()
    width = max(2, len(str(total)))
    sev = func.coalesce(FindingSighting.severity, Finding.severity)
    q = (
        select(FindingSighting, Finding, Image, ImagePose)
        .join(Finding, Finding.id == FindingSighting.finding_id)
        .join(Image, Image.id == FindingSighting.image_id)
        .outerjoin(
            ImagePose,
            and_(ImagePose.image_id == FindingSighting.image_id, ImagePose.asset_model_id == Finding.asset_model_id),
        )
        .where(where, ASSET)
        .order_by(
            FindingSighting.cy.is_(None),
            FindingSighting.cy.desc(),
            sev.is_(None),
            sev.desc(),
            func.coalesce(Image.original_name, Image.path),
            FindingSighting.id,
        )
    )
    n, offset = 0, 0
    while True:
        with handle.session() as s:
            page = s.execute(q.offset(offset).limit(PAGE)).all()
            rows = [
                _sighting_values(sg, f, img, pose, infos.get(f.asset_model_id), types, scale)
                for sg, f, img, pose in page
            ]
        for row in rows:
            n += 1
            row[0] = "F" + str(n).zfill(width)
            yield row
        if len(page) < PAGE:
            return
        offset += PAGE


def photo_rows(handle, where) -> Iterator[list]:
    """Posed photos of the report's asset models with no sighting of a reported finding (kit: the
    photos without findings, for completeness). An image posed on two models prints once."""
    reported = select(Finding.id).where(where, ASSET)
    models = select(Finding.asset_model_id).where(where, ASSET)
    seen = select(FindingSighting.image_id).where(FindingSighting.finding_id.in_(reported))
    q = (
        select(Image, ImagePose, ImageReview)
        .join(ImagePose, ImagePose.image_id == Image.id)
        .outerjoin(ImageReview, ImageReview.image_id == Image.id)
        .where(ImagePose.asset_model_id.in_(models), Image.id.not_in(seen))
        .order_by(func.coalesce(Image.original_name, Image.path), Image.id, ImagePose.asset_model_id)
    )
    last, offset = None, 0
    while True:
        with handle.session() as s:
            page = s.execute(q.offset(offset).limit(PAGE)).all()
            rows = []
            for img, pose, review in page:
                if img.id == last:
                    continue
                last = img.id
                target = pose.target if isinstance(pose.target, list) and len(pose.target) == 3 else None
                rows.append(
                    [
                        "",
                        "",
                        img.id,
                        _name(img),
                        "",
                        REVIEW_LABEL.get(review.status, "Not assessed") if review is not None else "Not assessed",
                        "",
                        "",
                        "",
                        f"{float(target[1]):.2f}" if target is not None else "",
                        "",
                        "",
                        "no",
                        f"{((review.coverage if review is not None else None) or 0.0) * 100:.4f}",
                        (review.note or None) if review is not None else None,
                        None,
                        pose.sequence,
                        _captured(img),
                        img.lat,
                        img.lon,
                        img.alt,
                    ]
                )
        yield from rows
        if len(page) < PAGE:
            return
        offset += PAGE


def csv_rows(handle, where, *, scale: dict) -> Iterator[list]:
    yield from sighting_rows(handle, where, scale=scale)
    yield from photo_rows(handle, where)
```

- [ ] **Step 5: `render_job.py` writes the chosen layout**

Add `from app.reports.writers import asset_csv, asset_rows` and:

```python
def write_csv_file(handle, partial: Path, config, *, where, ids, scale, number, on_row) -> Path:
    """`sightings.csv` in the kit's columns for `asset_sightings`, else today's `findings.csv`."""
    if str(config.csv_layout) == "asset_sightings":
        path = partial / "sightings.csv"
        asset_csv.write_asset_sightings(path, asset_rows.csv_rows(handle, where, scale=scale), on_row=on_row)
        return path
    path = partial / "findings.csv"
    csv_out.write_csv(path, rows.export_rows(handle, ids, scale=scale, version_number=number), on_row=on_row)
    return path
```

`_write_tables` gains a `where` keyword; its `if fmt == "csv":` branch becomes `path = write_csv_file(handle, partial, config, where=where, ids=ids, scale=scale, number=number, on_row=on_row)` (the `source = ...` line moves into the `xlsx` branch). `_run_pipeline` passes `where=cctx.where`.

- [ ] **Step 6: Run**

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_reports_asset_csv.py tests/test_reports_writers.py tests/test_reports_render_job.py -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add .gitattributes backend/app/reports/writers/asset_csv.py backend/app/reports/writers/asset_rows.py backend/app/reports/render_job.py backend/tests/data/reports/asset_sightings_fixture.py backend/tests/data/reports/asset_sightings.csv backend/tests/test_reports_asset_csv.py
git commit -m @'
feat(reports): asset_sightings CSV layout, byte-exact with the inspection kit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 13: The preview draws the asset finding page and the brand's fills

**Files:**
- Modify: `frontend/src/reports/preview/blocks/FindingBlock.tsx`
- Modify: `frontend/src/reports/preview/blocks/TableBlock.tsx`
- Modify: `frontend/src/reports/preview/PreviewContext.ts` (`CoverBrand.headFill?`)
- Modify: `frontend/src/reports/preview/coverBrand.ts` (U6's; sets `headFill`)
- Test: `frontend/src/reports/preview/blocks/assetBlocks.test.tsx` (more cases)

**Interfaces:**
- Consumes: Task 1 (`AssetDrawingSvg`, `FindingAsset` in the generated client); U6 `CoverBrand`, `coverBrandOf(brand, logoSrc)`, `PreviewEnv.brand`; D2 TS `withBrand`.
- Produces: `CoverBrand.headFill?: string` (D2's overlay `colours.head_fill`); a `finding` block with `asset` shows the kicker above its head band and the facts beside an 18 mm height locator, as the PDF does; the table head and the finding band use `headFill` when a brand is set.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/reports/preview/blocks/assetBlocks.test.tsx`:

```tsx
import { PreviewEnvContext } from "../PreviewContext";
import { coverBrandOf } from "../coverBrand";
import { FIXTURE_BLOCKS } from "../fixtures";
import { FindingBlock } from "./FindingBlock";
import { TableBlock } from "./TableBlock";

const base = FIXTURE_BLOCKS.finding_pages[0] as BlockOf<"finding">;
const ASSET_FINDING: BlockOf<"finding"> = {
  ...base,
  kv: [
    ["Height", "41.2 m above street level"],
    ["Zone", "Upper floors"],
  ],
  asset: {
    kicker: "Finding F-0042 · Upper floors · West elevation · seen in 3 photos",
    height_locator: { ...MAP_BLOCK.drawing, width: 64, height: 200, font_size: 6, bands: [], x_ticks: [] },
  },
};

describe("FindingBlock with an asset panel", () => {
  it("shows the kicker and the facts beside the height locator", () => {
    render(<FindingBlock block={ASSET_FINDING} />);
    expect(screen.getByText(ASSET_FINDING.asset!.kicker)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Height on the asset" })).toBeInTheDocument();
    expect(screen.getByText("41.2 m above street level")).toBeInTheDocument();
  });

  it("prints as before without one", () => {
    render(<FindingBlock block={{ ...base, asset: null }} />);
    expect(screen.queryByRole("img", { name: "Height on the asset" })).toBeNull();
  });
});

describe("brand head fill", () => {
  const brand = coverBrandOf(
    {
      colors: { accent: "#BC0000", accent_dark: "#9E0000", navy: "#141D2D", ink: "#1A1A1A", pale: "#FFE5E5", line: "#E7E4DE" },
      font_text: null,
      font_numerals: null,
    } as Parameters<typeof coverBrandOf>[0],
    null,
  );

  it("comes from D2's overlay", () => {
    expect(brand.headFill).toBe("#FFE5E5");
  });

  it("fills the table head and the finding band", () => {
    const table = FIXTURE_BLOCKS.findings_table.find((b) => b.kind === "table") as BlockOf<"table">;
    const { container } = render(
      <PreviewEnvContext.Provider
        value={{ resolveSnapshot: () => null, resolveAsset: () => null, scrollRoot: null, paper: "A4", brand }}
      >
        <TableBlock block={table} />
        <FindingBlock block={ASSET_FINDING} />
      </PreviewEnvContext.Provider>,
    );
    expect((container.querySelector("thead tr") as HTMLElement).style.background).toBe("rgb(255, 229, 229)");
    expect((container.querySelector("article header") as HTMLElement).style.background).toBe("rgb(255, 229, 229)");
  });
});
```

Run: `pnpm -C frontend exec vitest run src/reports/preview/blocks/assetBlocks.test.tsx`
Expected: FAIL (no kicker; `headFill` undefined).

- [ ] **Step 2: Implement**

`PreviewContext.ts`, in U6's `CoverBrand`, add:

```ts
  /** The brand's table head and finding band fill (D2 overlay `colours.head_fill`); absent is the theme's. */
  headFill?: string;
```

`coverBrand.ts`, `coverBrandOf` returns `{ gradient: theme.cover.gradient, fontFamily: brand.font_text, logoSrc, headFill: theme.colours.head_fill }`.

`TableBlock.tsx`: `import { usePreviewEnv } from "../PreviewContext";`, `const headFill = usePreviewEnv().brand?.headFill ?? PRINT.head;` at the top of `TableBlock`, and the head row's `style={{ background: headFill }}`.

`FindingBlock.tsx`: import `usePreviewEnv` and `AssetDrawingSvg`; at the top of the component `const headFill = usePreviewEnv().brand?.headFill ?? PRINT.head;` and `const asset = block.asset ?? null;`; the header's `background: headFill`; before the `<header>`:

```tsx
      {asset?.kicker ? (
        <p data-kicker style={{ ...textStyle(PRINT.size.small, PRINT.muted), margin: `0 0 ${mm(1)}` }}>
          {asset.kicker}
        </p>
      ) : null}
```

and replace the `kv` line with:

```tsx
      {asset?.height_locator ? (
        <div className="grid items-start" style={{ gridTemplateColumns: `${mm(22)} 1fr`, gap: mm(0), marginTop: mm(3) }}>
          <AssetDrawingSvg drawing={asset.height_locator} label="Height on the asset" widthMm={18} />
          {block.kv.length > 0 ? <KvBlock block={{ kind: "kv", rows: block.kv }} /> : <span />}
        </div>
      ) : block.kv.length > 0 ? (
        <KvBlock block={{ kind: "kv", rows: block.kv }} />
      ) : null}
```

(22 mm is the PDF's 18 mm locator plus its 4 mm gap.)

- [ ] **Step 3: Run**

Run: `pnpm -C frontend exec vitest run src/reports`
Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add frontend/src/reports/preview/blocks/FindingBlock.tsx frontend/src/reports/preview/blocks/TableBlock.tsx frontend/src/reports/preview/PreviewContext.ts frontend/src/reports/preview/coverBrand.ts frontend/src/reports/preview/blocks/assetBlocks.test.tsx
git commit -m @'
feat(reports): preview asset finding panel and brand head fill, matching the PDF

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 14: Builder controls for the new options

**Files:**
- Modify: `frontend/src/reports/SectionOptions.tsx`
- Modify: `frontend/src/reports/ReportSettings.tsx` (a "Tables" region; U6's brand select is untouched)
- Test: `frontend/src/reports/SectionOptions.test.tsx` (new), `frontend/src/reports/ReportSettings.test.tsx` (one case)

**Interfaces:**
- Consumes: Task 4's config shape (generated types).
- Produces: the findings table column checkboxes Zone, Side, Height, Sightings; the finding pages "Pages for" select (`min_severity`); the asset summary switches "Findings map" (`show_map`) and "Zone and side tables" (`show_tables`); the "Tables" region with the "CSV layout" segmented control (`csv_layout`). Copy is sentence case with no dashes.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/reports/SectionOptions.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { reportConfig } from "@/test/reportBuilderFixtures";
import { SectionOptions } from "./SectionOptions";

const sectionOf = (key: string) => reportConfig().sections.find((s) => s.key === key)!;

describe("SectionOptions for the asset report (spec 2026-10-02-asset-findings §10)", () => {
  it("offers the four asset columns", () => {
    const onChange = vi.fn();
    render(<SectionOptions section={sectionOf("findings_table")} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Zone"));
    expect(onChange.mock.calls[0][0].columns).toContain("zone");
    for (const name of ["Side", "Height", "Sightings"]) expect(screen.getByLabelText(name)).toBeInTheDocument();
  });

  it("sets the pages' minimum severity, and clears it", () => {
    const onChange = vi.fn();
    render(<SectionOptions section={sectionOf("finding_pages")} onChange={onChange} />);
    const select = screen.getByLabelText("Pages for");
    fireEvent.change(select, { target: { value: "2" } });
    expect(onChange).toHaveBeenLastCalledWith({ min_severity: 2 });
    fireEvent.change(select, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ min_severity: null });
  });

  it("switches the asset summary's map and tables", () => {
    const onChange = vi.fn();
    render(<SectionOptions section={sectionOf("asset_summary")} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Findings map"));
    expect(onChange).toHaveBeenLastCalledWith({ show_map: false });
    fireEvent.click(screen.getByLabelText("Zone and side tables"));
    expect(onChange).toHaveBeenLastCalledWith({ show_tables: false });
  });
});
```

Append inside the `describe("ReportSettings", ...)` block of `frontend/src/reports/ReportSettings.test.tsx`:

```tsx
  it("chooses the CSV layout", () => {
    const { latest } = setup();
    const tables = screen.getByRole("region", { name: "Tables" });
    fireEvent.click(within(tables).getByRole("radio", { name: "Asset sightings" }));
    expect(latest().csv_layout).toBe("asset_sightings");
  });
```

Run: `pnpm -C frontend exec vitest run src/reports/SectionOptions.test.tsx src/reports/ReportSettings.test.tsx`
Expected: FAIL (no "Zone" checkbox, no "Pages for", no "Tables" region).

- [ ] **Step 2: Implement**

`SectionOptions.tsx`:
- `TABLE_COLUMNS` gains `["zone", "Zone"], ["side", "Side"], ["height", "Height"], ["sightings", "Sightings"]`. The default list passed to `list(o, "columns", ...)` stays the first seven: change that call's default to `TABLE_COLUMNS.slice(0, 7).map(([v]) => v)`.
- Add `const SEVERITY_FLOORS = [1, 2, 3, 4] as const;` and, in the `finding_pages` case after the photos field:

```tsx
          <Field label="Pages for" htmlFor={`${id}-min-severity`} hint="The findings table still lists every finding.">
            <Select
              id={`${id}-min-severity`}
              value={typeof o.min_severity === "number" ? String(o.min_severity) : ""}
              onChange={(e) => onChange({ min_severity: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Every finding</option>
              {SEVERITY_FLOORS.map((n) => (
                <option key={n} value={n}>
                  {`Severity ${n} and above`}
                </option>
              ))}
            </Select>
          </Field>
```

- Add a case:

```tsx
    case "asset_summary":
      return (
        <div className="flex flex-col gap-3">
          <Switch
            checked={bool(o, "show_map", true)}
            onChange={(v) => onChange({ show_map: v })}
            label="Findings map"
          />
          <Switch
            checked={bool(o, "show_tables", true)}
            onChange={(v) => onChange({ show_tables: v })}
            label="Zone and side tables"
          />
        </div>
      );
```

`ReportSettings.tsx`: add `type CsvLayout = ReportConfig["csv_layout"];` and, after the "Paper" region:

```tsx
      <Region title="Tables">
        <Segmented<CsvLayout>
          label="CSV layout"
          size="sm"
          options={[
            { value: "findings", label: "Findings" },
            { value: "asset_sightings", label: "Asset sightings" },
          ]}
          value={config.csv_layout}
          onChange={(csv_layout) => onEdit((c) => ({ ...c, csv_layout }))}
          className="self-start"
        />
        <p className="text-2xs text-muted">
          Asset sightings writes one row per photo sighting in the inspection kit&apos;s columns.
        </p>
      </Region>
```

- [ ] **Step 3: Run**

Run: `pnpm -C frontend exec vitest run src/reports; pnpm -C frontend lint`
Expected: PASS, and `check-tokens` clean.

- [ ] **Step 4: Commit**

```powershell
git add frontend/src/reports/SectionOptions.tsx frontend/src/reports/ReportSettings.tsx frontend/src/reports/SectionOptions.test.tsx frontend/src/reports/ReportSettings.test.tsx
git commit -m @'
feat(reports): builder controls for asset columns, min severity, asset summary and CSV layout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 15: Gate, merge and walkthrough

- [ ] **Step 1: Run the full gate (AGENTS.md)**

```powershell
pnpm -C contract check
cd backend; .\.venv\Scripts\python.exe -m ruff check .; .\.venv\Scripts\python.exe -m ruff format --check .; .\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
```

and, only if `frontend/src-tauri/binaries/kestrel-backend-*.exe` exists: `cargo test --manifest-path frontend/src-tauri/Cargo.toml`.
Expected: every command clean. R1 adds no dependency, so no frozen build is needed; `backend\scripts\smoke_frozen.ps1` is still worth a run if the binary is present, because `reports-selftest` counts the fonts.

- [ ] **Step 2: Merge and clean up** (`scripts\finish-task.ps1 -Name af-r1`; on PowerShell 5.1 merge by hand, see memory "Nested unit controllers"). Remove the worktree and delete `task/af-r1`.

- [ ] **Step 3: The operator's walkthrough** (record it in the ledger; X repeats it on the acceptance data):
  1. Open a project with an asset model, findings on it and posed photos (the synthetic tower from X Step 1 works).
  2. Reports, New report. In the section list turn on "Asset summary"; the preview shows the tiles, the findings map with one dot per placed finding and the zone and side tables.
  3. Open "Finding pages" options, set "Pages for" to "Severity 2 and above"; the preview drops the minor findings' pages. Each asset finding page shows the kicker line, the photo, the 3D model view, the close-up and the height locator beside the facts.
  4. In "Findings table" tick Zone, Side, Height and Sightings; the table gains the four columns.
  5. In the Cover region pick a brand (U6's select); the preview cover and the table heads take the brand's colours.
  6. In "Tables" choose "Asset sightings", tick CSV and PDF, Render. Open the version folder: `sightings.csv` opens in Excel with the kit's 21 columns; the PDF shows the brand's footer line and website, the header logo and the cover logo bottom left of the band.

- [ ] **Step 4: Wrap up** with `/wrapup` (session note and north star).

---

## Self-review

**Spec coverage (§10 and what R1 owns of §12):**
- Section `asset_summary` (tiles: findings, by severity, sightings, uncertain photos; the findings map from P1's geometry as a reportlab vector drawing; zone and side tables): Tasks 3, 4, 8.
- `finding_pages` for asset findings (kicker, photo with the polygon overlay, close-up crop, 3D locator rendered on the server along the normal with a pin or patch outline in the severity colour, SVG height locator on the silhouette, facts in profile order, note): Tasks 5, 6, 7, 8, 13.
- `finding_pages.min_severity`: Tasks 4, 7, 14.
- Findings table columns zone, side, height, sightings: Tasks 4, 14.
- CSV layout `asset_sightings` (21 columns, BOM, CRLF, the kit's quoting, photos without findings with empty ids), byte-exact fixture test: Task 12.
- Brand in the PDF (cover colours and logo, header logo, footer website and confidentiality replacing the hard-coded footer at `canvas.py:80`, brand fonts registered with reportlab): Tasks 9, 10; preview parity for blocks: Task 13 (U6 owns the preview cover).
- No em or en dash in report source or preview copy, pinned by a grep test over `backend/app/reports/**` and `frontend/src/reports/**` (coordinator ruling): Task 8 Steps 1 and 2.
- PDF rule tests (no em or en dash in extracted text, zero `/SMask`, fonts embedded, `qpdf --check` when present, else skipped) and byte determinism (existing tests plus a branded one): Tasks 8, 10, 11.
- C0 Appendix A (`csv_layout`, `asset_summary`, the columns, `min_severity`) with every ripple it lists: Task 4.

**Budget and DAG:** stated at the top; the only job is `report_render`; every read is paged or aggregated.

**Placeholders:** none. Two steps adapt to code another unit writes and name the exact change: Task 1 Step 10 and Task 4 Step 7 add the new required properties to whatever literals `tsc` reports.

**Type consistency:** `AssetDrawing` field names are identical in the YAML, `schemas.py`, `asset_drawing.py`, `asset_flowables.py` and `AssetDrawingSvg.tsx`; `ResolvedBrand` fields are used the same way in `brand.py`, `document.py` and the tests; `asset_locator` spec fields match between the YAML, `schemas.py`, `asset_pages._locator` and `snapshots/asset_locator.py`.

**Review Focus:** the index assigns no Review Focus test to R1.

**Last task is the gate:** Task 15.

## Index notes

1. **Report config changes come from C0's Appendix A and land in R1 Task 4.** The index's Interfaces table lists them under C0; C0's Index note 1 moves everything but `brand_id` to R1. The names are unchanged except `FindingPagesSection.min_severity`, which is `FindingPagesOptions.min_severity` (the real schema). `TITLE` of the section is "Asset summary" (C0's appendix). The section summarises one asset model, as `AssetSummaryOptions.asset_model_id` says (null is the first with findings in the filter).
2. **R1 adds report contract shapes no unit declared:** the `asset_map` block, `FindingBlock.asset` (`FindingAsset`), the shared `AssetDrawing` primitives, and the `asset_locator` snapshot kind. They are R1's own (R1 owns `backend/app/reports/*`), in Task 1, with `test_reports_contract.py`'s index kind sets extended. Drawing primitives travel in the document, so the preview needs no TypeScript twin of the height locator, and the map in the PDF is P1's geometry exactly.
3. **`get_brand` takes the catalogue handle** (D2 Index note 1): R1 calls `get_brand(handle.catalogue, brand_id)`. **Brand logos are app-level files** resolved with D2's `store.logo_path(cat, logo_id)`, not project report assets. **Fonts are D2's bundled families**, registered through `app.brands.fonts.register_family`; R1 reads `theme["fonts"].get("numerals", theme["fonts"]["sans"])`.
4. **Preview brand split with U6.** U6 builds the brand picker in `ReportSettings.tsx` and brands the preview cover (`CoverBrand`, `coverBrandOf`); R1 only adds `CoverBrand.headFill` for the table head and finding band. The PDF places the brand's on-dark logo bottom left of the cover band, as U6's preview does (U6 Index note 3). The preview has no page header or footer today, branded or not, so the brand footer and header logo are PDF only.
5. **P1 names used:** `MapDot(id, height_m, bearing_deg, severity)` (the index wrote `MapDot` without fields); `geometry(...)` keys as P1 Task 4 lists; `ReviewConfig.facts`, `focus.frustum` (a `(min, max)` pair of half-height fractions; the locator frames `frustum[0] * height`, at least 2 m), `focus.oblique_deg`, `sides.basis`.
6. **The 3D locator reads J3's patch file directly** at `asset_models/<id>/placements/v<n>/<sighting>.bin` (spec §5.7), deriving the vertex count as `bytes // 20`. If J3 changes that layout, `snapshots/asset_locator.patch_bin` and `patch_outline` are the two places to follow.
7. **Unplaced sightings in the CSV:** height and zone are empty (index Data rules); `side_approx` prints the kit's `Not placed` so the acceptance comparison on side still matches the kit row for row.

**Spec gaps found:**
- §10 says the 3D locator is "orthographic along the normal" but gives no framing: R1 frames a square of `focus.frustum[0] x height` around the finding (the kit's focus convention), culling the rest of the mesh.
- §10 lists the brand footer and header logo for the PDF; no unit draws page furniture in the preview, so those stay PDF only (note 4).
