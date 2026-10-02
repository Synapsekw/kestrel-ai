---
type: spec
date: 2026-10-02
status: proposed
tags: [spec, asset-model, bim, agent, confined-space, elios]
related: ["[[2026-09-26-inspection-platform-design]]", "[[2026-09-26-point-cloud-workspace-design]]", "[[2026-09-26-map-workspace-design]]"]
---

# Asset model builder (sub-project M1 of the confined-space mission programme)

## 1. Goal

The operator received a one-off 3D mission report for HCl tank 710-D-130335 (source in
`C:\Users\D\Downloads\source_2`). It was built in Claude Cowork: an agent read the GA drawing,
hand-wrote a 620-line `trimesh` script (`build_model.py`) that modelled the tank part by part,
rendered it headless to check its own work, then aligned ten Elios 3 flights to the model and
built a viewer with synced video, findings and a shell development map. Every step was bespoke
code with the tank's dimensions hard-coded.

The operator wants all of that inside Kestrel, as repeatable features. This spec does two things:

1. it sets out the **programme** (M1 to M6, §3) that ports every capability of the artifact;
2. it designs **M1, the asset model builder**, the prerequisite: the operator chooses drawings,
   point clouds and photos already in a project, an AI agent builds a structured model of the
   asset from them, and the app turns that model into a GLB the operator can review, edit and
   download.

Done means:

1. A project has a new data item kind, **Asset model**, listed with the other data items.
2. **Build with AI…** starts a background run over any mix of the project's drawings, point clouds
   and photos, with Claude, OpenAI or Gemini.
3. The operator watches the run: phase, step count, latest render.
4. The run ends with a versioned **model spec** and its GLB. Every part names the source it came
   from (a drawing region, a cloud measurement or a photo).
5. The operator reviews the model in an asset model workspace, edits any dimension (a new version
   each time), restores or compares versions, and downloads the GLB and the spec.
6. **Refine…** runs the agent again from the current spec plus the operator's notes.
7. Acceptance: the agent rebuilds the HCl tank from its GA drawing within the tolerances of §11.

## 2. Scope

**In:** the asset model data item (three tables, §5); the model spec and the deterministic GLB
builder (§6); the build agent, its tools and its run job (§7); a Gemini adapter for the agent's
provider layer (§7.1); the software rasterizer the agent uses to see its own model (§7.4); the
asset model workspace (§8); the contract additions (§9).

**Out (later stages, §3):** Elios mission import, flight registration, findings on the model, the
shell development map, report sections, video projection and the offline HTML package. Native
DWG import. Arbitrary AI-written code (approach B/C, §4) — not built; revisited only if an asset
falls outside the shape vocabulary.

## 3. The programme

Each stage is its own spec, plan and merge, and each leaves something testable in the installed
app.

| Stage | Operator can, after it | Ports from the artifact |
| --- | --- | --- |
| **M1 Asset model builder** (this spec) | Build, review, edit and download a model of the asset from drawings, clouds and photos | `build_model.py`, `model_meta.json`, the model viewer basics |
| **M2 Elios mission import** | Import a mission folder (`.efly`, `livetraj.csv`, `servo.csv`, LAS, videos) as one item per flight; play a flight in 3D with the drone marker, path, view cone, log-synced video and POIs | `align_flight.py` (minus the tank ray-cast), `flights.js`, the 60 s proxy clips |
| **M3 Registration** | Register flights to each other and to the M1 model, automatically with a 3-point manual fallback and a quality score; one combined mission view | `align_all.py`, `align_pipes.py`, `clouds.py`, generalised |
| **M4 Findings on the asset** | Turn POIs into findings on the model surface, linked to their photo and video moment, with bearing and height | the POI ray-cast, `findings.json`, finding cards |
| **M5 Asset views and report** | Shell development map, nozzle schedule, mission summary, and those as report sections | `summary.py`, `build_report.py` |
| **M6 Polish and export** | f-theta video projection on the model, see-through mode, offline HTML package | the projection shader, `make.py` offline build |

**Dependencies.** M1 and M2 are independent and run in parallel. M3 needs both. M4 needs M3. M5
needs M4. M6 needs M2 (and M4 for its full value). Critical path: M1/M2 → M3 → M4 → M5.

**Shared across the programme.** An **asset frame**: metres, Y up, origin at the asset's base
centre, X towards plant north, Z towards plant east, bearings clockwise from plant north (the
artifact's frame). It is stored with each asset model and needs no GPS. M3 registers clouds and
flights into it; M4 anchors findings in it.

## 4. Decisions

| # | Decision | Why |
| --- | --- | --- |
| D1 | The agent emits a **structured model spec**; the app's own code builds the mesh (approach A). Not AI-written code in a sandbox (B), not Managed Agents (C). | Safe (no arbitrary code runs), deterministic, testable without live calls, provider-neutral (Claude or Gemini), editable afterwards; the per-part spec is what M3/M4 refer to. |
| D2 | Inputs are any mix of **existing** drawings, point clouds and photos. M1 adds no importer. | `app/drawings/` already imports PDF/PNG/JPG/TIF/DXF/LandXML; clouds and photos are data items already. |
| D3 | Asset types are a wide mix (tanks, vessels, boilers, stacks, ducts, culverts), covered by a **shape vocabulary** (§6.2), not per-type templates. | The operator's work spans all of them. |
| D4 | The agent run is a **background job**, not a project-agent chat turn. | Runs last minutes; the UI must never block. |
| D5 | The agent sees its model through a **numpy software rasterizer**, not OpenGL. | Works headless in the frozen sidecar, deterministic, snapshot-testable. |
| D6 | The spec is versioned; every build, refine and manual edit adds a version and none is overwritten. | Review, compare and restore; a failed run leaves a draft instead of nothing. |
| D7 | Default model `claude-opus-5-5`; Anthropic, OpenAI and Gemini selectable per run. | The operator asked for Claude or Gemini; OpenAI comes free with the existing adapter. |

## 5. Data model

Project database, new migration.

**`asset_model`**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | str(36) | |
| `name` | str | |
| `asset_type` | str, nullable | free text, e.g. "vertical tank" |
| `tag` | str, nullable | e.g. `710-D-130335` |
| `status` | str | `empty` (no version yet) \| `ready` \| `building` |
| `current_version` | int, nullable | |
| `captured_on` | date, nullable | for the Data list order |
| `created_at`, `updated_at` | datetime | |

**`asset_model_version`**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | str(36) | |
| `model_id` | FK | |
| `version` | int | 1, 2, … unique per model |
| `spec` | JSON | the model spec (§6) |
| `kind` | str | `agent` \| `manual` \| `draft` (a run that stopped early) |
| `glb_path` | str, nullable | `<project>/asset_models/<model_id>/v<n>.glb`; null until the GLB job finishes |
| `glb_status` | str | `pending` \| `ready` \| `failed` |
| `source_ids` | JSON | the data items the run read: `[{kind, id}]` |
| `run_id` | FK, nullable | the agent run that produced it |
| `note` | str, nullable | the operator's edit note or the run summary |
| `created_at` | datetime | |

**`asset_model_run`**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | str(36) | |
| `model_id` | FK | |
| `job_id` | str | the background job |
| `provider`, `model_name` | str | |
| `mode` | str | `build` \| `refine` |
| `notes` | str, nullable | the operator's instructions |
| `state` | str | `running` \| `finished` \| `stopped` \| `failed` |
| `stop_reason` | str, nullable | `budget` \| `timeout` \| `user` \| `provider_error` |
| `steps` | JSON | `[{n, tool, ok, summary, thumb_path?}]` — tool names and short summaries only |
| `summary` | str, nullable | the agent's `finish` summary |
| `open_questions` | JSON | `[str]` |
| `usage` | JSON | input/output tokens |
| `started_at`, `ended_at` | datetime | |

Logging follows `project_agent`: tool names, states and durations only — never prompts, model
output, tool payloads, keys or SDK exception text. `steps.summary` is app-written text (e.g.
"Added 4 parts"), not model output.

The data-item provider for `asset_model` is added to `app/data_items/providers.py` alongside the
others, ordered the same way.

## 6. The model spec and the GLB builder

### 6.1 Spec shape

Pydantic models in `app/asset_models/spec.py`, mirrored in the contract.

```
AssetSpec
  asset: { tag?, type?, name?, frame_note?, plant_to_true_north_deg?, attributes: {str: str} }
  parts: Part[]

Part
  id: str                 # stable, agent-chosen slug, e.g. "shell_course_1", "N7"
  name: str
  group: Shell | Head | Bottom | Nozzle | Manway | Support | Access | Internal | Lining | Other
  shape: one of §6.2
  params: shape-specific, millimetres and degrees
  placement: { origin_mm: [x, y, z], axis: [x, y, z] (unit, default Y up),
               bearing_deg?, elevation_mm? }      # bearing/elevation for shell-mounted parts
  material: paint | steel | rubber | concrete | grating | galvanised | glass | other
  source: { kind: drawing | cloud | photo | assumed, id?, page?, region?: [x0, y0, x1, y1] (0..1),
            note? }
  confidence: high | medium | low
```

Units are millimetres in the spec (drawings are in mm); the builder emits metres.

### 6.2 Shape vocabulary

| Shape | Params | Covers |
| --- | --- | --- |
| `cylinder` | `id`, `thickness`, `height`, optional `sweep_deg` | shell courses, stacks, ducts, pipe walls |
| `cone` | `d_bottom`, `d_top`, `thickness`, `height` | reducers, hoppers, cone roofs and bottoms |
| `head_torispherical` | `id`, `thickness`, `crown_r`, `knuckle_r`, `facing` up/down | dished ends |
| `head_ellipsoidal` | `id`, `thickness`, `ratio` (2:1 default), `facing` | vessel heads |
| `head_hemispherical` | `id`, `thickness`, `facing` | spheres, hemi heads |
| `flat_plate` | `d` or `w`×`l`, `thickness`, optional `slope` (1:n, cone-up/down) | bottoms, floors, blinds |
| `box` | `w`, `l`, `h` | supports, platforms, rectangular ducts and culverts |
| `nozzle` | `dn`, `od`, `projection`, `flange_od`, `flange_t`, optional `blind` | nozzles and manways (radial on a shell or vertical on a head) |
| `pipe_run` | `od`, `points_mm[]` (joints get a sphere) | internal pipes, dip pipes |
| `lathe` | `profile_mm[[r, y], …]`, `sweep_deg` | anything rotationally symmetric |
| `extrusion` | `outline_mm[[x, z], …]`, `height` | stiffeners, plates, irregular sections |
| `sweep` | `section` (circle/rect), `path_mm[]` | handrails, ladder stringers, cable trays |

Shell-mounted parts (nozzles, manways) are placed by `bearing_deg` and `elevation_mm` on a named
host part; the builder computes the position on the host's outer surface. Head-mounted ones use
plant east/north offsets (`e_mm`, `n_mm`) as on the drawing. Adding a shape later is a new entry in
the vocabulary, its builder function and its tests — nothing else changes.

### 6.3 Validation (`validate`)

Runs on every spec write; errors block the GLB, warnings don't.

- **Errors:** unknown shape or bad params (non-positive dimensions, thickness ≥ radius); duplicate
  part ids; a shell-mounted part whose host doesn't exist; a spec over 2 000 parts.
- **Warnings:** parts whose bounding
  boxes overlap more than 50 % (likely a duplicate); a part with `source.kind = assumed` and
  `confidence = high`.

### 6.4 GLB builder (`app/asset_models/build.py`)

Pure function: `spec → (glb bytes, meta)`. One glTF node per part, named by part id, with
`extras` carrying `name`, `group` and `params` so the viewer and later stages can read them. PBR
materials as in the artifact (sRGB authored, converted to linear). Triangle budget per part scales
with size (segment counts from a chord-error tolerance of 2 mm, capped). `meta` holds the bounds,
the top elevation, the part index, and triangle counts. Uses `trimesh` and `numpy` (`trimesh`
becomes a backend dependency; checked for PyInstaller bundling in planning).

The GLB is written by a short **`asset_model_glb` job** after every new version, so neither an
edit nor a run blocks on mesh generation.

## 7. The build agent

### 7.1 Providers

The run reuses the provider-neutral history and adapters in `app/project_agent/llm.py` (Anthropic
Messages tool use, OpenAI Responses). M1 adds a **Gemini adapter** behind the same `complete`
entry point, with the key in Credential Manager under the existing `KeyStore` (provider name
`gemini`), set from App settings like the others. Errors map to the same fixed texts; SDK messages
are never passed on. Images go to the model as base64 image blocks.

For Anthropic: `claude-opus-5-5`, adaptive thinking, streaming, `effort` high. Model choice per run
in the build dialog; the default comes from the existing provider config.

### 7.2 Run job (`asset_model_run`)

1. Load the sources, the current spec (refine) or an empty one (build), and the operator's notes.
2. Loop: ask the model for the next step; run its tool calls through the tools of §7.3; store
   every step; stream progress events (`phase`, `step`, `thumb`).
3. Every `upsert_parts`/`remove_parts` writes to the working spec only after validation passes.
4. On `finish`: write the working spec as a new `agent` version, start the GLB job, store the
   summary and open questions.
5. On budget, timeout, user stop or provider failure: if the working spec has at least one part,
   write it as a `draft` version; record the stop reason.

**Budget per run:** at most 80 tool calls, a token budget (default 3 M input+output tokens summed over
calls, with Anthropic prompt caching on), at most 40 images sent, 20 minutes wall clock. The model
history is append-only (preserved thinking rejects edited history). One run per asset model at a time; at most
two runs per app at once.

**Prompt.** A system prompt explaining the asset frame, the spec, the shape vocabulary, the
working method (read the title block and nozzle schedule first; build the primary shell; add heads
and bottom; place nozzles from the schedule; check with renders; check against any cloud; finish
with honest open questions), and that every part must name its source. The prompt never contains
keys or file system paths beyond item names.

### 7.3 Tools

All tools are app code; all reads are bounded.

| Tool | Args | Returns | Bound |
| --- | --- | --- | --- |
| `list_sources` | — | the run's drawings (pages, format), clouds (bounds, point count, CRS or local), photos (count, size) | — |
| `drawing_view` | `id`, `region?` (a Drawing row is one page) | PNG of the page or a crop | longest side ≤ 1 600 px |
| `drawing_text` | `id`, `region?` | text spans with positions from a vector PDF or DXF; empty for rasters | ≤ 4 000 spans |
| `cloud_slice` | `id`, `axis` (x/y/z), `at_m`, `thickness_m` | a section image (≤ 1 024 px) and ≤ 5 000 sampled points | reads the run's cloud sample (≤ 2 M points) |
| `cloud_fit` | `id`, `kind` (circle/cylinder/plane), `region` (box) | fitted params, RMS residual, inlier share | ≤ 200 k points |
| `photo_view` | `id`, `region?` | a downscaled JPEG | ≤ 1 600 px |
| `set_asset` | asset fields | updated asset block | — |
| `upsert_parts` | `parts[]` | validation result, part count | ≤ 200 parts per call |
| `remove_parts` | `ids[]` | part count | — |
| `render` | `views[]` (iso / front / side / top / section@bearing / custom) | PNG per view, parts outlined and labelled by id on request | ≤ 4 views, ≤ 1 024 px |
| `compare_to_cloud` | `id`, `transform?` | per-part deviation (median, p95, mm) and overall | ≤ 200 k points |
| `validate` | — | errors and warnings | — |
| `finish` | `summary`, `open_questions[]` | — | — |

`compare_to_cloud` needs the cloud in the asset frame. In M1 the agent supplies the transform
(it can find a tank's axis with `cloud_fit`, as `align_pipes.py` did); M3 replaces this with
proper registration.

### 7.4 Rasterizer (`app/asset_models/raster.py`)

A numpy z-buffer rasterizer: orthographic or perspective camera, flat shading from one light plus
ambient, per-part colour, part outlines from depth and id discontinuities, optional id labels at
part centroids (Pillow). Target: a 1 024 px view of a 200 k-triangle model in under a second on
the operator's machine. Same input, same pixels.

## 8. Asset model workspace (UI)

A new workspace following the point-cloud workspace's layout (`ws-clouds`, Aero glass,
`GlassPanel`s over a full-bleed three.js canvas). UI work loads the design skills, `DESIGN.md` and
`frontend/src/ui/` first; the mockup is made in planning.

| Panel | Position | Contents |
| --- | --- | --- |
| **Model panel** | top left | Picker (name · tag · version) with "New asset model…" and "Details…"; group toggles; optional point-cloud overlay (any ready cloud, using the last run's transform) |
| **View tools** | left palette | Orbit, Pan, **Cut** (vertical plane at a bearing), **Levels** (elevation rings), **Head off**, Fit **F**, presets **Alt+1–4** as in the clouds workspace |
| **Inspector** | right | Tabs **Parts** (grouped tree; selection syncs with 3D) · **Part** (editable params in mm, placement, notes, source link that opens the drawing crop beside the view, deviation if known) · **Versions** (list, kind, restore, compare two: parts added/removed/changed) · **Run** (steps, summary, open questions, usage) |
| **Build bar** | bottom | **Build with AI…** / **Refine…** → dialog: source picker (drawings, clouds, photos), provider/model, notes. While running: phase, step n/80, latest render thumbnail, **Stop** |
| **Actions** | top right | Download GLB, Download spec (JSON) |

**Editing** a part saves a `manual` version and starts the GLB job; the viewer swaps to the new GLB
when it is ready and keeps the camera.

**States.** No asset models: `EmptyState` "Build a 3D model of the asset from its drawings, scans
and photos". A model with no version and a run in progress: the progress card. A failed or stopped
run: its reason, **Try again**, and the draft version if one was written.

## 9. Contract

Added to `contract/openapi.yaml` first, with `contract/client/schema.d.ts` regenerated in the same
change.

- `GET/POST /projects/{pid}/asset-models`, `GET/PATCH/DELETE /projects/{pid}/asset-models/{id}`
- `GET /projects/{pid}/asset-models/{id}/versions`, `GET …/versions/{n}`,
  `POST …/versions` (manual edit: a full spec + note), `POST …/versions/{n}/restore`
- `GET …/versions/{n}/glb` (file); the spec download is the version detail's `spec`, saved by the UI
- `POST /projects/{pid}/asset-models/{id}/runs` (start: mode, sources, provider, model, notes) →
  job; `GET …/runs`, `GET …/runs/{rid}`, `POST …/runs/{rid}/stop`
- `GET …/runs/{rid}/steps/{n}/thumb` (the step's render thumbnail), `GET …/runs/{rid}/overlay/{cloudId}`
  (≤ 300 k float32 points in the asset frame, written by `compare_to_cloud`)
- Schemas: `AssetModel`, `AssetModelVersion`, `AssetSpec`, `AssetPart` (with a discriminated
  `params` per shape), `AssetModelRun`, `AssetModelRunStart`.
- A new `KeyedProviderName` (`openai`, `anthropic`, `gemini`) types `/providers` and runs; detection keeps
  `ProviderName` (`openai`, `anthropic`), so Gemini is offered for asset model runs only.

## 10. Budget and execution DAG

**Background jobs:** the agent run (≤ 20 min, cancellable, progress events) and the GLB build.
**Bounded reads:** every tool in §7.3 states its cap; no tool loads a full cloud, a full image set
or an unscaled page into memory. Each run samples a cloud once (≤ 2 M points, one streamed pass).

**Units**

| Unit | What | Needs |
| --- | --- | --- |
| U1 | Spec models, shape vocabulary, validation, GLB builder (pure Python) | — |
| U2 | Rasterizer, `render`, `compare_to_cloud` | U1 |
| U3 | Contract, migration, tables, data-item provider, models/versions API, GLB job | — (contract first) |
| U4 | Look tools: `list_sources`, `drawing_view`, `drawing_text`, `cloud_slice`, `cloud_fit`, `photo_view` | — |
| U5 | Run job, build tools, prompt, Gemini adapter, runs API | U1, U3, U4 |
| U6 | Workspace: viewer, panels, Parts/Part/Versions tabs, manual edit | U3 |
| U7 | Build dialog, run progress, Run tab, Gemini key in App settings | U5, U6 |

**Batches:** 1 = U1, U3, U4 · 2 = U2, U5, U6 · 3 = U7. Critical path U1 → U5 → U7. U2 can land
after U5 starts: U5's fake-model tests don't need real renders.

## 11. Testing and acceptance

**Gate tests (no live model calls).**

- U1: each shape's bounds and volume against hand-computed values; bearing/elevation placement in
  the asset frame; every validation rule; GLB round-trip (node names, extras, materials) with
  `trimesh` loading the output.
- U2: rasterizer snapshot tests within a pixel tolerance; determinism; `compare_to_cloud` on a
  synthetic cylinder cloud with known offset.
- U3: API and migration tests; versions never overwritten; GLB job states.
- U4: each tool's caps enforced; crops and slices correct on small fixture drawings (vector PDF,
  raster) and a fixture cloud.
- U5: a **scripted fake model** replays a fixed tool-call sequence — finish writes an `agent`
  version; budget, timeout and stop write a `draft`; invalid `upsert_parts` returns a tool error
  and the loop continues; no prompt or payload reaches the log.
- U6/U7: Vitest for panels and edit flow; Playwright e2e against the fake model (build → watch →
  version → edit → new GLB → download).

**Live test (`live` marker, outside the gate).** One run of the real default model on the
acceptance drawing.

**Acceptance — the HCl tank.** The operator supplies GA drawing P-00212-DW-MD-143TD1 rev 3 (as
built) and imports it as a Drawing. A build run on that drawing alone must give, against the
values in `build_model.py` / `model_meta.json`:

- internal diameter 4 000 mm and shell height 8 000 mm (±5 mm);
- three shell courses at 0–3 000, 3 000–5 500, 5 500–8 000 mm (±10 mm);
- a torispherical head with crown and knuckle radii within 5 %;
- all 17 nozzles and manways of the schedule (N1, N1B, N2–N6, N6B, N7–N13, M1, M2), bearings
  within ±2°, elevations within ±25 mm;
- every part with a non-`assumed` source.

With the tank's Elios cloud added to the run, the shell's deviation median is under 15 mm.

## 12. Risks

| Risk | Mitigation |
| --- | --- |
| The agent misreads small drawing text | `drawing_text` gives exact vector text where the PDF has it; `drawing_view` crops let it zoom; open questions surface doubts; manual edit fixes the rest |
| `trimesh` or the rasterizer bloats or breaks the frozen sidecar | Checked in planning against the PyInstaller build before U1 is done |
| An asset needs a shape the vocabulary lacks | `lathe`, `extrusion` and `sweep` cover most; a new shape is a contained addition (§6.2) |
| Gemini tool-use behaviour differs | The fake-model tests pin the loop; the live test runs per provider when its key is present |
| Run cost | Token budget per run, shown usage per run, default limits in App settings |

## 13. Amendments made while planning (2026-10-02)

The implementation plan (`docs/superpowers/plans/2026-10-02-asset-model-builder.md`) found these;
the sections above are updated to match.

- No server-side octree reader exists, so cloud tools read a per-run sample (≤ 2 M points, one
  streamed laspy pass, cached as `runs/<runId>/cloud_<cloudId>.npz`).
- A `Drawing` row is one page; `drawing_view` reads its rendered `plan.tif`, `drawing_text` reads the
  source PDF's text layer (pypdfium2) or DXF text (ezdxf).
- trimesh does not export per-node extras; the builder patches the GLB's JSON chunk.
- `pipe_run` has no `bend_r`; the "nozzle off its host surface" warning is dropped (hosted parts are
  placed on the surface by construction).
- Run budget 3 M tokens (not 400 k), 40 images, append-only history.
- The run checkpoints `working.json` after each build tool; the restart sweep turns it into a draft.
- `AssetModelRun.comparison` holds the last `compare_to_cloud` result; a `get_spec` read tool is added.
- `asset_model.status` maps to the data item status `importing` (building) or `ready` (ready, empty).
- `KeyedProviderName` for `/providers` and runs; the default Anthropic model becomes `claude-opus-5-5`.
