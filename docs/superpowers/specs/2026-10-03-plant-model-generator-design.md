# Plant model generator and Site 3D view — design

Status: approved by the operator in conversation, 2026-10-03. The operator asked for it to be run as
a goal to completion, without separate spec and plan review stops.

Supersedes the *scope* of M1 (`2026-10-02-asset-model-builder-design.md`). The M1 tables, routes,
part shapes, run job, look tools, rasterizer and workspace stay; this spec widens them.

## 1. Why

The operator ran M1 on the LNG Terminal project (KIPIC Al-Zour LNG import terminal) and compared
the result with the Cowork-built artifact "Al-Zour LNG Plant Model".

**What Cowork built** (`KIPIC_AlZour_LNG_Plant.glb` + `KIPIC_AlZour_Asset_Register.csv`):
- 885 register rows and 864 modelled items; 404 tags; 46 item types; about 446 k triangles;
  34 materials.
- Traced from the four as-built area plot plans P0058LNG-00-40-0-T0005 to T0008 (jetty, tank,
  process and utility, buildings), with the overall plot plan T0003 for layout.
- Every glTF node's `extras` carries the register row: plant E/N, UTM-39 E/N, base, top and height
  source, area, type, notes and source sheet. Heights: 61 from the drawing, 824 indicative.
- Includes land, sea, roads and paving. The viewer adds a water shader and a sky dome, plus an ortho
  drape, a point cloud, posed photos, panoramas and videos.

**What Kestrel built:** a single LNG tank in 3 parts (wall, dome, a box for the pump platform). It
used 1.19 M input tokens and 68 tool calls (41 of them plane fits), from the 1:3000 overall plan
page alone.

**Root causes:**
1. **Scope.** M1 models one asset, part by part, in millimetres, with a budget of 80 tool calls.
2. **No vocabulary for a plant.** There were no item types, no plant grid and no register.
3. **Inputs.** Only page 1 of the overall plan was imported. A multi-page PDF imports one page per
   Drawing, which also made the HCl run see only the cover sheet. The four area plot plans were
   never imported.

## 2. Goal

The operator supplies drawings and a point cloud (and optionally an ortho and photos) for **any**
project. One unattended AI run then:
1. reads the drawings;
2. lists every asset on them;
3. checks each one against the point cloud;
4. produces a GLB and a register CSV, realistic enough to stand in for the Cowork artifact.

The model opens in a new **Site 3D view**. There it can be layered over the draped ortho, the point
cloud and the drawings, with water and sky, and connected to the project's other data.

## 3. Programme

| Slice | What | Status |
| --- | --- | --- |
| **G1 (this spec)** | Generator (intake, register, builder catalogue, run, cloud check, environment) + Site 3D view (model, ortho, cloud, drawings, water/sky, posed photos, existing findings) | to build |
| G2 | Connect data: points, findings and pictures anchored on model **items**. Built with the artifact-port P1 asset anchor (`anchor_kind = asset`), not separately | after G1 and P1 |
| G3 | Media: panoramas, video and flights at their poses (artifact-port P4 / confined-space M2) | after G2 |

The HCl tank stays a valid case: it is a model with one item (`type: composite` or `tank_vertical`)
whose detail is M1 parts.

## 4. Decisions (operator, 2026-10-03)

| # | Decision |
| --- | --- |
| D1 | General, not Al-Zour-specific: drawings + cloud in, GLB + CSV out, for any plant or asset |
| D2 | The model nests **site → items → parts**. M1 parts become the detail level of an item |
| D3 | First slice = generator + Site 3D view together. Al-Zour is the acceptance job |
| D4 | **One unattended run** per build. Budget about 40 M tokens / 400 images / 4 h; staged internally |
| D5 | **The drawing decides plan position; the cloud decides height.** A disagreement over the tolerance becomes a flag on the item and is never a silent move |
| D6 | The environment (land, sea, roads, paving) is traced by the AI and editable by the operator. The scene renders water and sky |
| D7 | The Site 3D view is a new per-project view. It is reached from Asset models, the Map and Cloud workspaces and the run summary |
| D8 | **Approach A:** the AI writes a typed register; app-code builders for each type make the geometry. No AI-written code runs |
| D9 | The canonical model frame stays M1's / P1's A7: metres in the GLB, Y up, X plant north, Z plant east. Origin = plant grid origin at the vertical datum |

## 5. The spec: site, items, parts

Pydantic in `backend/app/asset_models/spec.py`, mirrored in the contract. The existing `AssetSpec`
gains three optional blocks, so every M1 spec stays valid.

```
AssetSpec
  asset:   {...M1...}
  site?:   SiteFrame
  items:   Item[]          # default []
  parts:   Part[]          # M1 top-level parts (still allowed; a single-asset model)
  environment: EnvFeature[]  # default []

SiteFrame
  crs: { epsg?: int, wkt?: str }           # the site CRS the grid is defined in (Al-Zour: EPSG:32639)
  origin_crs: [E, N]                       # plant (E 0, N 0) in that CRS, metres
  plant_north_deg: float                   # plant north, clockwise from grid north (Al-Zour 17.9991)
  datum: { label: str, el_m: float }       # e.g. "HPFS", 100.0: plant EL at scene Y = 0
  cloud_z_to_el?: { cloud_id, offset_m, tilt?: [dx, dy] }  # fitted by the run (Al-Zour cloud z -20.45 ≈ ground)
  source: { kind: drawing|assumed|operator, id?, note? }

Item
  id: slug (≤ 64)                   # stable across versions
  tag?: str                         # e.g. 20-T-0001; null for untagged items
  name: str
  type: one of the builder catalogue (§6)
  area?: str                        # e.g. "20" / "Area_20_Tank"
  footprint: { kind: polygon, pts: [[E, N], …] (3..500, plant m) }
           | { kind: rect, center: [E, N], size: [along, across], rot_deg }
           | { kind: circle, center: [E, N], d }
           | { kind: line, pts: [[E, N], …], width }        # roads, racks, fences, trestles
  base_el: float | null             # plant EL, m
  top_el:  float | null
  levels: float[]                   # decks/tiers, plant EL
  params: dict                      # type-specific; validated by the builder's schema
  height_source: drawing | cloud | indicative
  source: { kind: drawing|cloud|photo|assumed, id?, page?, region? (0..1), note? }
  confidence: high | medium | low
  flags: Flag[]                     # { code: plan_offset|height_mismatch|missing_in_cloud|unregistered|builder_fallback|straddles_package, value?, note }
  parts: Part[]                     # optional M1 parts in the item's local mm frame (origin = footprint centre at base_el)
  notes?: str (≤ 1000)

EnvFeature
  id, kind: land | sea | road | paved | laydown | slope | revetment
  pts: [[E, N], …], el: float, source, confidence
```

**Coordinates.** `plant_E` / `plant_N` are the drawing's own grid. Scene coordinates:
- `x = plant_N` (north), `z = plant_E` (east), `y = EL - datum.el_m`.
- Site CRS from plant: rotate (E, N) by `plant_north_deg` and add `origin_crs`.

`backend/app/asset_models/siteframe.py` holds both conversions. A golden test checks them against the
Al-Zour register (`plant_E`/`plant_N` → `utm39_E`/`utm39_N`, all 864 geometry rows within 0.05 m).

**Validation** (extends M1 `validate`):
- **Errors:** an unknown type; params failing the builder schema; a self-intersecting footprint;
  duplicate item ids; `top_el < base_el`; over 20 000 items.
- **Warnings:**
  - two items of the same type whose footprints overlap more than 50 %;
  - a tagged item with `confidence = high` and `source.kind = assumed`;
  - flags present.

**Size.** The spec JSON for Al-Zour is about 1.5 MB. Version create runs `validate` in the GLB job,
not in the request (this fixes M1's owed item 8). Request-path validation stays schema-only.

## 6. Builder catalogue

`backend/app/asset_models/builders/`: one module per family, plus a registry. A builder is:

```python
@builder("pipe_rack", family="structure", params=PipeRackParams)
def build_pipe_rack(item: Item, ctx: BuildCtx) -> list[MeshNode]: ...
```

- `MeshNode` = name, material, `trimesh.Trimesh` **or** `Instanced(mesh, transforms[N,4,4])`, plus
  extras.
- `BuildCtx` gives the plant → scene transform, the palette, the level of detail and a triangle
  budget.
- Each param schema has defaults. A defaulted value is recorded in the CSV `notes`, and the height
  source becomes `indicative` unless given.

**The 46 types in G1, by family:**
- **structure:** trestle, jetty_platform, dolphin, pipe_rack, pipe_sleeper, catwalk, walkway,
  stair_tower, overbridge, platform, gangway.
- **equipment:** tank_lng, vessel_v, vessel_h, storage_tank_small, pump, pump_group, compressor,
  heater, vaporizer_orv, vaporizer_scv, stack, flare, loading_arm, crane, monitor, generator,
  transformer, package, nav_aid.
- **building:** building, substation, analyzer_house, shelter, gate.
- **civil:** road, paved, laydown, parking, trench, channel, basin, wall, fence, revetment.
- **fallback:**
  - `other` extrudes the footprint from base to top;
  - `composite` is made only of the item's M1 parts.

**Realism floor.** Each builder reaches at least the Cowork detail level. Reference renders of the
Cowork nodes of the same type are the fixtures, at `backend/tests/data/plant/cowork_nodes/`, with
the sources noted. Examples:
- **trestle:** deck slab, pile bents at bay spacing, bracing, handrail both sides, pipe-rack band on
  one side.
- **pipe_rack:** column grid, beams for each tier, bracing in end bays, pipes as instanced cylinders
  when `params.lines` is given.
- **tank_lng:** concrete outer wall, dome, roof platforms (pump, safety, instrument, flare,
  unloading, walking), stair tower, pipe risers.
- **vessel_h:** shell, two heads, saddles. **vessel_v:** shell, heads, skirt.
- **loading_arm:** riser, inner and outer arm, counterweight.
- **dolphin:** deck on piles, fender panel.
- **building:** walls, roof with parapet, door and window bands.

Repeated elements (piles, columns, posts, grating bars, rack pipes) are **instanced**
(`EXT_mesh_gpu_instancing`).

**Fallback rule.** A builder exception or schema failure on one item builds that item as `other`
and adds a `builder_fallback` flag. One bad item never fails the GLB.

**Adding a type:** a builder, its schema, a golden test, and an entry in the catalogue file the
agent's tool descriptions are generated from. Nothing else changes.

## 7. GLB assembly (`asset_model_glb` job, extended)

The input is a version's spec; the outputs are `v<n>.glb` + `v<n>.csv` + `v<n>.meta.json`.

**Node hierarchy:**
- root (with site extras: CRS, origin, plant north, datum, and the conversion formula);
- then area groups;
- then one node per item, with the register row in its extras;
- then its child nodes.

M1 top-level parts stay under root. Environment is under `environment/`.

**Output rules:**
- Materials use Cowork's 34-material palette, with names and colours from the Cowork GLB.
- Compression is meshopt (`EXT_meshopt_compression`) when the encoder is available, otherwise none.
  The planning check decides whether a bundled encoder is viable in the frozen sidecar.
- **CSV:** Cowork's 17 columns in their order (`node,tag,name,type,area,group,plant_E,plant_N,
  utm39_E,utm39_N,base_EL,height_m,top_EL,height_source,has_geometry,source_sheet,notes`), plus
  `flags` and `confidence`. The `utm39_*` columns are named `site_E`/`site_N` when the site CRS is
  not UTM-39.

**Budget:** a 2 000-item plant must build in under 2 minutes and under 1.5 GB of RAM. Al-Zour
triangles must be at most 1.5 × Cowork's.

The job also writes the `asset_item` index rows for the version (§9).

## 8. The generator run

The same `asset_model_run` job and table, with `mode = plant`. M1 modes `build` and `refine` are
unchanged.

### 8.1 Intake

- **Import all pages.** Importing a PDF creates one Drawing per page, all sharing `source_sha256`.
  The import dialog gets **"All pages"** as the default.
- `list_sources` groups pages by source file.
- The build dialog's source picker selects whole files.
- The build dialog lists **project-folder drawings that were never imported** (by scanning the
  project folder's `Drawings/` or `drawings/` for PDF, DXF and TIF files not matched by sha256). It
  offers "Import and include" for them.
- Scanned plot plans have no text layer (Al-Zour: 0 characters on all 29 pages), so vision on zoomed
  tiles is the main reader.

### 8.2 Stages (one job)

1. **Survey** (orchestrator conversation):
   - read each page's title block, scale, key plan, grid labels and equipment list;
   - fix the `site` frame with `set_site`. It uses at least two grid intersections read off the
     drawing (plant E/N) and the drawing's existing georeference (site CRS) to compute
     `origin_crs` + `plant_north_deg`, with a residual. A residual over 1 m opens a question.
   - split the work into **packages** (`plan_packages`): each is a page region of one sheet with an
     area label and an expected item list from the equipment list, sized for one sub-run.
2. **Trace** (sub-run conversations, up to **4 in parallel**):
   - each package gets a fresh conversation with the package brief, the catalogue and the tools;
   - it zooms (`drawing_zoom`), reads tags and leaders, and writes items (`upsert_items`) in plant
     coordinates;
   - per sub-run limits: 150 calls, 4 M tokens, 60 images;
   - a finished package is persisted (`site_model_package` row + draft items), so a restart resumes
     after the last finished package.
3. **Merge** (app code): items with the same tag merge. Untagged items of the same type whose
   footprints overlap more than 60 % merge. Conflicts get a `straddles_package` flag.
4. **Cloud check** (app code; the AI only reviews the outcome):
   - for each item, with a cloud in the site CRS: fit `cloud_z_to_el` once, from the ground around
     the items with drawing elevations;
   - inside each footprint, take the ground and top percentiles to get `top_el`. Use them when
     `height_source` is `indicative`; flag `height_mismatch` when it is `drawing` and differs by
     over 0.5 m;
   - flag `missing_in_cloud` when the footprint is covered by the scan but empty;
   - flag `plan_offset` when the best-fit shift of the item's cloud points exceeds 1 m. The position
     stays as on the drawing (D5);
   - **unregistered candidates:** connected above-ground clusters over 3 m × 3 m with no item go to
     the orchestrator, which names them (new item) or rejects them;
   - bounded: the cloud is read once as a ≤ 20 M point sample, through the octree level for the
     plant extent, with a per-item ≤ 200 k point cap.
5. **Environment** (orchestrator): trace land, sea, road, paved and laydown polygons from the
   overall plan (`upsert_environment`), checked against the ortho with `ortho_view` when one exists.
6. **Build and self-check:** build the GLB (in process, the same code as the job), then
   `render_site` (a plan view over ortho and drawing tiles with item outlines, and an iso view).
   Up to **2 fix rounds**, then `finish` (summary, open questions, package table, flags summary).

### 8.3 New tools (all app code, all bounded)

| Tool | Args | Returns | Bound |
| --- | --- | --- | --- |
| `drawing_zoom` | `id`, `region` (0..1), `dpi?` | a PNG of the region at up to 600 dpi, plus a grid overlay with plant E/N ticks once `site` is set | ≤ 1 600 px longest side |
| `set_site` | SiteFrame fields, or `grid_points: [{page_px, plant_E, plant_N}]` | the computed frame + residual | — |
| `plan_packages` | `packages[]` | ids | ≤ 64 packages |
| `upsert_items` | `items[]` | validation per item, count | ≤ 150 items per call |
| `remove_items` | `ids[]` | count | — |
| `upsert_environment` | `features[]` | count | ≤ 50 per call |
| `catalogue` | `type?` | builder types with param schemas and defaults | — |
| `cloud_check` | `item_ids?` | per-item heights, flags, unregistered candidates | as §8.2.4 |
| `ortho_view` | `bbox` (plant m) | ortho crop PNG | ≤ 1 600 px |
| `render_site` | `views[]` (`plan` / `iso` / `area:<label>`), `overlay?` (ortho / drawing) | PNG per view | ≤ 4 views, ≤ 1 600 px |
| `items_query` | `area?`, `type?`, `tag?`, `bbox?` | compact rows | ≤ 300 rows |

M1 tools stay available to sub-runs (`drawing_view`, `drawing_text`, `cloud_slice`, `cloud_fit`,
`photo_view`, `upsert_parts`, `render`, `compare_to_cloud`). That lets an item with a detailed
drawing get M1 parts.

### 8.4 Budget, stop, recovery

- **Whole run:** 40 M tokens (input + output, summed over the orchestrator and all sub-runs),
  400 images, 4 h wall clock. These are configurable in App settings as M1's are.
- Prompt caching is on: system prompt, catalogue and package brief are cached prefixes.
- Usage and cost are shown live in the Run tab (tokens per stage; a cost estimate from a price table
  in app code, labelled an estimate).
- **When the budget runs out:** packages in flight may finish; no new package starts. The run then
  goes to merge → cloud check → build, and lists unreached packages. "Re-run package" (a new run,
  `mode = plant_package`) redoes chosen packages on the current version.
- **Stop:** writes a `draft` version from the merged items so far.
- **Restart:** a `running` plant run found at startup resumes from its last finished package (M1
  marks M1 runs `failed`; plant runs resume).

### 8.5 Prompts

- `agent/prompt_plant.py`: an orchestrator prompt and a sub-run prompt.
- Content covers the frame (D9), the authority rule (D5), reading scanned plot plans (title block,
  key plan, grid, leaders, equipment list), the catalogue and when to use `other`/`composite`,
  honesty (indicative heights, open questions), and never inventing tags.
- The prompts never contain keys or file system paths.

### 8.6 Providers

Anthropic `claude-opus-5-5` is the default and the acceptance provider (adaptive thinking, effort
high). OpenAI and Gemini keep working through `llm.complete` and are not acceptance-tested for
plants.

## 9. Data model (project migration `0017`, additive only)

`asset_model`, `asset_model_version` and `finding` are **not** rebuilt. P1's `0016` owns their
rebuild. Changes:

- `asset_model.kind`: str, default `asset`, values `asset | plant`, via ALTER ADD.
- **`asset_item`** (new), the register index; written by the GLB job and by P1/J1 GLB import later:

  | Column | Type |
  | --- | --- |
  | `id` | int PK |
  | `model_id` | FK asset_model, CASCADE |
  | `version` | int |
  | `node`, `tag`, `name`, `type`, `area` | str (`tag`, `area` nullable) |
  | `plant_e`, `plant_n`, `site_x`, `site_y`, `lon`, `lat` | float, nullable |
  | `base_el`, `top_el` | float, nullable |
  | `height_source`, `confidence` | str |
  | `flags` | JSON |
  | `source_sheet` | str, nullable |
  | `has_geometry` | bool |

  - Indexes: `(model_id, version)`, `(model_id, version, tag)`, `(model_id, version, type)`.
  - The list endpoint is paged (≤ 500 rows).
- **`site_model_package`** (new): `id`, `run_id` FK CASCADE, `n`, `label`, `drawing_id`,
  `region`, `area`, `state` (`queued|running|done|failed|skipped`), `usage`, `item_count`,
  `summary`, `started_at`, `ended_at`.
- When a plant version is written and `asset_model.frame` is **null**, the frame is filled for P1's
  consumers. Rules (agreed with P1's coordinator):
  - write only through P1's `app.asset_review.frame.Frame` (contract `AssetFrame`), so it
    validates;
  - fill `origin` (lat/lon of the plant origin, ground altitude at the datum), `north_offset_deg`
    (plant +X true bearing: `plant_north_deg` plus grid convergence), `datum_label` and `height_m`
    (model top);
  - never write `silhouette`, `levels` or `presets`: J1 derives them;
  - never overwrite a frame the operator or `asset_glb_import` already set.

## 10. Contract additions

Added to `contract/openapi.yaml`, with `schema.d.ts` regenerated in the same change.

**Schemas:**
- `AssetSpec` gains `site`, `items`, `environment`, with `SiteFrame`, `AssetItem`, `ItemFootprint`
  (discriminated), `EnvFeature` and `ItemFlag`.
- `AssetModel` gains `kind`.
- `AssetModelRunStart.mode` gains `plant` and `plant_package` (+ `package_ids`).
- `AssetModelRun` gains `packages` (summary).

**Routes:**
- `GET …/asset-models/{id}/versions/{n}/items`: paged, filtered by `q`, `type`, `area`, `flag`,
  `bbox`.
- `GET …/versions/{n}/items/{itemId}`: the full item from the spec.
- `GET …/versions/{n}/csv`: the file.
- `GET …/asset-models/{id}/runs/{rid}/packages`.
- `GET /projects/{pid}/drawings/unimported`: folder files not yet imported.
- `GET /asset-models/catalogue`: types, families and param schemas, for the item editor.
- `GET /projects/{pid}/site-scene`: the scene manifest for the Site 3D view. Every list in it is
  bounded:
  - the site frame (from the chosen model, or else the map workspace frame);
  - layers available: models with ready GLBs, orthos/maps, ready clouds in the same CRS, georeferenced
    drawings, posed photos, findings with map/cloud anchors;
  - each layer's URL template.

Existing tile and octree routes are reused as they are.

## 11. Site 3D view (frontend)

Route `/p/:projectId/site[/:modelId]`. A new folder, `frontend/src/site3d/`. It is a separate engine
from `assetmodels/viewer/engine.ts`, which P1 builds on and this spec does not change.

**Engine** (`site3d/engine/`):
- three 0.180 + potree-core in one `WebGLRenderer`, with logarithmic depth (scene spans 3 km × 10 cm).
- The scene origin is the plant origin. A `SiteTransform` (TS mirror of `siteframe.py`, pinned to
  the same golden vectors as `contract/fixtures/`) maps the site CRS ↔ scene.

**Layers** (a module per layer under `site3d/layers/`, as `mapws/layers/` does):

| Layer | What | Bound |
| --- | --- | --- |
| model | GLB (GLTFLoader + meshopt decoder); colour by material / type / area / height source / flag; see-through (opacity); wireframe; cut plane; selection outline | one model at a time |
| ortho | the site tile grid (`workspace/tiles`) draped on a ground plane at the datum, quadtree LOD by camera distance | ≤ 64 MB textures, ≤ 256 tiles live |
| cloud | existing octree via potree-core, with the `cloud_z_to_el` offset applied | point budget 3 M (setting) |
| drawing | georeferenced drawing tiles on a plane at grade, opacity | same tile cap as ortho |
| water | three `Water` (examples/jsm/objects) on `sea` polygons, normals texture shipped in `public/`, shoreline foam from a distance field computed once per model | one mesh |
| sky | three `Sky` + sun, matching hemisphere light; off → plain background from tokens | — |
| photos | camera glyphs from existing poses (`pointclouds/cameras.py` data); click opens the photo | ≤ 2 000 glyphs, instanced |
| findings | existing map/cloud findings as pins | paged |

**Panels** (Aero glass, `GlassPanel`; the UI loads the design skills, `DESIGN.md` and `ui/` first):
- **Layers** (top left): toggles, opacity, colour-by, height colouring, water/sky.
- **Register** (right):
  - search by tag or name, filter by area, type and flag;
  - a virtualised list from the paged items API;
  - clicking a row flies to the item.
- **Item** (right, on selection):
  - the register row and flags;
  - "Source" opens the drawing crop;
  - **Edit** changes type, footprint numbers, heights and params with a schema-driven form, and
    saves a `manual` version; the GLB rebuilds and the view swaps, keeping the camera.
- **View tools** (left palette): orbit, pan, fly, measure (distance and height), cut, presets (fit,
  plan, and one per area from the spec), screenshot.
- **Run** (bottom, while a run is live): stage, package table, tokens, Stop.

**Entry points:**
- the Asset models workspace "Open in site" (plant models open here by default);
- the Map workspace and the Cloud workspace "Open in 3D", at the same place;
- the run summary;
- the sidebar's Asset models link stays as the way in. No new sidebar entry in G1.

**Fixes from M1's deferred UI list, done here because the item editor reuses them:**
- unsaved edits prompt before they are dropped;
- the editor shows the base version;
- list reload errors are shown;
- a failed GLB swap shows the error and the old model is labelled stale;
- the Orbit button works;
- `MAX_STEPS` comes from the run's budget, not a constant.

## 12. Budget and execution DAG

**Background jobs:** the plant run (≤ 4 h, cancellable, resumable, progress events per stage and
package); GLB/CSV build; PDF all-pages import; cloud check (inside the run).

**Bounded reads:**
- drawing tiles ≤ 1 600 px;
- the cloud through an octree-level sample ≤ 20 M points, read once per run;
- items lists paged at ≤ 500 rows;
- scene textures and points capped (§11);
- no tool or route loads a full image set, full cloud or unscaled page.

**Units:**

| Unit | What | Needs |
| --- | --- | --- |
| **F0** | Contract (all of §10), migration 0017, ORM, spec models (§5), `siteframe.py` + golden vectors (py + ts), builder registry + `BuildCtx`/`MeshNode` interfaces + `other`/`composite`, stub routes returning 501 | main after P1 0016 |
| **B1** | Builders: structure family (11 types) | F0 |
| **B2** | Builders: equipment family (19 types) | F0 |
| **B3** | Builders: building + civil families (15 types) + environment meshes (land/sea/slope) | F0 |
| **A1** | GLB assembly job: hierarchy, extras, instancing, meshopt, CSV, `asset_item` index, items/csv routes | F0 (uses whatever builders exist; fallback covers the rest) |
| **I1** | Intake: PDF all pages, unimported-drawings scan + route, `list_sources` grouping | F0 |
| **R1** | Plant run: orchestrator + sub-runs, packages table, new tools (§8.3) except `cloud_check`, prompts, budget/stop/resume, runs API extensions | F0, I1 (soft) |
| **C1** | Cloud check (§8.2.4) as a pure module + `cloud_check` tool | F0 |
| **S1** | Site 3D core: route, engine, `SiteTransform`, model layer, ortho drape, drawing layer, site-scene manifest route, presets, selection | F0 |
| **S2** | Site 3D layers: cloud, water, sky, photos, findings | S1 |
| **S3** | Site 3D panels: layers, register, item + editor, run bar, entry points, M1 UI fixes | S1, A1 |
| **K1** | Scorer (`backend/app/asset_models/score.py` + CLI) vs Cowork CSV; Al-Zour fixtures; live acceptance test | F0 |
| **L1** | Live acceptance loop: import the Al-Zour drawings, run, score, tune prompts/catalogue docs, re-run; installer | everything |

**Batches:**
- 1 = F0.
- 2 = B1, B2, B3, A1, I1, C1, S1, K1 (8 in parallel).
- 3 = R1, S2, S3.
- 4 = L1.

**Critical path:** F0 → R1 → L1. A1 must merge before S3's e2e.

## 13. Testing and acceptance

**Gate tests** (no live model calls):
- **F0:** spec round-trip; `siteframe` against the 864 Al-Zour rows (0.05 m); contract test covers
  every new route.
- **B1 to B3:** for each builder, bounds, triangle count range, a watertight check where the shape
  is closed, instancing counts, defaults recorded; golden render (rasterizer) within tolerance.
- **A1:**
  - GLB round-trip (node per item, extras equal to the register row, materials);
  - CSV columns in Cowork order;
  - `asset_item` rows;
  - a 2 000-item synthetic plant in under 2 minutes;
  - fallback on a broken item.
- **I1:** a multi-page fixture PDF imports N pages; the unimported scan matches by sha256.
- **R1:** a scripted fake model drives survey → 3 packages (2 in parallel) → merge → cloud check →
  build → finish. Also: budget exhaustion mid-run; stop writes a draft; resume after a simulated
  crash; no prompt or payload in logs.
- **C1:** a synthetic cloud with known tanks, a missing item, an offset item and an unregistered
  cluster.
- **K1:** the scorer on Cowork's own CSV gives 100 %; on a perturbed copy it gives the expected
  numbers.
- **S1 to S3:**
  - vitest for the transform (golden vectors), layer modules and panels;
  - Playwright e2e on a fixture plant model: open the site, toggle layers, search a tag, select,
    edit a height, the GLB swaps;
  - selectors use the Main-navigation links (sidebar redesign).

**Acceptance: Al-Zour (live, `live` marker, run by the coordinator in L1).**

Setup: the project `E:\Asset Inspections\LNG Terminal`, with the five plot-plan PDFs (all pages),
the project point cloud and the ortho. One plant run with default budgets.

**Pass when:**
- at least 95 % of Cowork's 404 tagged items are found with a matching type (type-family match
  accepted for `package`/`other`);
- plan position is within 2 m for items with a footprint over 5 m, and within 5 m otherwise;
- all 8 LNG tanks, both jetty heads, the trestles and all dolphins are present;
- the land/sea outline is within 10 m of Cowork's `landmask.json` (Hausdorff, over the plant
  extent);
- the run ends within budget (≤ 40 M tokens, ≤ 4 h);
- the GLB opens in the Site 3D view over the ortho and cloud, with water and sky.

The report goes to `docs/evidence/2026-10-03-plant-model-g1/` (scorer output, token use per stage,
screenshots).

**Fixtures:**
- `backend/tests/data/plant/kipic_register.csv`: the Cowork CSV, 885 rows.
- `kipic_landmask.json`.
- `cowork_nodes/`: per-type reference meshes extracted from the Cowork GLB.

The Cowork GLB itself (26 MB) stays out of git, under `backend/tests/data/plant/` (git-ignored),
fetched from the artifact by a script.

## 14. Risks

| Risk | Mitigation |
| --- | --- |
| Vision misreads scanned plot plans at small scale | `drawing_zoom` at up to 600 dpi with a plant-grid tick overlay; equipment list read first, so packages know which tags to expect; the scorer shows recall per area, and the prompt is tuned in L1 |
| 40 M tokens not enough for 885 items | budget-out still builds; per-package re-run; per-stage token usage tells where to cut (tile sizes, caching) |
| The cloud is warped (Cowork: ~3 m; tank rows 182 m vs 189 m) | D5: plan from the drawing; offsets are only flagged |
| The cloud z datum differs from plant EL | the `cloud_z_to_el` fit from items with drawing ELs |
| meshopt encoder not available in the frozen sidecar | uncompressed GLB fallback; F0 checks the PyInstaller build |
| Collision with the artifact-port P1 wave (asset_model, engine.ts) | 0017 additive only; a separate `site3d` engine; ping P1's coordinator before merges that touch `asset_model` |
| Parallel sub-runs hit provider rate limits | a concurrency of 4 is configurable; retry with backoff in `llm.complete`; a package failure doesn't fail the run |
