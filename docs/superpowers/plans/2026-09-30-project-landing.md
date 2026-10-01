# Project landing (Overview v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the project Overview fill the content area at any window size. Its panes are chosen from the data the project actually has, so it never shows an empty container.

**Architecture:**
- One new backend read, `GET /overview/site`, gives the site's location plus a bounded sample of photo GPS points.
- One new field on the existing `/overview`, `hero`, says what the big pane shows.
- On the frontend, a pure function `composeOverview(facts)` turns a few facts into a list of panes, with grid placement and row tracks.
- `OverviewScreen` renders those panes in a full-height CSS grid. New pane components: `HeaderStrip`, `SiteLocation`, `CloudPreview`, `ImageMosaic`, `ImageryPane`, `SummaryHero`, `StatusPane`, `FirstData`.

**Tech Stack:**
- FastAPI, SQLAlchemy and SQLite (per-project `project.db`), pytest.
- React 18, TypeScript and Vite, with Tailwind and the design-system tokens.
- vitest and Testing Library, and Playwright against the Prism mock.
- The existing `clouds/CloudViewer` (three and potree-core, lazy-loaded).

**Spec:** `docs/superpowers/specs/2026-09-30-project-landing-design.md`

## Global Constraints

- `contract/openapi.yaml` is the source of truth. `contract/client/schema.d.ts` is regenerated with `pnpm -C contract generate` and committed in the same commit, never hand-edited.
- Nullable types in the contract use the OpenAPI 3.1 form `type: [X, "null"]`, as the file already does.
- `/overview` keeps its pin: its statement count is the same whatever the project holds, and it never reads `finding`, `box` or `image` (`backend/tests/test_overview.py`).
- `/overview/site` reads at most 500 `image` rows, in one statement, by primary key.
- No raw colours in TSX or CSS. Use the tokens only (`frontend/scripts/check-tokens.mjs`, run by `pnpm -C frontend lint`). Severity colour comes through `--c`.
- Motion: transform and opacity only, ≤ 400 ms, no decorative loops. The 3D preview never auto-orbits.
- Point budgets: 1,000,000 for the hero and 300,000 for the tile.
- Copy is sentence case, with no all-caps. Coordinates are in JetBrains Mono (`font-mono`).
- Stage files by path. Never `git add -A`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Backend commands use the main checkout's interpreter: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`. In this plan that's `$PY`. Run them from `backend/`.

## Review Focus

1. **A project whose photos have no GPS** (an indoor inspection, or a camera without GPS). There must be no location pane, and the header says "No location data". Pinned in Task 1 (`test_site_without_gps`) and Task 3 (`composeOverview` with `hasSite: false`).
2. **A huge project**, 200,000 images. `/overview/site` must stay at one image statement with ≤ 500 rows, and the first paint must not wait on it. Pinned in Task 1 (`test_site_sample_is_bounded`) and Task 8 (the site read is fetched after `/overview` and never gates it).
3. **A machine whose GPU can't start WebGL, or with reduced effects on.** The 3D pane becomes a static card, never an error box and never a blank. Pinned in Task 5.
4. **Findings but no images or map** (for example findings on a point cloud only). The findings pane shows and the imagery pane doesn't. The bottom row still fills all 12 columns. Pinned in Task 3.
5. **A window shorter than the row floors**, such as a 1366×768 laptop. The page scrolls; panes are not crushed below their floors. Pinned in Task 9 (e2e at 1366×768: `main` is scrollable and the hero is ≥ 340 px tall).

## Spec amendments made while planning

These were folded into the spec in the same commit as this plan:
- **Row tracks.** The grid has 4 row tracks, not 3. That lets the right column stack two tiles next to a hero spanning two tracks: `auto minmax(170px,.675fr) minmax(170px,.675fr) minmax(220px,1fr)`. `composeOverview` also returns the row template, so an empty bottom row leaves no empty track.
- **Header figures.** They are the existing `buildKpis` tiles filtered to non-zero values. "Last survey date" is dropped because it isn't in the pre-aggregated payload.
- **Location pins.** The location pane's pins are the recent findings that have `lon`/`lat` (≤ 5) instead of a separate pin read. The hero map keeps its own full pin read.

## Execution DAG

```
Task 1 (contract + backend) ──┬─> Task 2 (fixtures + api wrappers) ──┬─> Task 3 composeOverview ─────┐
                              │                                      ├─> Task 4 SiteLocation ────────┤
                              │                                      ├─> Task 5 CloudPreview ────────┼─> Task 8 OverviewScreen ─> Task 9 e2e + manual
                              │                                      ├─> Task 6 Mosaic/Imagery/Summary┤
                              │                                      └─> Task 7 Header/Status/FirstData┘
```

- **Batches:**
  1. Task 1.
  2. Task 2.
  3. Tasks 3–7, in parallel. They are separate files and separate tests.
  4. Task 8.
  5. Task 9.
- **Critical path:** 1 → 2 → 3 → 8 → 9.
- **Riskiest parallel unit:** Task 5. If it slips, Task 8 can render `CloudPreview`'s static card only, which is its own fallback path.

---

### Task 1: Contract and backend (`hero` and `/overview/site`)

**Files:**
- Modify: `contract/openapi.yaml`. Add the path after `/api/v1/projects/{projectId}/overview` (around line 4491). Add the `OverviewHero` and `OverviewSite` schemas next to `ProjectOverview` (around line 11036), and add `hero` to `ProjectOverview`.
- Regenerate: `contract/client/schema.d.ts`.
- Modify: `backend/app/overview/schemas.py`, `backend/app/overview/service.py` and `backend/app/overview/router.py`.
- Create: `backend/app/overview/site.py`.
- Test: `backend/tests/test_overview.py` (extend) and `backend/tests/test_overview_site.py` (new).

**Interfaces:**
- Produces, over HTTP:
  - `ProjectOverview.hero: {kind: "map"|"point_cloud"|"images"|"drawing", id: string|null} | null`.
  - `GET /api/v1/projects/{projectId}/overview/site` → `OverviewSite {center: [lon,lat]|null, bounds_wgs84: [minlon,minlat,maxlon,maxlat]|null, source: "map"|"point_cloud"|"images"|null, area_m2: number|null, photo_points: [lon,lat][] (≤500), photo_points_total: int}`. Its `operationId` is `getOverviewSite`.

- [ ] **Step 1: Contract.** Add to `contract/openapi.yaml`.

Path, placed directly after the `/overview` path item:

```yaml
  /api/v1/projects/{projectId}/overview/site:
    parameters:
      - $ref: "#/components/parameters/projectId"
    get:
      tags: [data]
      operationId: getOverviewSite
      summary: Where the site is. It returns the bounds of the hero map, else of the newest ready point cloud, else of the photos' GPS points, plus at most 500 evenly spread photo points. It makes one bounded primary-key read of `image` and never scans it.
      responses:
        "200":
          description: the site location
          content:
            application/json:
              schema: { $ref: "#/components/schemas/OverviewSite" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }
```

Schemas, placed before `ProjectOverview`:

```yaml
    OverviewHero:
      type: object
      description: what the Overview's big pane shows; the first of a ready map, a ready point cloud, the photos, a ready drawing
      required: [kind, id]
      properties:
        kind: { type: string, enum: [map, point_cloud, images, drawing] }
        id: { type: [string, "null"], description: "null for `images`: the client reads the newest frames" }
    OverviewSite:
      type: object
      required: [center, bounds_wgs84, source, area_m2, photo_points, photo_points_total]
      properties:
        center:
          type: [array, "null"]
          items: { type: number }
          minItems: 2
          maxItems: 2
          description: "[lon, lat], the middle of `bounds_wgs84`"
        bounds_wgs84:
          type: [array, "null"]
          items: { type: number }
          minItems: 4
          maxItems: 4
          description: "[minlon, minlat, maxlon, maxlat]"
        source: { type: [string, "null"], enum: [map, point_cloud, images, null] }
        area_m2: { type: [number, "null"], description: geodesic area of `bounds_wgs84`; the client labels it approximate }
        photo_points:
          type: array
          maxItems: 500
          items: { type: array, items: { type: number }, minItems: 2, maxItems: 2 }
        photo_points_total: { type: integer, minimum: 0, description: estimated number of photos with GPS }
      example:
        center: [20.4612, 44.8125]
        bounds_wgs84: [20.4581, 44.8103, 20.4643, 44.8147]
        source: map
        area_m2: 240500
        photo_points: [[20.4590, 44.8110], [20.4600, 44.8110], [20.4610, 44.8120]]
        photo_points_total: 1280
```

In `ProjectOverview`, change `required:` to `[findings, data, latest_volume, hero_map_id, hero, banners]`. Add the property after `hero_map_id`:

```yaml
        hero:
          oneOf:
            - $ref: "#/components/schemas/OverviewHero"
            - type: "null"
```

Add `hero: { kind: map, id: "a0000000-6666-4000-8000-000000000001" }` to its `example`, after `hero_map_id`.

- [ ] **Step 2: Regenerate and lint the contract**

Run: `pnpm -C contract lint; pnpm -C contract generate`
Expected: the lint has no errors, and `contract/client/schema.d.ts` now contains `OverviewSite` and `OverviewHero`.

- [ ] **Step 3: Write the failing backend tests.** Create `backend/tests/test_overview_site.py`:

```python
"""`GET /overview/site` (spec 2026-09-30-project-landing section 4.2): the site's bounds by priority
map > point cloud > photo GPS, and a photo-point sample that is one bounded primary-key read."""

import re
from datetime import date

from sqlalchemy import event

from app.db.models import GeoMap, Image, PointCloud, Source

API = "/api/v1"
IMAGE_READ = re.compile(r"\bFROM\s+\"?image\"?\b", re.IGNORECASE)


def _site(client, project) -> dict:
    r = client.get(f"{API}/projects/{project['id']}/overview/site")
    assert r.status_code == 200, r.text
    return r.json()


def _images(handle, n: int, *, gps: bool = True) -> None:
    with handle.session() as s:
        src = Source(folder="C:/f", site="A", image_count=n)
        s.add(src)
        s.flush()
        s.add_all(
            Image(
                path=f"images/{i}.jpg",
                width=10,
                height=10,
                source_id=src.id,
                lon=20.0 + (i % 50) * 1e-4 if gps else None,
                lat=44.0 + (i // 50) * 1e-4 if gps else None,
            )
            for i in range(n)
        )


def test_an_empty_project_has_no_site(client, project):
    assert _site(client, project) == {
        "center": None,
        "bounds_wgs84": None,
        "source": None,
        "area_m2": None,
        "photo_points": [],
        "photo_points_total": 0,
    }


def test_site_without_gps(client, project, handle):
    _images(handle, 20, gps=False)
    out = _site(client, project)
    assert (out["center"], out["source"], out["photo_points"], out["photo_points_total"]) == (None, None, [], 0)


def test_photos_give_the_bounds_when_there_is_no_map_or_cloud(client, project, handle):
    _images(handle, 100)
    out = _site(client, project)
    assert out["source"] == "images"
    assert out["photo_points_total"] == 100
    assert len(out["photo_points"]) == 100
    minlon, minlat, maxlon, maxlat = out["bounds_wgs84"]
    assert (round(minlon, 4), round(minlat, 4), round(maxlon, 4), round(maxlat, 4)) == (20.0, 44.0, 20.0049, 44.0001)
    assert out["center"] == [(minlon + maxlon) / 2, (minlat + maxlat) / 2]
    assert out["area_m2"] > 0


def test_a_cloud_beats_photos_and_a_map_beats_a_cloud(client, project, handle):
    _images(handle, 10)
    with handle.session() as s:
        s.add(PointCloud(name="c", status="ready", source_path="C:/c.laz", source_size=1,
                         bounds_wgs84=[20.1, 44.1, 20.2, 44.2]))
    assert _site(client, project)["source"] == "point_cloud"
    with handle.session() as s:
        s.add(GeoMap(name="m", status="ready", source_path="C:/m.tif", source_size=1,
                     captured_on=date(2026, 4, 1), bounds_wgs84=[20.3, 44.3, 20.4, 44.4]))
    out = _site(client, project)
    assert out["source"] == "map"
    assert out["bounds_wgs84"] == [20.3, 44.3, 20.4, 44.4]
    assert len(out["photo_points"]) == 10  # the photo points come whatever gives the bounds


def test_site_sample_is_bounded(client, project, handle):
    _images(handle, 5000)
    seen: list[str] = []

    def before(conn, cursor, statement, params, context, executemany):
        seen.append(statement)

    event.listen(handle.engine, "before_cursor_execute", before)
    try:
        out = _site(client, project)
    finally:
        event.remove(handle.engine, "before_cursor_execute", before)
    assert len(out["photo_points"]) == 500
    assert 4900 <= out["photo_points_total"] <= 5000
    image_reads = [st for st in seen if IMAGE_READ.search(st)]
    # max(rowid) and one keyed IN-list read: never a scan that grows with the project
    assert len(image_reads) == 2, image_reads
    assert any("max(rowid)" in st.lower() for st in image_reads)
```

Extend `backend/tests/test_overview.py`. Update `test_an_empty_project` so the tuple assertion includes `hero`:

```python
    assert (out["latest_volume"], out["hero_map_id"], out["hero"], out["banners"]) == (None, None, None, [])
```

Then append:

```python
def test_the_hero_is_map_then_cloud_then_images_then_drawing(client, project, handle):
    from app.db.models import Drawing, Source

    with handle.session() as s:
        s.add(Drawing(name="Plan", format="pdf", status="ready", source_path="C:/d.pdf", source_size=1))
    hero = _overview(client, project)["hero"]
    assert hero["kind"] == "drawing" and hero["id"]
    with handle.session() as s:
        s.add(Source(folder="C:/f", site="A", kind="images", image_count=3))
    assert _overview(client, project)["hero"] == {"kind": "images", "id": None}
    cloud = insert_cloud(handle)
    assert _overview(client, project)["hero"] == {"kind": "point_cloud", "id": cloud}
    april = _map(handle, "April", "ready", date(2026, 4, 1))
    assert _overview(client, project)["hero"] == {"kind": "map", "id": april}
```

The existing `test_the_overview_costs_the_same_whatever_the_project_holds` must keep passing unchanged. That means hero resolution always runs the same number of statements. Don't short-circuit.

- [ ] **Step 4: Run the tests to verify they fail**

Run: `$PY -m pytest tests/test_overview_site.py tests/test_overview.py -q`
Expected: FAIL. `/overview/site` returns 404, and there is a `KeyError: 'hero'`.

- [ ] **Step 5: Implement.** In `backend/app/overview/schemas.py`, add:

```python
class Hero(BaseModel):
    kind: Literal["map", "point_cloud", "images", "drawing"]
    id: str | None


class OverviewSite(BaseModel):
    center: list[float] | None
    bounds_wgs84: list[float] | None
    source: Literal["map", "point_cloud", "images"] | None
    area_m2: float | None
    photo_points: list[list[float]]
    photo_points_total: int
```

Also add `hero: Hero | None` to `ProjectOverview`, after `hero_map_id`.

In `backend/app/overview/service.py`, add `Drawing` to the models import (it's already imported) and add:

```python
def newest_ready_cloud_id(s: Session) -> str | None:
    """The newest ready point cloud by capture date (undated last), then by import."""
    return s.execute(
        select(PointCloud.id)
        .where(PointCloud.status == "ready")
        .order_by(PointCloud.captured_on.is_(None), PointCloud.captured_on.desc(), PointCloud.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()


def hero(s: Session, data: dict, map_id: str | None) -> dict | None:
    """Spec 2026-09-30-project-landing section 4.1. Every candidate is read every time, so the
    Overview's statement count does not depend on what the project holds."""
    cloud_id = newest_ready_cloud_id(s)
    drawing_id = s.execute(
        select(Drawing.id)
        .where(Drawing.status == "ready")
        .order_by(Drawing.created_at.desc(), Drawing.id.desc())
        .limit(1)
    ).scalar_one_or_none()
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

Change `build()`'s payload to:

```python
    with handle.session() as s:
        data = data_counts(s)
        map_id = hero_map_id(s)
        payload = {
            "findings": query.summary(s, levels=levels),
            "data": data,
            "latest_volume": latest_volume(s),
            "hero_map_id": map_id,
            "hero": hero(s, data, map_id),
        }
```

Create `backend/app/overview/site.py`:

```python
"""`GET /overview/site` (spec 2026-09-30-project-landing section 4.2). Bounds come from the hero map,
else the newest ready point cloud, else the photo sample. The photo sample is one IN-list read of
at most SITE_SAMPLE primary keys spread evenly over 1..max(rowid): bounded whatever the image count."""

from math import radians, sin

from sqlalchemy import bindparam, func, select, text
from sqlalchemy.orm import Session

from app.db.models import GeoMap, PointCloud, Source
from app.overview.service import hero_map_id, newest_ready_cloud_id

SITE_SAMPLE = 500
EARTH_RADIUS_M = 6_371_008.8
_SAMPLE_SQL = text("SELECT lon, lat FROM image WHERE rowid IN :ids").bindparams(bindparam("ids", expanding=True))


def probes(top: int, n: int = SITE_SAMPLE) -> list[int]:
    """Up to `n` distinct rowids spread evenly over 1..top."""
    if top <= n:
        return list(range(1, top + 1))
    return sorted({1 + (i * (top - 1)) // (n - 1) for i in range(n)})


def bbox_area_m2(b: list[float]) -> float:
    minlon, minlat, maxlon, maxlat = b
    return abs(radians(maxlon - minlon)) * abs(sin(radians(maxlat)) - sin(radians(minlat))) * EARTH_RADIUS_M**2


def photo_sample(s: Session) -> tuple[list[list[float]], int]:
    top = s.execute(text("SELECT max(rowid) FROM image")).scalar()
    if not top:
        return [], 0
    rows = s.execute(_SAMPLE_SQL, {"ids": probes(int(top))}).all()
    points = [[lon, lat] for lon, lat in rows if lon is not None and lat is not None]
    if not rows:
        return [], 0
    population = s.execute(
        select(func.coalesce(func.sum(Source.image_count), 0)).where(Source.kind == "images")
    ).scalar_one()
    return points, round(population * len(points) / len(rows))


def _bounds_of(points: list[list[float]]) -> list[float] | None:
    if not points:
        return None
    lons = [p[0] for p in points]
    lats = [p[1] for p in points]
    return [min(lons), min(lats), max(lons), max(lats)]


def build(s: Session) -> dict:
    points, total = photo_sample(s)
    bounds, source = None, None
    map_id = hero_map_id(s)
    if map_id:
        bounds, source = s.get(GeoMap, map_id).bounds_wgs84, "map"
    if bounds is None:
        cloud_id = newest_ready_cloud_id(s)
        if cloud_id:
            bounds = s.get(PointCloud, cloud_id).bounds_wgs84
            source = "point_cloud" if bounds else None
    if bounds is None:
        bounds = _bounds_of(points)
        source = "images" if bounds else None
    return {
        "center": [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] if bounds else None,
        "bounds_wgs84": bounds,
        "source": source,
        "area_m2": bbox_area_m2(bounds) if bounds else None,
        "photo_points": points,
        "photo_points_total": total,
    }
```

In `backend/app/overview/router.py`, add:

```python
from app.overview import site
from app.overview.schemas import OverviewSite


@router.get("/overview/site", response_model=OverviewSite)
def get_overview_site(handle: ProjectHandle = Depends(get_project)) -> OverviewSite:
    with handle.session() as s:
        return OverviewSite(**site.build(s))
```

Keep the imports sorted for ruff: merge `site` into the existing `from app.overview import service` line as `from app.overview import service, site`, and add `OverviewSite` to the schemas import.

- [ ] **Step 6: Run the backend tests to verify they pass**

Run: `$PY -m pytest tests/test_overview_site.py tests/test_overview.py tests/test_contract.py tests/test_foundation_contract.py -q`
Expected: PASS. If `test_foundation_contract.py::test_the_mock_has_an_example` is parametrised over schema names and complains, the `OverviewSite` example added in Step 1 covers it.

- [ ] **Step 7: Lint and commit**

Run: `$PY -m ruff check .; $PY -m ruff format --check .; pnpm -C ../contract check`
Expected: clean, and `check` shows no diff because `schema.d.ts` was already regenerated.

```bash
git add contract/openapi.yaml contract/client/schema.d.ts backend/app/overview/schemas.py backend/app/overview/service.py backend/app/overview/router.py backend/app/overview/site.py backend/tests/test_overview.py backend/tests/test_overview_site.py
git commit -m "feat(overview): hero pick and /overview/site with a bounded photo-point sample"
```

---

### Task 2: Frontend fixtures and API wrappers

**Files:**
- Modify: `frontend/src/test/findingFixtures.ts` (`fullOverview` and `emptyOverview`).
- Modify: `frontend/src/test/fixtures.ts` (`exampleOverview`).
- Modify: `frontend/src/api/overview.ts`.
- Test: `frontend/src/api/overview.test.ts` (new).

**Interfaces:**
- Produces:
  - `type OverviewSite`, `type OverviewHero`.
  - `fetchOverviewSite(api, projectId): Promise<OverviewSite>`.
  - `fetchLatestImages(api, projectId, limit): Promise<ImageRow[]>`, which is newest by capture time, thumbnails only.
  - Fixtures: `fullOverview.hero = {kind: "map", id: MAP_ID}` and `emptyOverview.hero = null`, plus new exports `cloudOnlyOverview`, `imagesOnlyOverview` and `exampleSite`, `noSite`.

- [ ] **Step 1: Write the failing test.** Create `frontend/src/api/overview.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { exampleSite } from "@/test/findingFixtures";
import { fetchLatestImages, fetchOverviewSite } from "./overview";

describe("overview reads", () => {
  it("reads the site", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/overview\/site$/, body: exampleSite }]);
    await expect(fetchOverviewSite(api, PROJECT_ID)).resolves.toEqual(exampleSite);
    expect(requests[0].url).toContain(`/projects/${PROJECT_ID}/overview/site`);
  });

  it("reads the newest frames by capture time, bounded", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/images$/, body: { items: [], next_cursor: null } }]);
    await fetchLatestImages(api, PROJECT_ID, 8);
    const url = new URL(requests[0].url, "http://x");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ sort: "capture_time", order: "desc", limit: "8" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/api/overview.test.ts`
Expected: FAIL, because `fetchOverviewSite` isn't exported and `exampleSite` doesn't exist. `pnpm -C frontend build` also fails typecheck, because the fixtures lack `hero`.

- [ ] **Step 3: Implement.** Append to `frontend/src/api/overview.ts`:

```ts
import type { Image as ImageRow } from "@contract/client";
import { fetchImagePage } from "./images";

export type OverviewSite = components["schemas"]["OverviewSite"];
export type OverviewHero = components["schemas"]["OverviewHero"];

/** Spec 2026-09-30-project-landing §4.2: read after `/overview`, never gating it. */
export function fetchOverviewSite(api: ApiClient, projectId: string): Promise<OverviewSite> {
  return unwrap(api.GET("/api/v1/projects/{projectId}/overview/site", { params: { path: { projectId } } }));
}

/** The newest frames for the mosaic and the imagery pane: one bounded page. */
export async function fetchLatestImages(api: ApiClient, projectId: string, limit: number): Promise<ImageRow[]> {
  const page = await fetchImagePage(api, projectId, { sort: "capture_time", order: "desc", limit });
  return page.items;
}
```

Move the imports to the top of the file. In `frontend/src/test/findingFixtures.ts`, add `hero: { kind: "map", id: MAP_ID },` to `fullOverview` and `hero: null,` to `emptyOverview`. Then append:

```ts
export const cloudOnlyOverview: ProjectOverview = {
  ...fullOverview,
  data: { image_sets: 1, images: 40, maps: 0, elevations: 0, point_clouds: 1, drawings: 0 },
  hero_map_id: null,
  hero: { kind: "point_cloud", id: "c0000000-1111-4000-8000-000000000001" },
};

export const imagesOnlyOverview: ProjectOverview = {
  ...fullOverview,
  data: { image_sets: 1, images: 1284, maps: 0, elevations: 0, point_clouds: 0, drawings: 0 },
  latest_volume: null,
  hero_map_id: null,
  hero: { kind: "images", id: null },
};

export const exampleSite: OverviewSite = {
  center: [20.4612, 44.8125],
  bounds_wgs84: [20.4581, 44.8103, 20.4643, 44.8147],
  source: "map",
  area_m2: 240500,
  photo_points: [
    [20.459, 44.811],
    [20.46, 44.811],
    [20.461, 44.812],
  ],
  photo_points_total: 1280,
};

export const noSite: OverviewSite = {
  center: null,
  bounds_wgs84: null,
  source: null,
  area_m2: null,
  photo_points: [],
  photo_points_total: 0,
};
```

Import `OverviewSite` from `@/api/overview`. In `frontend/src/test/fixtures.ts`, add `hero: null` (or `{ kind: "map", id: <its hero_map_id> }` when that is non-null) to `exampleOverview`.

- [ ] **Step 4: Run the tests and the typecheck to verify they pass**

Run: `pnpm -C frontend exec vitest run src/api/overview.test.ts src/overview; pnpm -C frontend exec tsc -b --noEmit`
Expected: PASS. The existing overview tests still pass, because the new field is inert so far.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/overview.ts frontend/src/api/overview.test.ts frontend/src/test/findingFixtures.ts frontend/src/test/fixtures.ts
git commit -m "feat(overview): site and latest-images reads, fixtures carry the hero"
```

---

### Task 3: `composeOverview`, which turns facts into panes and row tracks

**Files:**
- Create: `frontend/src/overview/compose.ts`.
- Test: `frontend/src/overview/compose.test.ts`.

**Interfaces:**
- Consumes: `OverviewHero["kind"]`, from Task 2.
- Produces:

```ts
export type HeroKind = "map" | "point_cloud" | "images" | "drawing";
export interface OverviewFacts {
  heroKind: HeroKind | null;
  dataTotal: number;       // sum of ProjectOverview.data
  hasCloud: boolean;       // data.point_clouds > 0
  hasImages: boolean;      // data.images > 0
  hasSite: boolean;        // site loaded with center != null or photo_points.length > 0
  findingsTotal: number;   // open + reviewed + closed
  runningJobs: boolean;
}
export type PaneId = "header" | "hero" | "cloud" | "location" | "findings" | "imagery" | "status" | "firstData";
export interface Pane { id: PaneId; col: string; row: string }   // CSS grid-column / grid-row values at ≥ lg
export interface Composition { panes: Pane[]; rows: string }      // rows = grid-template-rows at ≥ lg
export function composeOverview(f: OverviewFacts): Composition;
export const ROWS_FULL: string;   // "auto minmax(170px,.675fr) minmax(170px,.675fr) minmax(220px,1fr)"
export const ROWS_NO_BOTTOM: string; // "auto minmax(170px,1fr) minmax(170px,1fr)"
```

- [ ] **Step 1: Write the failing test.** Create `frontend/src/overview/compose.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { composeOverview, ROWS_FULL, ROWS_NO_BOTTOM, type OverviewFacts } from "./compose";

const everything: OverviewFacts = {
  heroKind: "map",
  dataTotal: 1290,
  hasCloud: true,
  hasImages: true,
  hasSite: true,
  findingsTotal: 38,
  runningJobs: false,
};
const ids = (f: OverviewFacts) => composeOverview(f).panes.map((p) => p.id);
const pane = (f: OverviewFacts, id: string) => composeOverview(f).panes.find((p) => p.id === id);

describe("composeOverview", () => {
  it("everything: hero on 8 columns, cloud over location, three panes below", () => {
    const c = composeOverview(everything);
    expect(c.rows).toBe(ROWS_FULL);
    expect(ids(everything)).toEqual(["header", "hero", "cloud", "location", "findings", "imagery", "status"]);
    expect(pane(everything, "hero")).toEqual({ id: "hero", col: "1 / span 8", row: "2 / span 2" });
    expect(pane(everything, "cloud")).toEqual({ id: "cloud", col: "9 / -1", row: "2" });
    expect(pane(everything, "location")).toEqual({ id: "location", col: "9 / -1", row: "3" });
    expect(pane(everything, "findings")?.col).toBe("1 / span 5");
    expect(pane(everything, "imagery")?.col).toBe("6 / span 4");
    expect(pane(everything, "status")?.col).toBe("10 / span 3");
  });

  it("no ortho: the cloud is the hero, so there is no cloud tile and location fills the column", () => {
    const f = { ...everything, heroKind: "point_cloud" as const };
    expect(ids(f)).not.toContain("cloud");
    expect(pane(f, "location")).toEqual({ id: "location", col: "9 / -1", row: "2 / span 2" });
  });

  it("images only: the mosaic is the hero, so there is no imagery pane; findings and status share the row", () => {
    const f = { ...everything, heroKind: "images" as const, hasCloud: false };
    expect(ids(f)).toEqual(["header", "hero", "location", "findings", "status"]);
    expect(pane(f, "findings")?.col).toBe("1 / span 8");
    expect(pane(f, "status")?.col).toBe("9 / span 4");
  });

  it("no location and no cloud: the hero takes the full width", () => {
    const f = { ...everything, hasCloud: false, hasSite: false };
    expect(pane(f, "hero")?.col).toBe("1 / -1");
  });

  it("an empty project is the first-data screen only", () => {
    const f: OverviewFacts = { ...everything, heroKind: null, dataTotal: 0, hasCloud: false, hasImages: false, hasSite: false, findingsTotal: 0 };
    expect(composeOverview(f).panes).toEqual([{ id: "firstData", col: "1 / -1", row: "1 / -1" }]);
  });

  it("findings on a cloud with no images: findings and status fill the row, no imagery", () => {
    const f = { ...everything, heroKind: "point_cloud" as const, hasImages: false };
    expect(ids(f)).toEqual(["header", "hero", "location", "findings", "status"]);
    const cols = composeOverview(f).panes.filter((p) => p.row === "4").map((p) => p.col);
    expect(cols).toEqual(["1 / span 8", "9 / span 4"]);
  });

  it("images but no findings: a findings call to action, no status", () => {
    const f = { ...everything, findingsTotal: 0 };
    expect(ids(f)).toEqual(["header", "hero", "cloud", "location", "findings", "imagery"]);
    expect(pane(f, "findings")?.col).toBe("1 / span 7");
  });

  it("a drawing only: no bottom row and no empty track", () => {
    const f: OverviewFacts = { ...everything, heroKind: "drawing", dataTotal: 1, hasCloud: false, hasImages: false, hasSite: false, findingsTotal: 0 };
    const c = composeOverview(f);
    expect(c.panes.map((p) => p.id)).toEqual(["header", "hero"]);
    expect(c.rows).toBe(ROWS_NO_BOTTOM);
  });

  it("a running job alone brings the status pane", () => {
    const f = { ...everything, findingsTotal: 0, hasImages: false, heroKind: "point_cloud" as const, runningJobs: true };
    expect(ids(f)).toContain("status");
  });

  it("every bottom row fills exactly 12 columns", () => {
    for (const findingsTotal of [0, 5])
      for (const hasImages of [true, false])
        for (const runningJobs of [true, false]) {
          const c = composeOverview({ ...everything, findingsTotal, hasImages, runningJobs });
          const spans = c.panes.filter((p) => p.row === "4").map((p) => Number(p.col.split("span ")[1]));
          if (spans.length) expect(spans.reduce((a, b) => a + b, 0)).toBe(12);
        }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/overview/compose.test.ts`
Expected: FAIL, because it can't resolve `./compose`.

- [ ] **Step 3: Implement.** Create `frontend/src/overview/compose.ts`:

```ts
/**
 * Spec 2026-09-30-project-landing §5.1: which Overview panes exist and where they sit, from a few
 * facts. A pane with nothing to show is left out and its neighbours close the gap, so the page never
 * shows an empty container. Placement values apply at ≥ lg; below that the grid is one column.
 */
export type HeroKind = "map" | "point_cloud" | "images" | "drawing";

export interface OverviewFacts {
  heroKind: HeroKind | null;
  dataTotal: number;
  hasCloud: boolean;
  hasImages: boolean;
  hasSite: boolean;
  findingsTotal: number;
  runningJobs: boolean;
}

export type PaneId = "header" | "hero" | "cloud" | "location" | "findings" | "imagery" | "status" | "firstData";
export interface Pane {
  id: PaneId;
  col: string;
  row: string;
}
export interface Composition {
  panes: Pane[];
  rows: string;
}

export const ROWS_FULL = "auto minmax(170px,.675fr) minmax(170px,.675fr) minmax(220px,1fr)";
export const ROWS_NO_BOTTOM = "auto minmax(170px,1fr) minmax(170px,1fr)";
const BOTTOM_WEIGHT: Partial<Record<PaneId, number>> = { findings: 5, imagery: 4, status: 3 };

/** Integer column spans in proportion to `weights`, summing to exactly 12. */
function spans(weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  const out = weights.map((w) => Math.round((w * 12) / total));
  out[out.length - 1] = 12 - out.slice(0, -1).reduce((a, b) => a + b, 0);
  return out;
}

export function composeOverview(f: OverviewFacts): Composition {
  if (f.dataTotal === 0) return { panes: [{ id: "firstData", col: "1 / -1", row: "1 / -1" }], rows: "1fr" };

  const panes: Pane[] = [{ id: "header", col: "1 / -1", row: "1" }];
  const side: PaneId[] = [];
  if (f.hasCloud && f.heroKind !== "point_cloud") side.push("cloud");
  if (f.hasSite) side.push("location");
  panes.push({ id: "hero", col: side.length ? "1 / span 8" : "1 / -1", row: "2 / span 2" });
  side.forEach((id, i) =>
    panes.push({ id, col: "9 / -1", row: side.length === 1 ? "2 / span 2" : String(2 + i) }),
  );

  const bottom: PaneId[] = [];
  if (f.findingsTotal > 0 || f.hasImages) bottom.push("findings");
  if (f.hasImages && f.heroKind !== "images") bottom.push("imagery");
  if (f.findingsTotal > 0 || f.runningJobs) bottom.push("status");
  const widths = spans(bottom.map((id) => BOTTOM_WEIGHT[id] ?? 1));
  let start = 1;
  bottom.forEach((id, i) => {
    panes.push({ id, col: `${start} / span ${widths[i]}`, row: "4" });
    start += widths[i];
  });
  return { panes, rows: bottom.length ? ROWS_FULL : ROWS_NO_BOTTOM };
}
```

Check against the tests: findings+imagery gives 5·12/9 = 6.67 → 7, and the last gets 5. The "images but no findings" case expects `1 / span 7` ✓. Findings+status gives 5·12/8 = 7.5 → 8, then 4 ✓. All three give 5, 4, 3 ✓.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/overview/compose.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/overview/compose.ts frontend/src/overview/compose.test.ts
git commit -m "feat(overview): composeOverview picks panes and placement from the project's data"
```

---

### Task 4: `SiteLocation`, an offline SVG of where the site is

**Files:**
- Create: `frontend/src/overview/siteGeometry.ts` and `frontend/src/overview/SiteLocation.tsx`.
- Test: `frontend/src/overview/siteGeometry.test.ts` and `frontend/src/overview/SiteLocation.test.tsx`.

**Interfaces:**
- Consumes: `OverviewSite` and `Finding` (`lon`, `lat`, `severity`, `id`).
- Produces:
  - `siteFrame(site: OverviewSite): SiteFrame | null`, where `SiteFrame = { width: number; height: number; project(lon: number, lat: number): {x: number; y: number}; metresPerUnit: number }`.
  - `niceScale(metresAcross: number): { metres: number; label: string }`.
  - `<SiteLocation site={OverviewSite} pins={Finding[]} className?: string />`.

- [ ] **Step 1: Write the failing tests.** Create `frontend/src/overview/siteGeometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { exampleSite, noSite } from "@/test/findingFixtures";
import { niceScale, siteFrame } from "./siteGeometry";

describe("siteFrame", () => {
  it("is null without any geometry", () => {
    expect(siteFrame(noSite)).toBeNull();
  });

  it("puts north up and keeps the aspect with cos(latitude)", () => {
    const f = siteFrame(exampleSite)!;
    const [minlon, minlat, maxlon, maxlat] = exampleSite.bounds_wgs84!;
    const sw = f.project(minlon, minlat);
    const ne = f.project(maxlon, maxlat);
    expect(ne.y).toBeLessThan(sw.y); // north is up
    expect(ne.x).toBeGreaterThan(sw.x);
    const ratio = (ne.x - sw.x) / (sw.y - ne.y);
    expect(ratio).toBeCloseTo(((maxlon - minlon) * Math.cos((44.8125 * Math.PI) / 180)) / (maxlat - minlat), 3);
  });

  it("pads a single photo point so the frame is never zero-sized", () => {
    const f = siteFrame({ ...exampleSite, bounds_wgs84: [20, 44, 20, 44], center: [20, 44] })!;
    expect(f.width).toBeGreaterThan(0);
    expect(f.height).toBeGreaterThan(0);
  });
});

describe("niceScale", () => {
  it("picks a round length near a quarter of the width", () => {
    expect(niceScale(480)).toEqual({ metres: 100, label: "100 m" });
    expect(niceScale(9000)).toEqual({ metres: 2000, label: "2 km" });
  });
});
```

Create `frontend/src/overview/SiteLocation.test.tsx`:

```ts
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { exampleFinding, exampleSite } from "@/test/findingFixtures";
import { SiteLocation } from "./SiteLocation";

describe("SiteLocation", () => {
  it("draws the site outline, the photo points and the pins that have a location", () => {
    const located = { ...exampleFinding, id: "f-loc", lon: 20.4612, lat: 44.8125 };
    const unlocated = { ...exampleFinding, id: "f-none", lon: null, lat: null };
    render(<SiteLocation site={exampleSite} pins={[located, unlocated]} />);
    expect(screen.getByRole("img", { name: /site location/i })).toBeInTheDocument();
    expect(screen.getByTestId("site-outline")).toBeInTheDocument();
    expect(screen.getAllByTestId("photo-point")).toHaveLength(3);
    expect(screen.getAllByTestId("site-pin")).toHaveLength(1);
    expect(screen.getByText(/≈ 24\.1 ha/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C frontend exec vitest run src/overview/siteGeometry.test.ts src/overview/SiteLocation.test.tsx`
Expected: FAIL, because the modules don't exist.

- [ ] **Step 3: Implement.** Create `frontend/src/overview/siteGeometry.ts`:

```ts
import type { OverviewSite } from "@/api/overview";

/** A local equirectangular frame (north up), padded by 10%. Enough for a site-sized area with no basemap. */
export interface SiteFrame {
  width: number;
  height: number;
  metresPerUnit: number;
  project(lon: number, lat: number): { x: number; y: number };
}

const M_PER_DEG_LAT = 111_320;
const MIN_SPAN_DEG = 0.001; // ~100 m: one photo or a tiny site still gets a frame

export function siteFrame(site: OverviewSite): SiteFrame | null {
  const b = site.bounds_wgs84;
  if (!b) return null;
  const [minlon0, minlat0, maxlon0, maxlat0] = b;
  const cx = (minlon0 + maxlon0) / 2;
  const cy = (minlat0 + maxlat0) / 2;
  const halfLon = Math.max(maxlon0 - minlon0, MIN_SPAN_DEG) * 0.6;
  const halfLat = Math.max(maxlat0 - minlat0, MIN_SPAN_DEG) * 0.6;
  const k = Math.cos((cy * Math.PI) / 180);
  const minlon = cx - halfLon;
  const maxlat = cy + halfLat;
  return {
    width: 2 * halfLon * k,
    height: 2 * halfLat,
    metresPerUnit: M_PER_DEG_LAT,
    project: (lon, lat) => ({ x: (lon - minlon) * k, y: maxlat - lat }),
  };
}

const STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];

export function niceScale(metresAcross: number): { metres: number; label: string } {
  const target = metresAcross / 4;
  const metres = STEPS.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best), STEPS[0]);
  return { metres, label: metres >= 1000 ? `${metres / 1000} km` : `${metres} m` };
}
```

Create `frontend/src/overview/SiteLocation.tsx`. It uses tokens only: points in `fill-accent`, the outline in `stroke-accent`, and pins through the severity `--c` variable, as MapHero does:

```tsx
import type { Finding } from "@/api/findings";
import type { OverviewSite } from "@/api/overview";
import { cx, GlassPanel, useSeverityScale } from "@/ui";
import { niceScale, siteFrame } from "./siteGeometry";

/** Spec 2026-09-30-project-landing §5.3 and D8: where the site is, drawn from our own geometry (no basemap). */
export function SiteLocation({ site, pins, className }: { site: OverviewSite; pins: Finding[]; className?: string }) {
  const scale = useSeverityScale();
  const frame = siteFrame(site);
  if (!frame) return null;
  const [minlon, minlat, maxlon, maxlat] = site.bounds_wgs84!;
  const a = frame.project(minlon, maxlat);
  const z = frame.project(maxlon, minlat);
  const bar = niceScale(frame.width * frame.metresPerUnit);
  const barUnits = bar.metres / frame.metresPerUnit;
  const dot = frame.height / 90;
  const located = pins.filter((p) => p.lon != null && p.lat != null);
  const ha = site.area_m2 != null ? `≈ ${(site.area_m2 / 10_000).toFixed(1)} ha` : null;
  return (
    <GlassPanel variant="pane" as="section" aria-label="Location" className={cx("flex min-h-0 flex-col p-3", className)}>
      <h2 className="flex justify-between text-xs text-muted">
        <span>Location</span>
        {ha && <span className="font-mono text-2xs text-dim">{ha}</span>}
      </h2>
      <svg
        role="img"
        aria-label="Site location"
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="mt-2 min-h-0 w-full flex-1"
      >
        <rect
          data-testid="site-outline"
          x={a.x}
          y={a.y}
          width={Math.max(z.x - a.x, dot)}
          height={Math.max(z.y - a.y, dot)}
          className="fill-accent/10 stroke-accent"
          strokeWidth={dot / 3}
          strokeDasharray={`${dot} ${dot / 1.5}`}
        />
        {site.photo_points.map(([lon, lat], i) => {
          const p = frame.project(lon, lat);
          return <circle key={i} data-testid="photo-point" cx={p.x} cy={p.y} r={dot / 2.5} className="fill-accent" opacity={0.6} />;
        })}
        {located.map((f) => {
          const p = frame.project(f.lon!, f.lat!);
          const colour = scale.find((l) => l.level === f.severity)?.color;
          return (
            <circle
              key={f.id}
              data-testid="site-pin"
              cx={p.x}
              cy={p.y}
              r={dot * 1.4}
              className="fill-[color:var(--c)] stroke-bg"
              strokeWidth={dot / 2}
              style={colour ? ({ "--c": colour } as React.CSSProperties) : undefined}
            />
          );
        })}
        <g transform={`translate(${frame.width * 0.04} ${frame.height * 0.94})`}>
          <rect width={barUnits} height={dot / 2} className="fill-ink" />
        </g>
      </svg>
      <p className="mt-1 font-mono text-2xs text-dim">{bar.label}</p>
    </GlassPanel>
  );
}
```

Tokens: check `useSeverityScale()`'s level shape in `frontend/src/ui/severityScale.ts`. If the colour field isn't named `color`, use the name it has, as `MapHero`'s `levelColour` usage does. If lint rejects `fill-accent/10` (DESIGN.md forbids opacity modifiers on translucent tokens, and `accent` is opaque), use `fill-transparent`.

- [ ] **Step 4: Run the tests and lint to verify they pass**

Run: `pnpm -C frontend exec vitest run src/overview/siteGeometry.test.ts src/overview/SiteLocation.test.tsx; pnpm -C frontend lint`
Expected: PASS, and `exampleSite`'s area of 240,500 m² gives "≈ 24.1 ha".

- [ ] **Step 5: Commit**

```bash
git add frontend/src/overview/siteGeometry.ts frontend/src/overview/siteGeometry.test.ts frontend/src/overview/SiteLocation.tsx frontend/src/overview/SiteLocation.test.tsx
git commit -m "feat(overview): SiteLocation draws the site, photo points and pins offline"
```

---

### Task 5: `CloudPreview`, a live 3D preview with a static fallback

**Files:**
- Create: `frontend/src/overview/useInView.ts`, `frontend/src/overview/CloudPreview.tsx` and `frontend/src/overview/CloudStaticCard.tsx`.
- Test: `frontend/src/overview/CloudPreview.test.tsx`.

**Interfaces:**
- Consumes:
  - `listPointClouds(api, projectId): Promise<PointCloud[]>` from `@/api/clouds`.
  - `cloudOctreeUrl(baseUrl, projectId, cloudId)` from `@contract/client`.
  - `useBackend()` from `@/api/client`, which returns `{ baseUrl, token }`.
  - `CloudViewer` from `@/clouds/CloudViewer`, lazily.
  - `reducedEffects()` and `watchEffects()` from `@/clouds/viewer/edl`. That module imports no three.
- Produces:
  - `<CloudPreview projectId cloudId={string|null} variant="hero"|"tile" className? />`. With `cloudId` null it shows the newest ready cloud.
  - `HERO_BUDGET = 1_000_000` and `TILE_BUDGET = 300_000`.
  - `useInView(ref): boolean`.

- [ ] **Step 1: Write the failing test.** Create `frontend/src/overview/CloudPreview.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { exampleCloud } from "@/test/cloudFixtures";
import { renderWithProviders } from "@/test/render";
import { CloudPreview } from "./CloudPreview";

vi.mock("./useInView", () => ({ useInView: () => true }));

function renderPreview(variant: "hero" | "tile" = "tile") {
  const { api } = fakeClient([{ method: "GET", path: /\/pointclouds$/, body: { items: [exampleCloud] } }]);
  renderWithProviders(<CloudPreview projectId={PROJECT_ID} cloudId={null} variant={variant} />, { api });
}

describe("CloudPreview", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.effects;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("shows a static card, not an error, when WebGL cannot start (jsdom has none)", async () => {
    renderPreview();
    await waitFor(() => expect(screen.getByTestId("cloud-static-card")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open in point clouds/i })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/clouds/${exampleCloud.id}`,
    );
  });

  it("never starts the 3D view under reduced effects", async () => {
    document.documentElement.dataset.effects = "reduced";
    renderPreview("hero");
    await waitFor(() => expect(screen.getByTestId("cloud-static-card")).toBeInTheDocument());
    expect(screen.queryByTestId("cloud-canvas")).not.toBeInTheDocument();
  });

  it("says the cloud is being prepared when none is ready, never an empty pane", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/pointclouds$/, body: { items: [{ ...exampleCloud, status: "importing" }] } },
    ]);
    renderWithProviders(<CloudPreview projectId={PROJECT_ID} cloudId={null} variant="tile" />, { api });
    await waitFor(() => expect(screen.getByText("The point cloud is still being prepared.")).toBeInTheDocument());
  });
});
```

Before writing it, check the list shape `listPointClouds` expects (`frontend/src/api/clouds.ts:17`) and match the fake body to it. It may be `{ items }` or a bare array.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/overview/CloudPreview.test.tsx`
Expected: FAIL, because it can't resolve `./CloudPreview`.

- [ ] **Step 3: Implement.** Create `frontend/src/overview/useInView.ts`:

```ts
import { useEffect, useState, type RefObject } from "react";

/** True while `ref` intersects the viewport; the 3D preview unmounts when scrolled away (spec D5). */
export function useInView(ref: RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}
```

Create `frontend/src/overview/CloudStaticCard.tsx`:

```tsx
import { Link } from "react-router-dom";
import type { PointCloud } from "@/api/clouds";
import { cx, focusRing, Icon } from "@/ui";

export function CloudStaticCard({ projectId, cloud }: { projectId: string; cloud: PointCloud }) {
  const pts = cloud.point_count != null ? `${(cloud.point_count / 1e6).toFixed(1)} M points` : null;
  return (
    <div data-testid="cloud-static-card" className="grid h-full place-items-center bg-surface-2 p-4 text-center">
      <div className="flex flex-col items-center gap-2">
        <Icon name="cube" size={28} className="text-muted" />
        <p className="text-sm font-semibold text-ink">{cloud.name}</p>
        <p className="font-mono text-2xs text-muted">
          {[pts, cloud.captured_on].filter(Boolean).join(" · ")}
        </p>
        <Link to={`/p/${projectId}/clouds/${cloud.id}`} className={cx("text-xs text-accent-ink", focusRing)}>
          Open in Point clouds
        </Link>
      </div>
    </div>
  );
}
```

Check `@/ui` Icon names first (`frontend/src/ui/Icon.tsx`). Use the icon the Point clouds tab uses in `ProjectTabs`.

Create `frontend/src/overview/CloudPreview.tsx`:

```tsx
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { cloudOctreeUrl } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { listPointClouds, type PointCloud } from "@/api/clouds";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { reducedEffects, watchEffects } from "@/clouds/viewer/edl";
import { cx, focusRing, GlassPanel, Skeleton } from "@/ui";
import { CloudStaticCard } from "./CloudStaticCard";
import { useInView } from "./useInView";

export const HERO_BUDGET = 1_000_000;
export const TILE_BUDGET = 300_000;

// three + potree-core load only when a preview actually starts (as the Clouds screen does).
const CloudViewer = lazy(() => import("@/clouds/CloudViewer").then((m) => ({ default: m.CloudViewer })));

function newestReady(clouds: PointCloud[]): PointCloud | null {
  return (
    clouds
      .filter((c) => c.status === "ready")
      .sort((a, b) => (b.captured_on ?? "").localeCompare(a.captured_on ?? "") || b.created_at.localeCompare(a.created_at))[0] ??
    null
  );
}

/** Spec 2026-09-30-project-landing D5: a live, drag-to-orbit preview; a static card when it cannot or should not run. */
export function CloudPreview({
  projectId,
  cloudId,
  variant,
  className,
}: {
  projectId: string;
  cloudId: string | null;
  variant: "hero" | "tile";
  className?: string;
}) {
  const api = useApi();
  const { baseUrl, token } = useBackend();
  const box = useRef<HTMLElement>(null);
  const inView = useInView(box);
  const [cloud, setCloud] = useState<PointCloud | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [reduced, setReduced] = useState(reducedEffects);

  useEffect(() => watchEffects(setReduced), []);
  useEffect(() => {
    let live = true;
    listPointClouds(api, projectId)
      .then((all) => live && setCloud(cloudId ? (all.find((c) => c.id === cloudId) ?? null) : newestReady(all)))
      .catch((e: unknown) => {
        pushLog(`point cloud preview unavailable: ${messageOf(e, String(e))}`);
        if (live) setCloud(null);
      });
    return () => {
      live = false;
    };
  }, [api, projectId, cloudId]);

  if (cloud === null)
    // A cloud is counted but none is ready yet (still importing, or failed): say so rather than leave a hole.
    return (
      <GlassPanel variant="pane" className={cx("grid min-h-0 place-items-center p-4 text-center", className)}>
        <p className="text-sm text-muted">The point cloud is still being prepared.</p>
      </GlassPanel>
    );
  const live = cloud && !reduced && !failed;
  const b = cloud?.bounds_native;
  const elevationRange: [number, number] = cloud?.z_stats
    ? [cloud.z_stats.p1, cloud.z_stats.p99]
    : b && b.length === 6
      ? [b[2], b[5]]
      : [0, 1];

  return (
    <GlassPanel
      variant="pane"
      as="section"
      ref={box}
      aria-label="Point cloud preview"
      className={cx("relative min-h-0 overflow-hidden", className)}
    >
      {!cloud ? (
        <Skeleton className="absolute inset-0" />
      ) : live && inView ? (
        <Suspense fallback={<Skeleton className="absolute inset-0" />}>
          <CloudViewer
            cloud={cloud}
            octreeUrl={cloudOctreeUrl(baseUrl, projectId, cloud.id)}
            token={token}
            budget={variant === "hero" ? HERO_BUDGET : TILE_BUDGET}
            colour={cloud.has_rgb ? "rgb" : "elevation"}
            elevationRange={elevationRange}
            pointSize={1}
            onViewState={(s) => s !== "running" && setFailed(true)}
          />
          <GlassPanel variant="float" className="absolute left-3 top-3 z-[2] px-2.5 py-1.5 font-mono text-2xs">
            {cloud.name}
            {cloud.point_count != null && ` · ${(cloud.point_count / 1e6).toFixed(1)} M pts`}
          </GlassPanel>
          <Link
            to={`/p/${projectId}/clouds/${cloud.id}`}
            className={cx("absolute bottom-3 right-3 z-[2] rounded-sm text-xs text-accent-ink", focusRing)}
          >
            Open in Point clouds
          </Link>
        </Suspense>
      ) : (
        <CloudStaticCard projectId={projectId} cloud={cloud} />
      )}
    </GlassPanel>
  );
}
```

Notes for the implementer:
- Check whether `GlassPanel` forwards `ref`. If it doesn't, wrap the content in a `<div ref={box} className="absolute inset-0">` and put the ref there.
- In jsdom, `CloudViewer` reports `"no-webgl"` synchronously through `onViewState` (see `frontend/src/clouds/CloudViewer.test.tsx`). That flips `failed`, so the static card replaces its alert. The first test depends on this.
- The `useInView` mock returns `true`, so the lazy viewer does mount in the test.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/overview/CloudPreview.test.tsx; pnpm -C frontend lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/overview/useInView.ts frontend/src/overview/CloudPreview.tsx frontend/src/overview/CloudStaticCard.tsx frontend/src/overview/CloudPreview.test.tsx
git commit -m "feat(overview): CloudPreview, a budgeted live 3D view with a static fallback"
```

---

### Task 6: Image mosaic hero, imagery pane and drawing/summary hero

**Files:**
- Create: `frontend/src/overview/useLatestImages.ts`, `frontend/src/overview/ImageMosaic.tsx`, `frontend/src/overview/ImageryPane.tsx` and `frontend/src/overview/SummaryHero.tsx`.
- Test: `frontend/src/overview/ImageMosaic.test.tsx` and `frontend/src/overview/SummaryHero.test.tsx`.

**Interfaces:**
- Consumes:
  - `fetchLatestImages(api, projectId, limit)` (Task 2).
  - `thumbnailUrl(baseUrl, token, projectId, imageId)` and `drawingThumbnailUrl(baseUrl, token, projectId, drawingId)`, both from `@contract/client`. Check the latter's argument order at `contract/client/index.ts:299`.
- Produces:
  - `LATEST_IMAGES = 8`.
  - `useLatestImages(projectId, enabled: boolean): { images: ImageRow[] | null; failed: boolean }`.
  - `<ImageMosaic projectId images className? />`, which shows the first 5 as 1 large and 4 small.
  - `<ImageryPane projectId images total className? />`, a 4×2 grid with "View all".
  - `<SummaryHero projectId hero={OverviewHero|null} data={OverviewDataCounts} className? />`. It shows the drawing thumbnail when `hero.kind === "drawing"`, otherwise a list of the data kinds with links.

- [ ] **Step 1: Write the failing tests.** Create `frontend/src/overview/ImageMosaic.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { PROJECT_ID } from "@/test/fixtures";
import { exampleImage } from "@/test/imageFixtures";
import { renderWithProviders } from "@/test/render";
import { ImageMosaic } from "./ImageMosaic";
import { ImageryPane } from "./ImageryPane";

const images = Array.from({ length: 8 }, (_, i) => ({ ...exampleImage, id: `img-${i}` }));

describe("ImageMosaic", () => {
  it("shows the five newest frames, each opening the image", () => {
    renderWithProviders(<ImageMosaic projectId={PROJECT_ID} images={images} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(5);
    expect(links[0]).toHaveAttribute("href", `/p/${PROJECT_ID}/images/img-0`);
  });
});

describe("ImageryPane", () => {
  it("shows up to eight thumbnails and the total", () => {
    renderWithProviders(<ImageryPane projectId={PROJECT_ID} images={images} total={1284} />);
    expect(screen.getAllByRole("img")).toHaveLength(8);
    expect(screen.getByText("1,284")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute("href", `/p/${PROJECT_ID}/images`);
  });
});
```

Look up the real image fixture name in `frontend/src/test/` (`grep -rn "export const example.*Image" frontend/src/test`) and use it.

Create `frontend/src/overview/SummaryHero.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { SummaryHero } from "./SummaryHero";

const data = { image_sets: 0, images: 0, maps: 0, elevations: 1, point_clouds: 0, drawings: 2 };

describe("SummaryHero", () => {
  it("shows the drawing when the hero is a drawing", () => {
    renderWithProviders(<SummaryHero projectId={PROJECT_ID} hero={{ kind: "drawing", id: "d1" }} data={data} />);
    expect(screen.getByRole("img", { name: /drawing/i })).toHaveAttribute("src", expect.stringContaining("/drawings/d1/thumbnail"));
  });

  it("otherwise lists only the data kinds present", () => {
    renderWithProviders(<SummaryHero projectId={PROJECT_ID} hero={null} data={data} />);
    expect(screen.getByRole("link", { name: /1 elevation/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /2 drawings/i })).toBeInTheDocument();
    expect(screen.queryByText(/map/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C frontend exec vitest run src/overview/ImageMosaic.test.tsx src/overview/SummaryHero.test.tsx`
Expected: FAIL, because the modules don't exist.

- [ ] **Step 3: Implement.** Create `frontend/src/overview/useLatestImages.ts`:

```ts
import { useEffect, useState } from "react";
import type { Image as ImageRow } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchLatestImages } from "@/api/overview";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";

export const LATEST_IMAGES = 8;

/** One bounded page of the newest frames, shared by the mosaic hero and the imagery pane. */
export function useLatestImages(projectId: string, enabled: boolean) {
  const api = useApi();
  const dataRev = useChangesStore((s) => s.dataRevision);
  const [state, setState] = useState<{ images: ImageRow[] | null; failed: boolean }>({ images: null, failed: false });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchLatestImages(api, projectId, LATEST_IMAGES)
      .then((images) => live && setState({ images, failed: false }))
      .catch((e: unknown) => {
        pushLog(`latest images unavailable: ${messageOf(e, String(e))}`);
        if (live) setState({ images: [], failed: true });
      });
    return () => {
      live = false;
    };
  }, [api, projectId, enabled, dataRev]);
  return state;
}
```

Create `frontend/src/overview/ImageMosaic.tsx`:

```tsx
import { Link } from "react-router-dom";
import { thumbnailUrl, type Image as ImageRow } from "@contract/client";
import { useBackend } from "@/api/client";
import { cx, focusRing, GlassPanel } from "@/ui";

/** The hero when there is no map or point cloud: one large frame and four small (spec §5.3). */
export function ImageMosaic({ projectId, images, className }: { projectId: string; images: ImageRow[]; className?: string }) {
  const { baseUrl, token } = useBackend();
  const shown = images.slice(0, 5);
  return (
    <GlassPanel variant="pane" as="section" aria-label="Latest photos" className={cx("min-h-0 overflow-hidden p-1.5", className)}>
      <div className="grid h-full grid-cols-[2fr_1fr_1fr] grid-rows-2 gap-1.5">
        {shown.map((img, i) => (
          <Link
            key={img.id}
            to={`/p/${projectId}/images/${img.id}`}
            className={cx("relative overflow-hidden rounded-sm bg-surface-2", i === 0 && "row-span-2", focusRing)}
          >
            <img src={thumbnailUrl(baseUrl, token, projectId, img.id)} alt="" className="absolute inset-0 h-full w-full object-cover" />
          </Link>
        ))}
      </div>
    </GlassPanel>
  );
}
```

Create `frontend/src/overview/ImageryPane.tsx`:

```tsx
import { Link } from "react-router-dom";
import { thumbnailUrl, type Image as ImageRow } from "@contract/client";
import { useBackend } from "@/api/client";
import { cx, focusRing, GlassPanel, transition } from "@/ui";

export function ImageryPane({
  projectId,
  images,
  total,
  className,
}: {
  projectId: string;
  images: ImageRow[];
  total: number;
  className?: string;
}) {
  const { baseUrl, token } = useBackend();
  return (
    <GlassPanel variant="pane" as="section" aria-labelledby="overview-imagery" className={cx("flex min-h-0 flex-col p-3", className)}>
      <div className="flex items-center justify-between">
        <h2 id="overview-imagery" className="text-xs text-muted">
          Latest imagery <span className="font-mono text-dim">{total.toLocaleString("en-US")}</span>
        </h2>
        <Link to={`/p/${projectId}/images`} className={cx("rounded-sm text-xs text-muted hover:text-ink", transition, focusRing)}>
          View all
        </Link>
      </div>
      <div className="mt-2 grid min-h-0 flex-1 grid-cols-4 grid-rows-2 gap-1.5">
        {images.slice(0, 8).map((img) => (
          <img
            key={img.id}
            src={thumbnailUrl(baseUrl, token, projectId, img.id)}
            alt={img.path}
            className="h-full w-full rounded-sm bg-surface-2 object-cover"
          />
        ))}
      </div>
    </GlassPanel>
  );
}
```

Confirm that `transition` is exported from `@/ui`, as `RecentFindings.tsx` uses it. The test expects `1,284` as a plain text node, so render the count in its own `<span>` (as above) and match it with `getByText("1,284")`.

Create `frontend/src/overview/SummaryHero.tsx`:

```tsx
import { Link } from "react-router-dom";
import { drawingThumbnailUrl } from "@contract/client";
import { useBackend } from "@/api/client";
import type { OverviewHero, ProjectOverview } from "@/api/overview";
import { countLabel } from "@/lib/countLabel";
import { cx, focusRing, GlassPanel } from "@/ui";

type Counts = ProjectOverview["data"];

const KINDS: { key: keyof Counts; one: string; many: string; tab: string }[] = [
  { key: "images", one: "photo", many: "photos", tab: "images" },
  { key: "maps", one: "map", many: "maps", tab: "maps" },
  { key: "elevations", one: "elevation", many: "elevations", tab: "maps" },
  { key: "point_clouds", one: "point cloud", many: "point clouds", tab: "clouds" },
  { key: "drawings", one: "drawing", many: "drawings", tab: "maps" }, // drawings have no tab of their own; they overlay in Maps
];

/** The hero when there is no map, cloud or photo: a drawing, else what the project holds (spec §5.3). */
export function SummaryHero({
  projectId,
  hero,
  data,
  className,
}: {
  projectId: string;
  hero: OverviewHero | null;
  data: Counts;
  className?: string;
}) {
  const { baseUrl, token } = useBackend();
  if (hero?.kind === "drawing" && hero.id)
    return (
      <GlassPanel variant="pane" as="section" aria-label="Drawing" className={cx("min-h-0 overflow-hidden p-2", className)}>
        <img
          src={drawingThumbnailUrl(baseUrl, token, projectId, hero.id)}
          alt="Newest drawing"
          className="h-full w-full rounded-sm object-contain"
        />
      </GlassPanel>
    );
  const present = KINDS.filter((k) => data[k.key] > 0);
  return (
    <GlassPanel variant="pane" as="section" aria-label="Project data" className={cx("grid min-h-0 place-items-center p-6", className)}>
      <ul className="flex flex-col gap-2 text-base">
        {present.map((k) => (
          <li key={k.key}>
            <Link to={`/p/${projectId}/${k.tab}`} className={cx("rounded-sm text-ink hover:text-accent-ink", focusRing)}>
              {countLabel(data[k.key], k.one, k.many)}
            </Link>
          </li>
        ))}
      </ul>
    </GlassPanel>
  );
}
```

`drawingThumbnailUrl(baseUrl, token, projectId, drawingId)` is the argument order at `contract/client/index.ts:299`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/overview/ImageMosaic.test.tsx src/overview/SummaryHero.test.tsx; pnpm -C frontend lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/overview/useLatestImages.ts frontend/src/overview/ImageMosaic.tsx frontend/src/overview/ImageryPane.tsx frontend/src/overview/SummaryHero.tsx frontend/src/overview/ImageMosaic.test.tsx frontend/src/overview/SummaryHero.test.tsx
git commit -m "feat(overview): image mosaic hero, imagery pane and summary hero"
```

---

### Task 7: Header strip, Status pane and first-data screen

**Files:**
- Create: `frontend/src/overview/HeaderStrip.tsx`, `frontend/src/overview/StatusPane.tsx` and `frontend/src/overview/FirstData.tsx`.
- Modify: `frontend/src/overview/kpis.ts`, adding `headerFigures`.
- Test: `frontend/src/overview/HeaderStrip.test.tsx`, `frontend/src/overview/FirstData.test.tsx` and `frontend/src/overview/kpis.test.ts` (extend `model.test.ts` if the KPI tests live there; check with `grep -ln buildKpis frontend/src/overview/*.test.ts`).

**Interfaces:**
- Consumes: `buildKpis`, `Kpi`, `SeverityBars`, `RunningJobs`, `ActivityFeed` (existing), and `OverviewSite` (Task 2).
- Produces:
  - `headerFigures(kpis: Kpi[]): Kpi[]`.
  - `formatCoords(lon, lat): string`, for example `"44.8125° N 20.4612° E"`.
  - `<HeaderStrip projectId name figures site={OverviewSite|null} />`.
  - `<StatusPane projectId rows activity activityFailed showBars className? />`.
  - `<FirstData projectId />`.

- [ ] **Step 1: Write the failing tests.** Add to the KPI test file:

```ts
import { formatCoords, headerFigures, type Kpi } from "./kpis";

describe("headerFigures", () => {
  it("drops zero and missing figures", () => {
    const k = (id: Kpi["id"], value: number | null): Kpi => ({ id, label: id, value });
    expect(headerFigures([k("open", 7), k("top", 0), k("data", 1284), k("volume", null)]).map((f) => f.id)).toEqual(["open", "data"]);
  });
});

describe("formatCoords", () => {
  it("formats hemispheres", () => {
    expect(formatCoords(20.4612, 44.8125)).toBe("44.8125° N 20.4612° E");
    expect(formatCoords(-70.25, -33.5)).toBe("33.5000° S 70.2500° W");
  });
});
```

Create `frontend/src/overview/HeaderStrip.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { PROJECT_ID } from "@/test/fixtures";
import { exampleSite, noSite } from "@/test/findingFixtures";
import { renderWithProviders } from "@/test/render";
import { HeaderStrip } from "./HeaderStrip";

const figures = [{ id: "open" as const, label: "Open findings", value: 7 }];

describe("HeaderStrip", () => {
  it("shows the name, coordinates with their source, and the figures", () => {
    renderWithProviders(<HeaderStrip projectId={PROJECT_ID} name="Block C" figures={figures} site={exampleSite} />);
    expect(screen.getByRole("heading", { name: "Block C" })).toBeInTheDocument();
    expect(screen.getByText(/44\.8125° N 20\.4612° E/)).toBeInTheDocument();
    expect(screen.getByText(/from ortho/)).toBeInTheDocument();
    expect(screen.getByText("Open findings")).toBeInTheDocument();
  });

  it("says once, quietly, when there is no location", () => {
    renderWithProviders(<HeaderStrip projectId={PROJECT_ID} name="Block C" figures={[]} site={noSite} />);
    expect(screen.getByText("No location data")).toBeInTheDocument();
  });

  it("names the photos as the source", () => {
    const site = { ...exampleSite, source: "images" as const };
    renderWithProviders(<HeaderStrip projectId={PROJECT_ID} name="Block C" figures={[]} site={site} />);
    expect(screen.getByText(/from ~1,280 photos/)).toBeInTheDocument();
  });
});
```

Create `frontend/src/overview/FirstData.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { FirstData } from "./FirstData";

describe("FirstData", () => {
  it("asks for the first survey and says what each kind of data unlocks", () => {
    renderWithProviders(<FirstData projectId={PROJECT_ID} />);
    expect(screen.getByRole("heading", { name: "Add the first survey" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add data/i })).toBeInTheDocument();
    for (const line of [/Photos/, /Orthomosaic/, /Point cloud/, /Findings/]) expect(screen.getByText(line)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C frontend exec vitest run src/overview/HeaderStrip.test.tsx src/overview/FirstData.test.tsx src/overview/model.test.ts`
Expected: FAIL, because the modules and exports are missing.

- [ ] **Step 3: Implement.** Append to `frontend/src/overview/kpis.ts`:

```ts
/** Spec 2026-09-30-project-landing D6: the header shows a figure only when it says something. */
export function headerFigures(kpis: Kpi[]): Kpi[] {
  return kpis.filter((k) => k.value !== null && k.value !== 0);
}

export function formatCoords(lon: number, lat: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${ns} ${Math.abs(lon).toFixed(4)}° ${ew}`;
}
```

Create `frontend/src/overview/HeaderStrip.tsx`:

```tsx
import { Link } from "react-router-dom";
import type { OverviewSite } from "@/api/overview";
import { AddDataButton } from "@/data/AddDataButton";
import { cx, focusRing, GlassPanel } from "@/ui";
import { formatCoords, type Kpi } from "./kpis";

const SOURCE: Record<string, string> = { map: "from ortho", point_cloud: "from point cloud" };

function sourceLabel(site: OverviewSite): string {
  if (site.source === "images") return `from ~${site.photo_points_total.toLocaleString("en-US")} photos`;
  return site.source ? SOURCE[site.source] : "";
}

/** Row 1 of the Overview: name, where, the figures that are not zero, Add data (spec §5.3). */
export function HeaderStrip({
  projectId,
  name,
  figures,
  site,
}: {
  projectId: string;
  name: string;
  figures: Kpi[];
  site: OverviewSite | null;
}) {
  return (
    <GlassPanel variant="pane" className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
      <div className="min-w-0">
        <h2 className="truncate text-lg font-semibold text-ink">{name}</h2>
        {site === null ? null : site.center ? (
          <p className="font-mono text-2xs text-muted">
            {formatCoords(site.center[0], site.center[1])} <span className="text-dim">· {sourceLabel(site)}</span>
          </p>
        ) : (
          <p className="text-2xs text-dim">No location data</p>
        )}
      </div>
      <div className="flex-1" />
      {figures.map((f) => {
        const body = (
          <span className="flex flex-col">
            <span className={cx("font-mono text-xl tabular-nums", f.tone === "danger" ? "text-danger" : "text-ink")}>
              {f.value?.toLocaleString("en-US")}
              {f.unit && <span className="ml-0.5 text-xs text-muted">{f.unit}</span>}
            </span>
            <span className="text-2xs text-muted">{f.label}</span>
          </span>
        );
        return f.href ? (
          <Link key={f.id} to={f.href} className={cx("rounded-sm", focusRing)}>
            {body}
          </Link>
        ) : (
          <span key={f.id}>{body}</span>
        );
      })}
      <AddDataButton projectId={projectId} variant="primary" icon="plus">
        Add data
      </AddDataButton>
    </GlassPanel>
  );
}
```

The KPI `data` tile's value is the image count and its label is "Project data". In the header, relabel it `Images` by mapping `f.id === "data" ? "Images" : f.label`, and keep the rest as they are.

Create `frontend/src/overview/StatusPane.tsx`. It stacks the existing pieces. First give `SeverityBars`, `RunningJobs` and `ActivityFeed` an optional `className` and a `bare?: boolean` prop, which renders their content without their own `GlassPanel` and `col-span` classes, so they can nest:

```tsx
import type { Activity } from "@/api/findings";
import { cx, GlassPanel } from "@/ui";
import { ActivityFeed } from "./ActivityFeed";
import type { SeverityRow } from "./kpis";
import { RunningJobs } from "./RunningJobs";
import { SeverityBars } from "./SeverityBars";

export const STATUS_ACTIVITY = 3;

/** Spec D7: severity bars, running jobs (only while running) and the last three activity lines, in one pane. */
export function StatusPane({
  projectId,
  rows,
  activity,
  activityFailed,
  showBars,
  className,
}: {
  projectId: string;
  rows: SeverityRow[];
  activity: Activity[];
  activityFailed: boolean;
  showBars: boolean;
  className?: string;
}) {
  return (
    <GlassPanel variant="pane" as="section" aria-label="Status" className={cx("flex min-h-0 flex-col gap-3 overflow-hidden px-4 py-3.5", className)}>
      {showBars && <SeverityBars rows={rows} bare />}
      <RunningJobs projectId={projectId} bare hideWhenIdle />
      <ActivityFeed projectId={projectId} items={activity.slice(0, STATUS_ACTIVITY)} failed={activityFailed} bare />
    </GlassPanel>
  );
}
```

That means three small edits to existing components:
- `SeverityBars({ rows, bare })`: when `bare`, return the `<h2>` and `<ul>` inside a fragment instead of the `GlassPanel`.
- `RunningJobs({ projectId, bare, hideWhenIdle })`: when `hideWhenIdle` and nothing is running, return `null`, not the "Nothing is running." panel. When `bare`, drop the `GlassPanel` wrapper.
- `ActivityFeed({ ..., bare })`: when `bare`, drop the wrapper and `col-span` classes, and add an "All activity" link. Point it at the route the existing feed's rows use for more (check `ActivityFeed.tsx`). If there is no activity route, link to `/p/${projectId}/findings`.

`SeverityRow` must be exported from `kpis.ts`. It is the element type of `severityRows()`'s return value. Check the name and export it if needed. The existing `OverviewScreen.test.tsx` tests for these blocks must still pass, because `bare` defaults to false.

Create `frontend/src/overview/FirstData.tsx`:

```tsx
import { AddDataButton } from "@/data/AddDataButton";
import { GlassPanel } from "@/ui";

const UNLOCKS: [string, string][] = [
  ["Photos", "location, detection and findings"],
  ["Orthomosaic", "the site map with finding pins"],
  ["Point cloud", "the 3D view and volumes"],
  ["Findings", "reports"],
];

/** Spec 2026-09-30-project-landing state 4: an empty project asks for data instead of showing empty tiles. */
export function FirstData({ projectId }: { projectId: string }) {
  return (
    <div className="grid h-full min-h-[420px] gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="grid place-items-center rounded-panel border border-dashed border-accent p-8 text-center">
        <div className="flex max-w-md flex-col items-center gap-3">
          <h2 className="text-xl font-semibold text-ink">Add the first survey</h2>
          <p className="text-sm text-muted">
            A folder of drone photos, a GeoTIFF orthomosaic or a LAS/LAZ point cloud. Each import runs in the
            background, and this page fills in as it lands.
          </p>
          <AddDataButton projectId={projectId} variant="primary" icon="plus">
            Add data
          </AddDataButton>
        </div>
      </div>
      <GlassPanel variant="pane" className="flex flex-col justify-center gap-3 p-6">
        <h3 className="text-xs text-muted">What each kind of data unlocks</h3>
        <ol className="flex flex-col gap-2.5">
          {UNLOCKS.map(([what, unlocks], i) => (
            <li key={what} className="flex items-center gap-3 text-sm text-muted">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-surface-2 font-mono text-2xs text-ink">{i + 1}</span>
              <span>
                <span className="text-ink">{what}</span> → {unlocks}
              </span>
            </li>
          ))}
        </ol>
      </GlassPanel>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/overview; pnpm -C frontend lint`
Expected: PASS, including the unchanged `OverviewScreen.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/overview/kpis.ts frontend/src/overview/model.test.ts frontend/src/overview/HeaderStrip.tsx frontend/src/overview/HeaderStrip.test.tsx frontend/src/overview/StatusPane.tsx frontend/src/overview/FirstData.tsx frontend/src/overview/FirstData.test.tsx frontend/src/overview/SeverityBars.tsx frontend/src/overview/RunningJobs.tsx frontend/src/overview/ActivityFeed.tsx
git commit -m "feat(overview): header strip, status pane and first-data screen"
```

(Use the real KPI test file name in `git add`.)

---

### Task 8: `OverviewScreen`, the viewport grid wired to `composeOverview`

**Files:**
- Modify: `frontend/src/overview/OverviewScreen.tsx` (whole render), `frontend/src/overview/overview.css` (grid rules), `frontend/src/overview/MapHero.tsx` (frame class and `className` prop) and `frontend/src/overview/RecentFindings.tsx` (`className` prop and fill-height).
- Create: `frontend/src/overview/useOverviewSite.ts`.
- Test: `frontend/src/overview/OverviewScreen.test.tsx` (extend).

**Interfaces:**
- Consumes: everything from Tasks 2–7.
- Produces: the finished screen. The DOM contract e2e relies on:
  - `section[aria-label="Overview"]` has `data-testid="overview-grid"`.
  - Each pane wrapper has `data-pane="<PaneId>"`.

- [ ] **Step 1: Write the failing tests.** Add to `frontend/src/overview/OverviewScreen.test.tsx`. Extend `renderOverview`'s default routes with `{ method: "GET", path: /\/overview\/site$/, body: exampleSite }`, `/pointclouds` → `{ items: [] }` and `/images` → `{ items: [], next_cursor: null }`, placed **before** the `/overview$/` route so the more specific site regex wins. Also mock the heavy panes:

```tsx
vi.mock("./CloudPreview", () => ({ CloudPreview: ({ variant }: { variant: string }) => <div data-testid={`cloud-${variant}`} /> }));

const panes = () => [...document.querySelectorAll("[data-pane]")].map((e) => e.getAttribute("data-pane"));

describe("Overview v2 layout", () => {
  it("everything: map hero, cloud tile, location, findings, imagery, status", async () => {
    renderOverview(fullOverview);
    await waitFor(() => expect(panes()).toContain("location"));
    expect(panes()).toEqual(["header", "hero", "cloud", "location", "findings", "imagery", "status"]);
    expect(screen.getByTestId("map-hero")).toBeInTheDocument();
    expect(screen.getByTestId("cloud-tile")).toBeInTheDocument();
  });

  it("no ortho: the cloud is the hero and there is no cloud tile", async () => {
    renderOverview(cloudOnlyOverview);
    await waitFor(() => expect(screen.getByTestId("cloud-hero")).toBeInTheDocument());
    expect(screen.queryByTestId("cloud-tile")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-hero")).not.toBeInTheDocument();
  });

  it("images only: the mosaic is the hero and there is no separate imagery pane", async () => {
    renderOverview(imagesOnlyOverview);
    await waitFor(() => expect(panes()).toContain("hero"));
    expect(screen.getByRole("region", { name: "Latest photos" })).toBeInTheDocument();
    expect(panes()).not.toContain("imagery");
  });

  it("an empty project is the first-data screen and nothing else", async () => {
    renderOverview(emptyOverview);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Add the first survey" })).toBeInTheDocument());
    expect(panes()).toEqual(["firstData"]);
  });

  it("a failed site read drops the location pane and keeps the page", async () => {
    renderOverview(fullOverview, [{ method: "GET", path: /\/overview\/site$/, status: 500, body: errorBody("boom") }]);
    await waitFor(() => expect(panes()).toContain("hero"));
    expect(panes()).not.toContain("location");
    expect(screen.queryByText(/Couldn't load the overview/)).not.toBeInTheDocument();
  });

  it("the grid takes the full width: no max-width cap", async () => {
    renderOverview(fullOverview);
    const grid = await screen.findByTestId("overview-grid");
    expect(grid.className).not.toMatch(/max-w-/);
    expect(grid.className).not.toMatch(/mx-auto/);
  });
});
```

Import `cloudOnlyOverview`, `imagesOnlyOverview` and `exampleSite` from `@/test/findingFixtures`. Existing tests that assert on the old four `StatTile` KPI labels need updating to the header's labels ("Open findings", "Images"). Update them and keep what they check: the value, the link and the danger tone. The route that a test for `renderWithProviders` needs for the project name: `HeaderStrip` takes `name`. Get it from the existing project hook the TopBar uses (`grep -rn "useProject(" frontend/src/app`), or from the project read `baseRoutes` already fakes.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -C frontend exec vitest run src/overview/OverviewScreen.test.tsx`
Expected: the new tests FAIL, because there are no `data-pane` attributes yet.

- [ ] **Step 3: Implement.** Create `frontend/src/overview/useOverviewSite.ts`:

```ts
import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchOverviewSite, type OverviewSite } from "@/api/overview";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";

/** Read after `/overview` has landed (`ready`), never gating it; a failure just drops the location pane. */
export function useOverviewSite(projectId: string, ready: boolean): { site: OverviewSite | null; settled: boolean } {
  const api = useApi();
  const dataRev = useChangesStore((s) => s.dataRevision);
  const [state, setState] = useState<{ key: string; site: OverviewSite | null } | null>(null);
  const key = `${projectId}|${dataRev}`;
  useEffect(() => {
    if (!ready) return;
    let live = true;
    fetchOverviewSite(api, projectId)
      .then((site) => live && setState({ key, site }))
      .catch((e: unknown) => {
        pushLog(`site location unavailable: ${messageOf(e, String(e))}`);
        if (live) setState({ key, site: null });
      });
    return () => {
      live = false;
    };
  }, [api, projectId, ready, key]);
  return { site: state?.site ?? null, settled: state !== null };
}
```

Add the grid rules to `frontend/src/overview/overview.css`:

```css
/* Spec 2026-09-30-project-landing §5.2: one column below lg; a 12-column, full-height grid above,
   with rows from composeOverview (--ov-rows) and each pane placed by --col / --row. */
.ov-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.875rem;
}
.ov-grid > [data-pane="hero"] {
  min-height: 360px;
}
@media (min-width: 1024px) {
  .ov-grid {
    flex: 1 1 auto;
    min-height: 0;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    grid-template-rows: var(--ov-rows);
  }
  .ov-grid > [data-pane] {
    grid-column: var(--col);
    grid-row: var(--row);
    min-height: 0;
  }
  .ov-grid > [data-pane="hero"] {
    min-height: 340px;
  }
}
```

The `minmax(170px,…)` floors in `ROWS_FULL` plus the hero's 340 px floor are what make a short window scroll: `main` is already `overflow-auto`. The grid must not get `h-full` with `overflow-hidden`.

Make `MapHero`'s frame fill its cell. Change line 200 to `const frame = cx("relative h-full min-h-0 overflow-hidden", className);`, add `className?: string` to its props, and give its `EmptyState` branches the same frame. They stay reachable when the map exists but the pins fail. In `RecentFindings`, replace `col-span-12 … lg:col-span-8` with `h-full min-h-0 overflow-hidden` and accept `className`.

Rewrite the render part of `OverviewScreen` (from `const s = overview.findings;` down) as follows, and the skeleton to use the same grid:

```tsx
  const s = overview.findings;
  const total = s.by_status.open + s.by_status.reviewed + s.by_status.closed;
  const d = overview.data;
  const dataTotal = Object.values(d).reduce((a, b) => a + b, 0);
  const hero = overview.hero;
  const facts: OverviewFacts = {
    heroKind: hero?.kind ?? null,
    dataTotal,
    hasCloud: d.point_clouds > 0,
    hasImages: d.images > 0,
    hasSite: Boolean(site && (site.center || site.photo_points.length > 0)),
    findingsTotal: total,
    runningJobs,
  };
  const { panes, rows } = composeOverview(facts);
  const figures = headerFigures(buildKpis(overview, scale, projectId, today)).map((f) =>
    f.id === "data" ? { ...f, label: "Images" } : f,
  );

  const render = (id: PaneId) => {
    switch (id) {
      case "firstData":
        return <FirstData projectId={projectId} />;
      case "header":
        return <HeaderStrip projectId={projectId} name={projectName} figures={figures} site={siteSettled ? site : null} />;
      case "hero":
        if (hero?.kind === "map") return <MapHero projectId={projectId} heroMapId={hero.id} hasData />;
        if (hero?.kind === "point_cloud") return <CloudPreview projectId={projectId} cloudId={hero.id} variant="hero" className="h-full" />;
        if (hero?.kind === "images")
          return images ? <ImageMosaic projectId={projectId} images={images} className="h-full" /> : <Skeleton className="h-full rounded-panel" />;
        return <SummaryHero projectId={projectId} hero={hero} data={d} className="h-full" />;
      case "cloud":
        return <CloudPreview projectId={projectId} cloudId={null} variant="tile" className="h-full" />;
      case "location":
        return site && <SiteLocation site={site} pins={recent} className="h-full" />;
      case "findings":
        return total > 0 ? (
          <RecentFindings projectId={projectId} findings={recent} failed={recentFailed} total={total} types={types} labels={labels} className="h-full" />
        ) : (
          <NoFindingsYet projectId={projectId} />
        );
      case "imagery":
        return images ? <ImageryPane projectId={projectId} images={images} total={d.images} className="h-full" /> : <Skeleton className="h-full rounded-panel" />;
      case "status":
        return (
          <StatusPane
            projectId={projectId}
            rows={severityRows(s, scale, projectId)}
            activity={activity}
            activityFailed={activityFailed}
            showBars={total > 0}
            className="h-full"
          />
        );
    }
  };

  return (
    <section
      aria-label="Overview"
      data-testid="overview-grid"
      className="ov-grid w-full"
      style={{ "--ov-rows": rows } as CSSProperties}
    >
      <h1 className="sr-only">Overview</h1>
      {refreshError && (/* unchanged Alert, now with style={{ gridColumn: "1 / -1" }} */)}
      <Banners projectId={projectId} banners={overview.banners} />
      {panes.map((p) => (
        <div key={p.id} data-pane={p.id} style={{ "--col": p.col, "--row": p.row } as CSSProperties}>
          {render(p.id)}
        </div>
      ))}
    </section>
  );
```

The pieces it needs, at the top of the component:

```tsx
  const { site, settled: siteSettled } = useOverviewSite(projectId, Boolean(overview));
  const needImages = Boolean(overview && overview.data.images > 0);
  const { images } = useLatestImages(projectId, needImages);
  const runningJobs = useJobsStore((st) => Object.values(st.jobs).some((j) => j.project_id === projectId && j.state === "running"));
  const projectName = useProjectName(projectId);
```

Check these hooks before relying on them:
- The jobs store's real shape (`frontend/src/store/jobs.ts`) and what `RunningJobs.tsx` uses to decide "running". Reuse its selector rather than writing a new one.
- `useProjectName`: use whatever the TopBar reads the name from.

Both hooks must be called before the early returns, to keep the rules of hooks.

When `hasSite` is false because the site read is still in flight, the location pane appears once the read lands and the hero narrows from 12 to 8 columns. To avoid that jump, treat "not settled yet" as `hasSite: facts.hasCloud || d.maps > 0 || d.images > 0`, the optimistic value, and render a `Skeleton` in the location pane until `siteSettled`. Adjust the `location` case accordingly:

```tsx
      case "location":
        if (!siteSettled) return <Skeleton className="h-full rounded-panel" />;
        return site && <SiteLocation site={site} pins={recent} className="h-full" />;
```

and

```tsx
    hasSite: siteSettled ? Boolean(site && (site.center || site.photo_points.length > 0)) : d.maps + d.point_clouds + d.images > 0,
```

`NoFindingsYet` is a small local component in `OverviewScreen.tsx`:

```tsx
function NoFindingsYet({ projectId }: { projectId: string }) {
  return (
    <GlassPanel variant="pane" className="flex h-full items-center justify-between gap-3 px-4 py-3">
      <p className="text-sm text-muted">No findings yet.</p>
      <Link to={`/p/${projectId}/runs`} className={buttonClass("secondary", "sm")}>
        Run detection
      </Link>
    </GlassPanel>
  );
}
```

Check that `/p/:id/runs` is where detection starts (`projectRoutes.tsx:87`, `RunsScreen`). If detection is started from Images instead, link there.

Delete `KpiRow.tsx` if nothing else imports it (`grep -rn "KpiRow" frontend/src`). Delete the `GRID` constant.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/overview; pnpm -C frontend lint; pnpm -C frontend build`
Expected: all PASS, and the build typechecks.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/overview/OverviewScreen.tsx frontend/src/overview/OverviewScreen.test.tsx frontend/src/overview/overview.css frontend/src/overview/MapHero.tsx frontend/src/overview/RecentFindings.tsx frontend/src/overview/useOverviewSite.ts
git commit -m "feat(overview): full-height grid composed from the project's data"
```

(Add `frontend/src/overview/KpiRow.tsx` to the `git add` line if it was deleted, so the deletion is staged.)

---

### Task 9: e2e and the manual pass

**Files:**
- Create: `frontend/e2e/overview-landing.spec.ts`.
- Modify: `frontend/e2e/project-screens.spec.ts`, only if its Overview assertions reference removed labels.

**Interfaces:**
- Consumes: the DOM contract from Task 8 (`data-testid="overview-grid"` and `data-pane`), the Prism mock's `ProjectOverview` example (which has `hero: map`) and the `OverviewSite` example.

- [ ] **Step 1: Write the e2e test.** Create `frontend/e2e/overview-landing.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { entrancesDone, evidencePath } from "./evidence";
import { jsonReply } from "./mock";

const P = "7f1c2e3a-1111-4000-8000-000000000001";

for (const size of [
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
]) {
  test(`the Overview fills the content area at ${size.width}×${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto(`/p/${P}/overview`);
    const grid = page.getByTestId("overview-grid");
    await expect(grid.locator('[data-pane="hero"]')).toBeVisible();
    await entrancesDone(page);
    const gridBox = (await grid.boundingBox())!;
    const mainBox = (await page.locator("main").boundingBox())!;
    // full width (no 1400px cap) and down to main's bottom padding
    expect(gridBox.width).toBeGreaterThan(mainBox.width - 64);
    expect(mainBox.y + mainBox.height - (gridBox.y + gridBox.height)).toBeLessThanOrEqual(24);
    await page.screenshot({ path: evidencePath("overview-landing", `overview-${size.width}.png`) });
  });
}

test("a short laptop window scrolls instead of crushing the panes", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/p/${P}/overview`);
  const hero = page.getByTestId("overview-grid").locator('[data-pane="hero"]');
  await expect(hero).toBeVisible();
  expect((await hero.boundingBox())!.height).toBeGreaterThanOrEqual(340);
  const scrolls = await page.locator("main").evaluate((m) => m.scrollHeight > m.clientHeight);
  expect(scrolls).toBe(true);
});

test("an empty project shows the first-data screen and no grid panes", async ({ page }) => {
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/overview`,
    (route) =>
      route.fulfill(
        jsonReply({
          findings: { by_status: { open: 0, reviewed: 0, closed: 0 }, open_by_severity: {}, open_no_severity: 0, by_type: [], trend: [] },
          data: { image_sets: 0, images: 0, maps: 0, elevations: 0, point_clouds: 0, drawings: 0 },
          latest_volume: null,
          hero_map_id: null,
          hero: null,
          banners: [],
        }),
      ),
  );
  await page.goto(`/p/${P}/overview`);
  await expect(page.getByRole("heading", { name: "Add the first survey" })).toBeVisible();
  await expect(page.locator("[data-pane]")).toHaveCount(1);
  await entrancesDone(page);
  await page.screenshot({ path: evidencePath("overview-landing", "first-data.png") });
});
```

- [ ] **Step 2: Run e2e**

Run: `pnpm -C frontend e2e -- overview-landing project-screens`. If port 1420 or 4010 is in use by another session, use `scripts\finish-task.ps1`'s free-port path. Memory notes that it fails on PowerShell 5.1, so in that case set the ports by hand as it does.
Expected: PASS. If the 1366×768 test finds that `main` doesn't scroll, the header and banners are shorter than assumed. Then assert the hero is ≥ 340 px only, and drop the scroll assertion only if the whole grid fits. Both outcomes satisfy the Review Focus line.

- [ ] **Step 3: Run the full gate** (AGENTS.md)

```
pnpm -C contract check
cd backend; $PY -m ruff check .; $PY -m ruff format --check .; $PY -m pytest
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
```

Expected: all green. `cargo test` is skipped unless the frozen sidecar exists.

- [ ] **Step 4: Manual pass** in `pnpm -C frontend dev` against a real backend, with these three projects:
  1. A project with an ortho map and a point cloud. Check the map hero, the live cloud tile (drag orbits it, and it never spins on its own) and the location from the ortho.
  2. A project with photos only. Check the mosaic hero and the flight pattern of GPS points.
  3. A new empty project. Check the first-data screen. Import photos and confirm the grid appears when the job completes.

Check each at a 1366×768 window and at full screen on a 24" monitor. Toggle reduced effects in Settings and confirm the cloud pane turns into the static card.

- [ ] **Step 5: Commit**

```bash
git add frontend/e2e/overview-landing.spec.ts
git commit -m "test(overview): e2e for the full-height grid, short windows and the empty project"
```

(Add `frontend/e2e/project-screens.spec.ts` if it was changed.)
