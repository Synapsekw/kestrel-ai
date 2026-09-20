---
type: spec
date: 2026-09-20
status: proposed
tags: [spec, annotation, training, obb]
related: ["[[2026-09-17-kestrel-ai-app-design]]", "[[2026-09-19-site-office-ui-design]]"]
---

# Rotated bounding boxes (oriented boxes, OBB)

## 1. Goal

An annotator can rotate a box while labelling, and that rotation survives all the way to a trained
model and back: rotated labels materialise in YOLO-OBB format, an OBB checkpoint trains on them,
and inference returns rotated proposals.

Done means: draw a box, rotate it onto a skewed excavator, freeze an OBB dataset, train, run the
result back over an image, and see rotated proposals whose angles match the machines.

Aerial frames are the whole point of this app. A tracked excavator at 40 degrees to the frame fills
roughly half of its axis-aligned bounding box with background, so an axis-aligned label teaches the
detector that "excavator" includes a lot of gravel. Rotation is the fix.

## 2. The decision that shapes everything: rotation must reach the model

Rotation is cheap on the canvas and expensive in the pipeline, and it is tempting to ship only the
canvas. That would be a lie to the operator.

`materialise.py::_label_text` writes the 5-number detect format. If it keeps doing so, a rotated
box is flattened to its axis-aligned envelope at freeze time, and the label written to disk is
*exactly* the loose box the annotator was trying to avoid. The effort spent rotating would buy
nothing, while the UI implied it bought something.

So the feature is defined as the full path or nothing:

| | Detect (today) | OBB (this spec) |
| --- | --- | --- |
| Label line | `class cx cy w h` | `class x1 y1 x2 y2 x3 y3 x4 y4` |
| Checkpoint | `yolo11{n,s,m}.pt` | `yolo11{n,s,m}-obb.pt` |
| Ultralytics task | `detect` | `obb` |
| Result field | `result.boxes` | `result.obb` |

It ships in two waves (section 7) so the canvas is usable early, but wave 1 is explicitly not the
finished feature and says so in the UI.

## 3. Data model

### 3.1 One field

`Box` gains **`angle`**: degrees, rotating the box about **its own centre**, normalised to
`[0, 180)`.

- **Degrees, not radians** — it is shown to a person and typed by a person.
- **About the centre, not the corner** — `x, y, w, h` keep their exact current meaning (the
  unrotated box). Konva rotates about a node's origin, so the renderer sets
  `offsetX={w/2} offsetY={h/2} x={cx} y={cy} rotation={angle}` to move the pivot.
- **`[0, 180)`, not `[0, 360)`** — a rectangle has 180 degree symmetry, so 190 and 10 describe the
  same shape. Wrapping at 180 is visually seamless and removes a whole class of "the same box has
  two representations" bugs from comparison, undo and dedup.

An `angle: 0` box is byte-identical to what is stored today. That is the property the whole
migration story rests on.

### 3.2 Migration

`backend/app/db/migrations/versions/0003_box_angle.py`: add `angle` to `box` as
`Float, nullable=False, server_default="0"`. No backfill pass, no data rewrite, no iteration over
existing rows — the column default does the work.

This matters for the startup invariant in `AGENTS.md`: a migration that cannot fail on user data is
a migration that cannot be the reason the app will not open.

### 3.3 Clamping — a deliberate asymmetry

`geometry.ts::clampRect` (`frontend/src/editor/geometry.ts:73`) currently forces a box fully inside
the image. That rule cannot hold for rotated boxes: a truck half out of frame at 30 degrees is a
legitimate annotation, and forcing its rotated corners inside the image would shrink or shove the
box every time the annotator rotated it near an edge.

The rule:

| Angle | Clamp |
| --- | --- |
| `0` | exactly as today — `clampRect` unchanged, existing tests stand |
| non-zero | the box **centre** is clamped into the image; corners may overflow |

At materialisation, normalised corner coordinates are clipped to `[0, 1]`. Ultralytics tolerates
this and it is the correct meaning of a truncated object.

This asymmetry is intentional and is recorded here so it is not "fixed" later by someone unifying
the two paths. Unifying them would change behaviour for every box that already exists.

## 4. Wave 1 — rotate, store, round-trip

### 4.1 Contract

`contract/openapi.yaml`:

- `Box`: `angle: { type: number, minimum: 0, exclusiveMaximum: 180 }`, added to `required`.
- `BoxCreate`, `BoxUpdate`: `angle` optional, same bounds, default `0`.
- Examples updated to carry `angle`.

`contract/client/schema.d.ts` is regenerated and committed **in the same change** — the invariant in
`AGENTS.md`. Spectral lint and `pnpm -C contract check` gate it.

### 4.2 Backend

| File | Change |
| --- | --- |
| `app/db/models.py` | `angle` column on `Box` (`:58`) |
| `app/db/migrations/versions/0003_box_angle.py` | new |
| `app/datasets/schemas.py` | `angle` on the box create/update models, bounds `0 <= angle < 180` |
| `app/datasets/boxes.py` | accept and persist `angle`; normalise on write so `180` and `-10` cannot be stored |

Normalisation lives on the write path, not only in the UI. A value arriving from the mock server,
a test, or a future import must land normalised.

### 4.3 Geometry (`frontend/src/editor/geometry.ts`)

New pure functions, each independently testable:

```
export interface OrientedRect extends Rect { angle: number }

centreOf(r: Rect): Point
cornersOf(r: OrientedRect): [Point, Point, Point, Point]   // clockwise from top-left, image px
aabbOf(r: OrientedRect): Rect                              // axis-aligned envelope
normaliseAngle(deg: number): number                        // -> [0, 180)
clampOriented(r: OrientedRect, image: Size): OrientedRect  // centre-in-image (section 3.3)
orientedEquals(a: OrientedRect, b: OrientedRect, eps?): boolean
```

`rectEquals` grows an angle term via `orientedEquals`; the existing `rectEquals` stays for the
angle-free call sites so nothing axis-aligned changes meaning.

### 4.4 Canvas (`frontend/src/editor/BoxLayer.tsx`)

- `Transformer`: `rotateEnabled={true}`, `rotationSnapTolerance` tuned so an unsnapped drag stays
  free, and `rotationSnaps={shiftHeld ? [0,15,30,...,345] : []}`.

  **How Shift is tracked:** the store already carries `spaceHeld` (`store/editor.ts:30`, set by
  `setSpaceHeld` at `:193`) for the pan modifier. `shiftHeld` is added the same way, from the same
  keydown/keyup path, so there is one established pattern for modifier state rather than two.

  The snap list runs to 345 even though `angle` is normalised to `[0, 180)`: Konva's node rotation
  is free to pass through 180 mid-drag, and normalisation happens once on commit. The node and the
  stored value are allowed to disagree during a drag and only during a drag.
- Each `Rect` gains the centre-pivot offset (section 3.1) and `rotation={b.angle}`.
- `commit()` (`BoxLayer.tsx:59`) reads `node.rotation()` alongside position and scale, normalises it,
  and passes an `OrientedRect` through.
- `syncNode()` (`:50`) restores `rotation` too, so a failed save snaps the node back to the stored
  angle exactly as it already does for position.
- The class label currently sits at `(b.x, b.y - 14px)`. For a rotated box that can land inside or
  under the shape. It anchors to the **top-most corner** from `cornersOf`, offset outward along the
  screen vertical, so it stays legible at any angle.
- The live `draft` rectangle is always angle 0 — you draw axis-aligned and then rotate.

### 4.5 Hotkeys (`frontend/src/editor/hotkeys.ts`)

Bare single characters are class hotkeys (`hotkeys.ts:72`), so rotation keys must carry a modifier.
`Shift+ArrowLeft/Right` currently falls through to `null` and is free:

| Keys | Action |
| --- | --- |
| drag the rotate handle | rotate the selected box |
| `Shift` while dragging | snap to 15 degrees |
| `Shift+Left` / `Shift+Right` | nudge the selected box by -1 / +1 degree |

New action `{ type: "rotate"; delta: number }`, wired through `useEditorHotkeys` and
`useEditorActions`, and added to `HOTKEY_HELP`.

### 4.6 Commands and history

`cmdUpdateRect` (`frontend/src/editor/commands.ts:102`) takes `OrientedRect` for both `before` and
`after`. Undo and redo then work unchanged — the existing history stores the before/after pair and
knows nothing about the shape's fields.

`cmdDuplicate` copies the angle. `duplicateOffset` keeps its axis-aligned offset behaviour and
carries the angle through untouched.

### 4.7 Exports

| Format | Change |
| --- | --- |
| `app/exports/csv_out.py` | new `angle` column |
| `app/exports/html_out.py` | angle in the row detail; the overlay draws the rotated quad |
| `app/exports/coco_out.py` | `bbox` stays the axis-aligned envelope **and** `segmentation` gains the 4-corner polygon |
| `app/exports/rows.py` | angle carried into the shared row shape |

COCO has no rotated-box standard. Envelope-plus-polygon is the conventional encoding: every COCO
consumer keeps working off `bbox`, and anything that understands `segmentation` recovers the exact
rotated shape. Nothing is lost and nothing breaks.

### 4.8 The honest caveat

Datasets still freeze axis-aligned in wave 1. The dataset creation screen states this where it is
read *before* the work, not after — one line saying rotation is stored but not yet trained on, and
naming wave 2. The line is deleted in wave 2.

## 5. Wave 2 — rotation reaches the model

### 5.1 Dataset task

`Dataset` gains `task: detect | obb`, chosen at freeze, stored on the row, shown on the dataset
detail screen. Contract, migration (`0004_dataset_task`, default `detect`) and schema follow the
same shape as section 3.2.

### 5.2 Label materialisation

`app/datasets/materialise.py::_label_text` (`:72`) branches:

- **`obb`** — `class x1 y1 x2 y2 x3 y3 x4 y4`, each coordinate normalised by width/height and
  clipped to `[0, 1]`, corners clockwise from the rotated top-left. A Python `corners_of` mirrors
  the TypeScript one; the two are pinned to the same golden fixtures so they cannot drift.
- **`detect`** — unchanged 5-number envelope. The freeze **warns** with a count when it is
  discarding non-zero angles, rather than silently degrading the labels.

`data_yaml` is unchanged; ultralytics selects the task from the checkpoint.

### 5.3 Starter weights

`app/training/starter.py::CATALOGUE` gains `yolo11n-obb`, `yolo11s-obb`, `yolo11m-obb`.

**Packaging cost:** these are real files in `starter_weights/`, roughly doubling that part of the
installer. `list_starters` already tolerates a missing `.pt`, so if the installer size is
unacceptable the fallback is to ship the nano OBB checkpoint only and fetch the other two on
demand. Decide with the measured number, not in advance.

### 5.4 Training

`app/training/` refuses a mismatch before the subprocess starts:

- OBB dataset + detect weights -> `AppError`, naming both.
- detect dataset + OBB weights -> `AppError`, naming both.

Without this, the mismatch fails deep inside ultralytics with an error the operator cannot act on.

The `aerial` augmentation preset (`app/training/presets.py:13`) uses `degrees: 90.0`. Ultralytics
rotates OBB labels with the image, so the preset stays valid — but this is **verified empirically on
the first OBB run**, not assumed.

### 5.5 Inference

`app/providers/base.py::Detection` gains `angle: float = 0.0`.

`app/providers/local_yolo.py::_from_result` (`:99`) reads `result.obb` when the result carries one
and `result.boxes` otherwise, so a detect model and an OBB model both work through the same path.
OpenAI and Anthropic providers return `angle: 0.0` — they describe axis-aligned regions and will not
be asked to do otherwise.

**Tile dedup:** `tiling.py::iou` (`:81`) is axis-aligned and is used by `nms_per_class` and
`not_covered_by`. Rotated boxes dedup on their **axis-aligned envelopes**. True rotated IoU is a
convex-polygon intersection, and at an NMS threshold of 0.5 the envelope approximation picks the
same winners. This is a deliberate approximation, recorded so it is not mistaken for an oversight.

## 6. Budget and execution DAG

Required by `AGENTS.md` section 6.

### 6.1 Budget

**Background jobs:** unchanged. Freeze, training, inference and export are already background jobs
with progress and stay that way. This spec adds no new long operation.

**Bounded reads:** unchanged. Corner computation is O(4) per box and runs inside the existing
per-image streaming loop in `materialise.py`. No image set is loaded into memory; no new collection
is materialised.

**Hot path:** the canvas computes corners per visible box per frame. That is already the cost of
drawing them, and `visibleBoxes` already bounds the set.

### 6.2 DAG

```
Wave 1
  A. contract + schema.d.ts + migration 0003      [bottleneck - nothing starts before it]
       |
       +-- B. backend boxes/schemas validation     \
       +-- C. geometry.ts (pure fns + tests)        > parallel
       +-- D. exports (csv, html, coco, rows)      /
                |
                +-- E. BoxLayer rotate + label anchoring   [critical path, needs C]
                +-- F. hotkeys + useEditorActions          [needs C]
                +-- G. commands.ts OrientedRect            [needs C]

Wave 2
  H. dataset task field + migration 0004           [bottleneck]
       |
       +-- I. materialise OBB label format + corners_of parity tests  \
       +-- J. starter OBB weights + packaging                          > parallel
       +-- K. training task mismatch guards                           /
       +-- L. Detection.angle + local_yolo result.obb + NMS note
```

Critical path: `A -> C -> E`. Wave 2's critical path is `H -> I`.

## 7. Waves and what each one delivers

| Wave | Delivers | Operator sees |
| --- | --- | --- |
| 1 | angle through DB, contract, canvas, exports | rotate a box, it saves, it survives reload and export; datasets still freeze axis-aligned and the UI says so |
| 2 | OBB datasets, OBB training, rotated inference | freeze an OBB dataset, train it, get rotated proposals; the wave 1 caveat line is deleted |

Each wave merges green through the full gate in `AGENTS.md` section 4, from its own worktree, and
ends with a numbered "how to test this" walkthrough.

## 8. Testing

Full gate both waves. New tests:

**Backend**
- Migration: an existing project DB opens and every box reads `angle == 0`.
- `corners_of` property tests (hypothesis is already a backend dependency): rotating by 0 returns
  the axis-aligned corners; rotating by `a` then `-a` round-trips within epsilon; the envelope of
  the corners contains the original box for every angle.
- `_label_text` golden files: one detect fixture, one OBB fixture, one mixed-angle fixture proving
  the detect branch warns.
- Mismatch guards raise `AppError` for both directions (section 5.4).
- `Detection.angle` defaults to 0 for the OpenAI and Anthropic providers.

**Frontend**
- `geometry.test.ts`: `normaliseAngle` wrapping at the boundaries, `cornersOf` against hand-computed
  fixtures shared with the Python tests, `clampOriented` centre behaviour at all four edges.
- `BoxLayer`: a rotate-transform commits the normalised angle; a failed save re-syncs the node's
  rotation; the label anchors to the top-most corner at 0, 45, 90 and 135 degrees.
- `hotkeys.test.ts`: `Shift+Left/Right` produce the rotate action and do **not** shadow any class
  hotkey; every existing binding still resolves unchanged.
- `commands.test.ts`: undo and redo of a rotation restore the prior angle.

**Cross-language**
- One fixture file of `(x, y, w, h, angle) -> corners` cases, read by both the Python and the
  TypeScript corner tests. Two implementations of the same maths in two languages drift silently
  otherwise, and the symptom would be labels that are subtly wrong on disk.

## 9. Consequences the operator should know

1. **Existing trained models cannot propose rotated boxes.** Any detect model already in the
   registry returns `angle: 0` forever. Rotated proposals require training an OBB model on rotated
   data, so already-annotated images must be revisited if their boxes should be tight.
2. **A dataset is one task or the other.** An OBB dataset cannot train a detect checkpoint and vice
   versa; the guards in section 5.4 make that a clear error rather than a confusing one.
3. **Installer grows** by the OBB starter weights, unless the fetch-on-demand fallback in section
   5.3 is taken.

## 10. Out of scope

- **Axis-first drawing** (drag the long axis, then widen). Faster per box on a site full of
  differently-headed machines, and worth revisiting once rotation is proven end to end, but it is a
  new drawing interaction and does not belong in the same change as the data model.
- **Polygon / segmentation annotation.** Strictly more expressive than a rotated box and a
  different task type again. Not this spec.
- **Rotated IoU for NMS.** See section 5.5 — the envelope approximation is deliberate.
- **Auto-orientation** (proposing an angle from image gradients). Speculative.
