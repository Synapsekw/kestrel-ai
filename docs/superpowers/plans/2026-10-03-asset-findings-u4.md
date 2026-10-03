# Asset findings U4: register columns, asset source, gallery, outcome chips

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Findings register knows about asset findings:
- an **Asset** source chip;
- asset filters (asset model, zone, side, placement) in the URL;
- height, side, zone, component and sightings columns;
- a virtualised **Gallery** mode of finding thumbnails;
- **photo outcome chips** (Uncertain photos, No finding, All photos) that open the image browser filtered by photo review status.

**Architecture:**
- `frontend/src/findings/filters.ts` stays the one value object behind the URL and the `listFindings` query. It gains `assetModelId`, `zone`, `side`, `placed` and `view`. `view` is written to the URL but never sent to the API.
- The asset model list is one bounded read: `useAssetModelList` (M1), at most tens of rows. It feeds the asset filter row, the zone labels and the decision to show the outcome chips.
- The Gallery is a new component on the existing `useVirtualRows` and `computeWindow` primitives. It renders only the visible rows of tiles and pages through the same `useFindingsList` keyset cursor as the table, through `onEndReached`.
- The image browser gains one filter, `reviewStatus`, sent as `review_status` on `GET /images/index`. A new entry parameter, `?review=`, sets it, so a link from the register lands on a filtered browser. The backend filter is the last code task. It needs D1's `image_review` table.

**Tech Stack:** React 18 and TypeScript, Vitest and Testing Library, Playwright on the Prism mock; FastAPI and SQLAlchemy for the one backend filter; pytest.

**Spec sections covered:** §9 "Register" (columns, `asset` source chip, Gallery, photo outcome chips); §8 `GET /findings` filters as consumed by the UI; §5.4 `image_review` statuses as a browser filter.

**Index and Global Constraints:** `docs/superpowers/plans/2026-10-03-asset-findings.md`

**Needs:**
- **C0 merged** before Task 1. It supplies the `Finding` asset fields, `FindingAnchorKind` `asset`, the `listFindings` filters `asset_model_id`, `zone`, `side`, `placed`, the sorts `-height` and `zone`, and `AssetModel.review`.
- **D1 merged** before Task 8 (the backend `review_status` filter reads `ImageReview` and uses `set_status`). Tasks 1 to 7 do not need D1. If D1 has not merged when you reach Task 8, finish Task 9 first, then rebase onto `main` once D1 has.

**Worktree:** `scripts\start-task.ps1 -Name af-u4`

**Budget (Global Constraints):**
- There is no background job in this unit.
- **Bounded reads:**
  - The register stays keyset-paged at 200 rows per page (`FINDINGS_PAGE`), in table and gallery alike.
  - The gallery renders only the visible rows plus 2 overscan rows. Its `<img>` tags are `loading="lazy"`, so a 656-finding register fetches only the thumbnails on screen.
  - The asset model list is one read of at most tens of rows.
  - `review_status` adds one `EXISTS` per image row to the index query. It is indexed by the `image_review` primary key, so there is no new scan.

**Execution DAG:**
- Task 1 (contract param) and Task 2 (filter model) are independent.
- Tasks 3, 4 and 5 need Task 2.
- Task 6 needs Tasks 3, 4 and 5.
- Task 7 (image browser) needs Task 1.
- Task 8 (backend) needs Task 1 and D1.
- Task 9 (e2e) needs Tasks 6 and 7.
- Task 10 is the gate.

Parallel batches: {1, 2}, then {3, 4, 5, 7}, then {6, 8}, then 9, then 10. **Critical path:** 2, 5, 6, 9, 10.

---

### Task 1: Contract `review_status` on the image index

**Files:**
- Modify: `contract/openapi.yaml` (a new shared parameter `imageReviewStatus`, used by `getImageIndex`)
- Regenerate: `contract/client/schema.d.ts`
- Test: `pnpm -C contract check`

**Interfaces:**
- Produces: `GET /api/v1/projects/{projectId}/images/index?review_status=<csv>`. The value is a comma-separated list of `finding`, `none`, `uncertain` and `not_assessed`. `not_assessed` also matches a photo with no `image_review` row. In TS, `ImageIndexQuery.review_status?: string`.

- [ ] **Step 1: Check whether C0 already added it**

Run: `Select-String -Path contract/openapi.yaml -Pattern "name: review_status"`
Expected: no match. If C0 already added the parameter to `getImageIndex` with this name and pattern, skip to Task 2 and note it in the ledger.

- [ ] **Step 2: Add the shared parameter**

In `contract/openapi.yaml` under `components/parameters`, directly after `imageUnlabeled` (search `    imageUnlabeled:`), add:

```yaml
    imageReviewStatus:
      name: review_status
      in: query
      description: >-
        comma-separated photo review statuses (asset findings spec §5.4); `not_assessed` also
        matches a photo with no review status yet
      schema:
        type: string
        pattern: "^(finding|none|uncertain|not_assessed)(,(finding|none|uncertain|not_assessed))*$"
```

- [ ] **Step 3: Use it on `getImageIndex`**

In the `/api/v1/projects/{projectId}/images/index` `get` parameters, after `- $ref: "#/components/parameters/imageUnlabeled"`, add:

```yaml
        - $ref: "#/components/parameters/imageReviewStatus"
```

- [ ] **Step 4: Regenerate and check**

Run: `pnpm -C contract generate; pnpm -C contract check`
Expected: the generate step rewrites `contract/client/schema.d.ts`, and `check` passes (Spectral clean, no unused component).

Run: `Select-String -Path contract/client/schema.d.ts -Pattern "review_status"`
Expected: one match inside the `getImageIndex` query.

- [ ] **Step 5: Backend contract test still passes**

The backend ignores the new query parameter until Task 8. FastAPI ignores unknown query parameters, so schemathesis still conforms.

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_contract.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add contract/openapi.yaml contract/client/schema.d.ts
git commit -m "feat(contract): review_status filter on the image index

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Findings filter model, asset source, links and shared fixtures

**Files:**
- Modify: `frontend/src/findings/filters.ts`
- Modify: `frontend/src/findings/location.ts`
- Modify: `frontend/src/findings/links.ts`
- Modify: `frontend/src/findings/format.ts`
- Create: `frontend/src/findings/assetLookups.ts`
- Create: `frontend/src/test/assetFindingFixtures.ts` (also used by U5)
- Test: `frontend/src/findings/model.test.ts` (update the existing filter expectations, add asset cases)

**Interfaces:**
- Consumes (C0):
  - `Finding.asset_model_id: string | null`, `height_m: number | null`, `bearing_deg: number | null`, `side: string | null`, `zone: string | null`, `component: string | null`, `placement: "point" | "patch" | "none" | null`, `sighting_count: number`;
  - the asset `FindingAnchor` variant `{kind: "asset", asset_model_id: string}`;
  - `FindingListQuery` gains `asset_model_id?: string`, `zone?: string[]`, `side?: string[]`, `placed?: boolean`, and `sort` gains `"-height" | "zone"`;
  - `AssetModel.frame: AssetFrame | null` and `AssetModel.review: AssetReviewConfig | null`.
- Produces (index binding):
  - `SourceKind = "image" | "map" | "cloud" | "asset"`;
  - `FindingFilters` gains `assetModelId: string | null`, `zone: string[]`, `side: string[]`, `placed: PlacedFilter`, `view: FindingView`;
  - `type PlacedFilter = "all" | "placed" | "unplaced"`;
  - `type FindingView = "table" | "gallery"`;
  - `clearedFilters(f: FindingFilters): FindingFilters`;
  - `assetZoneLabels(models: readonly AssetModel[]): ReadonlyMap<string, string>`;
  - `zoneKey(modelId: string, zoneId: string): string`;
  - `formatHeight(m: number): string`;
  - `assetFacts(f, zoneLabels): string | null`;
  - test fixtures `ASSET_MODEL_ID`, `exampleAssetModel`, `exampleAssetFinding`, `exampleAssetFinding2`, `exampleUnplacedAssetFinding`.

- [ ] **Step 1: Write the shared fixtures**

Create `frontend/src/test/assetFindingFixtures.ts`:

```ts
import type { AssetModel } from "@contract/client";
import type { Finding } from "@/api/findings";
import { exampleFinding, TYPE_CRACK, TYPE_SPALLING } from "./findingFixtures";

export const ASSET_MODEL_ID = "a0000000-9999-4000-8000-000000000001";
export const ASSET_FINDING_ID = "f0000000-9999-4000-8000-000000000401";
export const ASSET_FINDING_ID_2 = "f0000000-9999-4000-8000-000000000402";
export const ASSET_FINDING_ID_3 = "f0000000-9999-4000-8000-000000000403";

/** An 80 m stack with the `stack` profile resolved (spec §5.1, §7): three zones, eight compass sides. */
export const exampleAssetModel: AssetModel = {
  id: ASSET_MODEL_ID,
  name: "Flare stack F-1",
  asset_type: "stack",
  tag: "F-1",
  status: "ready",
  current_version: 2,
  live_run_id: null,
  captured_on: null,
  created_at: "2026-10-02T09:00:00Z",
  updated_at: "2026-10-02T09:00:00Z",
  frame: {
    origin: { lat: 29.495, lon: 47.765, ground_alt_m: 12 },
    north_offset_deg: 0,
    height_m: 80,
    datum_label: "Ground",
    datum_note: "",
    line_azimuth_deg: null,
    silhouette: [
      [0, 2.4],
      [15, 2.2],
      [74, 1.6],
      [80, 1.8],
    ],
    levels: [20, 40, 60],
    presets: [],
  },
  review: {
    profile_id: "stack",
    finding_unit: "photo",
    placement: "patch",
    patch_grid: 14,
    cluster_m: 1.6,
    zones: [
      { id: "head", label: "Head", min_m: 73.6, max_m: 80 },
      { id: "shaft", label: "Shaft", min_m: 15.2, max_m: 73.6 },
      { id: "base", label: "Base", min_m: 0, max_m: 15.2 },
    ],
    sides: { type: "compass", labels: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"], basis: "hit" },
    focus: { frustum: 4, oblique_deg: 0 },
    report: { pages: 1, min_severity: null },
  },
};

const assetBase: Finding = {
  ...exampleFinding,
  anchor: { kind: "asset", asset_model_id: ASSET_MODEL_ID },
  data_type: "asset_model",
  data_id: ASSET_MODEL_ID,
  created_by: "human",
  confidence: null,
  asset_model_id: ASSET_MODEL_ID,
  bearing_deg: 90,
  component: "Shell",
  placement: "patch",
  representative: { image_id: "10000000-5555-4000-8000-000000000001", annotation_id: "b0000000-1212-4000-8000-000000000009" },
};

export const exampleAssetFinding: Finding = {
  ...assetBase,
  id: ASSET_FINDING_ID,
  number: 401,
  type_id: TYPE_SPALLING,
  severity: 3,
  height_m: 42.5,
  side: "E",
  zone: "shaft",
  sighting_count: 3,
};

export const exampleAssetFinding2: Finding = {
  ...assetBase,
  id: ASSET_FINDING_ID_2,
  number: 402,
  type_id: TYPE_CRACK,
  severity: 1,
  height_m: 77.1,
  bearing_deg: 200,
  side: "SW",
  zone: "head",
  sighting_count: 1,
};

/** A sighting the ray never hit: no height, zone or side (Global Constraints, data rules). */
export const exampleUnplacedAssetFinding: Finding = {
  ...assetBase,
  id: ASSET_FINDING_ID_3,
  number: 403,
  severity: 2,
  height_m: null,
  bearing_deg: null,
  side: null,
  zone: null,
  component: null,
  placement: "none",
  sighting_count: 1,
};
```

- [ ] **Step 2: Write the failing tests**

In `frontend/src/findings/model.test.ts`, extend the imports:

```ts
import { exampleAssetFinding, exampleAssetModel, exampleUnplacedAssetFinding, ASSET_MODEL_ID } from "@/test/assetFindingFixtures";
import { assetZoneLabels, zoneKey } from "./assetLookups";
import { assetFacts, formatHeight } from "./format";
```

and add `clearedFilters` to the existing `./filters` import list.

Replace the body of `it("parses the URL, dropping unknown and malformed values", ...)` with:

```ts
    const f = parseFilters(
      new URLSearchParams(
        "status=open&severity=4&severity=none&severity=x&type_id=t1&anchor_kind=map&anchor_kind=disk&q=crack&sort=bogus",
      ),
    );
    expect(f).toEqual({
      status: "open",
      severity: [4, "none"],
      typeIds: ["t1"],
      source: ["map"],
      q: "crack",
      sort: "-severity",
      assetModelId: null,
      zone: [],
      side: [],
      placed: "all",
      view: "table",
    });
    expect(parseFilters(new URLSearchParams("status=weird")).status).toBeNull();
```

Add, inside `describe("filters ↔ URL ↔ query", ...)`:

```ts
  it("reads and writes the asset filters and the view", () => {
    const f = parseFilters(
      new URLSearchParams(
        `anchor_kind=asset&asset_model_id=${ASSET_MODEL_ID}&zone=shaft&zone=head&zone=shaft&side=E&placed=false&sort=-height&view=gallery`,
      ),
    );
    expect(f).toMatchObject({
      source: ["asset"],
      assetModelId: ASSET_MODEL_ID,
      zone: ["shaft", "head"],
      side: ["E"],
      placed: "unplaced",
      sort: "-height",
      view: "gallery",
    });
    expect(filtersToSearch(f).toString()).toBe(
      `anchor_kind=asset&asset_model_id=${ASSET_MODEL_ID}&zone=shaft&zone=head&side=E&placed=false&sort=-height&view=gallery`,
    );
    expect(parseFilters(new URLSearchParams("placed=true")).placed).toBe("placed");
    expect(parseFilters(new URLSearchParams("placed=maybe&view=cards")).placed).toBe("all");
    expect(parseFilters(new URLSearchParams("view=cards")).view).toBe("table");
  });

  it("sends the asset filters to the API, never the view", () => {
    expect(
      filtersToQuery({
        ...DEFAULT_FILTERS,
        source: ["asset"],
        assetModelId: ASSET_MODEL_ID,
        zone: ["shaft"],
        side: ["E", "W"],
        placed: "placed",
        sort: "zone",
        view: "gallery",
      }),
    ).toEqual({
      sort: "zone",
      anchor_kind: ["asset"],
      asset_model_id: ASSET_MODEL_ID,
      zone: ["shaft"],
      side: ["E", "W"],
      placed: true,
    });
  });

  it("counts asset filters as filtering, the view as not, and Clear keeps sort and view", () => {
    expect(isFiltered({ ...DEFAULT_FILTERS, zone: ["head"] })).toBe(true);
    expect(isFiltered({ ...DEFAULT_FILTERS, placed: "unplaced" })).toBe(true);
    expect(isFiltered({ ...DEFAULT_FILTERS, assetModelId: ASSET_MODEL_ID })).toBe(true);
    expect(isFiltered({ ...DEFAULT_FILTERS, view: "gallery" })).toBe(false);
    expect(
      clearedFilters({ ...DEFAULT_FILTERS, zone: ["head"], sort: "number", view: "gallery" }),
    ).toEqual({ ...DEFAULT_FILTERS, sort: "number", view: "gallery" });
  });
```

In `describe("finding links (F §8.7)", ...)`, add:

```ts
  it("links an asset finding to its asset model workspace", () => {
    expect(findingHref(PROJECT_ID, exampleAssetFinding)).toBe(
      `/p/${PROJECT_ID}/models/${ASSET_MODEL_ID}?finding=${exampleAssetFinding.id}`,
    );
  });
```

In `describe("finding location", ...)`, add:

```ts
  it("names an asset finding by its model, with the Asset fallback", () => {
    expect(findingLocation(exampleAssetFinding, new Map([[ASSET_MODEL_ID, "Flare stack F-1"]]))).toEqual({
      icon: "cube",
      primary: "Flare stack F-1",
      secondary: null,
    });
    expect(findingLocation(exampleAssetFinding, new Map()).primary).toBe("Asset");
  });
```

Add a new block at the end of the file:

```ts
describe("asset facts", () => {
  const zones = assetZoneLabels([exampleAssetModel]);

  it("labels zones per model", () => {
    expect(zones.get(zoneKey(ASSET_MODEL_ID, "shaft"))).toBe("Shaft");
    expect(zones.size).toBe(3);
  });

  it("formats zone, side and height, and says Unplaced without a height", () => {
    expect(formatHeight(42.5)).toBe("42.5 m");
    expect(assetFacts(exampleAssetFinding, zones)).toBe("Shaft · E · 42.5 m");
    expect(assetFacts(exampleUnplacedAssetFinding, zones)).toBe("Unplaced");
    expect(assetFacts({ ...exampleAssetFinding, zone: "z9" }, zones)).toBe("z9 · E · 42.5 m");
    expect(assetFacts(exampleFinding, zones)).toBeNull();
  });
});
```

- [ ] **Step 3: Run them and see them fail**

Run: `pnpm -C frontend exec vitest run src/findings/model.test.ts`
Expected: FAIL. The new imports (`assetLookups`, `formatHeight`, `assetFacts`, `clearedFilters`) do not exist, and the parse result lacks the new keys.

- [ ] **Step 4: Implement `filters.ts`**

Replace `frontend/src/findings/filters.ts` with:

```ts
import type { FindingListQuery, FindingStatus } from "@/api/findings";
import { STATUSES } from "./status";

export type SourceKind = "image" | "map" | "cloud" | "asset";
export type SeverityFilter = number | "none";
export const FINDING_SORTS = ["-severity", "number", "-updated_at", "type", "-height", "zone"] as const;
export type FindingSort = (typeof FINDING_SORTS)[number];
/** `placed=true|false` in the URL and the API; "all" sends nothing. */
export type PlacedFilter = "all" | "placed" | "unplaced";
/** Written to the URL so a link keeps it; never sent to the API. */
export type FindingView = "table" | "gallery";

export interface FindingFilters {
  status: FindingStatus | null;
  severity: SeverityFilter[];
  typeIds: string[];
  source: SourceKind[];
  q: string;
  sort: FindingSort;
  assetModelId: string | null;
  zone: string[];
  side: string[];
  placed: PlacedFilter;
  view: FindingView;
}

export const DEFAULT_FILTERS: FindingFilters = {
  status: null,
  severity: [],
  typeIds: [],
  source: [],
  q: "",
  sort: "-severity",
  assetModelId: null,
  zone: [],
  side: [],
  placed: "all",
  view: "table",
};

const SOURCES: readonly SourceKind[] = ["image", "map", "cloud", "asset"];
const MAX_Q = 200;
/** Zone ids, side labels and model ids are short; a longer value is a malformed link. */
const MAX_KEY = 120;

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];
const keys = (xs: string[]): string[] => unique(xs.filter((v) => v && v.length <= MAX_KEY));

function parseSeverity(v: string): SeverityFilter[] {
  if (v === "none") return ["none"];
  return /^[1-9]\d?$/.test(v) ? [Number(v)] : [];
}

function parsePlaced(v: string | null): PlacedFilter {
  if (v === "true") return "placed";
  if (v === "false") return "unplaced";
  return "all";
}

/** The URL uses the API's own parameter names, so a pre-filtered link is also the query. */
export function parseFilters(search: URLSearchParams): FindingFilters {
  const status = search.get("status");
  const sort = search.get("sort");
  const model = search.get("asset_model_id");
  return {
    status: STATUSES.includes(status as FindingStatus) ? (status as FindingStatus) : null,
    severity: unique(search.getAll("severity").flatMap(parseSeverity)),
    typeIds: unique(search.getAll("type_id").filter(Boolean)),
    source: unique(
      search.getAll("anchor_kind").filter((s): s is SourceKind => SOURCES.includes(s as SourceKind)),
    ),
    q: (search.get("q") ?? "").slice(0, MAX_Q),
    sort: FINDING_SORTS.includes(sort as FindingSort) ? (sort as FindingSort) : "-severity",
    assetModelId: model && model.length <= MAX_KEY ? model : null,
    zone: keys(search.getAll("zone")),
    side: keys(search.getAll("side")),
    placed: parsePlaced(search.get("placed")),
    view: search.get("view") === "gallery" ? "gallery" : "table",
  };
}

export function filtersToSearch(f: FindingFilters): URLSearchParams {
  const s = new URLSearchParams();
  if (f.status) s.set("status", f.status);
  for (const v of f.severity) s.append("severity", String(v));
  for (const v of f.typeIds) s.append("type_id", v);
  for (const v of f.source) s.append("anchor_kind", v);
  if (f.assetModelId) s.set("asset_model_id", f.assetModelId);
  for (const v of f.zone) s.append("zone", v);
  for (const v of f.side) s.append("side", v);
  if (f.placed !== "all") s.set("placed", f.placed === "placed" ? "true" : "false");
  if (f.q.trim()) s.set("q", f.q.trim());
  if (f.sort !== DEFAULT_FILTERS.sort) s.set("sort", f.sort);
  if (f.view !== DEFAULT_FILTERS.view) s.set("view", f.view);
  return s;
}

/** F3: the contract's `listFindings` query `severity` is `string[]`; never cast around it. */
export function filtersToQuery(f: FindingFilters): FindingListQuery {
  const q: FindingListQuery = { sort: f.sort };
  if (f.status) q.status = [f.status];
  if (f.severity.length) q.severity = f.severity.map(String);
  if (f.typeIds.length) q.type_id = f.typeIds;
  if (f.source.length) q.anchor_kind = f.source;
  if (f.assetModelId) q.asset_model_id = f.assetModelId;
  if (f.zone.length) q.zone = f.zone;
  if (f.side.length) q.side = f.side;
  if (f.placed !== "all") q.placed = f.placed === "placed";
  if (f.q.trim()) q.q = f.q.trim();
  return q;
}

/** True when the list is narrowed (sort and view do not narrow). */
export function isFiltered(f: FindingFilters): boolean {
  return Boolean(
    f.status ||
      f.severity.length ||
      f.typeIds.length ||
      f.source.length ||
      f.q.trim() ||
      f.assetModelId ||
      f.zone.length ||
      f.side.length ||
      f.placed !== "all",
  );
}

/** "Clear filters": every filter back to its default, the sort and the view kept. */
export function clearedFilters(f: FindingFilters): FindingFilters {
  return { ...DEFAULT_FILTERS, sort: f.sort, view: f.view };
}

/** A link into the Findings tab with these filters (the Overview's "View all" and severity bars). */
export function findingsListPath(projectId: string, partial: Partial<FindingFilters>): string {
  const search = filtersToSearch({ ...DEFAULT_FILTERS, ...partial }).toString();
  return `/p/${projectId}/findings${search ? `?${search}` : ""}`;
}
```

- [ ] **Step 5: Implement `assetLookups.ts`, `format.ts`, `location.ts` and `links.ts`**

Create `frontend/src/findings/assetLookups.ts`:

```ts
import type { AssetModel } from "@contract/client";

/** Zone ids are unique per model only; the key carries both. */
export function zoneKey(modelId: string, zoneId: string): string {
  return `${modelId}|${zoneId}`;
}

/** Every model's zone labels (from its resolved review profile), keyed by `zoneKey`. */
export function assetZoneLabels(models: readonly AssetModel[]): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const m of models) for (const z of m.review?.zones ?? []) out.set(zoneKey(m.id, z.id), z.label);
  return out;
}
```

Append to `frontend/src/findings/format.ts`:

```ts
/** A height above the asset's ground datum, one decimal: "42.5 m". */
export function formatHeight(m: number): string {
  return `${m.toFixed(1)} m`;
}

/**
 * Zone, side and height of an asset finding ("Shaft · E · 42.5 m"), or "Unplaced" when no ray hit
 * (no height, zone or side: Global Constraints). Null for a finding that is not on an asset.
 */
export function assetFacts(
  f: Pick<Finding, "asset_model_id" | "zone" | "side" | "height_m">,
  zoneLabels: ReadonlyMap<string, string>,
): string | null {
  if (!f.asset_model_id) return null;
  if (f.height_m === null) return "Unplaced";
  const zone = f.zone ? (zoneLabels.get(zoneKey(f.asset_model_id, f.zone)) ?? f.zone) : null;
  return [zone, f.side, formatHeight(f.height_m)].filter(Boolean).join(" · ");
}
```

and add these imports at the top of `format.ts`:

```ts
import type { Finding } from "@/api/findings";
import { zoneKey } from "./assetLookups";
```

In `frontend/src/findings/location.ts`, replace the two records:

```ts
const SOURCE_ICON: Record<SourceKind, IconName> = { image: "images", map: "map", cloud: "cloud", asset: "cube" };

export const SOURCE_LABEL: Record<SourceKind, string> = {
  image: "Images",
  map: "Map",
  cloud: "Point cloud",
  asset: "Asset",
};
```

In `frontend/src/findings/links.ts`, add a case to the `switch` in `findingHref`, after `case "cloud":`. If C0 added a stopgap `asset` case to keep the build green, replace it with this one.

```ts
    case "asset":
      return `/p/${projectId}/models/${a.asset_model_id}?finding=${fid}`;
```

- [ ] **Step 6: Run the tests**

Run: `pnpm -C frontend exec vitest run src/findings/model.test.ts`
Expected: PASS.

Run: `pnpm -C frontend exec tsc -p tsconfig.app.json --noEmit`
Expected: no errors. If `tsc` reports a `Record<SourceKind, …>` elsewhere, add the `asset` entry there. Today the only ones are `location.ts` and `FindingFilters.tsx`; the latter is Task 3's.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/findings/filters.ts frontend/src/findings/assetLookups.ts frontend/src/findings/format.ts frontend/src/findings/location.ts frontend/src/findings/links.ts frontend/src/findings/model.test.ts frontend/src/test/assetFindingFixtures.ts
git commit -m "feat(findings): asset source, asset filters and view in the URL

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Asset filter row and the Asset source chip

**Files:**
- Modify: `frontend/src/findings/FindingFilters.tsx`
- Test: `frontend/src/findings/FindingFilters.asset.test.tsx` (new)

**Interfaces:**
- Consumes: `FindingFilters`, `clearedFilters` (Task 2), `AssetModel` (C0).
- Produces: `FindingFiltersBar` gains an optional prop `assetModels?: readonly AssetModel[]` (default empty). With none, it renders exactly as today, with no Asset chip and no asset sorts. With some, it adds:
  - the **Asset** source chip;
  - the sorts **Height** and **Zone**;
  - an asset row (`role="group"`, name "Asset filters"). The row holds the **Asset model** select and, for the chosen model, **Zone** and **Side** chips. It also holds the **Placement** segmented control (All, Placed, Unplaced).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/findings/FindingFilters.asset.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_SEVERITY_SCALE } from "@/ui";
import { ASSET_MODEL_ID, exampleAssetModel } from "@/test/assetFindingFixtures";
import { exampleSummary, projectTypes } from "@/test/findingFixtures";
import { DEFAULT_FILTERS, type FindingFilters } from "./filters";
import { FindingFiltersBar } from "./FindingFilters";

function bar(filters: FindingFilters, assetModels = [exampleAssetModel]) {
  const onChange = vi.fn();
  render(
    <FindingFiltersBar
      filters={filters}
      summary={exampleSummary}
      scale={DEFAULT_SEVERITY_SCALE}
      types={projectTypes}
      assetModels={assetModels}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe("FindingFiltersBar asset filters", () => {
  it("shows no asset chip, sort or row without asset models", () => {
    bar(DEFAULT_FILTERS, []);
    expect(screen.queryByRole("button", { name: "Asset" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Asset filters" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Sort: Height" })).not.toBeInTheDocument();
  });

  it("toggles the Asset source and offers the height and zone sorts", () => {
    const onChange = bar(DEFAULT_FILTERS);
    fireEvent.click(screen.getByRole("button", { name: "Asset", pressed: false }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_FILTERS, source: ["asset"] });
    expect(screen.getByRole("option", { name: "Sort: Height" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Sort: Zone" })).toBeInTheDocument();
  });

  it("picks a model, which clears the zone and side picks", () => {
    const onChange = bar({ ...DEFAULT_FILTERS, zone: ["x"], side: ["y"] });
    fireEvent.change(screen.getByRole("combobox", { name: "Asset model" }), {
      target: { value: ASSET_MODEL_ID },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_FILTERS,
      assetModelId: ASSET_MODEL_ID,
      zone: [],
      side: [],
    });
  });

  it("offers the chosen model's zones and sides as chips", () => {
    const onChange = bar({ ...DEFAULT_FILTERS, assetModelId: ASSET_MODEL_ID, zone: ["head"] });
    const zones = screen.getByRole("group", { name: "Zone" });
    expect(within(zones).getAllByRole("button").map((b) => b.textContent)).toEqual(["Head", "Shaft", "Base"]);
    expect(within(zones).getByRole("button", { name: "Head" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(zones).getByRole("button", { name: "Shaft" }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ zone: ["head", "shaft"], assetModelId: ASSET_MODEL_ID }),
    );
    const sides = screen.getByRole("group", { name: "Side" });
    fireEvent.click(within(sides).getByRole("button", { name: "SW" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ side: ["SW"] }));
  });

  it("filters by placement", () => {
    const onChange = bar(DEFAULT_FILTERS);
    const row = screen.getByRole("group", { name: "Asset filters" });
    fireEvent.click(within(row).getByRole("radio", { name: "Unplaced" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_FILTERS, placed: "unplaced" });
  });

  it("Clear filters keeps the sort and the view", () => {
    const onChange = bar({ ...DEFAULT_FILTERS, zone: ["head"], sort: "-height", view: "gallery" });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_FILTERS, sort: "-height", view: "gallery" });
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm -C frontend exec vitest run src/findings/FindingFilters.asset.test.tsx`
Expected: FAIL. `assetModels` is not a prop, and there is no Asset chip or asset row.

- [ ] **Step 3: Implement**

In `frontend/src/findings/FindingFilters.tsx`:

1. Replace the `import type { ClassDef } from "@contract/client";` line with `import type { AssetModel, ClassDef } from "@contract/client";`.
2. Replace the `./filters` import with:

```ts
import {
  clearedFilters,
  FINDING_SORTS,
  isFiltered,
  type FindingFilters,
  type FindingSort,
  type PlacedFilter,
  type SeverityFilter,
  type SourceKind,
} from "./filters";
```

3. Replace `SORT_LABEL`, `SOURCES` and `SOURCE_BUTTON` with:

```ts
const SORT_LABEL: Record<FindingSort, string> = {
  "-severity": "Severity",
  number: "Number",
  "-updated_at": "Recently updated",
  type: "Type",
  "-height": "Height",
  zone: "Zone",
};
/** Asset sorts and the Asset chip show only in a project with asset models. */
const ASSET_SORTS: readonly FindingSort[] = ["-height", "zone"];
const BASE_SOURCES: SourceKind[] = ["image", "map", "cloud"];
const SOURCE_BUTTON: Record<SourceKind, string> = { image: "Images", map: "Maps", cloud: "Clouds", asset: "Asset" };
const PLACED_OPTIONS: { value: PlacedFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "placed", label: "Placed" },
  { value: "unplaced", label: "Unplaced" },
];
```

4. Add this component above `export function FindingFiltersBar`:

```tsx
/** Spec §9 Register: the asset model, its zones and sides (from its review profile), and placement. */
function AssetFilterRow({
  filters,
  models,
  onChange,
}: {
  filters: FindingFilters;
  models: readonly AssetModel[];
  onChange: (next: FindingFilters) => void;
}) {
  const model = models.find((m) => m.id === filters.assetModelId) ?? null;
  const zones = model?.review?.zones ?? [];
  const sides = model?.review?.sides.labels ?? [];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" role="group" aria-label="Asset filters">
      <Select
        dense
        aria-label="Asset model"
        wrapperClassName="w-52"
        value={filters.assetModelId ?? ""}
        // A zone or side id belongs to one model: a new model starts with none picked.
        onChange={(e) => onChange({ ...filters, assetModelId: e.target.value || null, zone: [], side: [] })}
      >
        <option value="">All asset models</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>
      {zones.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Zone">
          {zones.map((z) => (
            <ToggleChip
              key={z.id}
              pressed={filters.zone.includes(z.id)}
              onClick={() => onChange({ ...filters, zone: toggle(filters.zone, z.id) })}
            >
              {z.label}
            </ToggleChip>
          ))}
        </div>
      )}
      {sides.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Side">
          {sides.map((s) => (
            <ToggleChip
              key={s}
              pressed={filters.side.includes(s)}
              onClick={() => onChange({ ...filters, side: toggle(filters.side, s) })}
            >
              {s}
            </ToggleChip>
          ))}
        </div>
      )}
      <Segmented<PlacedFilter>
        label="Placement"
        size="sm"
        value={filters.placed}
        onChange={(v) => onChange({ ...filters, placed: v })}
        options={PLACED_OPTIONS}
      />
    </div>
  );
}
```

5. Above `FindingFiltersBar`, add `const NO_ASSET_MODELS: readonly AssetModel[] = [];`. In `FindingFiltersBar`, add `assetModels = NO_ASSET_MODELS` to the destructured props and `assetModels?: readonly AssetModel[];` to the props type, so callers that do not pass it yet (the screen, until Task 6) keep today's bar. After `const severities = …`, add:

```ts
  const hasAssets = assetModels.length > 0;
  const sources: SourceKind[] = hasAssets ? [...BASE_SOURCES, "asset"] : BASE_SOURCES;
  const sorts = FINDING_SORTS.filter((s) => hasAssets || !ASSET_SORTS.includes(s));
```

6. Wrap the returned JSX. The existing `<div className="flex flex-wrap items-center gap-x-3 gap-y-2" role="group" aria-label="Filter findings">…</div>` becomes the first child of `<div className="flex flex-col gap-2">`, followed by:

```tsx
      {hasAssets && <AssetFilterRow filters={filters} models={assetModels} onChange={onChange} />}
```

7. Inside the first row:
   - In the Source group, replace `SOURCES.map(` with `sources.map(`.
   - In the sort `<Select>`, replace `FINDING_SORTS.map(` with `sorts.map(`.
   - In the "Clear filters" button, replace `onChange({ ...DEFAULT_FILTERS, sort: filters.sort });` with `onChange(clearedFilters(filters));`.
   - Remove `DEFAULT_FILTERS` from the imports if nothing else uses it.

- [ ] **Step 4: Run the tests**

Run: `pnpm -C frontend exec vitest run src/findings/FindingFilters.asset.test.tsx src/findings/FindingsScreen.test.tsx`
Expected: PASS for both. The screen does not pass `assetModels` yet, so it gets the empty default and today's bar.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/findings/FindingFilters.tsx frontend/src/findings/FindingFilters.asset.test.tsx
git commit -m "feat(findings): asset filter row and Asset source chip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Asset columns

**Files:**
- Modify: `frontend/src/findings/columns.tsx`
- Test: `frontend/src/findings/columns.test.tsx` (new)

**Interfaces:**
- Produces: `ColumnContext` gains `asset: boolean` and `zoneLabels: ReadonlyMap<string, string>`. When `asset` is true, these columns follow Location:
  - `height` ("Height", end aligned): the height, or "Unplaced" for an asset finding with no height;
  - `side` ("Side");
  - `zone` ("Zone"): the profile's zone label, else the raw id;
  - `component` ("Component");
  - `sightings` ("Sightings", end aligned): the count, for asset findings only.

  For non-asset rows these cells are empty, never a dash.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/findings/columns.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { exampleAssetFinding, exampleAssetModel, exampleUnplacedAssetFinding } from "@/test/assetFindingFixtures";
import { exampleFinding, projectTypes } from "@/test/findingFixtures";
import { PROJECT_ID } from "@/test/fixtures";
import { assetZoneLabels } from "./assetLookups";
import { findingColumns, type ColumnContext } from "./columns";

const ctx = (asset: boolean): ColumnContext => ({
  projectId: PROJECT_ID,
  types: new Map(projectTypes.map((t) => [t.id, t])),
  labels: new Map(),
  nowMs: Date.parse("2026-10-03T09:00:00Z"),
  asset,
  zoneLabels: assetZoneLabels([exampleAssetModel]),
});

const cell = (c: ColumnContext, key: string, f: typeof exampleFinding) => {
  const col = findingColumns(c).find((x) => x.key === key);
  if (!col) return null;
  const { container } = render(<>{col.render(f, 0)}</>);
  return container.textContent;
};

describe("findingColumns", () => {
  it("keeps today's columns when no asset finding is in view", () => {
    expect(findingColumns(ctx(false)).map((c) => c.key)).toEqual([
      "thumb",
      "number",
      "type",
      "severity",
      "location",
      "status",
      "updated",
    ]);
  });

  it("adds height, side, zone, component and sightings after location", () => {
    expect(findingColumns(ctx(true)).map((c) => c.key)).toEqual([
      "thumb",
      "number",
      "type",
      "severity",
      "location",
      "height",
      "side",
      "zone",
      "component",
      "sightings",
      "status",
      "updated",
    ]);
  });

  it("renders an asset finding's facts", () => {
    const c = ctx(true);
    expect(cell(c, "height", exampleAssetFinding)).toBe("42.5 m");
    expect(cell(c, "side", exampleAssetFinding)).toBe("E");
    expect(cell(c, "zone", exampleAssetFinding)).toBe("Shaft");
    expect(cell(c, "component", exampleAssetFinding)).toBe("Shell");
    expect(cell(c, "sightings", exampleAssetFinding)).toBe("3");
  });

  it("says Unplaced without a height, and leaves image rows empty", () => {
    const c = ctx(true);
    expect(cell(c, "height", exampleUnplacedAssetFinding)).toBe("Unplaced");
    expect(cell(c, "zone", exampleUnplacedAssetFinding)).toBe("");
    for (const key of ["height", "side", "zone", "component", "sightings"])
      expect(cell(c, key, exampleFinding)).toBe("");
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm -C frontend exec vitest run src/findings/columns.test.tsx`
Expected: FAIL. `asset` and `zoneLabels` are unknown, and there are no asset columns.

- [ ] **Step 3: Implement**

In `frontend/src/findings/columns.tsx`:

1. Add the imports:

```ts
import { zoneKey } from "./assetLookups";
import { formatFindingNumber, formatHeight, relativeTime } from "./format";
```

   The second line replaces the existing `./format` import.

2. Extend `ColumnContext`:

```ts
export interface ColumnContext {
  projectId: string;
  types: ReadonlyMap<string, ClassDef>;
  labels: ReadonlyMap<string, string>;
  nowMs: number;
  /** Show the asset columns (an asset finding is in view, or the filters ask for asset findings). */
  asset: boolean;
  zoneLabels: ReadonlyMap<string, string>;
}
```

3. Add above `findingColumns`:

```tsx
const muted = (text: string) => <span className="text-xs text-muted">{text}</span>;

/** Spec §9 Register: height, side, zone, component, sightings. Empty for other anchors. */
function assetColumns(ctx: ColumnContext): Column<Finding>[] {
  const onAsset = (f: Finding) => f.anchor.kind === "asset";
  return [
    {
      key: "height",
      header: "Height",
      width: "88px",
      align: "end",
      render: (f) =>
        !onAsset(f) ? null : f.height_m === null ? (
          muted("Unplaced")
        ) : (
          <span className="font-mono text-xs tabular-nums text-ink">{formatHeight(f.height_m)}</span>
        ),
    },
    { key: "side", header: "Side", width: "80px", render: (f) => (f.side ? muted(f.side) : null) },
    {
      key: "zone",
      header: "Zone",
      width: "110px",
      render: (f) =>
        f.zone && f.asset_model_id
          ? muted(ctx.zoneLabels.get(zoneKey(f.asset_model_id, f.zone)) ?? f.zone)
          : null,
    },
    {
      key: "component",
      header: "Component",
      width: "minmax(100px,0.6fr)",
      render: (f) => (f.component ? <span className="truncate text-xs text-muted">{f.component}</span> : null),
    },
    {
      key: "sightings",
      header: "Sightings",
      width: "84px",
      align: "end",
      render: (f) =>
        onAsset(f) ? (
          <span className="font-mono text-xs tabular-nums text-muted">{f.sighting_count}</span>
        ) : null,
    },
  ];
}
```

4. In `findingColumns`, build the list in three parts so the asset columns sit between Location and Status. Replace `return [` … `];` with:

```tsx
  const head: Column<Finding>[] = [
    /* thumb, number, type, severity, location: the five existing column objects, unchanged */
  ];
  const tail: Column<Finding>[] = [
    /* status, updated: the two existing column objects, unchanged */
  ];
  return [...head, ...(ctx.asset ? assetColumns(ctx) : []), ...tail];
```

Move the existing objects into `head` and `tail` verbatim. The comment lines above mark where they go; do not leave the comments in.

- [ ] **Step 4: Run the tests**

Run: `pnpm -C frontend exec vitest run src/findings/columns.test.tsx src/findings/FindingsScreen.test.tsx`
Expected: PASS. Until Task 6, `tsc` reports the screen's `findingColumns` call as missing `asset` and `zoneLabels`. At runtime they are falsy, so the table is unchanged; Task 6 Step 3.4 passes them.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/findings/columns.tsx frontend/src/findings/columns.test.tsx
git commit -m "feat(findings): height, side, zone, component and sightings columns

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Gallery mode

**Files:**
- Create: `frontend/src/findings/galleryGeometry.ts`
- Create: `frontend/src/findings/FindingGallery.tsx`
- Test: `frontend/src/findings/galleryGeometry.test.ts`, `frontend/src/findings/FindingGallery.test.tsx`

**Interfaces:**
- Consumes: `findingThumbnailUrl(baseUrl, token, projectId, findingId)` (`frontend/src/api/findings.ts`); `useVirtualRows`, `computeWindow` (`@/ui`); `assetFacts`, `findingLocation`.
- Produces:
  - `galleryGeometry(width: number): GalleryGeometry {cols, tileW, thumbH, rowH}`;
  - constants `GALLERY_MIN_TILE = 176`, `GALLERY_GAP = 12`, `GALLERY_CAPTION = 52`, `GALLERY_FALLBACK_WIDTH = 960`;
  - `<FindingGallery projectId items types labels zoneLabels activeKey loading onOpen onEndReached? />`. It renders a `role="list"` named "Findings gallery". Each tile is a button named "F-0401 Spalling", with `aria-current="true"` when it is the active finding.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/findings/galleryGeometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GALLERY_CAPTION, GALLERY_GAP, galleryGeometry } from "./galleryGeometry";

describe("galleryGeometry", () => {
  it("fits as many 176 px tiles as the width holds, 4:3 thumbs plus a caption", () => {
    const g = galleryGeometry(960);
    expect(g.cols).toBe(5);
    expect(g.tileW).toBeCloseTo((960 - 4 * GALLERY_GAP) / 5);
    expect(g.thumbH).toBeCloseTo((g.tileW * 3) / 4);
    expect(g.rowH).toBeCloseTo(g.thumbH + GALLERY_CAPTION + GALLERY_GAP);
  });

  it("uses the fallback width before the first measure (jsdom, first render)", () => {
    expect(galleryGeometry(0)).toEqual(galleryGeometry(960));
  });

  it("never drops below one column", () => {
    const g = galleryGeometry(120);
    expect(g.cols).toBe(1);
    expect(g.tileW).toBe(120);
  });
});
```

Create `frontend/src/findings/FindingGallery.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import type { Finding } from "@/api/findings";
import {
  ASSET_FINDING_ID,
  exampleAssetFinding,
  exampleAssetFinding2,
  exampleAssetModel,
  exampleUnplacedAssetFinding,
} from "@/test/assetFindingFixtures";
import { exampleFinding, projectTypes } from "@/test/findingFixtures";
import { PROJECT_ID, SOURCE_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { assetZoneLabels } from "./assetLookups";
import { FindingGallery } from "./FindingGallery";

const types = new Map(projectTypes.map((t) => [t.id, t]));

function gallery(items: Finding[], extra: Partial<Parameters<typeof FindingGallery>[0]> = {}) {
  const onOpen = vi.fn();
  const onEndReached = vi.fn();
  renderWithProviders(
    <FindingGallery
      projectId={PROJECT_ID}
      items={items}
      types={types}
      labels={new Map([[SOURCE_ID, "Flight 14 Sep"]])}
      zoneLabels={assetZoneLabels([exampleAssetModel])}
      activeKey={null}
      loading={false}
      onOpen={onOpen}
      onEndReached={onEndReached}
      {...extra}
    />,
  );
  return { onOpen, onEndReached };
}

describe("FindingGallery", () => {
  it("shows one tile per finding with its thumbnail, number, severity and facts", () => {
    gallery([exampleAssetFinding, exampleUnplacedAssetFinding, exampleFinding]);
    const list = screen.getByRole("list", { name: "Findings gallery" });
    const tile = within(list).getByRole("button", { name: "F-0401 Spalling" });
    expect(within(tile).getByText("Shaft · E · 42.5 m")).toBeInTheDocument();
    expect(tile.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining(`/findings/${ASSET_FINDING_ID}/thumbnail`),
    );
    expect(tile.querySelector("img")).toHaveAttribute("loading", "lazy");
    expect(within(list).getByRole("button", { name: "F-0403 Spalling" })).toHaveTextContent("Unplaced");
    expect(within(list).getByRole("button", { name: "F-0217 Spalling" })).toHaveTextContent("Flight 14 Sep");
  });

  it("opens a finding on click and marks the active one", () => {
    const { onOpen } = gallery([exampleAssetFinding, exampleAssetFinding2], { activeKey: ASSET_FINDING_ID });
    expect(screen.getByRole("button", { name: "F-0401 Spalling" })).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: "F-0402 Crack" }));
    expect(onOpen).toHaveBeenCalledWith(exampleAssetFinding2);
  });

  it("renders only the visible rows of a long register", () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ ...exampleAssetFinding, id: `f-${i}`, number: 1000 + i }));
    gallery(many);
    // jsdom: 960 px wide (5 columns), 600 px tall: 3 visible rows plus 2 overscan, at most 25 tiles.
    expect(screen.getAllByRole("listitem").length).toBeLessThanOrEqual(25);
  });

  it("a thumbnail that fails to load shows the type colour outline", () => {
    gallery([exampleAssetFinding]);
    const img = screen.getByRole("button", { name: "F-0401 Spalling" }).querySelector("img")!;
    fireEvent.error(img);
    expect(screen.getByRole("button", { name: "F-0401 Spalling" }).querySelector("img")).toBeNull();
    expect(screen.getByTestId("gallery-thumb-fallback")).toBeInTheDocument();
  });

  it("asks for the next page when the window nears the end, once per length", () => {
    const { onEndReached } = gallery([exampleAssetFinding, exampleAssetFinding2]);
    expect(onEndReached).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm -C frontend exec vitest run src/findings/galleryGeometry.test.ts src/findings/FindingGallery.test.tsx`
Expected: FAIL (the modules do not exist).

- [ ] **Step 3: Implement**

Create `frontend/src/findings/galleryGeometry.ts`:

```ts
/** Spec §9 Register Gallery: tiles at least 176 px wide, 12 px apart, a 4:3 thumb over a 52 px caption. */
export const GALLERY_MIN_TILE = 176;
export const GALLERY_GAP = 12;
export const GALLERY_CAPTION = 52;
/** jsdom and the first render measure 0. */
export const GALLERY_FALLBACK_WIDTH = 960;

export interface GalleryGeometry {
  cols: number;
  tileW: number;
  thumbH: number;
  rowH: number;
}

export function galleryGeometry(width: number): GalleryGeometry {
  const w = width > 0 ? width : GALLERY_FALLBACK_WIDTH;
  const cols = Math.max(1, Math.floor((w + GALLERY_GAP) / (GALLERY_MIN_TILE + GALLERY_GAP)));
  const tileW = (w - GALLERY_GAP * (cols - 1)) / cols;
  const thumbH = (tileW * 3) / 4;
  return { cols, tileW, thumbH, rowH: thumbH + GALLERY_CAPTION + GALLERY_GAP };
}
```

Create `frontend/src/findings/FindingGallery.tsx`:

```tsx
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ClassDef } from "@contract/client";
import { useBackend } from "@/api/client";
import { findingThumbnailUrl, type Finding } from "@/api/findings";
import { computeWindow, cx, focusRing, SeverityPill, transition, useVirtualRows } from "@/ui";
import { assetFacts, formatFindingNumber } from "./format";
import { GALLERY_CAPTION, GALLERY_GAP, galleryGeometry } from "./galleryGeometry";
import { findingLocation } from "./location";

const OVERSCAN_ROWS = 2;
/** Rows from the end at which the next page is asked for. */
const END_ROWS = 2;
/** A finding whose type left the project still shows an outline, in the muted ink. */
const UNKNOWN_TYPE_COLOUR = "rgb(var(--muted))";

export interface FindingGalleryProps {
  projectId: string;
  /** The loaded pages only; the caller appends a page on onEndReached (as DataTable's). */
  items: readonly Finding[];
  types: ReadonlyMap<string, ClassDef>;
  labels: ReadonlyMap<string, string>;
  zoneLabels: ReadonlyMap<string, string>;
  activeKey: string | null;
  loading: boolean;
  onOpen: (f: Finding) => void;
  onEndReached?: () => void;
}

function FindingTile({
  projectId,
  finding,
  colour,
  typeName,
  subtitle,
  active,
  thumbH,
  onOpen,
}: {
  projectId: string;
  finding: Finding;
  colour: string;
  typeName: string;
  subtitle: string;
  active: boolean;
  thumbH: number;
  onOpen: (f: Finding) => void;
}) {
  const { baseUrl, token } = useBackend();
  const [failed, setFailed] = useState(false);
  const number = formatFindingNumber(finding.number);
  return (
    <div role="listitem" className="min-w-0">
      <button
        type="button"
        aria-label={`${number} ${typeName}`}
        aria-current={active || undefined}
        onClick={() => onOpen(finding)}
        style={{ "--c": colour } as CSSProperties}
        className={cx(
          "flex w-full flex-col overflow-hidden rounded-card border bg-surface text-left",
          active ? "border-accent" : "border-card-line hover:border-line-strong",
          transition,
          focusRing,
        )}
      >
        <span className="relative block w-full bg-surface-2" style={{ height: thumbH }}>
          {failed ? (
            <span
              aria-hidden
              data-testid="gallery-thumb-fallback"
              className="absolute inset-6 rounded-sm border-2 border-[color:var(--c)]"
            />
          ) : (
            <img
              src={findingThumbnailUrl(baseUrl, token, projectId, finding.id)}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setFailed(true)}
              className="h-full w-full object-cover"
            />
          )}
        </span>
        <span className="flex flex-col justify-center gap-0.5 px-2.5" style={{ height: GALLERY_CAPTION }}>
          <span className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs tabular-nums text-ink">{number}</span>
            <SeverityPill level={finding.severity} />
          </span>
          <span className="truncate text-2xs text-muted">{subtitle}</span>
        </span>
      </button>
    </div>
  );
}

/**
 * Spec §9 Register Gallery: finding thumbnails (the representative sighting's crop) in a virtualised
 * grid. Only the visible rows render; thumbnails load lazily; paging is the table's keyset cursor.
 */
export function FindingGallery({
  projectId,
  items,
  types,
  labels,
  zoneLabels,
  activeKey,
  loading,
  onOpen,
  onEndReached,
}: FindingGalleryProps) {
  // Rows are sized from the measured width; `rowHeight` here only feeds scrollToIndex, unused.
  const { containerRef, onScroll, width, height, scrollTop } = useVirtualRows({ rowHeight: 1 });
  const geo = galleryGeometry(width);
  const rowCount = Math.ceil(items.length / geo.cols);
  const win = computeWindow(scrollTop, height, geo.rowH, rowCount, OVERSCAN_ROWS);
  const askedAt = useRef(-1);
  useEffect(() => {
    if (!onEndReached || loading || rowCount === 0) return;
    if (win.end >= rowCount - END_ROWS && askedAt.current !== items.length) {
      askedAt.current = items.length;
      onEndReached();
    }
  }, [win.end, rowCount, items.length, loading, onEndReached]);

  const rows = Array.from({ length: win.end - win.start }, (_, i) => win.start + i);
  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      role="list"
      aria-label="Findings gallery"
      aria-busy={loading || undefined}
      className="h-full overflow-auto"
    >
      <div className="relative" style={{ height: win.totalHeight }}>
        {rows.map((r) => (
          <div
            key={r}
            className="absolute inset-x-0 grid"
            style={{
              top: r * geo.rowH,
              gridTemplateColumns: `repeat(${geo.cols}, minmax(0, 1fr))`,
              columnGap: GALLERY_GAP,
            }}
          >
            {items.slice(r * geo.cols, (r + 1) * geo.cols).map((f) => {
              const t = types.get(f.type_id);
              return (
                <FindingTile
                  key={f.id}
                  projectId={projectId}
                  finding={f}
                  colour={t?.colour ?? UNKNOWN_TYPE_COLOUR}
                  typeName={t?.name ?? "Unknown type"}
                  subtitle={assetFacts(f, zoneLabels) ?? findingLocation(f, labels).primary}
                  active={f.id === activeKey}
                  thumbH={geo.thumbH}
                  onOpen={onOpen}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm -C frontend exec vitest run src/findings/galleryGeometry.test.ts src/findings/FindingGallery.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/findings/galleryGeometry.ts frontend/src/findings/galleryGeometry.test.ts frontend/src/findings/FindingGallery.tsx frontend/src/findings/FindingGallery.test.tsx
git commit -m "feat(findings): virtualised gallery of finding thumbnails

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Wire the register: view switch, asset columns, outcome chips

**Files:**
- Modify: `frontend/src/findings/FindingsScreen.tsx`
- Create: `frontend/src/findings/PhotoOutcomeChips.tsx`
- Modify: `frontend/src/images/workspace/entryParams.ts` (only the path builder `imagesReviewPath`; Task 7 does the parsing)
- Test: `frontend/src/findings/FindingsScreen.asset.test.tsx` (new); `frontend/src/findings/FindingsScreen.test.tsx` must stay green

**Interfaces:**
- Consumes: `useAssetModelList(projectId)` (`frontend/src/assetmodels/useAssetModels.ts`): `{models: AssetModel[] | null, error, reload}`.
- Produces:
  - `imagesReviewPath(projectId: string, review: ReviewEntry): string` in `entryParams.ts`, where `type ReviewEntry = "all" | "finding" | "none" | "uncertain" | "not_assessed"`. It returns `/p/<id>/images?review=<value>`.
  - `<PhotoOutcomeChips projectId />`: a `nav` named "Photo outcomes" with the links **Uncertain photos**, **No finding** and **All photos**.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/findings/FindingsScreen.asset.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  ASSET_FINDING_ID_2,
  ASSET_MODEL_ID,
  exampleAssetFinding,
  exampleAssetFinding2,
  exampleAssetModel,
} from "@/test/assetFindingFixtures";
import { baseRoutes, exampleFinding } from "@/test/findingFixtures";
import { fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { FindingsScreen } from "./FindingsScreen";

function renderTab(search = "", opts: { items?: object[]; models?: object[] } = {}) {
  const routes: FakeRoute[] = [
    {
      method: "GET",
      path: /\/findings$/,
      body: { items: opts.items ?? [exampleAssetFinding, exampleAssetFinding2], next_cursor: null },
    },
    { method: "GET", path: /\/asset-models$/, body: { items: opts.models ?? [exampleAssetModel] } },
  ];
  const { api, requests } = fakeClient(baseRoutes(routes));
  renderWithProviders(
    <>
      <FindingsScreen />
      <LocationProbe />
    </>,
    { api, route: `/p/${PROJECT_ID}/findings${search}`, path: "/p/:projectId/findings/:findingId?" },
  );
  return requests;
}

const lastListQuery = (requests: { url: string }[]) =>
  new URL(requests.filter((r) => /\/findings\?/.test(r.url)).at(-1)!.url, "http://fake").searchParams;

describe("FindingsScreen with asset findings", () => {
  beforeEach(() => useChangesStore.setState({ findingsRevision: 0, dataRevision: 0 }));

  it("shows the asset columns when an asset finding is in view", async () => {
    renderTab();
    const row = (await screen.findByText("F-0401")).closest('[role="row"]') as HTMLElement;
    expect(screen.getByRole("columnheader", { name: "Height" })).toBeInTheDocument();
    expect(within(row).getByText("42.5 m")).toBeInTheDocument();
    expect(within(row).getByText("Shaft")).toBeInTheDocument();
    expect(within(row).getByText("3")).toBeInTheDocument();
  });

  it("hides the asset columns for a register with no asset finding", async () => {
    renderTab("", { items: [exampleFinding], models: [] });
    await screen.findByText("F-0217");
    expect(screen.queryByRole("columnheader", { name: "Height" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Photo outcomes" })).not.toBeInTheDocument();
  });

  it("sends the asset filters from the URL", async () => {
    const requests = renderTab(`?anchor_kind=asset&asset_model_id=${ASSET_MODEL_ID}&zone=shaft&placed=true`);
    await screen.findByText("F-0401");
    const q = lastListQuery(requests);
    expect(q.getAll("anchor_kind")).toEqual(["asset"]);
    expect(q.get("asset_model_id")).toBe(ASSET_MODEL_ID);
    expect(q.getAll("zone")).toEqual(["shaft"]);
    expect(q.get("placed")).toBe("true");
    expect(q.get("view")).toBeNull();
  });

  it("switches to the gallery, keeps it in the URL, and opens a finding from a tile", async () => {
    renderTab();
    await screen.findByText("F-0401");
    fireEvent.click(screen.getByRole("radio", { name: "Gallery" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("view=gallery"));
    expect(screen.queryByRole("grid", { name: "Findings" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "F-0402 Crack" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(`/findings/${ASSET_FINDING_ID_2}?view=gallery`),
    );
  });

  it("links the photo outcome chips to the image browser by review status", async () => {
    renderTab();
    const nav = await screen.findByRole("navigation", { name: "Photo outcomes" });
    expect(within(nav).getByRole("link", { name: "Uncertain photos" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/images?review=uncertain`,
    );
    expect(within(nav).getByRole("link", { name: "No finding" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/images?review=none`,
    );
    expect(within(nav).getByRole("link", { name: "All photos" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/images?review=all`,
    );
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm -C frontend exec vitest run src/findings/FindingsScreen.asset.test.tsx`
Expected: FAIL. There are no asset columns or gallery switch in the screen, and no outcome chips.

- [ ] **Step 3: Implement**

Append to `frontend/src/images/workspace/entryParams.ts`:

```ts
/** A photo review status, or `all` (every photo, the review filter off). */
export type ReviewEntry = "all" | "finding" | "none" | "uncertain" | "not_assessed";

/** The image browser filtered by photo review status (spec §9 Register, photo outcome chips). */
export function imagesReviewPath(projectId: string, review: ReviewEntry): string {
  return `/p/${projectId}/images?review=${review}`;
}
```

Create `frontend/src/findings/PhotoOutcomeChips.tsx`:

```tsx
import { Link } from "react-router-dom";
import { imagesReviewPath, type ReviewEntry } from "@/images/workspace/entryParams";
import { cx, focusRing, pressable, transition } from "@/ui";

const OUTCOMES: { review: ReviewEntry; label: string }[] = [
  { review: "uncertain", label: "Uncertain photos" },
  { review: "none", label: "No finding" },
  { review: "all", label: "All photos" },
];

/** Spec §9 Register: the photo outcome chips open the image browser filtered by review status. */
export function PhotoOutcomeChips({ projectId }: { projectId: string }) {
  return (
    <nav aria-label="Photo outcomes" className="flex flex-wrap items-center gap-1.5">
      {OUTCOMES.map((o) => (
        <Link
          key={o.review}
          to={imagesReviewPath(projectId, o.review)}
          className={cx(
            "inline-flex h-7 items-center rounded-chip border border-line px-2.5 text-xs text-muted hover:bg-hover hover:text-ink",
            focusRing,
            transition,
            pressable,
          )}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}
```

In `frontend/src/findings/FindingsScreen.tsx`:

1. Imports. Add:

```ts
import type { AssetModel } from "@contract/client";
import { useAssetModelList } from "@/assetmodels/useAssetModels";
import { assetZoneLabels } from "./assetLookups";
import { FindingGallery } from "./FindingGallery";
import { PhotoOutcomeChips } from "./PhotoOutcomeChips";
```

   Add `Segmented` to the `@/ui` import. Replace the `./filters` import with:

```ts
import { clearedFilters, filtersToSearch, isFiltered, parseFilters, type FindingFilters, type FindingView } from "./filters";
```

2. Above the component, add:

```ts
const NO_MODELS: readonly AssetModel[] = [];
const VIEW_OPTIONS: { value: FindingView; label: string }[] = [
  { value: "table", label: "Table" },
  { value: "gallery", label: "Gallery" },
];
```

3. In the component, after `const nowMs = useNow(60_000);`, add:

```ts
  // One bounded read (tens of rows): the asset filter row, zone labels and the outcome chips.
  const assetModels = useAssetModelList(projectId).models ?? NO_MODELS;
  const zoneLabels = useMemo(() => assetZoneLabels(assetModels), [assetModels]);
  const showAsset =
    filters.source.includes("asset") ||
    filters.assetModelId !== null ||
    list.items.some((f) => f.anchor.kind === "asset");
```

4. Replace the `columns` memo with:

```ts
  const columns = useMemo(
    () => findingColumns({ projectId, types, labels, nowMs, asset: showAsset, zoneLabels }),
    [projectId, types, labels, nowMs, showAsset, zoneLabels],
  );
```

5. Replace the `<header>…</header>` block with:

```tsx
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Findings</h1>
          <p className="text-sm text-muted">
            Every defect in this project, from photos, maps and point clouds. Grade, comment and close them
            here.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {assetModels.length > 0 && <PhotoOutcomeChips projectId={projectId} />}
          <Segmented<FindingView>
            label="View"
            size="sm"
            value={filters.view}
            onChange={(v) => onFilters({ ...filters, view: v })}
            options={VIEW_OPTIONS}
          />
        </div>
      </header>
```

6. Pass the models to the filter bar: `<FindingFiltersBar filters={filters} summary={summary} scale={scale} types={all} assetModels={assetModels} onChange={onFilters} />`.

7. In the empty state, replace `onClick={() => onFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}` with `onClick={() => onFilters(clearedFilters(filters))}`.

8. Replace the `<div className="relative h-full">…</div>` block (the DataTable and BulkBar) with:

```tsx
          <div className="relative h-full">
            {filters.view === "gallery" ? (
              <FindingGallery
                projectId={projectId}
                items={list.items}
                types={types}
                labels={labels}
                zoneLabels={zoneLabels}
                activeKey={findingId ?? null}
                loading={list.status === "loading"}
                onOpen={openFinding}
                onEndReached={list.hasMore ? list.loadMore : undefined}
              />
            ) : (
              <DataTable
                label="Findings"
                className="h-full"
                columns={columns}
                rows={list.items}
                rowKey={(f) => f.id}
                loading={list.status === "loading"}
                selected={selected}
                onSelectionChange={setSelected}
                activeKey={findingId ?? null}
                onOpen={openFinding}
                onEndReached={list.hasMore ? list.loadMore : undefined}
              />
            )}
            {filters.view === "table" && selected.size > 0 && (
              <BulkBar
                projectId={projectId}
                ids={[...selected]}
                scale={scale}
                onDone={clearSelection}
                onClear={clearSelection}
              />
            )}
          </div>
```

- [ ] **Step 4: Run the register tests**

Run: `pnpm -C frontend exec vitest run src/findings`
Expected: PASS for every file in `src/findings`. That covers `FindingsScreen.test.tsx`, `FindingsScreen.keys.test.tsx` and `echoRereads.test.tsx`; their unrouted `/asset-models` read answers 404, which leaves the models empty.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/findings/FindingsScreen.tsx frontend/src/findings/PhotoOutcomeChips.tsx frontend/src/findings/FindingsScreen.asset.test.tsx frontend/src/images/workspace/entryParams.ts
git commit -m "feat(findings): gallery view, asset columns and photo outcome chips in the register

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Image browser photo review filter and the `?review=` entry

**Files:**
- Modify: `frontend/src/images/browser/filters.ts`
- Modify: `frontend/src/images/browser/BrowserFilters.tsx`
- Modify: `frontend/src/images/workspace/entryParams.ts`
- Modify: `frontend/src/images/workspace/ImagesWorkspace.tsx`
- Test: `frontend/src/images/browser/filters.test.ts`, `frontend/src/images/browser/BrowserFilters.test.tsx`, `frontend/src/images/workspace/entryParams.test.ts`, `frontend/src/images/workspace/ImagesWorkspace.test.tsx`

**Interfaces:**
- Consumes: `ImageIndexQuery.review_status?: string` (Task 1).
- Produces:
  - `BrowserFilterState.reviewStatus: ReviewStatusFilter`, where `type ReviewStatusFilter = "all" | PhotoReviewStatus` and `type PhotoReviewStatus = "finding" | "none" | "uncertain" | "not_assessed"`; `REVIEW_LABEL: Record<ReviewStatusFilter, string>`;
  - `Entry.review: ReviewEntry | null`;
  - `ENTRY_KEYS` gains `"review"`;
  - `?review=uncertain` lands on the browser with that filter, and the key is then dropped like the other entry keys.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/images/browser/filters.test.ts`, add inside `describe("browser filters → index query", ...)`:

```ts
  it("sends the photo review status, and counts it under More", () => {
    expect(filtersToIndexQuery(f({ reviewStatus: "uncertain" }))).toEqual({
      sort: "capture_time",
      order: "asc",
      fields: "geo",
      review_status: "uncertain",
    });
    expect(moreFilterCount(f({ reviewStatus: "none" }))).toBe(1);
    expect(moreFilterCount(DEFAULT_BROWSER_FILTERS)).toBe(0);
  });
```

In `frontend/src/images/workspace/entryParams.test.ts`, update every existing `toEqual({...})` object to include `review: null`, for example `{ preset: "suggestions", batch: false, sourceId: null, review: null }`, and add:

```ts
  it("reads the photo review entry from the register's outcome chips", () => {
    expect(parseEntry(q("review=uncertain"))).toEqual({ preset: null, batch: false, sourceId: null, review: "uncertain" });
    expect(parseEntry(q("review=all"))).toEqual({ preset: null, batch: false, sourceId: null, review: "all" });
    expect(parseEntry(q("review=bogus"))).toEqual({ preset: null, batch: false, sourceId: null, review: null });
  });
```

In `frontend/src/images/browser/BrowserFilters.test.tsx`, add a test using the file's existing render helper. In the version below the helper is assumed to be `renderFilters(value, onChange)`; if the helper has another name, use it.

```tsx
  it("filters by photo review status from More", () => {
    const onChange = vi.fn();
    renderFilters(DEFAULT_BROWSER_FILTERS, onChange);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Photo review" }), { target: { value: "uncertain" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_BROWSER_FILTERS, reviewStatus: "uncertain" });
  });
```

In `frontend/src/images/workspace/ImagesWorkspace.test.tsx`, after the `?source=` test, add:

```tsx
  it("?review= (the register's outcome chips) becomes the photo review filter and is dropped", async () => {
    mount(`/p/${PROJECT_ID}/images/${IMAGE_ID}?review=uncertain`);
    await waitFor(() => expect(loc()).toBe(`/p/${PROJECT_ID}/images/${IMAGE_ID}`));
    expect(h.lastFilters).toHaveBeenLastCalledWith(expect.objectContaining({ reviewStatus: "uncertain" }));
  });
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm -C frontend exec vitest run src/images/browser/filters.test.ts src/images/browser/BrowserFilters.test.tsx src/images/workspace/entryParams.test.ts src/images/workspace/ImagesWorkspace.test.tsx`
Expected: FAIL. `reviewStatus` is unknown, `parseEntry` lacks `review`, and there is no "Photo review" select.

- [ ] **Step 3: Implement the browser filter**

In `frontend/src/images/browser/filters.ts`:

1. After `export type TriState = …`, add:

```ts
/** Spec §5.4: a photo's review status. `not_assessed` also matches a photo never reviewed. */
export type PhotoReviewStatus = "finding" | "none" | "uncertain" | "not_assessed";
export type ReviewStatusFilter = "all" | PhotoReviewStatus;

export const REVIEW_LABEL: Record<ReviewStatusFilter, string> = {
  all: "Any review status",
  finding: "Has a finding",
  none: "No finding",
  uncertain: "Uncertain",
  not_assessed: "Not assessed",
};
```

2. Add `reviewStatus: ReviewStatusFilter;` to `BrowserFilterState`, after `unlabeled`, and `reviewStatus: "all",` to `DEFAULT_BROWSER_FILTERS`.
3. In `filtersToIndexQuery`, after the `unlabeled` line, add `if (f.reviewStatus !== "all") q.review_status = f.reviewStatus;`.
4. In `moreFilterCount`, add the term `(f.reviewStatus !== "all" ? 1 : 0) +` to the sum.

In `frontend/src/images/browser/BrowserFilters.tsx`:

1. Add `REVIEW_LABEL` and `type ReviewStatusFilter` to the `./filters` import.
2. Above `export function BrowserFilters`, add `const REVIEW_OPTIONS = Object.keys(REVIEW_LABEL) as ReviewStatusFilter[];`.
3. Inside the `More` disclosure, directly after `<Switch label="Unlabeled" … />`, add:

```tsx
          <Select
            dense
            aria-label="Photo review"
            value={value.reviewStatus}
            onChange={(e) => set({ reviewStatus: e.target.value as ReviewStatusFilter })}
          >
            {REVIEW_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {REVIEW_LABEL[r]}
              </option>
            ))}
          </Select>
```

- [ ] **Step 4: Implement the entry**

In `frontend/src/images/workspace/entryParams.ts`:

1. Change `ENTRY_KEYS` to `["filter", "batch", "ids", "source", "review"] as const`.
2. Add `review: ReviewEntry | null;` to `Entry`.
3. Above `parseEntry`, add `const REVIEWS: readonly ReviewEntry[] = ["all", "finding", "none", "uncertain", "not_assessed"];`.
4. Replace the `return` of `parseEntry` with:

```ts
  const r = q.get("review");
  const review = REVIEWS.includes(r as ReviewEntry) ? (r as ReviewEntry) : null;
  return { preset, batch: q.get("batch") === "1", sourceId: q.get("source") || null, review };
```

`ReviewEntry` is declared in the same file (Task 6). Move its declaration above `ENTRY_KEYS` so it reads top-down.

In `frontend/src/images/workspace/ImagesWorkspace.tsx`, replace the entry block inside `if (entry && entryHandled !== search) { … }`:

```ts
    const { preset, sourceId } = entry;
    if (preset || sourceId)
      setFilters((f) => {
        const base = preset ? filtersFor(preset) : f;
        return sourceId ? { ...base, sourceId } : base;
      });
```

with:

```ts
    const { preset, sourceId, review } = entry;
    if (preset || sourceId || review)
      setFilters((f) => {
        // A review link starts from the default filters, so the browser shows exactly that outcome.
        const base = preset ? filtersFor(preset) : review ? DEFAULT_BROWSER_FILTERS : f;
        const sourced = sourceId ? { ...base, sourceId } : base;
        return review ? { ...sourced, reviewStatus: review } : sourced;
      });
```

`ReviewEntry` and `ReviewStatusFilter` have the same members, so the assignment type-checks.

- [ ] **Step 5: Run the tests**

Run: `pnpm -C frontend exec vitest run src/images`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/images/browser/filters.ts frontend/src/images/browser/filters.test.ts frontend/src/images/browser/BrowserFilters.tsx frontend/src/images/browser/BrowserFilters.test.tsx frontend/src/images/workspace/entryParams.ts frontend/src/images/workspace/entryParams.test.ts frontend/src/images/workspace/ImagesWorkspace.tsx frontend/src/images/workspace/ImagesWorkspace.test.tsx
git commit -m "feat(images): photo review filter and the ?review= entry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Backend `review_status` filter on the image index (needs D1)

**Files:**
- Modify: `backend/app/imagery/filters.py`
- Modify: `backend/app/imagery/routes_index.py`
- Test: `backend/tests/test_image_index.py`

**Interfaces:**
- Consumes (D1): ORM `app.db.models.ImageReview` (`image_id` PK, `status`); `app.asset_review.review_status.set_status(s, image_id, status, note="")`.
- Produces: `ImageFilters.review_status: list[str] | None`; `REVIEW_PATTERN`; `review_condition(values) -> ColumnElement[bool]`. `GET /images/index?review_status=<csv>` filters by photo review status, and `not_assessed` also matches photos with no row.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_image_index.py`:

```python
def test_review_status_filter(client, world, handle):  # noqa: F811
    """Spec §5.4: a, b, c have a review status; d and e have none, so they read as not assessed."""
    from app.asset_review.review_status import set_status

    ids = world["ids"]
    with handle.session() as s:
        set_status(s, ids["a"], "uncertain")
        set_status(s, ids["b"], "none")
        set_status(s, ids["c"], "finding")
    back = {v: k for k, v in ids.items()}

    def names(value: str) -> list[str]:
        return sorted(back[i] for i in _index(client, world["pid"], review_status=value)["ids"])

    assert names("uncertain") == ["a"]
    assert names("none,finding") == ["b", "c"]
    assert names("not_assessed") == ["d", "e"]
    assert names("uncertain,not_assessed") == ["a", "d", "e"]
    with handle.session() as s:
        set_status(s, ids["e"], "not_assessed")
    assert names("not_assessed") == ["d", "e"]


def test_review_status_rejects_unknown_values(client, world):  # noqa: F811
    r = client.get(f"{API}/projects/{world['pid']}/images/index", params={"review_status": "maybe"})
    assert r.status_code == 422
```

- [ ] **Step 2: Run it and see it fail**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_image_index.py::test_review_status_filter tests/test_image_index.py::test_review_status_rejects_unknown_values -q`
Expected: FAIL. The parameter is ignored (every image is returned), and `maybe` answers 200.

- [ ] **Step 3: Implement**

In `backend/app/imagery/filters.py`:

1. Change the models import to `from app.db.models import Box, Finding, Image, ImageReview, ImageSummary`.
2. After `STATUS_PATTERN`, add:

```python
REVIEW_STATUSES = ("finding", "none", "uncertain", "not_assessed")
REVIEW_PATTERN = r"^(finding|none|uncertain|not_assessed)(,(finding|none|uncertain|not_assessed))*$"
```

3. Add `review_status: list[str] | None = None` as the last field of `ImageFilters`.
4. Above `def where(`, add:

```python
def review_condition(values: list[str]):
    """Photo review status (asset findings spec §5.4). `not_assessed` also matches a photo with no
    `image_review` row, so "not assessed" is every photo nobody has graded yet."""
    for v in values:
        if v not in REVIEW_STATUSES:
            raise _invalid(f"review_status {v!r} is not one of {', '.join(REVIEW_STATUSES)}")
    explicit = [v for v in values if v != "not_assessed"]
    conds = []
    if explicit:
        conds.append(exists().where(ImageReview.image_id == Image.id, ImageReview.status.in_(explicit)))
    if "not_assessed" in values:
        conds.append(~exists().where(ImageReview.image_id == Image.id, ImageReview.status != "not_assessed"))
    return or_(*conds)
```

5. In `where`, before `return q`, add:

```python
    if f.review_status:
        q = q.where(review_condition(f.review_status))
```

In `backend/app/imagery/routes_index.py`:

1. Change the filters import to `from app.imagery.filters import REVIEW_PATTERN, SEVERITY_PATTERN, SORT_NAMES, STATUS_PATTERN, ImageFilters, parse_csv`.
2. Add a parameter to `get_image_index` after `unlabeled`:

```python
    review_status: str | None = Query(None, pattern=REVIEW_PATTERN, description="csv of photo review statuses"),
```

3. Pass it to `ImageFilters(...)`: `review_status=parse_csv(review_status),`.

- [ ] **Step 4: Run the tests**

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/test_image_index.py tests/test_image_filters.py tests/test_contract.py -q`
Expected: PASS.

Run (from `backend/`): `& E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check app/imagery tests/test_image_index.py; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check app/imagery tests/test_image_index.py`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add backend/app/imagery/filters.py backend/app/imagery/routes_index.py backend/tests/test_image_index.py
git commit -m "feat(images): review_status filter on the image index

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: e2e: register gallery, filters and outcome chips on Prism

**Files:**
- Create: `frontend/e2e/findings-asset.spec.ts`

**Interfaces:**
- Consumes: the Prism mock (`playwright.config.ts`); `jsonReply` (`frontend/e2e/mock.ts`); `evidencePath`, `entrancesDone` (`frontend/e2e/evidence.ts`).

- [ ] **Step 1: Write the e2e test**

Create `frontend/e2e/findings-asset.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { entrancesDone, evidencePath } from "./evidence";
import { jsonReply } from "./mock";

// The contract's Project example, which the Prism mock serves for every project id.
const P = "7f1c2e3a-1111-4000-8000-000000000001";
const MODEL = "a0000000-9999-4000-8000-000000000001";
const T = "2026-10-02T09:00:00Z";

const model = {
  id: MODEL,
  name: "Flare stack F-1",
  asset_type: "stack",
  tag: "F-1",
  status: "ready",
  current_version: 1,
  live_run_id: null,
  captured_on: null,
  created_at: T,
  updated_at: T,
  frame: null,
  review: {
    profile_id: "stack",
    finding_unit: "photo",
    placement: "patch",
    patch_grid: 14,
    cluster_m: 1.6,
    zones: [
      { id: "head", label: "Head", min_m: 73.6, max_m: 80 },
      { id: "shaft", label: "Shaft", min_m: 15.2, max_m: 73.6 },
      { id: "base", label: "Base", min_m: 0, max_m: 15.2 },
    ],
    sides: { type: "compass", labels: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"], basis: "hit" },
    focus: { frustum: 4, oblique_deg: 0 },
    report: { pages: 1, min_severity: null },
  },
};

const finding = (i: number) => ({
  id: `f0000000-9999-4000-8000-0000000004${String(i).padStart(2, "0")}`,
  number: 400 + i,
  type_id: "t1",
  severity: (i % 3) + 1,
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
  height_m: 10 + i,
  bearing_deg: 90,
  side: "E",
  zone: "shaft",
  component: "Shell",
  placement: "patch",
  sighting_count: 2,
  representative: { image_id: "i1", annotation_id: "b1" },
});

test("the register shows asset columns, filters by zone, has a gallery and photo outcome chips", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const list = Array.from({ length: 30 }, (_, i) => finding(i + 1));
  const queries: URLSearchParams[] = [];
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/findings`,
    (route) => {
      queries.push(new URL(route.request().url()).searchParams);
      return route.fulfill(jsonReply({ items: list, next_cursor: null }));
    },
  );
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/asset-models`,
    (route) =>
      route.request().method() === "GET" ? route.fulfill(jsonReply({ items: [model] })) : route.fallback(),
  );

  await page.goto(`/p/${P}/findings?anchor_kind=asset`);
  await expect(page.getByRole("columnheader", { name: "Height" })).toBeVisible();
  await expect(page.getByText("11.0 m")).toBeVisible();

  // Zone filter: the model's zones are chips once a model is chosen.
  await page.getByRole("combobox", { name: "Asset model" }).selectOption(MODEL);
  await page.getByRole("group", { name: "Zone" }).getByRole("button", { name: "Shaft" }).click();
  await expect(page).toHaveURL(/zone=shaft/);
  await expect.poll(() => queries.at(-1)?.getAll("zone")).toEqual(["shaft"]);

  // Gallery: tiles, and a click opens the inspector with the view kept.
  await page.getByRole("radio", { name: "Gallery" }).click();
  await expect(page).toHaveURL(/view=gallery/);
  const gallery = page.getByRole("list", { name: "Findings gallery" });
  await expect(gallery.getByRole("listitem").first()).toBeVisible();
  await entrancesDone(page);
  await page.screenshot({ path: evidencePath("asset-findings", "register-gallery.png") });
  await gallery.getByRole("button", { name: /^F-0401 / }).click();
  await expect(page).toHaveURL(new RegExp(`/findings/${list[0].id}\\?.*view=gallery`));

  // Photo outcome chips: the image browser reads its index with the review filter.
  const indexRead = page.waitForRequest(
    (r) => r.url().includes(`/projects/${P}/images/index`) && r.url().includes("review_status=uncertain"),
  );
  await page.getByRole("navigation", { name: "Photo outcomes" }).getByRole("link", { name: "Uncertain photos" }).click();
  await indexRead;
  await expect(page).toHaveURL(new RegExp(`/p/${P}/images`));
});
```

- [ ] **Step 2: Run it**

Run: `pnpm -C frontend exec playwright test findings-asset`
Expected: PASS. If Prism rejects `review_status` on `/images/index`, Task 1's contract change is not in the running mock: restart the e2e run so Prism reloads `openapi.yaml`.

- [ ] **Step 3: Commit**

```bash
git add frontend/e2e/findings-asset.spec.ts
git commit -m "test(e2e): asset register, gallery and photo outcome chips

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Land

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

In a worktree, the backend line runs with `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe` from the worktree's `backend/` (CONTRIBUTING "Testing"). Expected: all green. `pnpm -C frontend lint` includes `check-tokens`; the new files use tokens only, and severity and type colours go through `--c`.

- [ ] **Step 2: Check the UI copy for dashes**

Run: `Select-String -Path frontend/src/findings/*.tsx,frontend/src/images/browser/*.tsx -Pattern "[\u2013\u2014]"`
Expected: no match in any file this unit touched.

- [ ] **Step 3: Finish**

Run `scripts\finish-task.ps1`, or the manual merge fallback (memory: finish-task fails on PS 5.1): gate, merge `task/af-u4` into `main`, remove the worktree (links first, then `git worktree remove`), and delete the branch.

- [ ] **Step 4: Operator walkthrough** (for the merge note):
  1. Open a project that has an asset model with a review profile and asset findings. On Prism, open `/p/<id>/findings?anchor_kind=asset` under `pnpm -C frontend dev`.
  2. Expect the Height, Side, Zone, Component and Sightings columns. Unplaced findings say "Unplaced".
  3. Pick the asset model in "Asset model", then click a zone chip. The list narrows, and the URL carries `zone=`.
  4. Click **Gallery**. Expect thumbnail tiles; scroll, and more pages load. Click a tile to open the inspector, and press J or K to move.
  5. Click **Uncertain photos**. The Images tab opens with "Photo review: Uncertain" under More. Every listed photo has that status.

---

## Self-review

**Spec coverage (§9 Register):**
- New columns height, side, zone, component and sightings: Task 4.
- The `asset` source chip: Tasks 2 and 3.
- Gallery mode, virtualised, from the thumbnail endpoint: Tasks 5 and 6.
- Photo outcome chips opening the image browser filtered by `image_review.status`: Tasks 6, 7, 1 and 8.
- §8 `GET /findings` filters (`asset_model_id`, `zone`, `side`, `placed`) and the sorts `-height` and `zone` are consumed in Task 2.
- The `component` filter is in the contract, but the register exposes no control for it: the spec's register list does not ask for one. The column shows the value.

**Review Focus:** none of the five items is assigned to U4. Item 5's register half (paging at scale) is held by the gallery reusing `useFindingsList`'s keyset pages and rendering only the visible window. The test "renders only the visible rows of a long register" pins it.

**Placeholders:** none. Task 3 edits an existing file by numbered sub-steps with full code; Task 4 moves existing column objects verbatim.

## Index notes

1. **Backend gap: no `review_status` filter on the image list (a C0/D1 gap).** Today `GET /images/index` has no photo review filter: `backend/app/imagery/filters.py` knows only `reviewed`, which is box review. U4 adds it:
   - the contract parameter in Task 1, only when C0 has not;
   - the backend filter in Task 8, which needs D1 merged.

   If D1 or C0 adds the same filter first, U4 skips that task. The parameter name is `review_status` (csv), the same name the index plan expects.
2. **Thumbnail of an asset finding (a J4 gap).** `backend/app/findings/thumbnails.py` crops around `finding.annotation_id` and `finding.image_id`. Under the new `ANCHOR_CHECK` both are null for asset findings, so the Gallery would show only the outline fallback. J4, which owns `findings/service.py`, should make `finding_thumbnail` use the representative sighting's box (`FindingOut.representative`) for `anchor_kind = 'asset'`. U4's Gallery needs no change for that: it calls the same URL.
3. **Assumed C0 shapes** (index names kept). Wherever the generated types differ, U4 conforms `assetFindingFixtures.ts`, `filtersToQuery` and `AssetFilterRow` to them:
   - `FindingListQuery.zone` and `side` are `string[]` (repeatable, like `status`), `asset_model_id` is `string`, and `placed` is `boolean`.
   - The asset `FindingAnchor` is `{kind: "asset", asset_model_id: string}`.
   - `AssetModel.review.sides.labels` is `string[]`.
   - `AssetReviewConfig` and `AssetFrame` follow spec §5.1 field by field.
4. **`findingHref` for asset findings** points at the asset workspace, `/p/<id>/models/<modelId>?finding=<id>`, because that route exists today. U3 may repoint it to the split inspection route when that lands; the test in `model.test.ts` moves with it.
5. **Shared fixture.** `frontend/src/test/assetFindingFixtures.ts` is created here and reused by U5 (and may be by U2 and U3).
