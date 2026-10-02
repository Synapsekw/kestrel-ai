# Project landing (Overview v2): a viewport-filling, data-driven layout

Status: draft for review · 2026-09-30 · supersedes the layout (not the data) of
`2026-09-26-foundation-design.md` §9.1

## 1. Goal

When a project opens, the Overview is a well-composed page that **fills the whole content area at
any window size**. It leads with the richest view of the site the project has: the ortho map, else
the point cloud, else the photos. Around that it shows where the site is, a 3D preview, the latest
imagery and the recent findings. **A pane with nothing to show is never drawn.** The layout closes
the gap instead, so there are no empty containers and no zeros.

Today's page is centred and short. `OverviewScreen.tsx:19` caps the grid at
`max-w-[1400px] mx-auto`, and nothing stretches it vertically: rows are auto-height and the map is a
fixed `min-h-[360px]`. So on a large monitor about half the height is empty backdrop.

The direction chosen in brainstorming is option **A, "viewport bento"**, together with its
data-state behaviour (mockups in `.superpowers/brainstorm/…/landing-layouts.html` and
`landing-states-a.html`).

## 2. Scope

In:
- The Overview's layout: full width, filling the height, content-driven panes.
- A header strip with the project name, location, non-zero key figures and "Add data".
- A hero pane that picks ortho map → point cloud → image mosaic.
- A 3D preview tile, a location pane, a latest-imagery pane and a status pane.
- A full-screen first-data screen for an empty project.
- One new read endpoint, `GET /projects/{id}/overview/site`, and one new field,
  `ProjectOverview.hero`.

Out:
- Place names such as "Belgrade, Serbia". These need reverse geocoding: either an online service
  (network access, and project coordinates sent to a third party) or a bundled gazetteer (tens of
  MB). The header shows coordinates only. A place name is a possible follow-up.
- Meshes or 3D models other than point clouds. The app has none.
- A basemap under the location pane. The app works offline, so the pane is drawn from our own
  geometry. (Superseded by `2026-10-02-site-basemap-design.md`.)
- Changes to the Projects list cards (§9.2).

## 3. Decisions

| # | Decision | Why |
| --- | --- | --- |
| D1 | The layout is computed by a pure function `composeOverview(facts) → Pane[]` from a handful of facts. It is not free-form packing. | Predictable and unit-testable per data state. |
| D2 | The grid fills the height using `minmax(<floor>, <n>fr)` rows. Below the floors, `main` scrolls as it does today. | Uses every pixel on large screens without cramming small ones. |
| D3 | Hero priority: ready ortho map > ready point cloud > images > drawing thumbnail > data-summary card. An empty project gets the first-data screen instead of the grid. | "The imagery is the brightest thing on the screen" (PRODUCT.md). |
| D4 | `/overview` stays pre-aggregated, and its statement-counter pin in `test_overview.py` stays. Location and photo points come from a separate `/overview/site` read, bounded to 500 image rows. | The Overview's first paint never waits on the `image` table. |
| D5 | 3D panes lazy-load the existing `clouds/viewer` engine. The hero has a budget of 1 M points and the tile 300 k. They mount only while visible, never auto-orbit, and fall back to a static card when WebGL fails or effects are reduced. | DESIGN.md: no decorative loops. The Overview must never be the page that runs a laptop GPU out of memory. |
| D6 | Key figures show only when they are non-zero or meaningful. "0 critical" is not shown. | The operator asked for no empty containers. The same rule applies to numbers. |
| D7 | The Activity feed and Running jobs, which have their own panes today, fold into one **Status** pane: severity bars, then running jobs, then the last 3 activity lines. | Frees a column for the imagery. Nothing is lost, and the full activity list stays one click away. **Review this: it drops the 8-row activity pane.** |
| D8 | The location pane is inline SVG with a local equirectangular projection. It draws the site outline, photo points and open-finding pins, with a scale bar. There is no OpenLayers instance. | A second OL map next to the hero adds nothing without a basemap. SVG is cheap and themable. **Amended 2026-10-02** (`2026-10-02-site-basemap-design.md`): cached keyless basemap tiles now lie inside this SVG; still no OL instance. |

## 4. Data

### 4.1 `ProjectOverview.hero` (new, required, nullable)

```yaml
OverviewHero:
  type: object
  required: [kind, id]
  properties:
    kind: { type: string, enum: [map, point_cloud, images, drawing] }
    id:   { type: string, nullable: true }   # null for `images`: the client reads the newest frames
```

Resolution happens in `overview/service.py`. The first match wins, and each step is one indexed
query on a small table:
1. `hero_map_id(s)`.
2. The newest point cloud with `status = 'ready'`, ordered by `captured_on` (undated last), then
   `created_at`.
3. `data.images > 0`, which gives `{kind: images, id: null}`.
4. The newest drawing that has a thumbnail.
5. Otherwise `null`.

`hero_map_id` stays in the payload unchanged, because the existing clients and tests read it.

### 4.2 `GET /api/v1/projects/{projectId}/overview/site` → `OverviewSite`

```yaml
OverviewSite:
  type: object
  required: [center, bounds_wgs84, source, area_m2, photo_points, photo_points_total]
  properties:
    center:       { type: array, items: number, minItems: 2, maxItems: 2, nullable: true }  # [lon, lat]
    bounds_wgs84: { type: array, items: number, minItems: 4, maxItems: 4, nullable: true }  # [minlon, minlat, maxlon, maxlat]
    source:       { type: string, enum: [map, point_cloud, images], nullable: true }
    area_m2:      { type: number, nullable: true }   # of bounds_wgs84, geodesic; labelled "≈"
    photo_points: { type: array, maxItems: 500, items: { type: array, items: number, minItems: 2, maxItems: 2 } }
    photo_points_total: { type: integer }            # photos with GPS in the sample's population
```

Where the bounds come from, first match wins:
1. `bounds_wgs84` of the hero map.
2. `bounds_wgs84` of the newest ready point cloud.
3. The extent of the photo-point sample.

`center` is the middle of the bounds. With no geo data, `center`, `bounds_wgs84`, `source` and
`area_m2` are all null and `photo_points` is empty. That is a 200 response, not an error.

**Photo-point sample (bounded).** The population size comes from `SUM(source.image_count)`, which
is pre-aggregated. The endpoint takes up to 500 rows with evenly spaced rowid seeks
(`WHERE rowid >= ? AND lat IS NOT NULL LIMIT 1` per stride, or an equivalent single statement).
It never runs a scan that grows with the image count in memory. `photo_points_total` is an
estimate: population × the share of the sample that has GPS. The client labels it
"from ~N photos".

Errors follow the existing `project_upgrading` / not-found conventions of `/overview`.

## 5. Layout

### 5.1 Facts → panes

```ts
interface OverviewFacts {
  hero: OverviewHero | null;
  hasCloud: boolean;           // data.point_clouds > 0 and at least one ready cloud (hero.kind tells us for the hero)
  hasImages: boolean;          // data.images > 0
  hasSite: boolean;            // site.center != null || site.photo_points.length > 0
  findingsTotal: number;       // from findings.by_status
  empty: boolean;              // every data count is 0
}
type PaneId = "header" | "hero" | "cloud" | "location" | "findings" | "imagery" | "status" | "firstData";
interface Pane { id: PaneId; col: string; row: string }   // CSS grid placement
```

`composeOverview(facts)` returns the panes to render and where they go:

| Pane | Rendered when | Placement rule |
| --- | --- | --- |
| `firstData` | `empty` | The only pane. It replaces the grid. |
| `header` | not `empty` | Row 1, all 12 columns. |
| `hero` | `hero != null`, or a data-summary card when other data exists | Row 2, columns 1–8. It widens to 12 when the right column is empty. |
| `cloud` | `hasCloud && hero.kind !== "point_cloud"` | Right column. It shares the column with `location`, or fills it alone. |
| `location` | `hasSite` | Right column. Same rule as `cloud`. |
| `findings` | `findingsTotal > 0`, or `hasImages` (then a compact call to action: "No findings yet · Run detection") | Row 3. |
| `imagery` | `hasImages && hero.kind !== "images"` | Row 3. |
| `status` | `findingsTotal > 0`, or running jobs | Row 3. |

The panes that remain on row 3 split the 12 columns by fixed weights: findings 5, imagery 4,
status 3. The shares are renormalised when a pane is missing, so the row is always full. There is
one test per state from the brainstorm screen (everything / no ortho / images only / empty), plus
the edge cases: no GPS anywhere, findings but no images, a drawing only.

### 5.2 Sizing

- `OverviewScreen` drops `mx-auto max-w-[1400px]`. The grid is `flex-1 min-h-0` inside the
  existing `PageTransition` column.
- Rows are four tracks: `auto minmax(170px,.675fr) minmax(170px,.675fr) minmax(220px,1fr)`. The hero
  spans the two middle tracks, so the right column can stack two tiles or give one tile both. The
  hero keeps a 340 px floor. When the bottom row is empty, `composeOverview` returns a template
  without it, so there is never an empty track. When the window is shorter than the floors, `main`
  (already `overflow-auto`) scrolls.
- Below `lg` (1024 px), the grid becomes a single column with fixed heights: hero 360 px, the rest
  auto. This is today's behaviour.
- The skeleton uses the same row template, so loading doesn't jump.

### 5.3 Panes

- **Header.**
  - Name, then coordinates in JetBrains Mono (`44.8125° N 20.4612° E`), then the source
    ("from ortho" / "from point cloud" / "from ~1,280 photos"). "No location data" in dim text
    when there is none.
  - Then the figures: the existing `buildKpis` values, each shown only when it is non-zero. These
    are open findings, the top severity, images, and the latest volume or the reviewed count. A
    last-survey date is not in the pre-aggregated payload, so it isn't shown.
  - `AddDataButton` on the right. This replaces `KpiRow`.
- **Hero: map.** Today's `MapHero`, stretched to `h-full`, with its pins and its "Open in Maps"
  link. Its current empty state moves to `firstData`.
- **Hero / tile: point cloud.**
  - A new `CloudPreview` lazy-loads the viewer engine with the budget from D5, fits the camera to
    the bounds and orbits on drag. A glass chip shows the name and point count, with an "Open in
    Point clouds" link.
  - Under reduced effects, or when WebGL fails, it shows a static card: the point count, the date
    and a link.
  - An `IntersectionObserver` unmounts it when it scrolls off-screen.
- **Hero: images.** A new `ImageMosaic` shows one large frame and four small ones: the newest five
  from `/images?limit=5` sorted by capture time descending, thumbnails only. Clicking opens the
  image in the Images workspace.
- **Hero: drawing / summary.**
  - A drawing shows its thumbnail.
  - The summary card lists the data kinds present, each linking to its tab.
- **Location.** A new `SiteLocation` renders the SVG from D8. Its pins are the recent findings that
  have `lon`/`lat` (≤ 5); the hero map keeps its own full pin read. `/overview/site` is fetched after
  `/overview`, with its own skeleton. If that fetch fails, the pane is dropped quietly and a
  diagnostics log line is written. The Overview never shows an error because of it.
- **Findings.** Today's `RecentFindings` with up to 5 rows, fitted to the pane's height. When the
  pane is shorter than 5 rows, the list scrolls inside the pane, so every row stays reachable.
- **Imagery.** A mosaic of the newest thumbnails, 8 in a 4×2 grid, with a "View all" link. It
  uses the same fetch as `ImageMosaic`, with `limit=8`.
- **Status.** `SeverityBars`, then `RunningJobs` (in compact form, shown only when a job is
  running), then the last 3 `ActivityFeed` items with an "All activity" link.
- **First data.**
  - The drop zone and `AddDataButton` on the left.
  - On the right, "what each kind of data unlocks": photos → location, detection and findings;
    orthomosaic → site map; point cloud → 3D and volumes; findings → reports.
  - When the first import job completes (the existing `useChangesStore` events), the Overview
    reloads and switches to the grid.

## 6. Budget

- **Background jobs:** none. Everything here is a read. Imports keep their jobs, and the Overview
  only listens for their change events.
- **Bounded reads:**
  - `/overview`: unchanged, and statement-pinned.
  - `/overview/site`: at most 500 image rows by rowid seek, plus two single-row reads.
  - Image mosaic: ≤ 8 thumbnails.
  - Recent findings: ≤ 5.
  - Point clouds: 1 M points for the hero and 300 k for the tile, via the engine's `pointBudget`,
    and at most one 3D pane on screen.
  - The location SVG draws ≤ 500 points and ≤ 5 pins.
- **Startup:** if `/overview/site` or the cloud preview fails, that pane degrades. It never blocks
  or crashes the Overview.

## 7. Testing

- **Backend** (`tests/test_overview.py`, `tests/test_overview_site.py`):
  - hero resolution in each branch;
  - site-bounds priority;
  - the sample stays ≤ 500 on a 5,000-image fixture, with a statement count that doesn't grow
    with the image count;
  - no-GPS returns nulls;
  - the `/overview` statement pin still holds.
- **Contract:** `pnpm -C contract check`; `schema.d.ts` is regenerated in the same commit.
- **Frontend unit** (vitest):
  - `composeOverview` for every row of the §5.1 table;
  - the header skips zero figures;
  - `SiteLocation` projection and scale bar;
  - `CloudPreview` falls back under reduced effects and on a WebGL error (mocked);
  - `OverviewScreen` renders the right panes for mocked payloads of the four states.
- **e2e** (Playwright on the Prism mock):
  - the grid's bottom edge reaches within 24 px of `main`'s bottom at 1920×1080 and 2560×1440;
  - the empty project shows `firstData` and no grid.
- **Manual:** a real project with an ortho and a point cloud, and one with photos only, in the
  built app, at a laptop size and on a 24" monitor.

## 8. Execution DAG

Units:
- **U1 Contract:** the `OverviewHero` and `OverviewSite` schemas, the new path, regenerating
  `schema.d.ts` and the Prism examples for the four states.
- **U2 Backend:**
  - hero resolution;
  - the `/overview/site` service, router and tests.
- **U3 Layout core:**
  - `composeOverview` and its tests;
  - the viewport grid, header and skeleton in `OverviewScreen`;
  - `KpiRow` → header figures.
- **U4a `SiteLocation`**, the SVG and its tests.
- **U4b `CloudPreview`**, covering the engine wrapper, budget, visibility and fallback.
- **U4c `ImageMosaic`, the imagery pane and the drawing / summary hero.**
- **U4d The Status pane and the `firstData` screen.**
- **U5 Integration:** wiring the panes into `composeOverview`'s output, the e2e tests and the
  manual pass.

Batches:
1. **U1**, which is on its own because everything else types against it.
2. **U2 ∥ U3 ∥ U4a ∥ U4b ∥ U4c ∥ U4d.** The frontend units build against the Prism mock and the
   generated types. The U4 units are separate files with separate tests.
3. **U5.**

Critical path: U1 → U3 → U5. U4b (the WebGL engine wrapper) is the riskiest parallel unit; if it
slips, U5 can ship with the static-card fallback and add the live preview after.
