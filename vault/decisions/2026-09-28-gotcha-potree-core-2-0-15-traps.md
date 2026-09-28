---
type: adr
date: 2026-09-28
status: accepted
tags: [decision, gotcha]
related: []
---

# 2026-09-28-gotcha-potree-core-2-0-15-traps

## Context

C-G's acceptance runs on the real chimney cloud (21.7 M points, Edge on an RTX 5070 Ti) found three
defects in the point-cloud workspace. Every one came from how potree-core 2.0.15 behaves with the
Potree 2.0 octree format (`metadata.json`), which is the format every Kestrel cloud uses. None showed
in the unit tests, and two did not show in the e2e either: the synthetic e2e octree has one node,
which is loaded before any capture, and nobody had compared the pixels of two colour modes.

### Trap 1: `newFormat: true` makes every colour mode draw RGB

`PointCloudOctree` builds its material as `new PointCloudMaterial({ newFormat: true })` whenever the
geometry is a v2 `OctreeGeometry`. `applyDefines()` then adds `#define new_format`, and the vertex
shader chooses the colour like this:

```glsl
#ifdef new_format
    vColor = rgba;
#elif defined color_type_rgb
    vColor = getRGB();
#elif defined color_type_height
    vColor = getElevation();
...
```

The `new_format` branch wins over every `color_type_*` branch. So Elevation, Intensity and Class
recompiled the program with the right define and still drew the `rgba` attribute. **Colour by
silently did nothing.** `newFormat` is a plain field (no shader-update decorator), so changing it
also needs an explicit `updateShaderSource()`.

### Trap 2: `OctreeGeometryNode.load()` returns `undefined`

The 2.0-format node's `load()` has no return statement. potree's `nodeLoadPromises` is therefore
`[undefined, …]`. The report-view capture's `waitForNodes` raced
`Promise.allSettled(nodeLoadPromises)` against a 50 ms timer. `allSettled([undefined])` settles in
the microtask queue, so the race won before the timer every time, and the loop never left the
microtask queue. The fetch responses and decoder-worker messages that would finish the loads are
macrotasks, so they never ran. Instrumented on the chimney: 33 509 steps in 10 s, every one with the
same 3 nodes loading, then the timeout and `render.complete: false`. **Every capture of a view that
was not already loaded took 10 s and was incomplete.**

### Trap 3: potree's `pick` runs `findHit` over the whole window

potree's pick path runs `findHit` over every pixel of the read-back (`Math.pow` per pixel, and it
zeroes every alpha) to find its own hit, even when the caller decodes the pixels itself. The pin
occlusion pass and `pickAllPoints` never use that hit. Under the CPU profiler it cost 19-21 ms per
676² window, about 40 of the 46 ms settle pass, which broke the §13 "occlusion ≤ 40 ms" target.

## Decision

1. `usesNewFormat(colour, octreeV2)` = `octreeV2 && colour === "rgb"`
   (`frontend/src/clouds/viewer/materialOptions.ts`). `engine.ts` remembers `octreeV2` from the
   loaded material, sets `material.newFormat` from it on every `applyMaterial()`, and calls
   `updateShaderSource()` when it changed, before it sets `pointColorType`.
2. `waitForNodes` (`frontend/src/clouds/viewer/capture.ts`) always waits through a timer:
   `Promise.race([Promise.allSettled(loads).then(() => clock.sleep(0)), clock.sleep(WAIT_STEP_MS)])`,
   `WAIT_STEP_MS = 16`. It never trusts `nodeLoadPromises` to be real promises.
3. The `findHit` wrapper in `withPickerSpy` (`frontend/src/clouds/viewer/pickAll.ts`) keeps the
   read-back and returns `null` without running potree's scan, and drops potree's per-pick copy.

## Rationale

- Each fix is local to Kestrel's own wrapper and leaves potree-core unpatched, so an upgrade does not
  have to carry a fork.
- Fix 1 keeps `new_format` for RGB because `getRGB()` reads the old `color` attribute, which a v2
  geometry does not have; only the `rgba` path draws RGB there. Elevation, Intensity and Class read
  attributes that do not depend on the format.
- Fix 2 yields to the event loop even when the loads look settled, so the fix holds whatever potree
  puts in `nodeLoadPromises`. The timeout path is unchanged, so a capture that truly times out still
  says `complete: false`.
- Fix 3 removes work nobody used. Measured on the chimney: the profiled settle pass fell from 45-89
  ms to 10-14 ms, and hover picks did not change.

## Consequences

- Positive: Colour by recolours the cloud; captures take 221-874 ms on the chimney with every view
  `complete: true` (was 10.3-10.9 s, all incomplete); occlusion meets its budget.
- Negative: fix 1 reads potree-core's internal `material.newFormat` at load; if a potree-core update
  renames it, the e2e colour tests catch it. Fix 3 depends on potree calling a function named
  `findHit`. Recheck all three on any potree-core upgrade.
- Test guard: `e2e/clouds.spec.ts` compares pixel halves in Class, Elevation and back to RGB;
  `viewer/capture.test.ts` has two "yields to the event loop" cases and
  `e2e/cloud-report-views.spec.ts` starts a capture while a node is loading;
  `viewer/pickAll.test.ts` asserts `findHit` is not called.
- A one-node synthetic octree hides load-timing bugs. Real-data runs are needed for them.

## Related

- Commit `ca2173c73a3d6c78b9c9c6e4df55b8506890aede` — fix(clouds): colour modes draw their colours
  on a v2 octree (C-G Task 15)
- Commit `7ddd90362d721723fa1e9ebe8fc34bf6639963bb` — fix(clouds): the report-view capture yields to
  the event loop while it waits for nodes (C-G Task 16)
- Commit `53736c91ec70c962b8379fbe8db256619bd56d12` — fix(clouds): occlusion counts only points on
  the pin's line of sight; the pick no longer runs potree's findHit (C-G Task 17)
- `docs/evidence/clouds/README.md` (criteria 9 and 10, "Changes to other units' code")
- `frontend/node_modules/potree-core/dist/index.js` (2.0.15)
