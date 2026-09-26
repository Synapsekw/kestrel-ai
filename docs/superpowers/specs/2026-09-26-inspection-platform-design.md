---
status: draft
date: 2026-09-26
tags: [spec, programme, inspection-platform]
---

# Kestrel inspection platform: the programme

This is the umbrella spec. It records the decisions the operator made during brainstorming on
2026-09-26, the shared domain model every sub-spec builds on, and the order of work. It holds no
implementation detail. Each sub-project below has its own spec, then its own plan, then its own
worktrees.

## 1. Goal

Kestrel becomes an all-in-one drone inspection app. **Every** kind of data a drone captures lives
in one project: photos, orthomosaics, elevation models, CAD drawings and point clouds. On each of
them the operator can:

- mark defects with a type and a severity, and let AI models trained in-app suggest them
- measure (length, area, height, lean, profile, volume)
- compare survey dates
- pin notes, photos and comments

Everything ends in a report. The UI is rebuilt at the same time, in the chosen **Aero glass**
direction. The bar is a smooth, modern, finished product with micro-animations and dashboards, not
a restyle.

Success is the operator opening one project and working a real site end to end:

1. Import photos, a map, a DSM and a cloud.
2. Run their own model.
3. Accept findings and grade them.
4. Measure a stockpile.
5. Pin a crack in 3D.
6. Produce the report.

This must not require leaving the project, and must not require the old train/detect split.

## 2. Decisions (operator, 2026-09-26)

| # | Question | Decision |
|---|---|---|
| D1 | Where does training data come from? | **From inspection projects.** Annotated images in any project can be pulled into a training dataset in the Models section. There are no separate labelling projects. |
| D2 | Where does the list of defect/object types live? | **One app-wide Catalogue.** A project picks the types it uses and can add new ones to the catalogue. Names line up across projects, and model classes map onto catalogue types. |
| D3 | Annotation shapes on images | **Boxes (axis-aligned and rotated) and polygons.** Boxes train detection models (YOLO, as today). Polygons train segmentation models (YOLO-seg). Polygons give area. |
| D4 | Severity | **One app-wide editable scale**, default 1 Minor, 2 Moderate, 3 Major, 4 Critical, each with a colour. Severity is a human judgement set on review. Models do not predict it. A catalogue type may have a default severity. |
| D5 | Findings across data types | **One Finding entity** for images, maps and point clouds: type, severity, note, photos, comments and a status of Open → Reviewed → Closed. Its geometry depends on the host: a box/polygon in image pixels, a point/polygon in map CRS, or a 3D point in cloud CRS. A project has one Findings list. An accepted model detection becomes a finding. |
| D6 | Existing projects | **Migrate automatically** on first start. Train and detect projects become ordinary projects, classes merge into the catalogue by name, and accepted boxes become findings (Reviewed, no severity). Maps, clouds, surfaces and volumes carry over. A project that fails to migrate is skipped and flagged, and the app still opens. *(Foundation §3 F4 and §11.4 refine this: migrated types start as `object`, so no findings are created at migration; re-marking a type `defect` in the Catalogue offers a backfill job that applies this rule to that type's accepted boxes. Pending operator confirmation, §10.)* |
| D7 | Objects vs defects | Each catalogue type is a **Defect** or an **Object**. Defect detections become findings. Object detections (machinery, stockpiles) are **counted, not tracked**: they feed counts, site-area analytics and the survey timeline with a light accept/reject review, and they appear in reports. |
| D8 | App structure | **Projects** and **Models** are separate top-level sections. Models covers the library, datasets and training. A project can use any library model. |
| D9 | Visual direction | **D, Aero glass**: deep indigo gradient backdrop, frosted translucent panels, violet→indigo primary gradient, teal success, Space Grotesk plus JetBrains Mono, 16 px panel and 10 px control radii, micro-animations throughout. Mockups: `.superpowers/brainstorm/1481982-1790403567/content/visual-directions.html` (tab D) and `ws-images.html`, `ws-maps.html`, `ws-clouds.html` in the same folder. |
| D10 | Workspaces | Images, Maps and Point clouds are **full workspaces**. Maps and Point clouds are full-bleed, with every control floating over the view as glass. Images has a browser (grid ⇄ capture-location map), a canvas with the full tool palette, and an inspector. The operator approved all three mockups as drawn. |
| D11 | Delivery | Built **in parallel**: multiple sub-agents and multiple worktrees, one sub-project per worktree once the foundation has landed. |

## 3. Shared domain model

These names are binding on every sub-spec. A sub-spec may add fields but must not rename or
redefine these.

- **Project**: a folder plus `project.db`. It has no kind. The `kind` column is dropped after
  migration, and existing API responses keep it as a deprecated, ignored field for one release
  only if the contract needs it. A project holds **data items** and **findings**.
- **Data item**: anything imported into a project. It has a `type`:
  - `image_set`: a photo import, today's images Source
  - `map`: an orthomosaic GeoTIFF
  - `elevation`: a DSM or DTM, today's surfaces, including a cloud-derived DSM and a design DEM
  - `drawing`: DXF, LandXML, or a PDF/PNG plan, georeferenced
  - `point_cloud`: LAS/LAZ

  Each item has a label, a capture date and a status. The project's **Data** list is the union of
  these, served by one endpoint. Each type keeps its own storage and endpoints underneath.
- **Catalogue type** (app-wide, in app data next to `library.db`) has:
  - `id`, `name`, `colour`, `kind` (`defect` | `object`)
  - `default_severity` (nullable), `hotkey`, `archived`

  A project has a **project type list**: the ordered catalogue types it uses. The app-wide
  database is F's `catalogue.db` (F1); it also holds the severity scale and R's report templates.
- **Severity scale** (app-wide): an ordered list of levels `{level:int, name, colour}`. The default
  is 1–4 as in D4.
- **Annotation** (image pixels): a box, rotated box or polygon on one image, with a catalogue type.
  It is the training label. An annotation on a `defect` type **is** the geometry of a finding.
- **Finding**:
  - `id`, `project_id`, `type_id`, `severity` (nullable), `status` (`open`|`reviewed`|`closed`)
  - `note`, `created_by` (`human` | `model:<model_id>`), `confidence` (nullable), timestamps
  - one **anchor**: `image` (image_id + annotation_id), `map` (map_id + a GeoJSON point or polygon
    in the map CRS), or `cloud` (cloud_id + x, y, z in the cloud CRS + uncertainty)
  - **attachments** (photos) and a **comment thread**

  Findings are defects only (D7).
- **Detection**: a model output (box, rotated box or polygon, with confidence) awaiting review. On
  accept, a defect detection becomes a finding plus an annotation; an object detection becomes a
  counted object. On reject, it is kept only as a negative for training statistics.
- **Measurement**: a length, area, height, lean, profile or volume on a map, elevation or cloud.
  Today's cloud measurements and volume measurements are its first two kinds. The project's
  Measurements list is the union.
- **Model** (library, app-wide, unchanged in principle): gains a `task` (`detect` | `obb` | `segment`)
  and a **class map** to catalogue types.
- **Dataset** (Models section): built from annotated images selected across projects by a filter
  (projects, types, date range, reviewed-only). The dataset records its sources; images are
  referenced, and are only copied when an export is built.

## 4. App structure

The top-level rail has five sections. The project tabs follow the approved mockups.

| Rail | Contents |
|---|---|
| **Projects** | Project list/cards. Inside a project, the tabs are Overview (dashboard), Images, Maps, Point clouds, Findings, Measurements, Reports. |
| **Models** | Library (models, import, starters), Datasets (built across projects), Training (runs, metrics, compare). |
| **Catalogue** | Defect/object types and the severity scale. |
| **Jobs** | Every background job app-wide, with progress, logs and cancel. |
| **Settings** | Providers, keys, defaults, about. |

The project agent drawer stays, and gains findings and measurement tools in the later sub-specs.

## 5. Sub-projects

| # | Sub-project | Spec | Owns |
|---|---|---|---|
| F | **Foundation** | `2026-09-26-foundation-design.md` | Aero glass design system in `frontend/src/ui/`, new app shell and rail, project model without kind, Data list, Catalogue and severity scale, Finding core (entity, API, Findings tab), Models section (library + datasets across projects + training), migration, project Overview dashboard, command palette |
| I | **Image inspection** | `2026-09-26-image-inspection-design.md` | Images workspace: browser (grid ⇄ capture map), canvas tools (box, rotated box, polygon, AI smart polygon, point, length measure by GSD), AI detect on image/batch, suggestion review, finding inspector (attachments, comments), segmentation training support (YOLO-seg) |
| M | **Map workspace** | `2026-09-26-map-workspace-design.md` | Full-bleed map, floating layers (orthos, elevation, drawings), compare (swipe / side-by-side / blend), 2D measure (distance, area, profile), volume in the workspace on top of the existing S2 engine, drawing import and georeferencing, map findings, survey timeline, detections layer |
| C | **Point cloud workspace** | `2026-09-26-point-cloud-workspace-design.md` | Full-bleed 3D, floating tools, the existing measurements plus area and cross-section, clipping box, pinned 3D findings with photos and comments, drone camera positions linking to source photos, colour-by modes |
| R | **Reports** | `2026-09-26-reports-design.md` | Project report builder: findings by severity, per-finding pages with imagery, measurements and volumes, comparison snapshots; PDF export as a background job; report templates |

## 6. Programme DAG

```
F (Foundation) ──┬──> I (Images)  ──┐
                 ├──> M (Maps)    ──┼──> R (Reports)
                 └──> C (Clouds)  ──┘
```

- **Critical path:** F → the longest of I, M, C → R.
- **Inside F**, the design system and shell can run in parallel with the backend domain work
  (catalogue, findings, migration, Data list). The screens that consume them come after both.
  F's own spec gives its internal DAG.
- **I, M and C** run in three parallel worktrees once F is merged. They touch disjoint screens and
  mostly disjoint backend packages. Shared files are `contract/openapi.yaml` and the router. Merges
  into `main` are **serialized**, with a rebase and gate between merges.
- **R** starts after at least I and M are merged. Its skeleton (template, job, PDF pipeline) may
  start in parallel and gain sections as I, M and C land.
- **Contract:** each sub-project owns a disjoint group of paths and schemas in
  `contract/openapi.yaml`. It regenerates `schema.d.ts` in the same change.
- **Migration ids** (reserved up front, per ADR `2026-09-23-gotcha-parallel-branches-collide-on-migration-ids`):
  project DB `0010` F, `0011` I, `0012` M, `0013` C, `0014` R; library DB `0002` F (no other);
  catalogue DB `0001` F, `0002` R (`report_template`). Each id is written by one unit of its
  sub-project. The number is a reservation, not a merge order: `down_revision` is set to `main`'s
  head at merge, and heads are re-checked before every merge.

## 7. Budget (programme-wide rules every sub-spec restates concretely)

- **Background jobs:** import of any data type, AI detection over more than one image or over a
  map, dataset build and export, training, migration of a large project, report PDF rendering,
  elevation and volume computation, drawing rasterisation.
- **Bounded reads:**
  - Image browsers and the capture map page through images, returning GPS points as a compact
    array and never full records.
  - Maps and elevation are tiles only.
  - Clouds stream octree nodes under a point budget.
  - Findings and measurements lists page.
  - The Overview dashboard reads pre-aggregated counts, never a full scan per render.

## 8. Cross-cutting rules

- Contract-first (`AGENTS.md`). API keys stay in Windows Credential Manager. The app starts even
  if migration fails.
- Motion: animation tokens (durations, easings) live in the design system. They respect
  `prefers-reduced-motion`, and they never block input. No animation longer than 400 ms on an
  interaction path.
- Performance on a laptop: backdrop blur only on floating panels over imagery, never on the scroll
  containers of long lists. Frame budget checked in the e2e suite on the three workspaces.
- `frontend/scripts/check-tokens.mjs` keeps enforcing the use of primitives. The new tokens replace
  Contour's, and `DESIGN.md` is rewritten for Aero glass in F.

## 9. Risks

1. **A parallel session is live.** A `task/model-gsd` worktree exists and `main` moved during
   brainstorming. F rewrites the shell and project model, so the model-gsd work must merge before
   F's shell and migration land, or F rebases onto it. Check before every merge.
2. **Migration is big-bang.** It is mitigated by a copy-first migration: `project.db` is backed up
   before any change, a failed project is skipped and flagged, and there is a dry-run test on a copy
   of every real project folder.
3. **Scope.** Five sub-projects, each the size of a past wave. Each spec must keep YAGNI and name
   what is deferred.
4. **Blur and gradients on a laptop GPU.** Measured in F with an e2e frame-time check; a
   reduced-effects fallback exists from the start.

## 10. Cross-spec reconciliation (2026-09-26)

The six specs were drafted in parallel. A consistency pass found these conflicts and resolved each
in place (F = Foundation, I = Images, M = Maps, C = Point clouds, R = Reports).

1. **Keyboard shortcuts differed per workspace** (I: X reject, digits severity; M: A area, R AI
   region, A/R/1–9/N review; C: digits 1–6 for measure tools, T top view). → F §5.6 defines one
   app-wide keymap (global keys, review keys A · X · Shift+A/X · 1–9 severity · T type · Tab, and
   per-workspace tool keys). M's tools become L distance, Q area, M finding point, D AI region, and
   review is X reject / Tab next; C's tools become P point, L distance, Z height, U verticality,
   Q area, E cross-section, M pin, H pan, Alt+1…4 views, N next ring. (F, I, M, C)
2. **Migration ids** (F reserved project `0010`; I `0011`; M an unnumbered `00NN`; C assumed
   `0013`; R unnumbered). → §6 "Migration ids": I `0011`, M `0012`, C `0013`, R `0014`; catalogue
   `0002` R. (umbrella, F, I, M, C, R)
3. **Cloud → image jump** requested by C but absent from I. → I §6.5 defines
   `/p/:pid/images/:imageId?at=px,py&r=rpx&from=cloud:<cloudId>` with a static dashed ring marker
   and a "Back to 3D" chip; C §4.2 references it. (I, C)
4. **Finding deep link** (C proposed `?finding=` for clouds; F linked `?at=` for maps and clouds).
   → F §8.7 defines one `findingHref`: `/findings/:id` (canonical), `images/:imageId?finding=`,
   `maps?map=<mapId>&finding=`, `clouds/:cloudId?finding=`; I §6.5, M §5, C §10.4 and R §9.4
   conform. (F, I, M, C, R)
5. **Human finding numbers**: R would add `Finding.number` if F did not. → F §8.1 owns `number`
   (allocation, format `F-0042`, migration numbering); R only reads it. (F, R)
6. **App-wide database name** (F `catalogue.db`, R `app.db`). → one DB, `catalogue.db`; R's
   `report_template` is catalogue revision `0002`, with built-ins served from code when the
   catalogue is down. (umbrella §3, F §7.1, R §3/§6.2/§19)
7. **Accepted detections → `reviewed` findings**: I and M already agreed with F; C has no
   detections. → stated once as a cross-host rule in F §8.5 and referenced by M §4. (F, M)
8. **`GET /measurements` ownership** ("M and C together" in F, "M ships it" in M, "not C's" in C).
   → M owns the endpoint and its three providers; C adds only the headline/status mapping for its
   `area` and `profile` sub-kinds (C §12 row 19). (F, I, M, C)
9. **Report views**: R expected only the finding `view3d` path and a `{finding_id | measurement_id}`
   spec. → R §3/§9.1/§9.4 now use C's exact paths (finding and cloud-measurement `view3d`),
   `subject_kind` + `subject_id`, `source_version` = `cloud_view.sha256`, the stale warning, and
   the fallback (cloud-derived hillshade, then placeholder with the deep link). (R, C)
10. **Migrated types default to `object`** (F4) vs D6 "accepted boxes become findings". → a
    clarifying note on D6; D7 does not contradict. (umbrella)
11. **`isTypingTarget` lived in `editor/hotkeys.ts`**, which I deletes while M and C import it. →
    moved to F's `ui/keymap.ts`. (F, I, M, C)
12. **`surfaces/ImportElevationDialog.tsx` created twice** (F extracts it; M added a new dialog of
    the same name). → M extends F's file with a DSM/DTM mode; M also enables F's disabled Drawing
    tile. (F, M)
13. **Primitives missing from F** (`Slider` used by M and C, `Combobox` and `Popover` used by C,
    which planned to add them itself; M used `SegmentedPill`/`IconButton` and 14 px radii). → F's
    DS unit adds `Popover`, `Slider`, `Combobox`; M uses `Segmented`, `ToolButton`,
    `rounded-panel`. (F, M, C)
14. **Decorative loops**: M's critical map pins pulsed indefinitely. → static ring; a finite pulse
    (≤ 3 cycles) on create/select only, now an explicit F §4.2 rule that C already met. (F, M)
15. **Raw colour in M** (`#1a1712`-like stage backdrop). → F's `--bg`. (M)
16. **Motion tokens in R** (180 ms spring, 200 ms). → `--dur-base` with `--ease-out`;
    `--ease-spring` stays reserved for pins and badges. (R)
17. **C panel entrance delays** (0.10–0.38 s from the mockup). → F's stagger tokens. (C)
18. **I `[`/`]` did two things** (pane toggles and the threshold). → panes move to Ctrl+[ / Ctrl+].
    (I, F)
19. **C rings tool used Space** (F's global hold-to-pan). → N "next ring". (C)
20. **Project tabs on full-bleed surfaces**: F hid them on "the image editor" while I keeps them,
    and C placed its viewport "below the project tabs". → tabs hide on Maps and Point clouds only.
    (F, C)
21. **M's map-findings payload used `title`** and "F-031", not F's fields. → `number`,
    `created_by`, title composed client-side, `F-0031`. (M)
22. **R's assumed field names diverged from F/I**: annotation shape `obox` (I: `rbox`, plus
    `point`), comment `body` (F: `text`), attachments attributed to I (F owns them), a
    `(project, …)` index (per-project DB). → aligned. (R)
23. **C's e2e sent `normal` inside F's cloud anchor**, contradicting C10. → the normal travels in
    the `view3d` meta. (C)
24. **Paths inside F's `/findings` group added by others** (I's `image_id` filter, C's
    `findings/{id}/view3d`). → listed as agreed additions in F §13. (F)
25. **Dangling or ambiguous DAG references**: C cited F §17 for the frame-time probe (it is F §4.3/
    §16); C's "R's acceptance waits on R1" meant C's own unit R1; R9-C "Needs C" was unspecific. →
    corrected to name the units. (C, R)
26. **Catalogue type hotkeys `1`–`9`** (F §7.2) vs digits = severity. → type hotkeys are live only
    inside a type picker. (F)
27. **Measurement kind names**: stored kinds keep S1/S2 names (`distance`, `vertical`) while the
    umbrella says length/lean. → R §7.2 maps them; no rename. (R)

**Open for operator confirmation**

1. **Migrated catalogue types start as `object`** (F4), so migration creates no findings; defects
   are recovered by marking the type `defect` and running the backfill. This refines D6.
2. **The app-wide keymap** (F §5.6), in particular the changes against the approved mockups and
   today's app: X (not R) rejects everywhere; digits are severity, never classes or tools; Maps
   tools L/Q/M/D and Play on P; cloud tools P/L/Z/U/Q/E/M with Pan on H and view presets on
   Alt+1…4 (S1's T top view is retired).
3. **One app-wide database `catalogue.db`** holding the catalogue, the severity scale and report
   templates (no `app.db`).
4. **C's "Capture missing views" runs in the foreground** (cancellable, with progress, 3D view
   frozen): the one sanctioned exception to "long work is a background job", because only the
   webview can render 3D.
5. **I's capture map/grid reads one capped columnar index** (≤ 100 k rows of compact arrays, with
   details paged by id) instead of paging GPS points (§7 "page through images"); a project above
   the cap must filter by source.
6. **Finding deep links**: a finding link opens the workspace of its anchor (`?finding=`), with
   `/findings/:id` as the canonical "Copy link" target.
7. **Critical map pins do not pulse** (a static thicker ring), departing from the Maps mockup.
