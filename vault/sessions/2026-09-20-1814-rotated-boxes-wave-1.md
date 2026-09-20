---
type: session
date: 2026-09-20-1814
branch: main
trigger: wrapup
status: complete
tags: [session]
related:
  ["[[2026-09-20-gotcha-openapi-default-makes-a-field-required-in-typescript]]",
   "[[2026-09-20-gotcha-symmetric-fixtures-make-tests-that-cannot-fail]]"]
---

# 2026-09-20-1814 rotated boxes wave 1

## What changed

Wave 1 of rotated bounding boxes (OBB), spec
`docs/superpowers/specs/2026-09-20-rotated-boxes-design.md`, plan
`docs/superpowers/plans/2026-09-20-rotated-boxes-wave-1.md`. Built in worktree
`.claude/worktrees/rotated-boxes` on `task/rotated-boxes`, merged to `main` as **`249262b`**
(no-ff), worktree removed and branch deleted. 18 commits, `bb99feb`..`03fce8f`, 40 files,
+1521/−102.

`16f8dee` also appears in the range — that is a **parallel session's** vault commit that `main`
gained mid-block, not this block's work.

**Shipped.** Every box carries an `angle`: degrees, about the box centre, normalised to `[0, 180)`.
`x, y, w, h` still describe the *unrotated* box, so an `angle: 0` box means exactly what it always
did and migration `0003` is a bare default-0 column add with no backfill.

- Contract, DB, API — `bb99feb`, `6efa0b7`, `9913711`, `2fe22e7`. Migration `0003_box_angle`,
  `angle` through `openapi.yaml` + regenerated client, normalise-on-write, and the deliberate
  clamping asymmetry (spec §3.3): angle 0 keeps the fully-inside rule, a rotated box needs only its
  centre in frame.
- Geometry, twice — `backend/app/geometry.py` and `frontend/src/editor/geometry.ts`
  (`5da5ca1`), pinned to `contract/fixtures/oriented-boxes.json` so the two languages cannot drift.
- Canvas — `87e3044`, `7bafd26`, `dd8db94`, `633b41a`. Centre-pivoted Konva node, rotate handle,
  Shift-gated 15° snaps, `Shift+Left/Right` 1° nudges, label anchored to the top-most corner.
- Exports — `8ef08e1`, `c80d319`, `d61367a`. CSV `angle` column; COCO keeps an axis-aligned `bbox`
  and adds a 4-corner `segmentation` only when rotated; HTML draws the quad; YOLO writes the
  envelope.
- Middle-button panning — `03fce8f`, added after the review, on operator request.

**Key decisions** (18 recorded during the run; these are the ones with consequences):

1. **Freeze writes the envelope, not the unrotated rect** (`b9d37e3`). The whole-branch review found
   `_frozen_boxes` dropping the angle, so a 60x20 box at 45° froze as a 60x20 upright rectangle that
   overlaps the machine only in the middle. That is a **regression this branch introduced** — before
   it, no box had an angle, so the unrotated rect was always right. Resolution: the frozen row keeps
   the `angle` and a shared `detect_boxes()` applies `aabb_of` at label-write time. Freezing the
   envelope instead would have been lossy and left wave 2 unable to materialise real OBB labels from
   an already-frozen dataset.
2. **`BoxCreate/Update.x,y` lost their `ge=0`** (`2de5bed`). Pydantic rejected negative `x` before
   the relaxed `_check_bounds` ran, so a rotated box could overhang the right edge but not the left.
   Every test and the draft walkthrough used the right edge, which is why eight task reviews missed
   it.
3. **Contract bounds came off the request schemas** (`6efa0b7`) — they asserted a 422 the server
   never sends, since out-of-range angles are normalised, not rejected.

## Why

An excavator at 40° to the frame fills roughly half its axis-aligned box with gravel, so an upright
label teaches the detector that "excavator" includes a lot of ground. Rotation is the fix. Wave 1
deliberately stops short of training on the angle — that is wave 2 — but stores, draws and exports
it, and says so in the UI so nobody spends a day rotating labels under a wrong assumption.

## Open threads

- **`main` is 24 commits ahead of `origin/main` and unpushed.** 19 are this block's. This makes the
  existing §5 "unpushed commits" entry substantially worse, and it is the thing to decide first.
- **Wave 2 is unwritten.** The spec's §5 describes it (OBB label format, `yolo11*-obb` starter
  weights, training task guards, `result.obb` parsing) but no plan exists. The packaging cost of the
  OBB checkpoints (spec §5.3) is still unmeasured.
- **13 deferred minors**, triaged by the whole-branch review. Two worth acting on: nothing tests
  **resize+rotate in one gesture** — `BoxLayer.test.tsx` mocks react-konva wholesale, so `commit()`
  has no unit coverage at all and the maths was verified by hand instead; and `_dashed_polygon`
  changed the dash phase on *unrotated* HTML thumbnails (visual only, unpinned by any test).
- **Spec §4.7 promised an angle in the HTML report's row detail and it was not built** — correctly,
  because that report has no per-box rows, only cards and count tables. CSV is the only export where
  the number is readable. Recorded so it is not later logged as a missing wave-1 item.
- **Three tests shipped during this block that could not fail**, each caught in review and fixed.
  See [[2026-09-20-gotcha-symmetric-fixtures-make-tests-that-cannot-fail]].
- The `task/smoke-check` worktree and branch were deliberately left untouched — they belong to the
  paused round trip in §5, not to this block.

## How to test

1. Open a project with imported images and press **E** on one.
2. Drag to draw a box — upright, as before.
3. Hold the **middle mouse button** and drag — the image pans, from anywhere including over a box,
   and no box gets selected.
4. Click a box; a **rotate handle** appears above it. Drag it — the box turns about its centre and
   the class label follows its highest corner.
5. Hold **Shift** while dragging the handle — it snaps every 15°.
6. Resize a rotated box from a corner — it keeps its angle and stays put.
7. **Shift+Right** ×4 turns it 4° clockwise; **Shift+Left** turns it back. **Ctrl+Z**/**Ctrl+Y**
   undo and redo the rotation. **Ctrl+D** duplicates at the same angle.
8. **Ctrl+Right** then **Ctrl+Left** — the rotation persisted across the image change.
9. Rotate a box off the **right** edge — it stays. Repeat on the **left** edge — also stays. Drag
   until the *centre* leaves frame — it is pulled back.
10. Export results: `detections.csv` has an `angle` column after `h`; `labels_coco.json` gives a
    rotated annotation an axis-aligned `bbox` **and** an 8-number `segmentation` (an unrotated one
    gets `bbox` only); `labels_yolo/*.txt` carries the envelope; the HTML report draws tilted quads.
11. Open **New dataset** — the info line reads "a rotated box is widened to the smallest upright box
    that contains it."

Steps 3 and 6 are the only ones that cannot be covered by the suite: the canvas tests mock Konva, and
middle-click autoscroll suppression only proves out in the packaged build.

## Next session entry point

Decide the push (§5). Then either write the wave-2 plan from spec §5, or clear the two deferred
minors worth clearing. Gate on merged `main` was green at wrap-up: contract check, ruff, 620 pytest,
frontend lint, 497 vitest, frontend build; `cargo test` skipped, sidecar absent.
