---
type: spec
date: 2026-09-23
status: approved
tags: [spec, maps, counts, reporting]
related: ["[[2026-09-22-geotiff-maps-design]]", "[[2026-09-23-object-counts-per-group-design]]"]
---

# Survey timeline: counts over time across a site's maps

## 1. Goal

A site is flown again and again. Each survey produces an orthomosaic, which the maps feature imports
and runs a model across, giving a count per class for that one map
(`2026-09-22-geotiff-maps-design.md` §1, `MapRun.counts`). What no screen answers today is the
question a site manager actually asks:

> How has this site changed since the last survey?

This feature reads the counts that already exist and puts them on a timeline: **counts per class per
survey date, the change since the previous survey, and an honest marker whenever two surveys were
counted in ways that cannot be compared.**

It is deliberately small. It adds no detector, no geometry and no job: everything it shows is
already stored.

### Why not counting from raw frames

The predecessor design (`2026-09-23-object-counts-per-group-design.md`) counted distinct objects from
overlapping drone frames by projecting boxes onto the ground. It was superseded before
implementation: on real data the projection put the same object 10-17 m away from itself between
consecutive frames (28 m unprojected), and the best-fitting angle convention differed between
flights, which is the signature of fitting noise. An orthomosaic has already solved that problem
properly, so counts ride on maps.

### Domain neutrality

Nothing here names a domain. It counts objects of the project's own classes: machinery today, trees
or power-line fittings tomorrow. The word "survey" is the drone-neutral term for one visit.

## 2. Scope

**In:** a survey date per map; a project-level timeline screen with a chart and a table; the
comparison rule that decides which run represents each survey; deltas between consecutive surveys.

**Out (v1):** no Excel or CSV export (the maps feature already exports detections, and the timeline
is small enough to read); no cross-project comparison; no zone-restricted trends (zones are per map
and a zone on one map is not the same ground as a zone on another); no forecasting.

## 3. Data

### 3.1 `GeoMap.captured_on` (migration)

One nullable `Date` column: **when the imagery was flown**, which is not when the file was imported.

- At import, read it from the raster's `TIFFTAG_DATETIME` when present, else leave null.
- Editable: `PATCH /maps/{mapId}` with `{captured_on}` (the endpoint today has only GET and DELETE).
- Null sorts by `created_at` and is shown as "date not set" with an inline edit, never guessed.

The migration adds a nullable column with no backfill, so it cannot fail an app start.

### 3.2 Nothing else is stored

The timeline is computed per request from `GeoMap` and `MapRun` rows. There is no snapshot table:
the numbers live in `MapRun.counts` and must not be duplicated where they could go stale.

## 4. Which run represents a survey

A map may have several runs: different models, different confidence. Comparing them blindly would
produce a trend that is really a record of model changes.

1. The **comparison basis** defaults to the model and confidence of the newest run in the project,
   and the operator can change it on the screen.
2. For each map, the survey's run is its **newest run matching that basis** (same `model_id`, same
   `conf`).
3. A map with no matching run falls back to its newest run and is marked **not comparable**, naming
   what differs ("different model", "confidence 0.4 vs 0.25").
4. A map with no runs at all is listed as **not counted yet**, with a link to run one.

Marked rows are drawn but excluded from delta arithmetic, and the chart shows them as hollow points
with a dashed connector, so a changed model can never masquerade as a change on the ground.

## 5. Screen

A new entry **Surveys** in the sidebar's plain section, beside Maps (not a pipeline step), at
`/p/:projectId/surveys`.

- **Chart:** one line per class over survey dates, in the project's class colours, drawn as inline
  SVG in the style of `frontend/src/models/TrainingCurve.tsx`. No new dependency, no basemap. Classes
  can be toggled. Fewer than two comparable surveys shows the table only, with one line of
  explanation.
- **Table:** one row per survey, newest first — date, map name, model and confidence, a column per
  class with the count and its change since the previous comparable survey (`+3`, `-1`, `=`), and a
  state pill when the row is not comparable or not counted. The row links to that map's run.
- **Empty state:** no maps yet → point at Maps and say what a survey is.
- **Wording:** "objects", "surveys", plain sentences. No machine-learning vocabulary.

## 6. API

`contract/openapi.yaml` first; `contract/client/schema.d.ts` regenerated in the same change.

| Endpoint | Purpose |
| --- | --- |
| `GET /projects/{projectId}/survey-timeline?model_id=&conf=` | the ordered surveys with their chosen run, counts per class, comparability and deltas |
| `PATCH /projects/{projectId}/maps/{mapId}` | set or clear `captured_on` |

`GET /survey-timeline` returns `{basis: {model_id, model_name, conf}, classes: [{id, name, colour}],
surveys: [{map_id, map_name, captured_on, date_is_import_date, run_id, model_name, conf, counts:
{class_id: n}, deltas: {class_id: n}, state: "ok" | "not_comparable" | "not_counted", reason}]}`.

## 7. Budget and bounded reads

- **No background job.** Every value is already aggregated: the endpoint reads `GeoMap` rows and
  their `MapRun` rows (tens per project) and never touches `MapDetection`, tiles or rasters.
- The response is bounded by the number of maps; a project with hundreds of surveys still returns
  one small row each. Should that ever stop being true, the endpoint gains a cursor, not a job.

## 8. Errors and edge cases

- **Two maps with the same date:** both shown, ordered by import time, deltas computed in that order.
- **A map whose run is still going:** shown as not counted yet; the screen refreshes when a
  `map_detect` job finishes (`useOnJobsFinished`).
- **A deleted model:** the run keeps `model_name`, so the row still reads sensibly.
- **A class added after an earlier survey:** its earlier cells read `-`, not `0`, because the class
  did not exist to be counted.
- **No `captured_on` anywhere:** the timeline orders by import date and says so once, above the table.

## 9. Testing

- **Backend unit:** the run-selection rule (matching basis wins over newer non-matching; no runs;
  confidence mismatch names itself), delta arithmetic skipping non-comparable rows, and the
  class-added-later `-` case.
- **Backend API:** the endpoint against a project with three maps and mixed runs; `PATCH captured_on`
  set, clear and reject a malformed date (422).
- **Import:** a GeoTIFF carrying `TIFFTAG_DATETIME` yields `captured_on`; one without yields null.
- **Frontend:** chart line building from survey rows (pure function, tested directly), the table's
  delta and state rendering, the empty state, and a refresh when a `map_detect` job finishes.
- **e2e:** `/p/<P>/surveys` against the Prism mock: the table renders, toggling a class hides its
  line, and changing the basis re-requests the timeline.

## 10. Success criteria

1. With two or more surveys counted by the same model and confidence, the screen shows counts per
   class over time and the change since the previous survey.
2. A survey counted with a different model or confidence is visibly marked and excluded from deltas.
3. A survey date can be set and corrected by hand, and is read from the GeoTIFF when it is there.
4. The screen makes no request that scales with map size or detection count.
5. Nothing on the screen assumes the objects are machinery.

## 11. Execution DAG

**Units**

- **U1 `captured_on`** — migration, model field, import reads `TIFFTAG_DATETIME`, `PATCH` handler, schema.
- **U2 timeline service** — run selection, deltas, comparability; pure functions plus the query.
- **U3 contract** — the two endpoints and their schemas, regenerated client. Depends on U1/U2 shapes.
- **U4 API handler** — `GET /survey-timeline`. Depends on U2, U3.
- **U5 screen** — route, sidebar entry, icon, table, empty states. Depends on U3.
- **U6 chart** — inline SVG lines, class toggles, non-comparable styling. Depends on U5.
- **U7 e2e + evidence** — depends on U4, U6.

**Parallel batches:** Batch 1: U1, U2, U3. Batch 2: U4 (after U2, U3), U5 (after U3). Batch 3: U6
(after U5). Batch 4: U7.

**Critical path:** U2 → U3 → U4 → U7.

## 12. Risks

- **One survey per map is an assumption.** A site flown twice in a day gives two maps with the same
  date; the timeline handles it by ordering on import time, and nothing breaks.
- **The basis defaults to the newest run's model.** Importing an old map after running a new model
  marks the old one not comparable until it is re-run. That is honest, but it can surprise; the
  reason text says exactly what to do.
- **Migration order.** Other sessions are merging; the new revision chains onto whatever head is on
  `main` at merge time, and the contract is regenerated after any rebase, never hand-edited.
