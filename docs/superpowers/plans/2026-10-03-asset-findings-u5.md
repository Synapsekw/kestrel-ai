# Asset findings U5: Overview asset hero, findings map component and card

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An asset-inspection project's Overview leads with its asset:
- **Hero:** the live GLB, auto-rotating, at the cloud hero's size, with the same static fallback as `CloudPreview.tsx`.
- **Side column:** the **asset findings map** card, an SVG of height by side with the silhouette, levels, zone bands and severity dots. Hovering a dot shows a tip, and clicking it opens the finding.
- **Photo outcome bar:** finding, uncertain, no finding, not assessed. Each part links to the image browser filtered by that status.

**Architecture:**
- **Backend (small).** `GET /overview` picks a ready asset model that has a review profile as the hero (`OverviewHero.kind = asset_model`), ahead of the map. It gains `photo_review`, the photo counts by `image_review.status`: one `GROUP BY` over `image_review`, never `image`, `box` or `finding`, so the statement counter in `tests/test_overview.py` still holds.
- **`frontend/src/assetmodels/findingsMap/FindingsMap.tsx`** is a pure SVG component. All layout comes from P1's TS twin `geometry(review, frame, dots)` (`frontend/src/assetmodels/findingsMap/geometry.ts`), the same numbers as the report's `findings_map.py`. The component draws, colours dots by the severity scale as data through `--c`, and handles hover, focus and click. U2 reuses it in the asset workspace.
- **`useAssetMapDots`** reads the model's placed open and reviewed findings: keyset-paged at 500 per page, at most 4,000 dots. It re-reads on `findings.changed`.
- **`overview/AssetPreview.tsx`** mirrors `CloudPreview.tsx`:
  - the same in-view, reduced-effects, probe-settled and error-boundary rules;
  - it mounts the lazy `ModelViewer` (M1 U6 engine) and calls U1's `setAutoRotate(true)` once the model is running;
  - `AssetStaticCard.tsx` is the fallback.
- **`overview/AssetMapCard.tsx`** holds the map and `OutcomeBar.tsx`. `compose.ts` gains an `assetMap` pane in the side column.

**Tech Stack:** React 18 and TypeScript, three 0.180 (through M1's lazy viewer), Vitest and Testing Library, Playwright with SwiftShader on the Prism mock; FastAPI and pytest for the overview payload.

**Spec sections covered:** §9 "Overview" (asset hero, asset findings map card, outcome bar) and §9 "Asset findings map" (the SVG component, its hover tip and its click).

**Index and Global Constraints:** `docs/superpowers/plans/2026-10-03-asset-findings.md`

**Needs:**
- **U1 merged**: `ModelEngine.setAutoRotate`. `ModelViewerHandle` is `Omit<ModelEngine, "load" | "dispose">`, so U1's change exposes it on the viewer handle.
- **P1 merged**: `geometry.ts` and the parity fixture.
- **D1 merged**: `AssetModel.review` and `ImageReview`, for Task 1.
- **U4 merged**: `imagesReviewPath`, the image browser's `?review=` entry, and `frontend/src/test/assetFindingFixtures.ts`.
- **M1 U6 and U7** are on `main`: `assetmodels/viewer/engine.ts`, `ModelViewer.tsx` and `useAssetModels.ts`.

All four units land in batches 2 and 3 before U5 starts its last task. Tasks 2 to 4 need only U1 and P1.

**Worktree:** `scripts\start-task.ps1 -Name af-u5`

**Budget (Global Constraints):**
- There is no background job in this unit.
- **Bounded reads:**
  - The Overview payload stays one pre-aggregated read. `photo_review` is a `GROUP BY` over `image_review`, one row per reviewed photo and indexed by primary key, and the hero adds one `LIMIT 1` over `asset_model`. Neither reads `image`, `box` or `finding`.
  - The map's dots are keyset pages of 500 findings, stopped at 4,000 (`MAP_DOTS_MAX`); the card says so when it stops.
  - The model is one `GET /asset-models/{id}` per card.
  - The GLB is fetched only while the hero is in view, effects are full and Auto's probe has settled. Under reduced effects it is never fetched.

**Execution DAG:**
- Task 1 (backend and contract) is independent of Tasks 2 to 5.
- Task 2 (compose) is independent.
- Task 3 (FindingsMap and dots) needs P1.
- Task 4 (AssetPreview) needs U1.
- Task 5 (AssetMapCard and OutcomeBar) needs Task 3 and U4.
- Task 6 (OverviewScreen) needs Tasks 1, 2, 4 and 5.
- Task 7 (e2e) needs Task 6.
- Task 8 is the gate.

Parallel batches: {1, 2, 3, 4}, then 5, then 6, then 7, then 8. **Critical path:** 3, 5, 6, 7, 8.

---

### Task 1: Overview payload: asset hero and photo review counts

**Files:**
- Modify: `contract/openapi.yaml` (`OverviewHero.kind`, new `PhotoReviewCounts`, `ProjectOverview.photo_review`)
- Regenerate: `contract/client/schema.d.ts`
- Modify: `backend/app/overview/schemas.py`
- Modify: `backend/app/overview/service.py`
- Test: `backend/tests/test_overview.py`

**Interfaces:**
- Consumes (D1): `app.db.models.AssetModel.review` (JSON, nullable); `app.db.models.ImageReview`; `app.asset_review.review_status.set_status(s, image_id, status, note="")`.
- Produces:
  - `OverviewHero.kind` gains `asset_model`, chosen first when a model is `ready`, has a `current_version` and has a non-null `review`;
  - `ProjectOverview.photo_review?: PhotoReviewCounts | null`, where `PhotoReviewCounts {finding, none, uncertain, not_assessed: int}`. It is null when no photo has a review status;
  - Python: `app.overview.service.hero_asset_model_id(s) -> str | None`, `photo_review(s) -> dict | None`.

- [ ] **Step 1: Write the failing backend tests**

In `backend/tests/test_overview.py`, extend `test_an_empty_project` with a last line:

```python
    assert out["photo_review"] is None
```

Append:

```python
def _asset_model(handle, *, review: dict | None, status: str = "ready", version: int | None = 1) -> str:
    from app.db.models import AssetModel

    with handle.session() as s:
        row = AssetModel(name="Stack", status=status, current_version=version, review=review)
        s.add(row)
        s.flush()
        return row.id


def test_the_hero_is_a_reviewed_asset_model_before_the_map(client, project, handle):
    april = _map(handle, "April", "ready", date(2026, 4, 1))
    _asset_model(handle, review=None)  # built, but no review profile: not an inspected asset
    assert _overview(client, project)["hero"] == {"kind": "map", "id": april}
    _asset_model(handle, review={"profile_id": "stack"}, status="building", version=None)  # not built yet
    assert _overview(client, project)["hero"] == {"kind": "map", "id": april}
    model = _asset_model(handle, review={"profile_id": "stack"})
    assert _overview(client, project)["hero"] == {"kind": "asset_model", "id": model}


def test_photo_review_counts_by_status(client, project, handle):
    from image_summary_helpers import new_image

    from app.asset_review.review_status import set_status

    ids = [new_image(handle) for _ in range(4)]
    assert _overview(client, project)["photo_review"] is None  # photos, but none reviewed yet
    with handle.session() as s:
        set_status(s, ids[0], "uncertain")
        set_status(s, ids[1], "uncertain")
        set_status(s, ids[2], "none")
        set_status(s, ids[3], "finding")
    assert _overview(client, project)["photo_review"] == {
        "finding": 1,
        "none": 1,
        "uncertain": 2,
        "not_assessed": 0,
    }


def test_the_asset_reads_keep_the_overview_cost_flat(client, project, handle):
    """The two new reads run on every call, so the statement count does not depend on the project."""
    from image_summary_helpers import new_image

    from app.asset_review.review_status import set_status

    empty, _ = _counted(handle.engine, lambda: _overview(client, project))
    _asset_model(handle, review={"profile_id": "stack"})
    image = new_image(handle)
    with handle.session() as s:
        set_status(s, image, "none")
    seen, out = _counted(handle.engine, lambda: _overview(client, project))
    assert len(seen) == len(empty), (empty, seen)
    assert [st for st in seen if FORBIDDEN.search(st)] == []
    assert out["hero"]["kind"] == "asset_model"
```

- [ ] **Step 2: Run them and see them fail**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_overview.py -q`
Expected: FAIL. `photo_review` is missing from the payload, and the hero stays `map`.

- [ ] **Step 3: Contract**

In `contract/openapi.yaml`:

1. Replace the `OverviewHero` schema's `description` and `kind` with:

```yaml
    OverviewHero:
      type: object
      description: >-
        what the Overview's big pane shows; the first of a ready asset model with a review profile
        (asset findings spec §9), a ready map, a ready point cloud, the photos, a ready drawing
      required: [kind, id]
      properties:
        kind: { type: string, enum: [asset_model, map, point_cloud, images, drawing] }
        id: { type: [string, "null"], description: "null for `images`: the client reads the newest frames" }
```

2. Directly after `OverviewHero`, add:

```yaml
    PhotoReviewCounts:
      type: object
      description: photos by review status (asset findings spec §5.4); a photo never reviewed is not counted
      required: [finding, none, uncertain, not_assessed]
      properties:
        finding: { type: integer, minimum: 0 }
        none: { type: integer, minimum: 0 }
        uncertain: { type: integer, minimum: 0 }
        not_assessed: { type: integer, minimum: 0 }
```

3. In `ProjectOverview.properties`, after `banners`, add (not in `required`, so older mocks stay valid):

```yaml
        photo_review:
          description: null until a photo has a review status
          oneOf:
            - $ref: "#/components/schemas/PhotoReviewCounts"
            - type: "null"
```

Run: `pnpm -C contract generate; pnpm -C contract check`
Expected: PASS; `schema.d.ts` regenerated.

- [ ] **Step 4: Backend**

In `backend/app/overview/schemas.py`:

```python
class Hero(BaseModel):
    kind: Literal["asset_model", "map", "point_cloud", "images", "drawing"]
    id: str | None


class PhotoReviewCounts(BaseModel):
    finding: int = 0
    none: int = 0
    uncertain: int = 0
    not_assessed: int = 0
```

and add the field to `ProjectOverview`, after `banners`:

```python
    photo_review: PhotoReviewCounts | None = None
```

In `backend/app/overview/service.py`:

1. Change the models import to `from app.db.models import AssetModel, Drawing, GeoMap, ImageReview, PointCloud, Source, Surface, VolumeMeasurement`.
2. Extend the module docstring's second sentence to: "Nothing here reads `finding`, `box` or `image` (a statement counter in tests/test_overview.py pins it), except `project_summary`'s cover, which takes the newest image by rowid: one row, no scan. `photo_review` groups `image_review`, at most one row per reviewed photo."
3. Above `def hero(`, add:

```python
REVIEW_STATUSES = ("finding", "none", "uncertain", "not_assessed")


def hero_asset_model_id(s: Session) -> str | None:
    """The newest built asset model with a review profile (asset findings spec section 9). A JSON
    null and an SQL NULL both mean "no profile"."""
    return s.execute(
        select(AssetModel.id)
        .where(
            AssetModel.status == "ready",
            AssetModel.current_version.is_not(None),
            func.coalesce(func.json_type(AssetModel.review), "null") != "null",
        )
        .order_by(AssetModel.updated_at.desc(), AssetModel.id.desc())
        .limit(1)
    ).scalar_one_or_none()


def photo_review(s: Session) -> dict | None:
    """Photos by review status; None until any photo has one (spec section 5.4)."""
    rows = s.execute(select(ImageReview.status, func.count()).group_by(ImageReview.status)).all()
    if not rows:
        return None
    out = dict.fromkeys(REVIEW_STATUSES, 0)
    for status, n in rows:
        out[status] = n
    return out
```

4. In `hero()`, read the asset model first (every candidate is read every time) and return it first:

```python
def hero(s: Session, data: dict, map_id: str | None) -> dict | None:
    """Spec 2026-09-30-project-landing section 4.1, with the asset model first (asset findings spec
    section 9). Every candidate is read every time, so the Overview's statement count does not
    depend on what the project holds."""
    asset_id = hero_asset_model_id(s)
    cloud_id = newest_ready_cloud_id(s)
    drawing_id = s.execute(
        select(Drawing.id)
        .where(Drawing.status == "ready")
        .order_by(Drawing.created_at.desc(), Drawing.id.desc())
        .limit(1)
    ).scalar_one_or_none()
    if asset_id:
        return {"kind": "asset_model", "id": asset_id}
    if map_id:
        return {"kind": "map", "id": map_id}
    if cloud_id:
        return {"kind": "point_cloud", "id": cloud_id}
    if data["images"] > 0:
        return {"kind": "images", "id": None}
    if drawing_id:
        return {"kind": "drawing", "id": drawing_id}
    return None
```

5. In `build()`, add `"photo_review": photo_review(s),` to `payload`, after `"hero"`.

- [ ] **Step 5: Run the tests**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_overview.py tests/test_overview_site.py tests/test_contract.py -q`
Expected: PASS. `test_the_overview_costs_the_same_whatever_the_project_holds` still passes, because both new reads run on the empty and the full call.

Run: `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check app/overview tests/test_overview.py; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check app/overview tests/test_overview.py`
Expected: clean.

Run: `pnpm -C frontend exec tsc -p tsconfig.app.json --noEmit`
Expected: no errors. `HeroKind` in `compose.ts` is its own union, and `facts.heroKind` takes `hero?.kind`, so if `tsc` reports `"asset_model"` not assignable to `HeroKind`, do Task 2 Step 3's `HeroKind` line now and include `compose.ts` in this commit.

- [ ] **Step 6: Commit**

```bash
git add contract/openapi.yaml contract/client/schema.d.ts backend/app/overview/schemas.py backend/app/overview/service.py backend/tests/test_overview.py
git commit -m "feat(overview): asset model hero and photo review counts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Compose the asset map pane

**Files:**
- Modify: `frontend/src/overview/compose.ts`
- Modify: `frontend/src/overview/OverviewScreen.tsx` (only the `SKELETON` facts: `hasAssetMap: false`)
- Test: `frontend/src/overview/compose.test.ts`

**Interfaces:**
- Produces:
  - `HeroKind` gains `"asset_model"`;
  - `OverviewFacts.hasAssetMap: boolean`;
  - `PaneId` gains `"assetMap"`.

  The side column (columns 9 to 12, rows 2 and 3) takes at most two panes, in the order asset map, cloud, location. A lone side pane spans both rows.

- [ ] **Step 1: Write the failing test**

In `frontend/src/overview/compose.test.ts`, add `hasAssetMap: false,` to the `everything` object, then add:

```ts
  it("asset hero: the findings map takes the side column, over location", () => {
    const f = { ...everything, heroKind: "asset_model" as const, hasAssetMap: true, hasCloud: false };
    expect(ids(f)).toEqual(["header", "hero", "assetMap", "location", "findings", "imagery", "status"]);
    expect(pane(f, "assetMap")).toEqual({ id: "assetMap", col: "9 / -1", row: "2" });
    expect(pane(f, "location")).toEqual({ id: "location", col: "9 / -1", row: "3" });
  });

  it("asset hero alone: the findings map spans both side rows", () => {
    const f = { ...everything, heroKind: "asset_model" as const, hasAssetMap: true, hasCloud: false, hasSite: false };
    expect(pane(f, "assetMap")).toEqual({ id: "assetMap", col: "9 / -1", row: "2 / span 2" });
  });

  it("the side column holds two panes at most: the asset map first, then the cloud", () => {
    const f = { ...everything, heroKind: "asset_model" as const, hasAssetMap: true };
    expect(ids(f)).toEqual(["header", "hero", "assetMap", "cloud", "findings", "imagery", "status"]);
  });
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm -C frontend exec vitest run src/overview/compose.test.ts`
Expected: FAIL (`hasAssetMap` is unknown and there is no `assetMap` pane).

- [ ] **Step 3: Implement**

In `frontend/src/overview/compose.ts`:

```ts
export type HeroKind = "asset_model" | "map" | "point_cloud" | "images" | "drawing";

export interface OverviewFacts {
  heroKind: HeroKind | null;
  dataTotal: number;
  hasCloud: boolean;
  hasImages: boolean;
  hasSite: boolean;
  /** The hero is an asset model, so its findings map sits beside it (asset findings spec §9). */
  hasAssetMap: boolean;
  findingsTotal: number;
  runningJobs: boolean;
}

export type PaneId =
  "header" | "hero" | "assetMap" | "cloud" | "location" | "findings" | "imagery" | "status" | "firstData";

/** The side column fits two panes; earlier entries win. */
const SIDE_MAX = 2;
```

and in `composeOverview`, replace the side block with:

```ts
  const side: PaneId[] = [];
  if (f.hasAssetMap) side.push("assetMap");
  if (f.hasCloud && f.heroKind !== "point_cloud") side.push("cloud");
  if (f.hasSite) side.push("location");
  const shown = side.slice(0, SIDE_MAX);
  panes.push({ id: "hero", col: shown.length ? "1 / span 8" : "1 / -1", row: "2 / span 2" });
  shown.forEach((id, i) =>
    panes.push({ id, col: "9 / -1", row: shown.length === 1 ? "2 / span 2" : String(2 + i) }),
  );
```

In `frontend/src/overview/OverviewScreen.tsx`, add `hasAssetMap: false,` to the `SKELETON` facts. Task 6 sets the real value.

- [ ] **Step 4: Run the tests**

Run: `pnpm -C frontend exec vitest run src/overview/compose.test.ts src/overview/OverviewScreen.test.tsx`
Expected: PASS. `OverviewScreen.tsx` does not yet pass `hasAssetMap` in `facts`, so `tsc` would fail on the screen; add `hasAssetMap: false,` to the `facts` object too, as a stopgap that Task 6 replaces.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/overview/compose.ts frontend/src/overview/compose.test.ts frontend/src/overview/OverviewScreen.tsx
git commit -m "feat(overview): an asset map pane in the side column

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The findings map component and its dots

**Files:**
- Create: `frontend/src/assetmodels/findingsMap/FindingsMap.tsx`
- Create: `frontend/src/assetmodels/findingsMap/useAssetMapDots.ts`
- Test: `frontend/src/assetmodels/findingsMap/FindingsMap.test.tsx` (geometry mocked: the render contract)
- Test: `frontend/src/assetmodels/findingsMap/FindingsMap.geometry.test.tsx` (P1's real geometry: the two fit)
- Test: `frontend/src/assetmodels/findingsMap/useAssetMapDots.test.tsx`

**Interfaces:**
- Consumes (P1, TS twin `frontend/src/assetmodels/findingsMap/geometry.ts`), as named in the index. The field names below are what U5 reads (see Index notes):

```ts
export interface MapDot {
  id: string;
  number: number;
  severity: number | null;
  height_m: number;
  bearing_deg: number | null;
  side: string | null;
  zone: string | null;
}
export interface MapGeometry {
  width: number;
  height: number;
  plot: { x: number; y: number; w: number; h: number };
  /** SVG path data in viewBox units: the silhouette drawn over the side axis. */
  silhouette: string;
  levels: { y: number; label: string }[];
  zones: { id: string; label: string; y0: number; y1: number }[];
  x_ticks: { x: number; label: string }[];
  y_ticks: { y: number; label: string }[];
  dots: { id: string; x: number; y: number; severity: number | null }[];
}
export function geometry(review: AssetReviewConfig, frame: AssetFrame, dots: MapDot[]): MapGeometry;
```

- Consumes: `listFindings` (`frontend/src/api/findings.ts`) with C0's `asset_model_id`, `placed`, `status` and `sort` query; `useChangesStore` (`findingsRevision`); `severityOf`, `useSeverityScale` (`@/ui`).
- Produces (index binding):
  - `<FindingsMap review frame dots onOpen className? />`, where `review: AssetReviewConfig`, `frame: AssetFrame`, `dots: readonly MapDot[]` and `onOpen: (findingId: string) => void`. It renders `<svg role="img">` named "Findings map, N findings by height and side". Each dot is a `role="button"` circle (`data-testid="map-dot"`), focusable, opened by click, Enter or Space. A tooltip (`role="tooltip"`) shows on hover or focus.
  - `MAP_DOTS_PAGE = 500`, `MAP_DOTS_MAX = 4000`;
  - `toMapDot(f: Finding): MapDot | null`;
  - `fetchMapDots(api, projectId, modelId): Promise<{dots: MapDot[]; truncated: boolean}>`;
  - `useAssetMapDots(projectId, modelId): {dots: MapDot[] | null; truncated: boolean; error: string | null}`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/assetmodels/findingsMap/FindingsMap.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_SEVERITY_SCALE } from "@/ui";
import {
  ASSET_FINDING_ID,
  ASSET_FINDING_ID_2,
  exampleAssetFinding,
  exampleAssetFinding2,
  exampleAssetModel,
} from "@/test/assetFindingFixtures";
import { toMapDot } from "./useAssetMapDots";
import { FindingsMap } from "./FindingsMap";
import { geometry } from "./geometry";

const h = vi.hoisted(() => ({
  geo: {
    width: 320,
    height: 480,
    plot: { x: 40, y: 20, w: 260, h: 430 },
    silhouette: "M 140 20 L 200 20 L 210 450 L 130 450 Z",
    levels: [{ y: 128, label: "60 m" }],
    zones: [
      { id: "head", label: "Head", y0: 20, y1: 54 },
      { id: "shaft", label: "Shaft", y0: 54, y1: 368 },
      { id: "base", label: "Base", y0: 368, y1: 450 },
    ],
    x_ticks: [
      { x: 40, label: "N" },
      { x: 105, label: "E" },
    ],
    y_ticks: [{ y: 450, label: "0 m" }],
    dots: [
      { id: "f0000000-9999-4000-8000-000000000401", x: 105, y: 222, severity: 3 },
      { id: "f0000000-9999-4000-8000-000000000402", x: 185, y: 34, severity: 1 },
    ],
  },
}));
vi.mock("./geometry", () => ({ geometry: vi.fn(() => h.geo) }));

const dots = [toMapDot(exampleAssetFinding)!, toMapDot(exampleAssetFinding2)!];

function draw(onOpen = vi.fn()) {
  render(
    <FindingsMap
      review={exampleAssetModel.review!}
      frame={exampleAssetModel.frame!}
      dots={dots}
      onOpen={onOpen}
    />,
  );
  return onOpen;
}

describe("FindingsMap", () => {
  it("lays out through the shared geometry with the model's review, frame and dots", () => {
    draw();
    expect(geometry).toHaveBeenCalledWith(exampleAssetModel.review, exampleAssetModel.frame, dots);
  });

  it("draws the silhouette, levels, zone bands and one dot per finding", () => {
    draw();
    expect(screen.getByRole("img", { name: "Findings map, 2 findings by height and side" })).toBeInTheDocument();
    expect(screen.getByTestId("silhouette")).toHaveAttribute("d", h.geo.silhouette);
    expect(screen.getAllByTestId("level")).toHaveLength(1);
    expect(screen.getAllByTestId("zone-band").map((z) => z.textContent)).toEqual(["Head", "Shaft", "Base"]);
    expect(screen.getAllByTestId("map-dot")).toHaveLength(2);
  });

  it("colours a dot by its severity level, as data through --c", () => {
    draw();
    const [first] = screen.getAllByTestId("map-dot");
    const colour = DEFAULT_SEVERITY_SCALE.find((l) => l.level === 3)!.colour;
    expect(first).toHaveClass("fill-[color:var(--c)]");
    expect(first.style.getPropertyValue("--c")).toBe(colour);
  });

  it("shows a tip on hover and on focus, and hides it on leave", () => {
    draw();
    const [first] = screen.getAllByTestId("map-dot");
    fireEvent.mouseEnter(first);
    expect(screen.getByRole("tooltip")).toHaveTextContent("F-0401");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Shaft · E · 42.5 m");
    fireEvent.mouseLeave(first);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.focus(first);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("opens a finding on click, Enter and Space", () => {
    const onOpen = draw();
    const [first, second] = screen.getAllByTestId("map-dot");
    fireEvent.click(first);
    expect(onOpen).toHaveBeenLastCalledWith(ASSET_FINDING_ID);
    fireEvent.keyDown(second, { key: "Enter" });
    expect(onOpen).toHaveBeenLastCalledWith(ASSET_FINDING_ID_2);
    fireEvent.keyDown(second, { key: " " });
    expect(onOpen).toHaveBeenCalledTimes(3);
  });
});
```

Create `frontend/src/assetmodels/findingsMap/FindingsMap.geometry.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { exampleAssetFinding, exampleAssetFinding2, exampleAssetModel } from "@/test/assetFindingFixtures";
import { FindingsMap } from "./FindingsMap";
import { toMapDot } from "./useAssetMapDots";

// P1's real geometry: the component and the TS twin fit together.
describe("FindingsMap with the shared geometry", () => {
  it("draws a silhouette and both placed findings of the example stack", () => {
    const dots = [toMapDot(exampleAssetFinding)!, toMapDot(exampleAssetFinding2)!];
    render(
      <FindingsMap review={exampleAssetModel.review!} frame={exampleAssetModel.frame!} dots={dots} onOpen={() => {}} />,
    );
    expect(screen.getByTestId("silhouette").getAttribute("d")).toMatch(/^M/);
    expect(screen.getAllByTestId("map-dot")).toHaveLength(2);
    expect(screen.getAllByTestId("zone-band")).toHaveLength(3);
  });
});
```

Create `frontend/src/assetmodels/findingsMap/useAssetMapDots.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  ASSET_MODEL_ID,
  exampleAssetFinding,
  exampleAssetFinding2,
  exampleUnplacedAssetFinding,
} from "@/test/assetFindingFixtures";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { MAP_DOTS_MAX, MAP_DOTS_PAGE, fetchMapDots, toMapDot, useAssetMapDots } from "./useAssetMapDots";

describe("toMapDot", () => {
  it("keeps a placed finding's map facts and drops an unplaced one", () => {
    expect(toMapDot(exampleAssetFinding)).toEqual({
      id: exampleAssetFinding.id,
      number: 401,
      severity: 3,
      height_m: 42.5,
      bearing_deg: 90,
      side: "E",
      zone: "shaft",
    });
    expect(toMapDot(exampleUnplacedAssetFinding)).toBeNull();
  });
});

describe("fetchMapDots", () => {
  it("asks for this model's placed, not closed findings and pages with the cursor", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/findings$/,
        body: (req) =>
          new URL(req.url, "http://fake").searchParams.get("cursor") === "c2"
            ? { items: [exampleAssetFinding2], next_cursor: null }
            : { items: [exampleAssetFinding, exampleUnplacedAssetFinding], next_cursor: "c2" },
      },
    ]);
    const r = await fetchMapDots(api, PROJECT_ID, ASSET_MODEL_ID);
    expect(r).toEqual({ dots: [toMapDot(exampleAssetFinding), toMapDot(exampleAssetFinding2)], truncated: false });
    const q = new URL(requests[0].url, "http://fake").searchParams;
    expect(q.get("asset_model_id")).toBe(ASSET_MODEL_ID);
    expect(q.get("placed")).toBe("true");
    expect(q.getAll("status")).toEqual(["open", "reviewed"]);
    expect(q.get("limit")).toBe(String(MAP_DOTS_PAGE));
    expect(requests).toHaveLength(2);
  });

  it("stops at the cap and says so", async () => {
    let n = 0;
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/findings$/,
        body: () => {
          n += 1;
          const items = Array.from({ length: MAP_DOTS_PAGE }, (_, i) => ({
            ...exampleAssetFinding,
            id: `f-${n}-${i}`,
          }));
          return { items, next_cursor: `c${n + 1}` };
        },
      },
    ]);
    const r = await fetchMapDots(api, PROJECT_ID, ASSET_MODEL_ID);
    expect(r.truncated).toBe(true);
    expect(r.dots).toHaveLength(MAP_DOTS_MAX);
    expect(requests).toHaveLength(MAP_DOTS_MAX / MAP_DOTS_PAGE);
  });

  it("a repeated cursor (the Prism mock) ends paging", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/findings$/, body: { items: [exampleAssetFinding], next_cursor: "same" } },
    ]);
    const r = await fetchMapDots(api, PROJECT_ID, ASSET_MODEL_ID);
    expect(r.truncated).toBe(false);
    expect(requests).toHaveLength(2);
  });
});

describe("useAssetMapDots", () => {
  it("re-reads on findings.changed without dropping the dots it shows", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/findings$/, body: { items: [exampleAssetFinding], next_cursor: null } },
    ]);
    const wrapper = ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
    const { result } = renderHook(() => useAssetMapDots(PROJECT_ID, ASSET_MODEL_ID), { wrapper });
    await waitFor(() => expect(result.current.dots).toHaveLength(1));
    act(() => useChangesStore.setState((s) => ({ findingsRevision: s.findingsRevision + 1 })));
    expect(result.current.dots).toHaveLength(1);
    await waitFor(() => expect(requests).toHaveLength(2));
  });
});
```

`TestApiProvider` is exported by `frontend/src/test/render.tsx`. If its prop is named differently from `api`, use the name `renderWithProviders` passes.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm -C frontend exec vitest run src/assetmodels/findingsMap`
Expected: FAIL (`FindingsMap.tsx` and `useAssetMapDots.ts` do not exist).

- [ ] **Step 3: Implement the dots**

Create `frontend/src/assetmodels/findingsMap/useAssetMapDots.ts`:

```ts
import { useEffect, useState } from "react";
import type { ApiClient } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listFindings, type Finding } from "@/api/findings";
import { useChangesStore } from "@/store/changes";
import type { MapDot } from "./geometry";

/** The API's findings page cap. */
export const MAP_DOTS_PAGE = 500;
/** Budget: the map draws at most this many dots; the card says when it stops. */
export const MAP_DOTS_MAX = 4000;
const MAX_PAGES = MAP_DOTS_MAX / MAP_DOTS_PAGE;

/** A placed finding's map facts; null without a height (unplaced: no zone, side or height). */
export function toMapDot(f: Finding): MapDot | null {
  if (f.height_m === null) return null;
  return {
    id: f.id,
    number: f.number,
    severity: f.severity,
    height_m: f.height_m,
    bearing_deg: f.bearing_deg,
    side: f.side,
    zone: f.zone,
  };
}

/** This model's placed findings that are not closed, keyset-paged, highest severity first. */
export async function fetchMapDots(
  api: ApiClient,
  projectId: string,
  modelId: string,
): Promise<{ dots: MapDot[]; truncated: boolean }> {
  const dots: MapDot[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await listFindings(api, projectId, {
      asset_model_id: modelId,
      placed: true,
      status: ["open", "reviewed"],
      sort: "-severity",
      limit: MAP_DOTS_PAGE,
      ...(cursor ? { cursor } : {}),
    });
    for (const f of res.items) {
      const d = toMapDot(f);
      if (d) dots.push(d);
    }
    // A repeated cursor (the Prism mock) ends paging instead of looping.
    if (!res.next_cursor || res.next_cursor === cursor) return { dots, truncated: false };
    cursor = res.next_cursor;
  }
  return { dots: dots.slice(0, MAP_DOTS_MAX), truncated: true };
}

interface Loaded {
  base: string;
  dots: MapDot[] | null;
  truncated: boolean;
  error: string | null;
}

/** The map's dots; re-read on `findings.changed`, keeping the last dots on screen meanwhile. */
export function useAssetMapDots(projectId: string, modelId: string) {
  const api = useApi();
  const revision = useChangesStore((s) => s.findingsRevision);
  const base = `${projectId}|${modelId}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    let live = true;
    fetchMapDots(api, projectId, modelId).then(
      (r) => {
        if (live) setLoaded({ base, dots: r.dots, truncated: r.truncated, error: null });
      },
      (e: unknown) => {
        if (live)
          setLoaded((prev) => ({
            base,
            dots: prev?.base === base ? prev.dots : null,
            truncated: false,
            error: messageOf(e, "could not load the findings map"),
          }));
      },
    );
    return () => {
      live = false;
    };
  }, [api, projectId, modelId, base, revision]);
  const current = loaded?.base === base ? loaded : null;
  return { dots: current?.dots ?? null, truncated: current?.truncated ?? false, error: current?.error ?? null };
}
```

- [ ] **Step 4: Implement the component**

Create `frontend/src/assetmodels/findingsMap/FindingsMap.tsx`:

```tsx
import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type SyntheticEvent } from "react";
import type { AssetModel } from "@contract/client";
import { formatFindingNumber, formatHeight } from "@/findings/format";
import { cx, GlassPanel, severityOf, useSeverityScale } from "@/ui";
import { geometry, type MapDot } from "./geometry";

export type AssetFrame = NonNullable<AssetModel["frame"]>;
export type AssetReviewConfig = NonNullable<AssetModel["review"]>;

export interface FindingsMapProps {
  review: AssetReviewConfig;
  frame: AssetFrame;
  dots: readonly MapDot[];
  onOpen: (findingId: string) => void;
  className?: string;
}

interface Tip {
  id: string;
  left: number;
  top: number;
}

/**
 * Spec §9 "Asset findings map": x is the side (compass bearing or face), y is height. Every
 * coordinate comes from `geometry`, the TS twin of the report's `findings_map.py`, so the Overview
 * and the PDF agree (shared fixture `contract/fixtures/asset-findings-map.json`).
 */
export function FindingsMap({ review, frame, dots, onOpen, className }: FindingsMapProps) {
  const scale = useSeverityScale();
  const g = useMemo(() => geometry(review, frame, [...dots]), [review, frame, dots]);
  const facts = useMemo(() => new Map(dots.map((d) => [d.id, d])), [dots]);
  const zoneLabel = useMemo(() => new Map(review.zones.map((z) => [z.id, z.label])), [review]);
  const host = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const font = g.height * 0.028;
  const dotR = g.height * 0.011;

  const tipText = (id: string): string => {
    const d = facts.get(id);
    if (!d) return "";
    const zone = d.zone ? (zoneLabel.get(d.zone) ?? d.zone) : null;
    return [
      formatFindingNumber(d.number),
      severityOf(scale, d.severity)?.name ?? null,
      zone,
      d.side,
      formatHeight(d.height_m),
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const show = (id: string) => (e: SyntheticEvent<SVGCircleElement>) => {
    const box = host.current?.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ id, left: r.left - (box?.left ?? 0) + r.width / 2, top: r.top - (box?.top ?? 0) });
  };
  const hide = () => setTip(null);
  const onKey = (id: string) => (e: KeyboardEvent<SVGCircleElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(id);
    }
  };

  return (
    <div ref={host} className={cx("relative min-h-0", className)}>
      <svg
        role="img"
        aria-label={`Findings map, ${g.dots.length} ${g.dots.length === 1 ? "finding" : "findings"} by height and side`}
        viewBox={`0 0 ${g.width} ${g.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
      >
        {g.zones.map((z, i) => (
          <g key={z.id} data-testid="zone-band">
            <rect
              x={g.plot.x}
              y={z.y0}
              width={g.plot.w}
              height={z.y1 - z.y0}
              className={i % 2 === 0 ? "fill-surface-2" : "fill-transparent"}
            />
            <text
              x={g.plot.x + g.plot.w - font * 0.4}
              y={z.y0 + font * 1.2}
              fontSize={font}
              textAnchor="end"
              className="fill-muted"
            >
              {z.label}
            </text>
          </g>
        ))}
        <path data-testid="silhouette" d={g.silhouette} className="fill-surface stroke-line-strong" strokeWidth={1} />
        {g.levels.map((l) => (
          <g key={`${l.y}-${l.label}`} data-testid="level">
            <line
              x1={g.plot.x}
              x2={g.plot.x + g.plot.w}
              y1={l.y}
              y2={l.y}
              className="stroke-line"
              strokeDasharray="2 3"
            />
            <text x={g.plot.x - font * 0.3} y={l.y} fontSize={font * 0.85} textAnchor="end" dominantBaseline="middle" className="fill-dim font-mono">
              {l.label}
            </text>
          </g>
        ))}
        {g.x_ticks.map((t) => (
          <text
            key={`${t.x}-${t.label}`}
            x={t.x}
            y={g.plot.y + g.plot.h + font * 1.2}
            fontSize={font}
            textAnchor="middle"
            className="fill-muted font-mono"
          >
            {t.label}
          </text>
        ))}
        {g.dots.map((d) => {
          const colour = severityOf(scale, d.severity)?.colour;
          return (
            <circle
              key={d.id}
              data-testid="map-dot"
              role="button"
              tabIndex={0}
              aria-label={tipText(d.id)}
              cx={d.x}
              cy={d.y}
              r={dotR}
              strokeWidth={dotR * 0.4}
              style={colour ? ({ "--c": colour } as CSSProperties) : undefined}
              className={cx(colour ? "fill-[color:var(--c)]" : "fill-muted", "cursor-pointer stroke-bg outline-none focus-visible:stroke-accent")}
              onMouseEnter={show(d.id)}
              onFocus={show(d.id)}
              onMouseLeave={hide}
              onBlur={hide}
              onClick={() => onOpen(d.id)}
              onKeyDown={onKey(d.id)}
            />
          );
        })}
      </svg>
      {tip && (
        <GlassPanel
          variant="float"
          role="tooltip"
          className="pointer-events-none absolute z-[2] -translate-x-1/2 -translate-y-full whitespace-nowrap px-2 py-1 font-mono text-2xs"
          style={{ left: tip.left, top: tip.top }}
        >
          {tipText(tip.id)}
        </GlassPanel>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm -C frontend exec vitest run src/assetmodels/findingsMap`
Expected: PASS for all three files. `FindingsMap.geometry.test.tsx` is the first test that runs P1's geometry under this component. If it fails because a field name differs from the `MapGeometry` shape above, follow Index note 1: change only the field reads in `FindingsMap.tsx` and the mocked object in `FindingsMap.test.tsx`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/assetmodels/findingsMap/FindingsMap.tsx frontend/src/assetmodels/findingsMap/useAssetMapDots.ts frontend/src/assetmodels/findingsMap/FindingsMap.test.tsx frontend/src/assetmodels/findingsMap/FindingsMap.geometry.test.tsx frontend/src/assetmodels/findingsMap/useAssetMapDots.test.tsx
git commit -m "feat(assetmodels): findings map component and its paged dots

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The asset hero: a live, auto-rotating GLB with a static fallback

**Files:**
- Modify: `frontend/src/api/assetModels.ts` (`getAssetModel`)
- Modify: `frontend/src/assetmodels/useAssetModels.ts` (`useAssetModel`)
- Create: `frontend/src/overview/PreviewBoundary.tsx` (moved out of `CloudPreview.tsx`)
- Modify: `frontend/src/overview/CloudPreview.tsx` (imports the boundary; behaviour unchanged)
- Create: `frontend/src/overview/AssetStaticCard.tsx`
- Create: `frontend/src/overview/AssetPreview.tsx`
- Test: `frontend/src/overview/AssetPreview.test.tsx`, `frontend/src/overview/AssetPreview.live.test.tsx`; the `CloudPreview` tests stay green

**Interfaces:**
- Consumes:
  - `ModelViewer` and `ModelViewerHandle` (`frontend/src/assetmodels/viewer/ModelViewer.tsx`);
  - U1's `ModelViewerHandle.setAutoRotate(on: boolean, speed?: number)`. The default speed is U1's;
  - `assetModelGlbUrl(baseUrl, token, projectId, assetModelId, version)` (`@contract/client`);
  - `reducedEffects`, `watchEffects` (`@/clouds/viewer/edl`); `autoProbeSettled` (`@/app/effects`); `useInView`.
- Produces:
  - `getAssetModel(api, projectId, id): Promise<AssetModel>`;
  - `useAssetModel(projectId, modelId): {model: AssetModel | null | undefined, error: string | null}`. `undefined` means loading; it reloads when an `asset_model_glb` job finishes;
  - `<PreviewBoundary what fallback onError>`;
  - `assetModelPath(projectId, modelId): string` = `/p/<id>/models/<modelId>`;
  - `<AssetStaticCard projectId model />`, with `data-testid="asset-static-card"`;
  - `<AssetPreview projectId modelId className? />`: a `section` region named "Asset preview" with `data-rotating="true"` once auto-rotate is on.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/overview/AssetPreview.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { ASSET_MODEL_ID, exampleAssetModel } from "@/test/assetFindingFixtures";
import { errorBody, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { AssetPreview } from "./AssetPreview";

vi.mock("./useInView", () => ({ useInView: () => [() => {}, true] }));

function renderPreview(model: object | null = exampleAssetModel, status = 200) {
  const { api } = fakeClient([
    {
      method: "GET",
      path: /\/asset-models\/[^/]+$/,
      status,
      body: status === 200 ? model ?? {} : errorBody("internal", "boom"),
    },
  ]);
  renderWithProviders(<AssetPreview projectId={PROJECT_ID} modelId={ASSET_MODEL_ID} />, { api });
}

describe("AssetPreview", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.effects;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("shows the static card, not an error, when WebGL cannot start (jsdom has none)", async () => {
    renderPreview();
    // The real viewer chunk (three) loads first; that import is slow in jsdom.
    await waitFor(() => expect(screen.getByTestId("asset-static-card")).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("asset-static-card")).toHaveTextContent("Flare stack F-1");
    expect(screen.getByTestId("asset-static-card")).toHaveTextContent("F-1 · 80.0 m · v2");
    expect(screen.getByRole("link", { name: "Open in Asset models" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/models/${ASSET_MODEL_ID}`,
    );
  });

  it("never starts the 3D view under reduced effects", async () => {
    document.documentElement.dataset.effects = "reduced";
    renderPreview();
    await waitFor(() => expect(screen.getByTestId("asset-static-card")).toBeInTheDocument());
    expect(screen.queryByTestId("model-canvas")).not.toBeInTheDocument();
  });

  it("says the model is still being built when it has no version", async () => {
    renderPreview({ ...exampleAssetModel, current_version: null, status: "building" });
    expect(await screen.findByText("The asset model is still being built.")).toBeInTheDocument();
  });

  it("says the preview could not be loaded when the read fails, with a way to Asset models", async () => {
    renderPreview(null, 500);
    expect(await screen.findByText("Couldn't load the asset preview.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Asset models" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/models/${ASSET_MODEL_ID}`,
    );
  });
});
```

Create `frontend/src/overview/AssetPreview.live.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { ASSET_MODEL_ID, exampleAssetModel } from "@/test/assetFindingFixtures";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { AssetPreview } from "./AssetPreview";

// The live branch with the viewer stubbed: what the preview does around the viewer, not the viewer.
const h = vi.hoisted(() => ({
  inView: true as boolean | null,
  state: "running" as string,
  rotate: vi.fn(),
  settled: Promise.resolve() as Promise<void>,
}));

vi.mock("./useInView", () => ({ useInView: () => [() => {}, h.inView] }));
vi.mock("@/app/effects", async (orig) => ({
  ...(await orig<object>()),
  autoProbeSettled: () => h.settled,
}));
vi.mock("@/assetmodels/viewer/ModelViewer", async () => {
  const { forwardRef, useEffect, useImperativeHandle } = await import("react");
  return {
    ModelViewer: forwardRef(function Stub(
      props: { glbUrl: string | null; onState?: (s: string) => void },
      ref,
    ) {
      useImperativeHandle(ref, () => ({ setAutoRotate: h.rotate }), []);
      useEffect(() => props.onState?.(h.state));
      if (h.state === "throw") throw new Error("shader compile failed");
      return <div data-testid="live-viewer" data-glb={props.glbUrl ?? ""} />;
    }),
  };
});

const region = () => screen.getByRole("region", { name: "Asset preview" });

async function renderPreview() {
  const { api, requests } = fakeClient([
    { method: "GET", path: /\/asset-models\/[^/]+$/, body: exampleAssetModel },
  ]);
  renderWithProviders(<AssetPreview projectId={PROJECT_ID} modelId={ASSET_MODEL_ID} />, { api });
  await waitFor(() => expect(requests).toHaveLength(1));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("AssetPreview live branch", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.effects;
    h.inView = true;
    h.state = "running";
    h.rotate.mockReset();
    h.settled = Promise.resolve();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("loads the current version's GLB and turns auto-rotate on once it runs", async () => {
    await renderPreview();
    const viewer = await screen.findByTestId("live-viewer");
    expect(viewer.dataset.glb).toContain(`/asset-models/${ASSET_MODEL_ID}/versions/2/glb`);
    expect(h.rotate).toHaveBeenCalledWith(true);
    expect(region()).toHaveAttribute("data-rotating", "true");
    expect(viewer.parentElement).toHaveClass("absolute", "inset-0", "flex");
  });

  it("a load error falls back to the static card", async () => {
    h.state = "load-error";
    await renderPreview();
    expect(await screen.findByTestId("asset-static-card")).toBeInTheDocument();
    expect(h.rotate).not.toHaveBeenCalled();
  });

  it("an engine error falls back to the static card instead of taking the app down", async () => {
    h.state = "throw";
    await renderPreview();
    expect(await screen.findByTestId("asset-static-card")).toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  it("holds a skeleton until the first intersection callback", async () => {
    h.inView = null;
    await renderPreview();
    expect(region()).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("live-viewer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("asset-static-card")).not.toBeInTheDocument();
  });

  it("waits for Auto's frame probe to settle before starting the 3D view", async () => {
    let release: () => void = () => {};
    h.settled = new Promise<void>((r) => (release = r));
    await renderPreview();
    expect(screen.queryByTestId("live-viewer")).not.toBeInTheDocument();
    await act(async () => release());
    expect(await screen.findByTestId("live-viewer")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm -C frontend exec vitest run src/overview/AssetPreview.test.tsx src/overview/AssetPreview.live.test.tsx`
Expected: FAIL (`AssetPreview` does not exist).

- [ ] **Step 3: Implement the read**

Append to `frontend/src/api/assetModels.ts`:

```ts
export async function getAssetModel(api: ApiClient, projectId: string, id: string): Promise<AssetModel> {
  return unwrap(api.GET(`${P}/{assetModelId}`, path(projectId, id)));
}
```

Append to `frontend/src/assetmodels/useAssetModels.ts` (add `getAssetModel` to its `@/api/assetModels` import):

```ts
/** One asset model; `undefined` while loading, `null` when the read failed. Reloads after a GLB build. */
export function useAssetModel(projectId: string, modelId: string) {
  const api = useApi();
  const key = `${projectId}/${modelId}`;
  const [loaded, setLoaded] = useState<{ key: string; model: AssetModel | null; error: string | null } | null>(
    null,
  );
  const reload = useCallback(() => {
    void getAssetModel(api, projectId, modelId)
      .then((model) => setLoaded({ key, model, error: null }))
      .catch((e: unknown) => setLoaded({ key, model: null, error: message(e) }));
  }, [api, projectId, modelId, key]);
  useEffect(reload, [reload]);
  useOnJobsFinished("asset_model_glb", reload);
  const current = loaded?.key === key ? loaded : null;
  return { model: current ? current.model : undefined, error: current?.error ?? null };
}
```

- [ ] **Step 4: Move the boundary**

Create `frontend/src/overview/PreviewBoundary.tsx`:

```tsx
import { Component, type ReactNode } from "react";
import { pushLog } from "@/app/diagnostics";

/**
 * Catches what a 3D preview throws past its own no-WebGL fallback (an engine error, a chunk that
 * failed to load), logs it and shows `fallback`, so a broken preview never takes the whole app down.
 */
export class PreviewBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; onError: () => void; what: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    pushLog(`${this.props.what} preview failed: ${error.message}`);
    this.props.onError();
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
```

In `frontend/src/overview/CloudPreview.tsx`:
- delete the local `PreviewBoundary` class and its doc comment;
- remove `Component` and `type ReactNode` from the `react` import;
- add `import { PreviewBoundary } from "./PreviewBoundary";`;
- add `what="point cloud"` to the `<PreviewBoundary …>` element.

The logged text is unchanged ("point cloud preview failed: …").

- [ ] **Step 5: Implement the static card and the hero**

Create `frontend/src/overview/AssetStaticCard.tsx`:

```tsx
import { Link } from "react-router-dom";
import type { AssetModel } from "@contract/client";
import { formatHeight } from "@/findings/format";
import { cx, focusRing, Icon } from "@/ui";

export function assetModelPath(projectId: string, modelId: string): string {
  return `/p/${projectId}/models/${modelId}`;
}

/** The hero when the 3D view cannot or should not run (reduced effects, no WebGL, a load error). */
export function AssetStaticCard({ projectId, model }: { projectId: string; model: AssetModel }) {
  const facts = [
    model.tag,
    model.frame ? formatHeight(model.frame.height_m) : null,
    model.current_version !== null ? `v${model.current_version}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div data-testid="asset-static-card" className="grid h-full place-items-center bg-surface-2 p-4 text-center">
      <div className="flex flex-col items-center gap-2">
        <Icon name="cube" size={28} className="text-muted" />
        <p className="text-sm font-semibold text-ink">{model.name}</p>
        {facts && <p className="font-mono text-2xs text-muted">{facts}</p>}
        <Link to={assetModelPath(projectId, model.id)} className={cx("text-xs text-accent-ink", focusRing)}>
          Open in Asset models
        </Link>
      </div>
    </div>
  );
}
```

Create `frontend/src/overview/AssetPreview.tsx`:

```tsx
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { assetModelGlbUrl } from "@contract/client";
import { useBackend } from "@/api/client";
import { autoProbeSettled } from "@/app/effects";
import { useAssetModel } from "@/assetmodels/useAssetModels";
import type { ModelViewerHandle, ModelViewState } from "@/assetmodels/viewer/ModelViewer";
import { reducedEffects, watchEffects } from "@/clouds/viewer/edl";
import { formatHeight } from "@/findings/format";
import { cx, focusRing, GlassPanel, Skeleton } from "@/ui";
import { AssetStaticCard, assetModelPath } from "./AssetStaticCard";
import { PreviewBoundary } from "./PreviewBoundary";
import { useInView } from "./useInView";

// three loads only when a preview actually starts (as the asset workspace does).
const ModelViewer = lazy(() =>
  import("@/assetmodels/viewer/ModelViewer").then((m) => ({ default: m.ModelViewer })),
);

const noop = () => {};

function Notice({
  projectId,
  modelId,
  text,
  className,
}: {
  projectId: string;
  modelId: string;
  text: string;
  className?: string;
}) {
  return (
    <GlassPanel variant="pane" className={cx("grid min-h-0 place-items-center gap-2 p-4 text-center", className)}>
      <div className="flex flex-col items-center gap-2">
        <p className="text-sm text-muted">{text}</p>
        <Link to={assetModelPath(projectId, modelId)} className={cx("rounded-sm text-xs text-accent-ink", focusRing)}>
          Open Asset models
        </Link>
      </div>
    </GlassPanel>
  );
}

/**
 * Spec §9 Overview: the asset hero. The live GLB, auto-rotating, at the cloud hero's size and with
 * its static fallback (spec 2026-09-30-project-landing D5): in view, full effects, probe settled.
 */
export function AssetPreview({
  projectId,
  modelId,
  className,
}: {
  projectId: string;
  modelId: string;
  className?: string;
}) {
  const { baseUrl, token } = useBackend();
  const { model } = useAssetModel(projectId, modelId);
  const [box, inView] = useInView<HTMLDivElement>();
  const key = `${projectId}|${modelId}`;
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [rotatingKey, setRotatingKey] = useState<string | null>(null);
  const failed = failedKey === key;
  const [reduced, setReduced] = useState(reducedEffects);
  const [probeSettled, setProbeSettled] = useState(false);
  const viewer = useRef<ModelViewerHandle>(null);

  useEffect(() => watchEffects(setReduced), []);
  useEffect(() => {
    let live = true;
    // A microtask later, so the Overview's own effect (which starts the probe) has run.
    void Promise.resolve()
      .then(autoProbeSettled)
      .then(() => {
        if (!live) return;
        setReduced(reducedEffects());
        setProbeSettled(true);
      });
    return () => {
      live = false;
    };
  }, []);

  if (model === null)
    return (
      <Notice projectId={projectId} modelId={modelId} text="Couldn't load the asset preview." className={className} />
    );
  if (model && model.current_version === null)
    return (
      <GlassPanel variant="pane" className={cx("grid min-h-0 place-items-center p-4 text-center", className)}>
        <p className="text-sm text-muted">The asset model is still being built.</p>
      </GlassPanel>
    );

  const version = model?.current_version ?? null;
  const wantLive = Boolean(model) && !reduced && !failed;
  // Until the first intersection callback, or while the probe measures, hold the skeleton.
  const waiting = !model || (wantLive && (inView === null || !probeSettled));
  const onState = (s: ModelViewState) => {
    if (s === "running") {
      viewer.current?.setAutoRotate(true);
      setRotatingKey(key);
    } else if (s === "no-webgl" || s === "load-error") setFailedKey(key);
  };

  return (
    <GlassPanel
      variant="pane"
      as="section"
      ref={box}
      aria-label="Asset preview"
      aria-busy={waiting || undefined}
      data-rotating={rotatingKey === key ? "true" : undefined}
      className={cx("relative min-h-0 overflow-hidden", className)}
    >
      {!model || waiting ? (
        <Skeleton className="absolute inset-0" />
      ) : wantLive && inView && version !== null ? (
        <PreviewBoundary
          key={key}
          what="asset model"
          onError={() => setFailedKey(key)}
          fallback={<AssetStaticCard projectId={projectId} model={model} />}
        >
          <Suspense fallback={<Skeleton className="absolute inset-0" />}>
            {/* ModelViewer's root is `flex-1`: it needs a flex parent, or it renders 0 px tall. */}
            <div className="absolute inset-0 flex">
              <ModelViewer
                ref={viewer}
                glbUrl={assetModelGlbUrl(baseUrl, token, projectId, model.id, version)}
                onParts={noop}
                onSelect={noop}
                onState={onState}
              />
            </div>
            <GlassPanel variant="float" className="absolute left-3 top-3 z-[2] px-2.5 py-1.5 font-mono text-2xs">
              {model.name}
              {model.frame && ` · ${formatHeight(model.frame.height_m)}`}
            </GlassPanel>
            <Link
              to={assetModelPath(projectId, model.id)}
              className={cx("absolute bottom-3 right-3 z-[2] rounded-sm text-xs text-accent-ink", focusRing)}
            >
              Open in Asset models
            </Link>
          </Suspense>
        </PreviewBoundary>
      ) : (
        <AssetStaticCard projectId={projectId} model={model} />
      )}
    </GlassPanel>
  );
}
```

`GlassPanel` forwards a ref and spreads `HTMLAttributes`, as `CloudPreview` relies on; `data-rotating` passes through.

- [ ] **Step 6: Run the tests**

Run: `pnpm -C frontend exec vitest run src/overview/AssetPreview.test.tsx src/overview/AssetPreview.live.test.tsx src/overview/CloudPreview.test.tsx src/overview/CloudPreview.live.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/assetModels.ts frontend/src/assetmodels/useAssetModels.ts frontend/src/overview/PreviewBoundary.tsx frontend/src/overview/CloudPreview.tsx frontend/src/overview/AssetStaticCard.tsx frontend/src/overview/AssetPreview.tsx frontend/src/overview/AssetPreview.test.tsx frontend/src/overview/AssetPreview.live.test.tsx
git commit -m "feat(overview): auto-rotating asset hero with a static fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The asset findings map card and the outcome bar

**Files:**
- Create: `frontend/src/overview/OutcomeBar.tsx`
- Create: `frontend/src/overview/AssetMapCard.tsx`
- Modify: `frontend/src/test/assetFindingFixtures.ts` (adds `examplePhotoReview`, `assetOverview`)
- Test: `frontend/src/overview/OutcomeBar.test.tsx`, `frontend/src/overview/AssetMapCard.test.tsx`

**Interfaces:**
- Consumes:
  - `imagesReviewPath(projectId, review)` (U4, `frontend/src/images/workspace/entryParams.ts`);
  - `findingPath(projectId, findingId)` (`frontend/src/findings/links.ts`);
  - `useAssetModel` (Task 4), `useAssetMapDots` and `FindingsMap` (Task 3);
  - `ProjectOverview["photo_review"]` (Task 1).
- Produces:
  - `type PhotoReviewCounts = NonNullable<ProjectOverview["photo_review"]>`;
  - `<OutcomeBar projectId counts />`: a stacked bar plus one link per status, named "<Status>: N photos". It renders nothing when the total is 0;
  - `<AssetMapCard projectId modelId photoReview className? />`: a `section` region named "Findings on the asset".

- [ ] **Step 1: Write the fixtures and the failing tests**

Append to `frontend/src/test/assetFindingFixtures.ts`:

```ts
import type { ProjectOverview } from "@/api/overview";
import { fullOverview } from "./findingFixtures";

export const examplePhotoReview: NonNullable<ProjectOverview["photo_review"]> = {
  finding: 12,
  none: 90,
  uncertain: 15,
  not_assessed: 3,
};

/** An asset-inspection project: photos, a reviewed asset model as the hero, no map or cloud. */
export const assetOverview: ProjectOverview = {
  ...fullOverview,
  data: { image_sets: 1, images: 120, maps: 0, elevations: 0, point_clouds: 0, drawings: 0 },
  latest_volume: null,
  hero_map_id: null,
  hero: { kind: "asset_model", id: ASSET_MODEL_ID },
  photo_review: examplePhotoReview,
};
```

Move the two new imports to the top of the file with the existing ones.

Create `frontend/src/overview/OutcomeBar.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { examplePhotoReview } from "@/test/assetFindingFixtures";
import { PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { OutcomeBar } from "./OutcomeBar";

describe("OutcomeBar", () => {
  it("links every outcome to the image browser filtered by it", () => {
    renderWithProviders(<OutcomeBar projectId={PROJECT_ID} counts={examplePhotoReview} />);
    const expected: [string, string][] = [
      ["Finding: 12 photos", "finding"],
      ["Uncertain: 15 photos", "uncertain"],
      ["No finding: 90 photos", "none"],
      ["Not assessed: 3 photos", "not_assessed"],
    ];
    for (const [name, review] of expected)
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", `/p/${PROJECT_ID}/images?review=${review}`);
  });

  it("sizes the bar's parts by their counts and leaves out empty ones", () => {
    renderWithProviders(
      <OutcomeBar projectId={PROJECT_ID} counts={{ ...examplePhotoReview, not_assessed: 0 }} />,
    );
    const parts = screen.getAllByTestId("outcome-part");
    expect(parts.map((p) => p.style.flexGrow)).toEqual(["12", "15", "90"]);
  });

  it("draws nothing without reviewed photos", () => {
    const { container } = renderWithProviders(
      <OutcomeBar projectId={PROJECT_ID} counts={{ finding: 0, none: 0, uncertain: 0, not_assessed: 0 }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

If `renderWithProviders` does not return the RTL result, replace the last test's `container` read with `expect(screen.queryByText(/Photos by outcome/)).not.toBeInTheDocument()`.

Create `frontend/src/overview/AssetMapCard.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import {
  ASSET_FINDING_ID,
  ASSET_MODEL_ID,
  exampleAssetFinding,
  exampleAssetFinding2,
  exampleAssetModel,
  examplePhotoReview,
} from "@/test/assetFindingFixtures";
import { errorBody, fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { AssetMapCard } from "./AssetMapCard";

vi.mock("@/assetmodels/findingsMap/FindingsMap", () => ({
  FindingsMap: ({ dots, onOpen }: { dots: { id: string }[]; onOpen: (id: string) => void }) => (
    <button type="button" data-testid="findings-map" data-dots={dots.length} onClick={() => onOpen(dots[0].id)}>
      map
    </button>
  ),
}));

function renderCard(model: object = exampleAssetModel, findings: FakeRoute["body"] = undefined, review = examplePhotoReview) {
  const { api } = fakeClient([
    { method: "GET", path: /\/asset-models\/[^/]+$/, body: model },
    {
      method: "GET",
      path: /\/findings$/,
      body: findings ?? { items: [exampleAssetFinding, exampleAssetFinding2], next_cursor: null },
    },
  ]);
  renderWithProviders(
    <>
      <AssetMapCard projectId={PROJECT_ID} modelId={ASSET_MODEL_ID} photoReview={review} />
      <LocationProbe />
    </>,
    { api, route: `/p/${PROJECT_ID}/overview`, path: "/p/:projectId/overview" },
  );
}

describe("AssetMapCard", () => {
  beforeEach(() => useChangesStore.setState({ findingsRevision: 0, dataRevision: 0 }));

  it("draws the model's placed findings and counts them", async () => {
    renderCard();
    const map = await screen.findByTestId("findings-map");
    expect(map).toHaveAttribute("data-dots", "2");
    expect(screen.getByRole("region", { name: "Findings on the asset" })).toHaveTextContent("2 findings");
  });

  it("opens a finding from the map in the Findings tab", async () => {
    renderCard();
    fireEvent.click(await screen.findByTestId("findings-map"));
    expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/findings/${ASSET_FINDING_ID}`);
  });

  it("asks for the frame and review profile when the model has none", async () => {
    renderCard({ ...exampleAssetModel, frame: null });
    expect(
      await screen.findByText("Set the asset frame and review profile to see the findings map."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Asset models" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/models/${ASSET_MODEL_ID}`,
    );
  });

  it("says so when the findings cannot be read", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/asset-models\/[^/]+$/, body: exampleAssetModel },
      { method: "GET", path: /\/findings$/, status: 500, body: errorBody("internal", "boom") },
    ]);
    renderWithProviders(<AssetMapCard projectId={PROJECT_ID} modelId={ASSET_MODEL_ID} photoReview={null} />, {
      api,
    });
    expect(await screen.findByText("Couldn't load the findings map.")).toBeInTheDocument();
  });

  it("shows the photo outcome bar under the map", async () => {
    renderCard();
    expect(await screen.findByRole("link", { name: "Uncertain: 15 photos" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm -C frontend exec vitest run src/overview/OutcomeBar.test.tsx src/overview/AssetMapCard.test.tsx`
Expected: FAIL (the modules do not exist).

- [ ] **Step 3: Implement**

Create `frontend/src/overview/OutcomeBar.tsx`:

```tsx
import { Link } from "react-router-dom";
import type { ProjectOverview } from "@/api/overview";
import { imagesReviewPath } from "@/images/workspace/entryParams";
import { countLabel } from "@/lib/countLabel";
import { cx, focusRing, transition } from "@/ui";

export type PhotoReviewCounts = NonNullable<ProjectOverview["photo_review"]>;
type Outcome = keyof PhotoReviewCounts;

/** Status tones, not data colours: these are the app's own semantic tokens. */
const OUTCOMES: { key: Outcome; label: string; tone: string }[] = [
  { key: "finding", label: "Finding", tone: "bg-danger" },
  { key: "uncertain", label: "Uncertain", tone: "bg-warn" },
  { key: "none", label: "No finding", tone: "bg-ok" },
  { key: "not_assessed", label: "Not assessed", tone: "bg-dim" },
];

/** Spec §9 Overview: photos by review outcome; each part opens the image browser filtered by it. */
export function OutcomeBar({ projectId, counts }: { projectId: string; counts: PhotoReviewCounts }) {
  const total = OUTCOMES.reduce((n, o) => n + counts[o.key], 0);
  if (total === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-2xs text-muted">Photos by outcome</h3>
      <div aria-hidden className="flex h-2 overflow-hidden rounded-chip bg-surface-2">
        {OUTCOMES.filter((o) => counts[o.key] > 0).map((o) => (
          <span key={o.key} data-testid="outcome-part" className={cx("h-full", o.tone)} style={{ flexGrow: counts[o.key] }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {OUTCOMES.map((o) => (
          <li key={o.key}>
            <Link
              to={imagesReviewPath(projectId, o.key)}
              aria-label={`${o.label}: ${countLabel(counts[o.key], "photo", "photos")}`}
              className={cx("inline-flex items-center gap-1.5 rounded-sm text-2xs text-muted hover:text-ink", transition, focusRing)}
            >
              <span aria-hidden className={cx("h-2 w-2 rounded-full", o.tone)} />
              {o.label}
              <span className="font-mono tabular-nums text-ink">{counts[o.key]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Create `frontend/src/overview/AssetMapCard.tsx`:

```tsx
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FindingsMap } from "@/assetmodels/findingsMap/FindingsMap";
import { MAP_DOTS_MAX, useAssetMapDots } from "@/assetmodels/findingsMap/useAssetMapDots";
import { useAssetModel } from "@/assetmodels/useAssetModels";
import { findingPath } from "@/findings/links";
import { countLabel } from "@/lib/countLabel";
import { cx, focusRing, GlassPanel, Skeleton } from "@/ui";
import { assetModelPath } from "./AssetStaticCard";
import { OutcomeBar, type PhotoReviewCounts } from "./OutcomeBar";

function Note({ children }: { children: ReactNode }) {
  return <div className="grid h-full place-items-center p-2 text-center text-sm text-muted">{children}</div>;
}

/** Spec §9 Overview: the asset findings map card, with the photo outcome bar under it. */
export function AssetMapCard({
  projectId,
  modelId,
  photoReview,
  className,
}: {
  projectId: string;
  modelId: string;
  photoReview: PhotoReviewCounts | null;
  className?: string;
}) {
  const navigate = useNavigate();
  const { model } = useAssetModel(projectId, modelId);
  const { dots, truncated, error } = useAssetMapDots(projectId, modelId);

  let body: ReactNode;
  if (model === null || (error && !dots)) body = <Note>Couldn&apos;t load the findings map.</Note>;
  else if (model === undefined || dots === null) body = <Skeleton className="h-full rounded-card" />;
  else if (!model.frame || !model.review)
    body = (
      <Note>
        <span className="flex flex-col items-center gap-2">
          Set the asset frame and review profile to see the findings map.
          <Link to={assetModelPath(projectId, modelId)} className={cx("rounded-sm text-xs text-accent-ink", focusRing)}>
            Open Asset models
          </Link>
        </span>
      </Note>
    );
  else
    body = (
      <FindingsMap
        review={model.review}
        frame={model.frame}
        dots={dots}
        onOpen={(id) => void navigate(findingPath(projectId, id))}
        className="h-full"
      />
    );

  return (
    <GlassPanel
      variant="pane"
      as="section"
      aria-label="Findings on the asset"
      className={cx("flex min-h-0 flex-col gap-2 px-4 py-3.5", className)}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs text-muted">Findings on the asset</h2>
        {dots && (
          <span className="font-mono text-2xs text-muted">
            {countLabel(dots.length, "finding", "findings")}
            {truncated && `, first ${MAP_DOTS_MAX.toLocaleString("en-US")} shown`}
          </span>
        )}
      </header>
      <div className="min-h-0 flex-1">{body}</div>
      {photoReview && <OutcomeBar projectId={projectId} counts={photoReview} />}
    </GlassPanel>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm -C frontend exec vitest run src/overview/OutcomeBar.test.tsx src/overview/AssetMapCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/overview/OutcomeBar.tsx frontend/src/overview/OutcomeBar.test.tsx frontend/src/overview/AssetMapCard.tsx frontend/src/overview/AssetMapCard.test.tsx frontend/src/test/assetFindingFixtures.ts
git commit -m "feat(overview): asset findings map card and photo outcome bar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Wire the Overview

**Files:**
- Modify: `frontend/src/overview/OverviewScreen.tsx`
- Test: `frontend/src/overview/OverviewScreen.test.tsx`

**Interfaces:**
- Consumes: `AssetPreview` (Task 4), `AssetMapCard` (Task 5), `composeOverview` with `hasAssetMap` (Task 2), and `overview.hero.kind === "asset_model"` with `overview.photo_review` (Task 1).
- Produces: an Overview whose hero is the asset preview, with the asset map card in the side column, whenever the payload's hero is an asset model.

- [ ] **Step 1: Write the failing test**

In `frontend/src/overview/OverviewScreen.test.tsx`, add next to the existing `vi.mock` calls:

```tsx
vi.mock("./AssetPreview", () => ({
  AssetPreview: ({ modelId }: { modelId: string }) => <div data-testid="asset-hero" data-model={modelId} />,
}));
vi.mock("./AssetMapCard", () => ({
  AssetMapCard: ({ modelId, photoReview }: { modelId: string; photoReview: { uncertain: number } | null }) => (
    <div data-testid="asset-map" data-model={modelId} data-uncertain={photoReview?.uncertain ?? ""} />
  ),
}));
```

Add `import { ASSET_MODEL_ID, assetOverview } from "@/test/assetFindingFixtures";` to the imports, and in `describe("Overview v2 layout", ...)` add:

```tsx
  it("asset inspection: the asset is the hero and its findings map sits beside it", async () => {
    renderOverview(assetOverview, [imagesRoute]);
    await waitFor(() => expect(panes()).toContain("assetMap"));
    expect(panes().slice(0, 4)).toEqual(["header", "hero", "assetMap", "location"]);
    expect(screen.getByTestId("asset-hero")).toHaveAttribute("data-model", ASSET_MODEL_ID);
    expect(screen.getByTestId("asset-map")).toHaveAttribute("data-uncertain", "15");
    expect(screen.queryByTestId("map-hero")).not.toBeInTheDocument();
  });

  it("a payload without photo_review (an older backend) still shows the asset map", async () => {
    const { photo_review: _omit, ...older } = assetOverview;
    renderOverview(older, [imagesRoute]);
    await waitFor(() => expect(screen.getByTestId("asset-map")).toHaveAttribute("data-uncertain", ""));
  });
```

`imagesRoute` and `panes()` are the file's existing helpers. If ESLint flags `_omit` as unused, keep the repo's convention for discarded destructured names; the `no-unused-vars` config there allows a leading underscore.

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm -C frontend exec vitest run src/overview/OverviewScreen.test.tsx`
Expected: FAIL. The asset hero renders the summary hero and there is no `assetMap` pane.

- [ ] **Step 3: Implement**

In `frontend/src/overview/OverviewScreen.tsx`:

1. Add the imports:

```ts
import { AssetMapCard } from "./AssetMapCard";
import { AssetPreview } from "./AssetPreview";
```

2. Replace the Task 2 stopgap in `facts` with:

```ts
    hasAssetMap: hero?.kind === "asset_model" && hero.id !== null,
```

3. Add a local after `const hero = overview.hero;`:

```ts
  const assetId = hero?.kind === "asset_model" ? hero.id : null;
```

4. In `render`, at the top of `case "hero":`, before the map branch:

```tsx
        if (assetId) return <AssetPreview projectId={projectId} modelId={assetId} className="h-full" />;
```

5. Add a case:

```tsx
      case "assetMap":
        return (
          assetId && (
            <AssetMapCard
              projectId={projectId}
              modelId={assetId}
              photoReview={overview.photo_review ?? null}
              className="h-full"
            />
          )
        );
```

- [ ] **Step 4: Run the Overview tests**

Run: `pnpm -C frontend exec vitest run src/overview`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/overview/OverviewScreen.tsx frontend/src/overview/OverviewScreen.test.tsx
git commit -m "feat(overview): asset hero and findings map card on the Overview

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: e2e: the asset Overview on Prism

**Files:**
- Create: `frontend/e2e/overview-landing-asset.spec.ts` (the `overview-landing*` family; its own file because the SwiftShader launch options are per file, as `overview-landing-cloud.spec.ts` notes)

**Interfaces:**
- Consumes:
  - `routeAssetModels`, `P`, `MODEL`, `modelJson` (`frontend/e2e/fixtures/assetModels.ts`): the model list, versions and the GLB fixture;
  - `SWIFTSHADER` (`frontend/e2e/fixtures/cloudWorkspace.ts`), as `models-workspace.spec.ts` uses it;
  - `jsonReply` (`frontend/e2e/mock.ts`); `entrancesDone`, `evidencePath` (`frontend/e2e/evidence.ts`).

- [ ] **Step 1: Write the e2e test**

Create `frontend/e2e/overview-landing-asset.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";
import { entrancesDone, evidencePath } from "./evidence";
import { MODEL, P, modelJson, routeAssetModels } from "./fixtures/assetModels";
import { SWIFTSHADER } from "./fixtures/cloudWorkspace";
import { jsonReply } from "./mock";

// Spec 2026-10-02-asset-findings §9 Overview: an asset project's hero is its rotating model, with the
// findings map and the photo outcome bar beside it. Full effects, since SwiftShader makes Auto start
// reduced (which never mounts the live view). Synthetic data only (Global Constraints).
test.use(SWIFTSHADER);

const T = "2026-10-02T09:00:00Z";
const frame = {
  origin: null,
  north_offset_deg: 0,
  height_m: 8,
  datum_label: "Ground",
  datum_note: "",
  line_azimuth_deg: null,
  silhouette: [
    [0, 2],
    [8, 2],
  ],
  levels: [2, 4, 6],
  presets: [],
};
const review = {
  profile_id: "tank",
  finding_unit: "region",
  placement: "patch",
  patch_grid: 14,
  cluster_m: 0.75,
  zones: [
    { id: "roof", label: "Roof", min_m: 7.6, max_m: 8 },
    { id: "shell", label: "Shell", min_m: 0.4, max_m: 7.6 },
    { id: "bottom", label: "Bottom", min_m: 0, max_m: 0.4 },
  ],
  sides: { type: "compass", labels: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"], basis: "hit" },
  focus: { frustum: 2, oblique_deg: 0 },
  report: { pages: 1, min_severity: null },
};
const finding = (n: number, height: number, bearing: number, side: string, zone: string, severity: number) => ({
  id: `f0000000-9999-4000-8000-00000000050${n}`,
  number: 500 + n,
  type_id: "t1",
  severity,
  status: "open",
  note: "",
  created_by: "human",
  confidence: null,
  anchor: { kind: "asset", asset_model_id: MODEL },
  lon: null,
  lat: null,
  data_type: "asset_model",
  data_id: MODEL,
  created_at: T,
  updated_at: T,
  reviewed_at: null,
  closed_at: null,
  asset_model_id: MODEL,
  height_m: height,
  bearing_deg: bearing,
  side,
  zone,
  component: "Shell",
  placement: "patch",
  sighting_count: 1,
  representative: null,
});
const FINDINGS = [
  finding(1, 6.5, 45, "NE", "shell", 3),
  finding(2, 7.8, 200, "SW", "roof", 1),
  finding(3, 1.2, 300, "NW", "shell", 2),
];

async function serveAssetProject(page: Page) {
  await page.addInitScript(() => localStorage.setItem("kestrel.effects", "full"));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await routeAssetModels(page);
  // Registered after routeAssetModels, so it answers first for the one model read.
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/asset-models/${MODEL}`,
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill(jsonReply({ ...modelJson(2), frame, review }))
        : route.fallback(),
  );
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/overview`,
    (route) =>
      route.fulfill(
        jsonReply({
          findings: {
            by_status: { open: 3, reviewed: 0, closed: 0 },
            open_by_severity: { "1": 1, "2": 1, "3": 1 },
            open_no_severity: 0,
            by_type: [],
            trend: [],
          },
          data: { image_sets: 1, images: 120, maps: 0, elevations: 0, point_clouds: 0, drawings: 0 },
          latest_volume: null,
          hero_map_id: null,
          hero: { kind: "asset_model", id: MODEL },
          banners: [],
          photo_review: { finding: 12, none: 90, uncertain: 15, not_assessed: 3 },
        }),
      ),
  );
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/findings`,
    (route) => route.fulfill(jsonReply({ items: FINDINGS, next_cursor: null })),
  );
}

test("an asset project's Overview: rotating model, findings map and outcome bar", async ({ page }) => {
  await serveAssetProject(page);
  await page.goto(`/p/${P}/overview`);

  const hero = page.getByRole("region", { name: "Asset preview" });
  await expect(hero.getByTestId("model-canvas")).toBeAttached({ timeout: 20_000 });
  await expect(hero).toHaveAttribute("data-rotating", "true", { timeout: 20_000 });
  const canvasBox = (await hero.getByTestId("model-canvas").boundingBox())!;
  expect(canvasBox.height).toBeGreaterThan((await hero.boundingBox())!.height - 4);

  const card = page.getByRole("region", { name: "Findings on the asset" });
  await expect(card.getByTestId("map-dot")).toHaveCount(3);
  await card.getByTestId("map-dot").first().hover();
  await expect(page.getByRole("tooltip")).toContainText("F-05");
  await entrancesDone(page);
  await page.screenshot({ path: evidencePath("asset-findings", "overview-asset.png") });

  const indexRead = page.waitForRequest(
    (r) => r.url().includes(`/projects/${P}/images/index`) && r.url().includes("review_status=uncertain"),
  );
  await card.getByRole("link", { name: "Uncertain: 15 photos" }).click();
  await indexRead;
});

test("a findings map dot opens the finding", async ({ page }) => {
  await serveAssetProject(page);
  await page.goto(`/p/${P}/overview`);
  const card = page.getByRole("region", { name: "Findings on the asset" });
  await expect(card.getByTestId("map-dot")).toHaveCount(3);
  await card.getByTestId("map-dot").first().click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/findings/f0000000-9999-4000-8000-00000000050\\d$`));
});
```

- [ ] **Step 2: Run it**

Run: `pnpm -C frontend exec playwright test overview-landing`
Expected: PASS for `overview-landing.spec.ts`, `overview-landing-cloud.spec.ts` and the new file. The first two keep passing: their payloads have no `photo_review` and a non-asset hero.

- [ ] **Step 3: Commit**

```bash
git add frontend/e2e/overview-landing-asset.spec.ts
git commit -m "test(e2e): asset Overview with rotating hero, findings map and outcome bar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Land

- [ ] **Step 1: Run the full gate** (AGENTS.md):

```
pnpm -C contract check
cd backend; .\.venv\Scripts\python.exe -m ruff check .; .\.venv\Scripts\python.exe -m ruff format --check .; .\.venv\Scripts\python.exe -m pytest
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
cargo test --manifest-path frontend/src-tauri/Cargo.toml  # only if the frozen sidecar is present
```

In a worktree, the backend line runs with `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe` (CONTRIBUTING "Testing"). Expected: all green. `pnpm -C frontend build` must still split three into the lazy viewer chunk: `AssetPreview` imports `ModelViewer` only through `lazy()`, and `FindingsMap` imports no three.

- [ ] **Step 2: Check the UI copy for dashes**

Run: `Select-String -Path frontend/src/overview/*.tsx,frontend/src/assetmodels/findingsMap/*.tsx -Pattern "[\u2013\u2014]"`
Expected: no match in any file this unit touched.

- [ ] **Step 3: Finish**

Run `scripts\finish-task.ps1`, or the manual merge fallback (memory: finish-task fails on PS 5.1): gate, merge `task/af-u5` into `main`, remove the worktree (links first), and delete the branch.

- [ ] **Step 4: Operator walkthrough** (for the merge note):
  1. Open a project with an asset model that has a frame and review profile, asset findings and some photo review statuses. For example, use the synthetic tower after X Step 1, or Prism with the e2e routes.
  2. Expect the Overview's big pane to show the 3D model turning slowly. Drag it: it orbits. Under Settings, reduced effects, it is a static card with "Open in Asset models".
  3. Expect the "Findings on the asset" card beside it: the silhouette, level lines, zone bands and one coloured dot per open or reviewed placed finding.
  4. Hover a dot: a tip shows "F-0042 · <severity> · <zone> · <side> · <height>". Click it: the Findings tab opens on that finding.
  5. Under the map, click "Uncertain: N photos". The Images tab opens with the photo review filter on Uncertain.

---

## Self-review

**Spec coverage:**
- §9 Overview:
  - Asset hero, live GLB auto-rotating at `CloudPreview`'s size, with the same static fallback rules: Task 4.
  - Asset findings map card: Task 5.
  - Outcome bar: Tasks 1 and 5.
  - Layout: Tasks 2 and 6.
- §9 Asset findings map:
  - One SVG component with x the side and y the height; it draws the silhouette, levels and zone bands, with dots coloured by severity through `--c`: Task 3.
  - Hover tip and click to open: Task 3.
  - The shared geometry: Task 3 consumes P1's TS twin; P1 owns the parity fixture.

**Review Focus:** none of the five items is assigned to U5. Item 5 (a 4,500-photo job) touches U5 only through the dots read. It is bounded at 500 per page and 4,000 in all, and pinned by `useAssetMapDots.test.tsx` "stops at the cap and says so".

**e2e:** the overview e2e family gains an asset project fixture on Prism (`overview-landing-asset.spec.ts`), with a live GLB under SwiftShader.

## Index notes

1. **P1's geometry shape was not yet written** when this plan was drafted: `docs/superpowers/plans/2026-10-03-asset-findings-p1.md` did not exist. U5 keeps the index signature `geometry(review, frame, dots)` and reads the `MapDot` and `MapGeometry` fields listed in Task 3's Interfaces. If P1 names a field differently, U5 adapts only the field reads in `FindingsMap.tsx` and the mocked object in `FindingsMap.test.tsx`; `FindingsMap.geometry.test.tsx` catches the mismatch. P1 should make the output viewBox-ready: SVG path data for the silhouette, and pixel `y` for levels, zones and dots. Then the TS component draws without arithmetic and the Python report renders the same numbers.
2. **Contract gap: the Overview had no asset hero and no photo outcome counts (C0/D1 gap).** `OverviewHero.kind` lacked `asset_model`, and `ProjectOverview` had no review counts. U5 Task 1 adds both, in its own contract commit as the index's file-ownership rule allows:
   - `photo_review` is optional and nullable, so older mocks stay valid;
   - the hero order is now asset model (ready, built, with a review profile), map, cloud, images, drawing.

   This needs **D1** (`AssetModel.review`, `ImageReview`) in addition to the index's U1 and P1.
3. **U5 also needs U4** for `imagesReviewPath`, the image browser's `?review=` entry and `frontend/src/test/assetFindingFixtures.ts`. Both are batch 2 or 3 per the index, so the order holds.
4. **`setAutoRotate` speed.** U5 calls `setAutoRotate(true)` with U1's default speed, so the speed unit is U1's alone.
5. **`PreviewBoundary`** moves out of `CloudPreview.tsx` into `overview/PreviewBoundary.tsx` so both heroes share it. Cloud behaviour and the log text are unchanged.
