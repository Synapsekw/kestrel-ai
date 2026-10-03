# Asset findings U1: engine additions and the asset review API module

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The M1 GLB engine shows findings and cameras on the asset model. It draws textured patches and pins, camera glyphs, a see-through ghost, auto-rotate, a street map ground, a focus view per finding and a view from any photo pose, and it reports what the operator clicked. A typed `assetReview.ts` module gives U2, U3 and U5 the poses, placements, sightings and asset findings as paged hooks, plus the job and finding actions.

**Architecture:**
- **Pure modules beside the engine**, unit tested without WebGL, the way `viewDirection` and `partsFromScene` are today:
  - `viewer/patch.ts`: patch mesh and label grid parsing, label lookup;
  - `viewer/pins.ts`: the 6 px pin scale and the lift along the normal;
  - `viewer/focus.ts`: the focus frustum and oblique direction (kit `focusFinding`);
  - `viewer/cameras.ts`: pose mapping, the pyramid glyph, frustum corners, 13 px screen picking;
  - `viewer/ground.ts`: basemap tiles placed in the asset frame;
  - `viewer/placements.ts`: placement items and `PatchLoader`, which fetches patch binaries only for patches in the view frustum, at most 6 at a time.
- **`viewer/engine.ts`** gains the methods of spec §9 and wires the pure modules into three.js. The engine stays a factory with on-demand rendering. Auto-rotate keeps the loop running while it is on. An orthographic camera is added for `focusFinding`; `setView` and `viewFromPose` return to the perspective camera.
- **`viewer/ModelViewer.tsx`** forwards the new methods, replays them onto a fresh engine (a reload, a new GLB), and passes picks out through `onPick`. `src/test/fakeModelViewer.tsx` records them for workspace tests.
- **`src/api/assetReview.ts`** wraps the C0 operations. List hooks page with `after`/`limit` (2,000 rows a page for poses and placements, 500 for findings) and reload when the matching job finishes.

**Tech Stack:** React 18, TypeScript, three 0.180 (pinned; `OrbitControls`, `InstancedMesh`, `OrthographicCamera`), Vitest and Testing Library.

**Spec sections covered:** §9 "Engine additions" table, §11 bounded reads (paged index, patch binaries per visible patch), §12 "Engine: pure functions tested".

**Index and Global Constraints:** `docs/superpowers/plans/2026-10-03-asset-findings.md`

**Needs:** C0 merged (the contract operations, schemas and the `placementMeshUrl`, `placementTextureUrl`, `placementLabelsUrl` builders). M1 U6 and U7 and the workspace rail are already on `main` (`frontend/src/assetmodels/viewer/engine.ts` exists; checked 2026-10-03). U1 works against fakes and the Prism mock only.

**Worktree:** `scripts\start-task.ps1 -Name af-u1`

**Before any code:** read `frontend/src/assetmodels/viewer/engine.ts` and `ModelViewer.tsx` in full, and the kit engine `C:\Users\D\Claude_Workspace\outputs\Kestrel AI Reference Pack\asset-inspection-kit\engine\src\engine.js` lines 133 to 240 (markers, patches, basemap, pins, picking) and 491 to 600 (focus, picking, render loop). The constants below are the kit's.

**Budget:** no background job in this unit. Bounded reads: poses and placements are fetched in pages of at most 2,000 rows, findings in pages of 500; patch binaries (at most 64 KB each) are fetched only for patches inside the view frustum, at most 6 in flight; camera glyphs are one `InstancedMesh` whatever the photo count.

**Execution DAG:**

```
T1 patch ─┐
T2 pins, focus, cameras ─┼──> T5 engine + viewer + fake ──> T7 gate
T3 placements (needs T1 types) ─┤
T4 ground ─┘
T6 api module (independent) ───────────────────────────────> T7
```

- Independent: T1, T2, T4, T6. T3 imports `Vec3` from T2's `pins.ts`, so it follows T2 (or runs in parallel with that one type stubbed).
- Batches: {T1, T2, T4, T6}, then {T3}, then {T5}, then {T7}.
- Critical path: T2, T3, T5, T7.

---

### Task 1: Patch mesh and label grid parsing

**Files:**
- Create: `frontend/src/assetmodels/viewer/patch.ts`
- Test: `frontend/src/assetmodels/viewer/patch.test.ts`

**Interfaces:**
- Consumes: the J3 `write_patch` binary layout (see Index notes 1 and 2).
- Produces:

```ts
// src/assetmodels/viewer/patch.ts
export class PatchFormatError extends Error {}
export interface PatchMesh { vertexCount: number; positions: Float32Array; uvs: Float32Array }
export interface LabelGrid { width: number; height: number; data: Uint8Array }
export function parsePatchMesh(buf: ArrayBuffer): PatchMesh;
export function parseLabelGrid(buf: ArrayBuffer): LabelGrid;
/** The label under a texture coordinate; 0 (no defect) outside [0, 1]. v = 1 is the top row. */
export function labelAt(grid: LabelGrid, u: number, v: number): number;
```

- [ ] **Step 1: Write the failing test**

```ts
// src/assetmodels/viewer/patch.test.ts
import { describe, expect, it } from "vitest";
import { PatchFormatError, labelAt, parseLabelGrid, parsePatchMesh } from "./patch";

function meshBuffer(positions: number[], uvs: number[], count = positions.length / 3): ArrayBuffer {
  const buf = new ArrayBuffer(4 + (positions.length + uvs.length) * 4);
  const dv = new DataView(buf);
  dv.setUint32(0, count, true);
  [...positions, ...uvs].forEach((v, i) => dv.setFloat32(4 + i * 4, v, true));
  return buf;
}

function labelBuffer(width: number, height: number, data: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(4 + data.length);
  const dv = new DataView(buf);
  dv.setUint16(0, width, true);
  dv.setUint16(2, height, true);
  new Uint8Array(buf, 4).set(data);
  return buf;
}

describe("patch binaries", () => {
  it("reads a little-endian header, then positions, then uvs", () => {
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const uvs = [0, 0, 1, 0, 0, 1];
    const mesh = parsePatchMesh(meshBuffer(positions, uvs));
    expect(mesh.vertexCount).toBe(3);
    expect(Array.from(mesh.positions)).toEqual(positions);
    expect(Array.from(mesh.uvs)).toEqual(uvs);
  });

  it("refuses a truncated mesh, an empty one and one that is not whole triangles", () => {
    expect(() => parsePatchMesh(new ArrayBuffer(2))).toThrow(PatchFormatError);
    expect(() => parsePatchMesh(meshBuffer([], [], 0))).toThrow(PatchFormatError);
    expect(() => parsePatchMesh(meshBuffer([0, 0, 0, 1, 0, 0], [0, 0, 1, 0]))).toThrow(PatchFormatError);
    const good = meshBuffer([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 0, 1, 0, 0, 1]);
    expect(() => parsePatchMesh(good.slice(0, good.byteLength - 4))).toThrow(PatchFormatError);
  });

  it("reads the label grid and looks labels up with v = 1 at the top row", () => {
    const grid = parseLabelGrid(labelBuffer(2, 2, [0, 1, 2, 0]));
    expect(grid).toMatchObject({ width: 2, height: 2 });
    expect(labelAt(grid, 0.75, 0.75)).toBe(1); // top right
    expect(labelAt(grid, 0.25, 0.25)).toBe(2); // bottom left
    expect(labelAt(grid, 0.25, 0.75)).toBe(0); // top left, no defect
    expect(labelAt(grid, 1, 1)).toBe(1); // the far edge clamps into the grid
  });

  it("answers 0 outside the texture", () => {
    const grid = parseLabelGrid(labelBuffer(1, 1, [3]));
    expect(labelAt(grid, -0.01, 0.5)).toBe(0);
    expect(labelAt(grid, 0.5, 1.01)).toBe(0);
    expect(labelAt(grid, Number.NaN, 0.5)).toBe(0);
  });

  it("refuses a label grid whose size disagrees with its header", () => {
    expect(() => parseLabelGrid(labelBuffer(3, 3, [0, 0]))).toThrow(PatchFormatError);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/assetmodels/viewer/patch.test.ts`
Expected: FAIL (`Failed to resolve import "./patch"`)

- [ ] **Step 3: Implement**

```ts
// src/assetmodels/viewer/patch.ts
// The derived patch files of spec §5.7, as J3's write_patch writes them (little-endian):
//   <sighting>.bin  uint32 vertexCount, Float32 xyz * N, Float32 uv * N (non-indexed triangles)
//   <sighting>.lbl  uint16 width, uint16 height, uint8 label * width * height (row 0 is the top)

export class PatchFormatError extends Error {}

export interface PatchMesh {
  vertexCount: number;
  positions: Float32Array;
  uvs: Float32Array;
}

export interface LabelGrid {
  width: number;
  height: number;
  data: Uint8Array;
}

export function parsePatchMesh(buf: ArrayBuffer): PatchMesh {
  if (buf.byteLength < 4) throw new PatchFormatError("the patch mesh is shorter than its header");
  const dv = new DataView(buf);
  const n = dv.getUint32(0, true);
  if (n === 0 || n % 3 !== 0) throw new PatchFormatError(`the patch mesh holds ${n} vertices, not whole triangles`);
  if (buf.byteLength !== 4 + n * 5 * 4) {
    throw new PatchFormatError(`the patch mesh is ${buf.byteLength} bytes; ${n} vertices need ${4 + n * 20}`);
  }
  // Read through the DataView: the file is little-endian whatever the machine is.
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) positions[i] = dv.getFloat32(4 + i * 4, true);
  const uvs = new Float32Array(n * 2);
  const at = 4 + n * 12;
  for (let i = 0; i < n * 2; i++) uvs[i] = dv.getFloat32(at + i * 4, true);
  return { vertexCount: n, positions, uvs };
}

export function parseLabelGrid(buf: ArrayBuffer): LabelGrid {
  if (buf.byteLength < 4) throw new PatchFormatError("the label grid is shorter than its header");
  const dv = new DataView(buf);
  const width = dv.getUint16(0, true);
  const height = dv.getUint16(2, true);
  if (width === 0 || height === 0 || buf.byteLength !== 4 + width * height) {
    throw new PatchFormatError(`the label grid is ${buf.byteLength} bytes for ${width} x ${height}`);
  }
  return { width, height, data: new Uint8Array(buf.slice(4)) };
}

export function labelAt(grid: LabelGrid, u: number, v: number): number {
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return 0;
  const x = Math.min(grid.width - 1, Math.floor(u * grid.width));
  const y = Math.min(grid.height - 1, Math.floor((1 - v) * grid.height));
  return grid.data[y * grid.width + x] ?? 0;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm -C frontend exec vitest run src/assetmodels/viewer/patch.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/assetmodels/viewer/patch.ts frontend/src/assetmodels/viewer/patch.test.ts
git commit -m "feat(asset-findings): parse patch meshes and label grids

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pin scale, focus view and camera math

**Files:**
- Create: `frontend/src/assetmodels/viewer/pins.ts`, `frontend/src/assetmodels/viewer/focus.ts`, `frontend/src/assetmodels/viewer/cameras.ts`
- Test: `frontend/src/assetmodels/viewer/pins.test.ts`, `frontend/src/assetmodels/viewer/focus.test.ts`, `frontend/src/assetmodels/viewer/cameras.test.ts`

**Interfaces:**
- Consumes: `components["schemas"]["ImagePose"]` (C0: `image_id, position, target, up, hfov_deg, vfov_deg, source, accuracy_m, sequence, outcome, updated_at`).
- Produces:

```ts
// pins.ts
export type Vec3 = [number, number, number];
export const PIN_PX = 6;
export const PIN_LIFT_FRACTION = 0.009;  // of the asset height, kit buildPins
export function worldPerPixelPerspective(fovDeg: number, distance: number, viewportHeightPx: number): number;
export function worldPerPixelOrtho(top: number, bottom: number, zoom: number, viewportHeightPx: number): number;
export function pinScale(worldPerPixel: number, baseRadius: number, px?: number): number;
export function liftedPosition(center: Vec3, normal: Vec3 | null, lift: number): Vec3;

// focus.ts
export interface FocusSettings { frustum: [number, number]; oblique_deg: number }
export const DEFAULT_FOCUS: FocusSettings;   // { frustum: [0.05, 0.125], oblique_deg: 0 }
export interface FocusInput { kind: "patch" | "point"; center: Vec3; normal: Vec3 | null; size: number; cameraPosition?: Vec3 | null }
export interface FocusView { target: Vec3; direction: Vec3; viewHeight: number; distance: number }
export function focusView(p: FocusInput, assetHeight: number, s?: FocusSettings): FocusView;

// cameras.ts
export interface CameraPose { imageId: string; position: Vec3; target: Vec3; up: Vec3; hfovDeg: number; vfovDeg: number; sequence: string | null; outcome: string | null }
export const CAMERA_PICK_PX = 13;
export function cameraPosesFrom(rows: readonly ImagePose[]): CameraPose[];
export function frustumCorners(hfovDeg: number, vfovDeg: number, d: number): Vec3[];   // apex, then the 4 far corners
export function pyramidGeometry(): THREE.BufferGeometry;                                 // apex at 0, base at z = -1
export function nearestOnScreen(points: readonly { id: string; x: number; y: number; z: number }[],
  px: number, py: number, viewport: { width: number; height: number }, radiusPx?: number): string | null;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/assetmodels/viewer/pins.test.ts
import { describe, expect, it } from "vitest";
import { PIN_PX, liftedPosition, pinScale, worldPerPixelOrtho, worldPerPixelPerspective } from "./pins";

describe("pins", () => {
  it("measures world units per screen pixel for both cameras", () => {
    expect(worldPerPixelPerspective(60, 10, 1000)).toBeCloseTo((2 * Math.tan(Math.PI / 6) * 10) / 1000, 9);
    expect(worldPerPixelOrtho(5, -5, 2, 500)).toBeCloseTo(0.01, 9);
  });

  it("holds a pin at about 6 px whatever the distance", () => {
    const near = worldPerPixelPerspective(38, 5, 800);
    const far = worldPerPixelPerspective(38, 500, 800);
    // the radius on screen is scale * baseRadius / worldPerPixel
    expect((pinScale(near, 1) * 1) / near).toBeCloseTo(PIN_PX, 6);
    expect((pinScale(far, 1) * 1) / far).toBeCloseTo(PIN_PX, 6);
    expect(pinScale(0.01, 0.5, 8)).toBeCloseTo(0.16, 9);
  });

  it("lifts a pin off its surface along the normal", () => {
    expect(liftedPosition([1, 2, 3], [0, 2, 0], 0.5)).toEqual([1, 2.5, 3]);
    expect(liftedPosition([1, 2, 3], null, 0.5)).toEqual([1, 2, 3]);
    expect(liftedPosition([1, 2, 3], [0, 0, 0], 0.5)).toEqual([1, 2, 3]);
  });
});
```

```ts
// src/assetmodels/viewer/focus.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_FOCUS, focusView } from "./focus";

const norm = (v: number[]) => Math.hypot(...v);

describe("focusView", () => {
  it("looks straight along a patch normal with the frustum clamped to the profile", () => {
    const small = focusView({ kind: "patch", center: [10, 20, 0], normal: [2, 0, 0], size: 2 }, 100);
    expect(small.target).toEqual([10, 20, 0]);
    expect(small.direction[0]).toBeCloseTo(1);
    expect(small.direction[1]).toBeCloseTo(0);
    expect(small.viewHeight).toBeCloseTo(7.2); // 2 * 3.6, inside [5, 12.5]
    expect(small.distance).toBeCloseTo(72.5); // H * 0.225 + 50
    expect(focusView({ kind: "patch", center: [0, 0, 0], normal: [1, 0, 0], size: 10 }, 100).viewHeight).toBeCloseTo(12.5);
    expect(focusView({ kind: "patch", center: [0, 0, 0], normal: [1, 0, 0], size: 0.1 }, 100).viewHeight).toBeCloseTo(5);
  });

  it("turns off the surface and looks slightly down with an oblique profile", () => {
    const v = focusView({ kind: "patch", center: [0, 0, 0], normal: [1, 0, 0], size: 2 }, 100, {
      frustum: DEFAULT_FOCUS.frustum,
      oblique_deg: 20,
    });
    expect(norm(v.direction)).toBeCloseTo(1);
    expect(v.direction[0]).toBeGreaterThan(0.9);
    expect(v.direction[2]).toBeLessThan(0); // rotated clockwise seen from above
    expect(v.direction[1]).toBeGreaterThan(0.15); // tan(11 deg) before normalising
  });

  it("aims a pin without a normal from its photo, never from below", () => {
    const v = focusView({ kind: "point", center: [0, 10, 10], normal: null, size: 0, cameraPosition: [0, 5, 50] }, 100);
    expect(v.direction).toEqual([0, 0, 1]);
    expect(v.viewHeight).toBeCloseTo(7.2); // H * 0.02 * 3.6
  });

  it("falls back to the outward horizontal from the axis when nothing else is known", () => {
    const v = focusView({ kind: "point", center: [0, 4, -3], normal: null, size: 0 }, 50);
    expect(v.direction[2]).toBeCloseTo(-1);
    const axis = focusView({ kind: "point", center: [0, 4, 0], normal: null, size: 0 }, 50);
    expect(axis.direction).toEqual([1, 0, 0]);
  });
});
```

```ts
// src/assetmodels/viewer/cameras.test.ts
import { describe, expect, it } from "vitest";
import { CAMERA_PICK_PX, cameraPosesFrom, frustumCorners, nearestOnScreen, pyramidGeometry } from "./cameras";

describe("camera glyphs", () => {
  it("maps the contract's poses", () => {
    const rows = [{ image_id: "i1", position: [1, 2, 3], target: [0, 0, 0], up: [0, 1, 0], hfov_deg: 70, vfov_deg: 52,
      source: "kit", accuracy_m: null, sequence: "A", outcome: "finding", updated_at: "2026-10-03T00:00:00Z" }];
    expect(cameraPosesFrom(rows as never)).toEqual([{ imageId: "i1", position: [1, 2, 3], target: [0, 0, 0], up: [0, 1, 0],
      hfovDeg: 70, vfovDeg: 52, sequence: "A", outcome: "finding" }]);
  });

  it("spans the field of view at the target distance", () => {
    const c = frustumCorners(90, 60, 10);
    expect(c[0]).toEqual([0, 0, 0]);
    expect(c[1][0]).toBeCloseTo(-10);
    expect(c[1][1]).toBeCloseTo(-10 * Math.tan(Math.PI / 6));
    expect(c[1][2]).toBe(-10);
  });

  it("builds a pyramid that points down -z", () => {
    const g = pyramidGeometry();
    g.computeBoundingBox();
    expect(g.boundingBox!.max.z).toBeCloseTo(0);
    expect(g.boundingBox!.min.z).toBeCloseTo(-1);
  });

  it("picks the nearest camera within 13 px and ignores ones behind the view", () => {
    const vp = { width: 200, height: 100 };
    const pts = [
      { id: "a", x: 0, y: 0, z: 0.5 },          // screen (100, 50)
      { id: "b", x: 0.1, y: 0, z: 0.5 },        // screen (110, 50)
      { id: "behind", x: 0.02, y: 0, z: 1.5 },  // beyond the far plane
    ];
    expect(CAMERA_PICK_PX).toBe(13);
    expect(nearestOnScreen(pts, 108, 50, vp)).toBe("b");
    expect(nearestOnScreen(pts, 101, 50, vp)).toBe("a");
    expect(nearestOnScreen(pts, 140, 50, vp)).toBeNull();
    expect(nearestOnScreen([pts[2]], 102, 50, vp)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/assetmodels/viewer/pins.test.ts src/assetmodels/viewer/focus.test.ts src/assetmodels/viewer/cameras.test.ts`
Expected: FAIL (the three modules don't exist)

- [ ] **Step 3: Implement**

```ts
// src/assetmodels/viewer/pins.ts
// Pins are spheres held at about 6 px on screen and lifted off the wall along the face normal
// (kit engine.js buildPins and renderInto).
export type Vec3 = [number, number, number];

export const PIN_PX = 6;
export const PIN_LIFT_FRACTION = 0.009;

export function worldPerPixelPerspective(fovDeg: number, distance: number, viewportHeightPx: number): number {
  return (2 * Math.tan((fovDeg * Math.PI) / 360) * distance) / Math.max(viewportHeightPx, 1);
}

export function worldPerPixelOrtho(top: number, bottom: number, zoom: number, viewportHeightPx: number): number {
  return (top - bottom) / Math.max(zoom, 1e-6) / Math.max(viewportHeightPx, 1);
}

/** The scale that draws a sphere of `baseRadius` world units at `px` screen pixels. */
export function pinScale(worldPerPixel: number, baseRadius: number, px = PIN_PX): number {
  return Math.max((px * worldPerPixel) / baseRadius, 1e-4);
}

export function liftedPosition(center: Vec3, normal: Vec3 | null, lift: number): Vec3 {
  if (!normal) return [...center];
  const n = Math.hypot(normal[0], normal[1], normal[2]);
  if (n < 1e-9) return [...center];
  return [center[0] + (normal[0] / n) * lift, center[1] + (normal[1] / n) * lift, center[2] + (normal[2] / n) * lift];
}
```

```ts
// src/assetmodels/viewer/focus.ts
// The focus view of kit engine.js focusFinding: orthographic, along the patch direction or the pin
// normal, the view height from the profile's frustum fractions, turned off the surface by the
// oblique angle so depth (slabs, balconies) reads.
import type { Vec3 } from "./pins";

export interface FocusSettings {
  /** The view height as fractions of the asset height: [min, max]. */
  frustum: [number, number];
  oblique_deg: number;
}

export const DEFAULT_FOCUS: FocusSettings = { frustum: [0.05, 0.125], oblique_deg: 0 };

export interface FocusInput {
  kind: "patch" | "point";
  center: Vec3;
  normal: Vec3 | null;
  /** The patch's largest extent in metres; ignored for a pin. */
  size: number;
  /** The photo's camera, for a pin without a normal. */
  cameraPosition?: Vec3 | null;
}

export interface FocusView {
  target: Vec3;
  /** Unit vector from the target toward the camera. */
  direction: Vec3;
  /** The orthographic view's full height in metres. */
  viewHeight: number;
  distance: number;
}

const unit = (v: Vec3): Vec3 | null => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n < 1e-9 ? null : [v[0] / n, v[1] / n, v[2] / n];
};

function baseDirection(p: FocusInput): Vec3 {
  if (p.kind === "patch" && p.normal) {
    const d = unit(p.normal);
    if (d) return d;
  }
  let d: Vec3 | null = p.normal ? [...p.normal] : null;
  if (!d && p.cameraPosition) {
    d = [p.cameraPosition[0] - p.center[0], p.cameraPosition[1] - p.center[1], p.cameraPosition[2] - p.center[2]];
  }
  if (d) {
    d[1] = Math.max(d[1], 0); // never look up from below the finding
    const u = unit(d);
    if (u) return u;
  }
  return unit([p.center[0], 0, p.center[2]]) ?? [1, 0, 0];
}

export function focusView(p: FocusInput, assetHeight: number, s: FocusSettings = DEFAULT_FOCUS): FocusView {
  const H = Math.max(assetHeight, 1);
  const extent = p.kind === "patch" ? Math.max(p.size, 0) : H * 0.02;
  const viewHeight = Math.max(H * s.frustum[0], Math.min(H * s.frustum[1], extent * 3.6));
  let direction = baseDirection(p);
  if (s.oblique_deg) {
    const a = (s.oblique_deg * Math.PI) / 180;
    const h = unit([direction[0], 0, direction[2]]);
    if (h) {
      // rotate the horizontal part by a about +Y (three.js applyAxisAngle), then tilt down by 0.55 a
      const x = h[0] * Math.cos(a) + h[2] * Math.sin(a);
      const z = -h[0] * Math.sin(a) + h[2] * Math.cos(a);
      direction = unit([x, Math.tan(a * 0.55), z]) ?? direction;
    }
  }
  return { target: [...p.center], direction, viewHeight, distance: H * 0.225 + 50 };
}
```

```ts
// src/assetmodels/viewer/cameras.ts
// Camera glyphs (spec §9 setCameras): one instanced wire pyramid per posed photo, picked within
// 13 px of its projected position (kit engine.js pickCamera).
import * as THREE from "three";
import type { components } from "@contract/client";
import type { Vec3 } from "./pins";

type ImagePose = components["schemas"]["ImagePose"];

export interface CameraPose {
  imageId: string;
  position: Vec3;
  target: Vec3;
  up: Vec3;
  hfovDeg: number;
  vfovDeg: number;
  sequence: string | null;
  outcome: string | null;
}

export const CAMERA_PICK_PX = 13;

const v3 = (a: readonly number[]): Vec3 => [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];

export function cameraPosesFrom(rows: readonly ImagePose[]): CameraPose[] {
  return rows.map((r) => ({
    imageId: r.image_id,
    position: v3(r.position),
    target: v3(r.target),
    up: v3(r.up),
    hfovDeg: r.hfov_deg,
    vfovDeg: r.vfov_deg,
    sequence: r.sequence ?? null,
    outcome: r.outcome ?? null,
  }));
}

export function frustumCorners(hfovDeg: number, vfovDeg: number, d: number): Vec3[] {
  const w = d * Math.tan((hfovDeg * Math.PI) / 360);
  const h = d * Math.tan((vfovDeg * Math.PI) / 360);
  return [[0, 0, 0], [-w, -h, -d], [w, -h, -d], [w, h, -d], [-w, h, -d]];
}

/** A unit camera pyramid: apex at the origin, a 1.24 x 0.84 base at z = -1 (the kit's marker proportions). */
export function pyramidGeometry(): THREE.BufferGeometry {
  const c = [[0, 0, 0], [-0.62, -0.42, -1], [0.62, -0.42, -1], [0.62, 0.42, -1], [-0.62, 0.42, -1]];
  const tris = [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1], [1, 3, 2], [1, 4, 3]];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat().flatMap((i) => c[i]), 3));
  return g;
}

/** Points are in normalised device coordinates (Vector3.project); px, py in the element's pixels. */
export function nearestOnScreen(
  points: readonly { id: string; x: number; y: number; z: number }[],
  px: number,
  py: number,
  viewport: { width: number; height: number },
  radiusPx = CAMERA_PICK_PX,
): string | null {
  let best: string | null = null;
  let bestD = radiusPx * radiusPx;
  for (const p of points) {
    if (p.z < -1 || p.z > 1) continue;
    const sx = ((p.x + 1) / 2) * viewport.width;
    const sy = ((1 - p.y) / 2) * viewport.height;
    const d = (sx - px) ** 2 + (sy - py) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = p.id;
    }
  }
  return best;
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm -C frontend exec vitest run src/assetmodels/viewer/pins.test.ts src/assetmodels/viewer/focus.test.ts src/assetmodels/viewer/cameras.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/assetmodels/viewer/pins.ts frontend/src/assetmodels/viewer/pins.test.ts frontend/src/assetmodels/viewer/focus.ts frontend/src/assetmodels/viewer/focus.test.ts frontend/src/assetmodels/viewer/cameras.ts frontend/src/assetmodels/viewer/cameras.test.ts
git commit -m "feat(asset-findings): pin scale, focus view and camera glyph math

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Placement items and the visible-only patch loader (Review Focus 5)

**Files:**
- Create: `frontend/src/assetmodels/viewer/placements.ts`
- Test: `frontend/src/assetmodels/viewer/placements.test.ts`

**Interfaces:**
- Consumes: `components["schemas"]["Placement"]` (C0: `sighting_id, finding_id, kind, center, normal, size, severity, patch_url`), `SeverityLevel`, `severityOf` (`src/ui/severityScale.ts`), `Vec3` (Task 2).
- Produces:

```ts
export interface PlacementItem { sightingId: string; findingId: string; kind: "point" | "patch";
  center: Vec3; normal: Vec3 | null; size: number; severity: number | null; colour: string }
export interface PatchBuffers { mesh: ArrayBuffer; texture: Blob; labels: ArrayBuffer }
export type FetchPatch = (sightingId: string) => Promise<PatchBuffers>;
export interface Sphere { center: Vec3; radius: number }
export const MAX_PATCH_FETCHES = 6;
export function placementItems(rows: readonly Placement[], scale: readonly SeverityLevel[], fallback: string): PlacementItem[];
export function frustumOf(camera: THREE.Camera): THREE.Frustum;
export class PatchLoader {
  constructor(fetchPatch: FetchPatch, onLoaded: (sightingId: string, b: PatchBuffers) => void, max?: number);
  update(items: readonly PlacementItem[], isVisible: (s: Sphere) => boolean, distance?: (c: Vec3) => number): void;
  has(sightingId: string): boolean;
  readonly inFlight: number;
  dispose(): void;
}
```

- [ ] **Step 1: Write the failing test (the Review Focus test is "loads only visible patch binaries")**

```ts
// src/assetmodels/viewer/placements.test.ts
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SEVERITY_SCALE } from "@/ui/severityScale";
import { MAX_PATCH_FETCHES, PatchLoader, frustumOf, placementItems, type PatchBuffers, type PlacementItem, type Sphere } from "./placements";

const patch = (id: string, center: [number, number, number]): PlacementItem => ({
  sightingId: id, findingId: `f-${id}`, kind: "patch", center, normal: [0, 0, 1], size: 1, severity: 2, colour: "#e2bf2e",
});
const pin = (id: string, center: [number, number, number]): PlacementItem => ({ ...patch(id, center), kind: "point" });

const buffers: PatchBuffers = { mesh: new ArrayBuffer(4), texture: new Blob([]), labels: new ArrayBuffer(4) };

function camera(at: [number, number, number], look: [number, number, number]) {
  const c = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
  c.position.set(...at);
  c.lookAt(...look);
  return c;
}

function visibleFrom(c: THREE.Camera) {
  const f = frustumOf(c);
  return (s: Sphere) => f.intersectsSphere(new THREE.Sphere(new THREE.Vector3(...s.center), s.radius));
}

/** A fetch whose answers the test releases one by one. */
function deferredFetch() {
  const pending = new Map<string, (b: PatchBuffers) => void>();
  const fetchPatch = vi.fn((id: string) => new Promise<PatchBuffers>((res) => pending.set(id, res)));
  const release = async (id: string) => {
    pending.get(id)?.(buffers);
    pending.delete(id);
    await Promise.resolve();
    await Promise.resolve();
  };
  return { fetchPatch, release };
}

describe("placementItems", () => {
  it("keeps placed sightings, colours them by severity and drops unplaced ones", () => {
    const rows = [
      { sighting_id: "s1", finding_id: "f1", kind: "patch", center: [1, 2, 3], normal: [0, 0, 1], size: 2.5, severity: 2, patch_url: "x" },
      { sighting_id: "s2", finding_id: "f1", kind: "point", center: [1, 2, 3], normal: null, size: null, severity: null, patch_url: null },
      { sighting_id: "s3", finding_id: "f2", kind: "none", center: null, normal: null, size: null, severity: 1, patch_url: null },
    ];
    const items = placementItems(rows as never, DEFAULT_SEVERITY_SCALE, "#999999");
    expect(items.map((i) => [i.sightingId, i.kind, i.colour, i.size])).toEqual([
      ["s1", "patch", "#e2bf2e", 2.5],
      ["s2", "point", "#999999", 0],
    ]);
  });
});

describe("PatchLoader", () => {
  it("loads only visible patch binaries", async () => {
    const { fetchPatch, release } = deferredFetch();
    const onLoaded = vi.fn();
    const loader = new PatchLoader(fetchPatch, onLoaded);
    const items = [patch("front", [0, 0, 0]), patch("behind", [0, 0, 30]), pin("pin", [0, 0, 0])];

    loader.update(items, visibleFrom(camera([0, 0, 10], [0, 0, 0])));
    expect(fetchPatch.mock.calls.map((c) => c[0])).toEqual(["front"]); // never the one behind, never a pin
    await release("front");
    expect(onLoaded).toHaveBeenCalledWith("front", buffers);
    expect(loader.has("front")).toBe(true);

    // Turn round: the other patch comes into view and loads; the first is kept, not fetched again.
    loader.update(items, visibleFrom(camera([0, 0, 10], [0, 0, 30])));
    expect(fetchPatch.mock.calls.map((c) => c[0])).toEqual(["front", "behind"]);
    loader.update(items, visibleFrom(camera([0, 0, 10], [0, 0, 0])));
    expect(fetchPatch).toHaveBeenCalledTimes(2);
  });

  it("keeps at most six fetches in flight, nearest first, and continues as they land", async () => {
    const { fetchPatch, release } = deferredFetch();
    const loader = new PatchLoader(fetchPatch, () => {});
    const items = Array.from({ length: 10 }, (_, i) => patch(`p${i}`, [0, 0, -i]));
    const cam = camera([0, 0, 10], [0, 0, 0]);
    loader.update(items, visibleFrom(cam), (c) => cam.position.distanceTo(new THREE.Vector3(...c)));
    expect(MAX_PATCH_FETCHES).toBe(6);
    expect(fetchPatch.mock.calls.map((c) => c[0])).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
    expect(loader.inFlight).toBe(6);
    await release("p0");
    expect(fetchPatch.mock.calls.map((c) => c[0])).toContain("p6");
    expect(loader.inFlight).toBe(6);
  });

  it("does not retry a failed patch in a loop, and stops after dispose", async () => {
    const fetchPatch = vi.fn(() => Promise.reject(new Error("404")));
    const loader = new PatchLoader(fetchPatch, () => {});
    const items = [patch("gone", [0, 0, 0])];
    const vis = visibleFrom(camera([0, 0, 10], [0, 0, 0]));
    loader.update(items, vis);
    await Promise.resolve();
    await Promise.resolve();
    loader.update(items, vis);
    expect(fetchPatch).toHaveBeenCalledTimes(1);
    loader.dispose();
    loader.update([patch("new", [0, 0, 0])], vis);
    expect(fetchPatch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/assetmodels/viewer/placements.test.ts`
Expected: FAIL (`Failed to resolve import "./placements"`)

- [ ] **Step 3: Implement**

```ts
// src/assetmodels/viewer/placements.ts
// Placements (spec §9 setPlacements, §11 "patch binaries are fetched per visible patch"): the
// paged index becomes items; a patch's mesh, texture and label grid are fetched only once the
// patch's bounding sphere is inside the view frustum, nearest first, at most 6 at a time, and are
// kept once loaded. A 715-patch facade never downloads what the operator has not looked at.
import * as THREE from "three";
import type { components } from "@contract/client";
import { severityOf, type SeverityLevel } from "@/ui/severityScale";
import type { Vec3 } from "./pins";

type Placement = components["schemas"]["Placement"];

export interface PlacementItem {
  sightingId: string;
  findingId: string;
  kind: "point" | "patch";
  center: Vec3;
  normal: Vec3 | null;
  /** Largest extent in metres (0 for a pin). */
  size: number;
  severity: number | null;
  /** #rrggbb from the severity scale (a data colour). */
  colour: string;
}

export interface PatchBuffers {
  mesh: ArrayBuffer;
  texture: Blob;
  labels: ArrayBuffer;
}

export type FetchPatch = (sightingId: string) => Promise<PatchBuffers>;

export interface Sphere {
  center: Vec3;
  radius: number;
}

export const MAX_PATCH_FETCHES = 6;

const v3 = (a: readonly number[]): Vec3 => [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];

export function placementItems(
  rows: readonly Placement[],
  scale: readonly SeverityLevel[],
  fallback: string,
): PlacementItem[] {
  const out: PlacementItem[] = [];
  for (const r of rows) {
    if ((r.kind !== "point" && r.kind !== "patch") || !r.center) continue;
    const size: unknown = r.size;
    out.push({
      sightingId: r.sighting_id,
      findingId: r.finding_id,
      kind: r.kind,
      center: v3(r.center),
      normal: r.normal ? v3(r.normal) : null,
      size: Array.isArray(size) ? Math.max(...(size as number[])) : typeof size === "number" ? size : 0,
      severity: r.severity ?? null,
      colour: severityOf(scale, r.severity ?? null)?.colour ?? fallback,
    });
  }
  return out;
}

export function frustumOf(camera: THREE.Camera): THREE.Frustum {
  camera.updateMatrixWorld();
  const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  return new THREE.Frustum().setFromProjectionMatrix(m);
}

export class PatchLoader {
  private readonly loaded = new Set<string>();
  private readonly pending = new Set<string>();
  private readonly failed = new Set<string>();
  private disposed = false;
  private last: {
    items: readonly PlacementItem[];
    isVisible: (s: Sphere) => boolean;
    distance: (c: Vec3) => number;
  } | null = null;

  constructor(
    private readonly fetchPatch: FetchPatch,
    private readonly onLoaded: (sightingId: string, b: PatchBuffers) => void,
    private readonly max = MAX_PATCH_FETCHES,
  ) {}

  get inFlight(): number {
    return this.pending.size;
  }

  has(sightingId: string): boolean {
    return this.loaded.has(sightingId);
  }

  update(
    items: readonly PlacementItem[],
    isVisible: (s: Sphere) => boolean,
    distance: (c: Vec3) => number = () => 0,
  ): void {
    if (this.disposed) return;
    this.last = { items, isVisible, distance };
    const free = this.max - this.pending.size;
    if (free <= 0) return;
    const wanted = items
      .filter(
        (p) =>
          p.kind === "patch" &&
          !this.loaded.has(p.sightingId) &&
          !this.pending.has(p.sightingId) &&
          !this.failed.has(p.sightingId) &&
          isVisible({ center: p.center, radius: Math.max(p.size, 0.05) }),
      )
      .sort((a, b) => distance(a.center) - distance(b.center))
      .slice(0, free);
    for (const p of wanted) this.start(p.sightingId);
  }

  private start(id: string): void {
    this.pending.add(id);
    this.fetchPatch(id).then(
      (b) => {
        this.pending.delete(id);
        if (this.disposed) return;
        this.loaded.add(id);
        this.onLoaded(id, b);
        this.pump();
      },
      () => {
        this.pending.delete(id);
        if (this.disposed) return;
        // a missing or broken patch file is skipped for this loader's life, never refetched per frame
        this.failed.add(id);
        this.pump();
      },
    );
  }

  private pump(): void {
    if (this.last) this.update(this.last.items, this.last.isVisible, this.last.distance);
  }

  dispose(): void {
    this.disposed = true;
    this.last = null;
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm -C frontend exec vitest run src/assetmodels/viewer/placements.test.ts`
Expected: PASS (4 tests, including "loads only visible patch binaries")

- [ ] **Step 5: Commit**

```bash
git add frontend/src/assetmodels/viewer/placements.ts frontend/src/assetmodels/viewer/placements.test.ts
git commit -m "feat(asset-findings): placement items and a visible-only patch loader

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Street map ground tiles in the asset frame

**Files:**
- Create: `frontend/src/assetmodels/viewer/ground.ts`
- Test: `frontend/src/assetmodels/viewer/ground.test.ts`

**Interfaces:**
- Consumes: `lonLatToTile`, `tileToLonLat`, `BASEMAP_MAX_ZOOM` (`src/overview/basemapTiles.ts`); the URL template from `basemapTileUrl(baseUrl, token, "streets")` (`contract/client/index.ts`).
- Produces:

```ts
export interface GroundOrigin { lat: number; lon: number; ground_alt_m: number }
export interface GroundTile { url: string; tl: [number, number]; tr: [number, number]; bl: [number, number]; y: number }  // [x, z] in the asset frame
export const EARTH_RADIUS_M = 6_378_137;
export const MAX_GROUND_TILES = 36;
export function toAssetXZ(lat: number, lon: number, origin: GroundOrigin, northOffsetDeg: number): [number, number];
export function groundTiles(origin: GroundOrigin, northOffsetDeg: number, template: string, radiusM: number): GroundTile[];
```

Convention: `north_offset_deg` is the bearing of plant north, clockwise from true north. A point due true north of the origin therefore lands at bearing `-north_offset_deg` in the asset frame. See Index note 4.

- [ ] **Step 1: Write the failing test**

```ts
// src/assetmodels/viewer/ground.test.ts
import { describe, expect, it } from "vitest";
import { MAX_GROUND_TILES, groundTiles, toAssetXZ } from "./ground";

const origin = { lat: 25.2, lon: 55.3, ground_alt_m: 4 };

describe("ground tiles", () => {
  it("puts true north on +X when plant north is true north", () => {
    const [x, z] = toAssetXZ(origin.lat + 0.001, origin.lon, origin, 0);
    expect(x).toBeCloseTo(111.32, 1);
    expect(z).toBeCloseTo(0, 6);
    const [ex, ez] = toAssetXZ(origin.lat, origin.lon + 0.001, origin, 0);
    expect(ex).toBeCloseTo(0, 6);
    expect(ez).toBeCloseTo(111.32 * Math.cos((25.2 * Math.PI) / 180), 1);
  });

  it("turns the map by the plant north offset", () => {
    const [x, z] = toAssetXZ(origin.lat + 0.001, origin.lon, origin, 90);
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(-111.32, 1);
  });

  it("covers the origin with a bounded set of streets tiles just under the datum", () => {
    const tiles = groundTiles(origin, 0, "http://b/api/v1/basemap/streets/{z}/{x}/{y}?token=t", 150);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(MAX_GROUND_TILES);
    expect(tiles[0].url).toMatch(/\/basemap\/streets\/\d+\/\d+\/\d+\?token=t$/);
    expect(tiles.every((t) => t.y < 0 && t.y > -0.2)).toBe(true);
    // the origin (0, 0) falls inside one tile: x between its top and bottom edge, z between left and right
    const holder = tiles.find((t) => t.bl[0] <= 0 && t.tl[0] >= 0 && t.tl[1] <= 0 && t.tr[1] >= 0);
    expect(holder).toBeDefined();
  });

  it("caps the tile count for a huge radius", () => {
    expect(groundTiles(origin, 0, "{z}/{x}/{y}", 50_000).length).toBeLessThanOrEqual(MAX_GROUND_TILES);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/assetmodels/viewer/ground.test.ts`
Expected: FAIL (`Failed to resolve import "./ground"`)

- [ ] **Step 3: Implement**

```ts
// src/assetmodels/viewer/ground.ts
// The street map under the model (spec §9 setGround): web-mercator tiles from the backend's
// basemap proxy, each placed by three corners in the asset frame with the same flat-earth offset
// the pose job uses (X = dlat * R, Z = dlon * R * cos(lat)), turned by the plant north offset.
import { BASEMAP_MAX_ZOOM, lonLatToTile, tileToLonLat } from "@/overview/basemapTiles";

export interface GroundOrigin {
  lat: number;
  lon: number;
  ground_alt_m: number;
}

export interface GroundTile {
  url: string;
  /** [x, z] corners in the asset frame (the fourth is tr + bl - tl). */
  tl: [number, number];
  tr: [number, number];
  bl: [number, number];
  y: number;
}

export const EARTH_RADIUS_M = 6_378_137;
export const MAX_GROUND_TILES = 36;
/** Just under the ground datum, so the base of the model is never z-fighting the map. */
const GROUND_Y = -0.05;
const EQUATOR_M = 2 * Math.PI * EARTH_RADIUS_M;
const DEG = Math.PI / 180;

export function toAssetXZ(lat: number, lon: number, origin: GroundOrigin, northOffsetDeg: number): [number, number] {
  const n = (lat - origin.lat) * DEG * EARTH_RADIUS_M;
  const e = (lon - origin.lon) * DEG * EARTH_RADIUS_M * Math.cos(origin.lat * DEG);
  const t = northOffsetDeg * DEG;
  return [n * Math.cos(t) + e * Math.sin(t), -n * Math.sin(t) + e * Math.cos(t)];
}

export function groundTiles(
  origin: GroundOrigin,
  northOffsetDeg: number,
  template: string,
  radiusM: number,
): GroundTile[] {
  const r = Math.max(radiusM, 10);
  // about four tiles across the circle, then fewer if the radius would need more than the cap
  const ideal = Math.log2((EQUATOR_M * Math.cos(origin.lat * DEG) * 4) / (2 * r));
  let z = Math.min(BASEMAP_MAX_ZOOM, Math.max(0, Math.floor(ideal)));
  const dLat = r / (DEG * EARTH_RADIUS_M);
  const dLon = r / (DEG * EARTH_RADIUS_M * Math.cos(origin.lat * DEG));
  for (;;) {
    const a = lonLatToTile(origin.lon - dLon, origin.lat + dLat, z);
    const b = lonLatToTile(origin.lon + dLon, origin.lat - dLat, z);
    const xs = [Math.floor(a.x), Math.floor(b.x)];
    const ys = [Math.floor(a.y), Math.floor(b.y)];
    const count = (xs[1] - xs[0] + 1) * (ys[1] - ys[0] + 1);
    if (count > MAX_GROUND_TILES && z > 0) {
      z -= 1;
      continue;
    }
    const last = 2 ** z - 1;
    const tiles: GroundTile[] = [];
    for (let x = Math.max(0, xs[0]); x <= Math.min(last, xs[1]); x++) {
      for (let y = Math.max(0, ys[0]); y <= Math.min(last, ys[1]); y++) {
        const nw = tileToLonLat(x, y, z);
        const ne = tileToLonLat(x + 1, y, z);
        const sw = tileToLonLat(x, y + 1, z);
        tiles.push({
          url: template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)),
          tl: toAssetXZ(nw.lat, nw.lon, origin, northOffsetDeg),
          tr: toAssetXZ(ne.lat, ne.lon, origin, northOffsetDeg),
          bl: toAssetXZ(sw.lat, sw.lon, origin, northOffsetDeg),
          y: GROUND_Y,
        });
      }
    }
    return tiles;
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm -C frontend exec vitest run src/assetmodels/viewer/ground.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/assetmodels/viewer/ground.ts frontend/src/assetmodels/viewer/ground.test.ts
git commit -m "feat(asset-findings): street map ground tiles in the asset frame

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Engine methods, the viewer shell and the test double

**Files:**
- Modify: `frontend/src/assetmodels/viewer/engine.ts`
- Modify: `frontend/src/assetmodels/viewer/ModelViewer.tsx`
- Modify: `frontend/src/test/fakeModelViewer.tsx`
- Test: `frontend/src/assetmodels/viewer/ModelViewer.test.tsx` (extend; its `stub` helper gains the new methods), `frontend/src/assetmodels/viewer/engine.test.ts` (extend: the exported constants)

**Interfaces:**
- Consumes: Tasks 1 to 4.
- Produces (the index's `ModelEngine` additions, binding names):

```ts
// engine.ts
export interface PickHit { kind: "finding" | "camera" | "part"; id: string }
export const GHOST_OPACITY = 0.25;
export const PATCH_ALPHA_TEST = 0.3;
export const PATCH_POLYGON_OFFSET = -4;
export const PATCH_RENDER_ORDER = 3;
export const PIN_RENDER_ORDER = 10;
export const GROUND_RENDER_ORDER = -10;
/**
 * The default for `setAutoRotate(on)` with no speed (U5's Overview hero calls it that way). The unit is
 * three.js OrbitControls' `autoRotateSpeed`: 2.0 is one turn per 30 s at 60 fps, so 0.6 is one turn
 * per 100 s, the kit's value.
 */
export const AUTO_ROTATE_SPEED = 0.6;
export interface ModelEngine {
  // ...the M1 methods, unchanged
  setPlacements(items: PlacementItem[], fetchPatch: FetchPatch): void;
  setCameras(poses: CameraPose[], colourOf: (p: CameraPose) => string): void;
  setSelectedCamera(imageId: string | null, cone: boolean): void;   // Index note 5
  focusFinding(findingId: string, settings?: FocusSettings): boolean; // false when the finding has no placement
  setGhost(on: boolean): void;
  setAutoRotate(on: boolean, speed?: number): void;
  setGround(tiles: GroundTile[] | null): void;
  viewFromPose(pose: CameraPose | null): void;   // null returns to the view before the first pose
  onPick(cb: ((hit: PickHit) => void) | null): void;
}

// ModelViewer.tsx
export type ModelViewerHandle = Omit<ModelEngine, "load" | "dispose" | "onPick">;
export interface ModelViewerProps { /* M1 props */ onPick?(hit: PickHit): void }

// test/fakeModelViewer.tsx
export function emitPick(hit: PickHit): void;
```

- [ ] **Step 1: Write the failing tests**

Add to `src/assetmodels/viewer/engine.test.ts`:

```ts
import {
  AUTO_ROTATE_SPEED,
  GHOST_OPACITY,
  GROUND_RENDER_ORDER,
  PATCH_ALPHA_TEST,
  PATCH_POLYGON_OFFSET,
  PATCH_RENDER_ORDER,
} from "./engine";

describe("engine constants follow the kit", () => {
  it("draws patches, ghost and ground as the kit does", () => {
    expect(PATCH_ALPHA_TEST).toBe(0.3);
    expect(PATCH_POLYGON_OFFSET).toBe(-4);
    expect(PATCH_RENDER_ORDER).toBe(3);
    expect(GHOST_OPACITY).toBe(0.25);
    expect(GROUND_RENDER_ORDER).toBe(-10);
    expect(AUTO_ROTATE_SPEED).toBe(0.6);
  });
});
```

(Merge the new names into the file's existing `import { partsFromScene, viewDirection } from "./engine";` line.)

In `src/assetmodels/viewer/ModelViewer.test.tsx`, replace the `stub` helper with one that carries the new methods, and add two tests:

```tsx
const stub = (load: () => Promise<unknown>, dispose = vi.fn()) => ({
  load: vi.fn(load),
  dispose,
  setGroupVisible: vi.fn(),
  select: vi.fn(),
  setCut: vi.fn(),
  setLevels: vi.fn(),
  setHeadOff: vi.fn(),
  setOverlay: vi.fn(),
  setView: vi.fn(),
  setPlacements: vi.fn(),
  setCameras: vi.fn(),
  setSelectedCamera: vi.fn(),
  focusFinding: vi.fn(() => true),
  setGhost: vi.fn(),
  setAutoRotate: vi.fn(),
  setGround: vi.fn(),
  viewFromPose: vi.fn(),
  onPick: vi.fn(),
});

it("replays placements, cameras, ghost, rotate, ground and the pose onto the engine after a load", async () => {
  let resolve: (v: unknown) => void = () => {};
  const eng = stub(() => new Promise((r) => (resolve = r)));
  create.mockImplementation(() => eng);
  const ref = createRef<ModelViewerHandle>();
  render(<ModelViewer ref={ref} glbUrl="x.glb" onParts={() => {}} onSelect={() => {}} />);
  const fetchPatch = vi.fn();
  const pose = { imageId: "i1", position: [1, 2, 3], target: [0, 0, 0], up: [0, 1, 0], hfovDeg: 70, vfovDeg: 50,
    sequence: null, outcome: null } as const;
  act(() => {
    ref.current!.setPlacements([], fetchPatch);
    ref.current!.setCameras([pose as never], () => "#ffffff");
    ref.current!.setSelectedCamera("i1", true);
    ref.current!.setGhost(true);
    ref.current!.setAutoRotate(true, 1.2);
    ref.current!.setGround([]);
    ref.current!.viewFromPose(pose as never);
  });
  eng.setGhost.mockClear();
  await act(async () => resolve([]));
  await waitFor(() => expect(eng.setGhost).toHaveBeenCalledWith(true));
  expect(eng.setPlacements).toHaveBeenLastCalledWith([], fetchPatch);
  expect(eng.setCameras).toHaveBeenCalled();
  expect(eng.setSelectedCamera).toHaveBeenLastCalledWith("i1", true);
  expect(eng.setAutoRotate).toHaveBeenLastCalledWith(true, 1.2);
  expect(eng.setGround).toHaveBeenLastCalledWith([]);
  expect(eng.viewFromPose).toHaveBeenLastCalledWith(pose);
});

it("passes the engine's picks out and forwards focusFinding", async () => {
  const eng = stub(() => Promise.resolve([]));
  create.mockImplementation(() => eng);
  const onPick = vi.fn();
  const ref = createRef<ModelViewerHandle>();
  render(<ModelViewer ref={ref} glbUrl="x.glb" onParts={() => {}} onSelect={() => {}} onPick={onPick} />);
  await waitFor(() => expect(eng.onPick).toHaveBeenCalled());
  const cb = eng.onPick.mock.calls[0][0] as (h: unknown) => void;
  cb({ kind: "finding", id: "f1" });
  expect(onPick).toHaveBeenCalledWith({ kind: "finding", id: "f1" });
  expect(ref.current!.focusFinding("f1")).toBe(true);
  expect(eng.focusFinding).toHaveBeenCalledWith("f1", undefined);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/assetmodels/viewer`
Expected: FAIL (the constants are not exported; the handle has no `setPlacements`)

- [ ] **Step 3: Implement the engine additions** in `src/assetmodels/viewer/engine.ts`.

3a. Imports and exported names, after the existing imports and before `export type ModelView`:

```ts
import { CAMERA_PICK_PX, frustumCorners, nearestOnScreen, pyramidGeometry, type CameraPose } from "./cameras";
import { DEFAULT_FOCUS, focusView, type FocusSettings } from "./focus";
import type { GroundTile } from "./ground";
import { labelAt, parseLabelGrid, parsePatchMesh, type LabelGrid } from "./patch";
import { PIN_LIFT_FRACTION, liftedPosition, pinScale, worldPerPixelOrtho, worldPerPixelPerspective } from "./pins";
import { PatchLoader, frustumOf, type FetchPatch, type PatchBuffers, type PlacementItem } from "./placements";

export interface PickHit {
  kind: "finding" | "camera" | "part";
  id: string;
}
export const GHOST_OPACITY = 0.25;
export const PATCH_ALPHA_TEST = 0.3;
export const PATCH_POLYGON_OFFSET = -4;
export const PATCH_RENDER_ORDER = 3;
export const PIN_RENDER_ORDER = 10;
export const GROUND_RENDER_ORDER = -10;
export const AUTO_ROTATE_SPEED = 0.6;
```

3b. The interface: add after `setView(view: ModelView): void;` in `ModelEngine`:

```ts
  /** Patches as textured meshes (loaded when visible) and pins as 6 px spheres; replaces the last set. */
  setPlacements(items: PlacementItem[], fetchPatch: FetchPatch): void;
  /** One instanced wire pyramid per pose; an empty list clears them. */
  setCameras(poses: CameraPose[], colourOf: (p: CameraPose) => string): void;
  /** Marks one camera; `cone` draws its view frustum out to the target. */
  setSelectedCamera(imageId: string | null, cone: boolean): void;
  /** Orthographic along the patch direction or pin normal; false when the finding has no placement. */
  focusFinding(findingId: string, settings?: FocusSettings): boolean;
  /** Every model material at 0.25 opacity with depth writes off, so findings behind show through. */
  setGhost(on: boolean): void;
  setAutoRotate(on: boolean, speed?: number): void;
  /** Basemap tiles under the model; null removes them. */
  setGround(tiles: GroundTile[] | null): void;
  /** The perspective camera at the photo's pose; null returns to the view before the first pose. */
  viewFromPose(pose: CameraPose | null): void;
  /** Clicks on a finding (patch label or pin), a camera (13 px) or a part. */
  onPick(cb: ((hit: PickHit) => void) | null): void;
```

3c. State and groups, inserted right after `scene.add(modelRoot, helpers);`:

```ts
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 1e5);
  let active: THREE.PerspectiveCamera | THREE.OrthographicCamera = camera;
  let orthoHeight = 10;
  const surface = new THREE.Group(); // textured patches
  const pins = new THREE.Group();
  const cams = new THREE.Group();
  const ground = new THREE.Group();
  scene.add(surface, pins, cams, ground);
  const textureLoader = new THREE.TextureLoader();
  textureLoader.setCrossOrigin("anonymous");
  let items: PlacementItem[] = [];
  let loader: PatchLoader | null = null;
  let poses: CameraPose[] = [];
  let selectedCam: { id: string | null; cone: boolean } = { id: null, cone: false };
  let ghostOn = false;
  let pickCb: ((hit: PickHit) => void) | null = null;
  let savedView: { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; fov: number } | null = null;
  /** The model's height above the datum, the H of the kit's fractions. */
  const assetHeight = () => Math.max(bounds.max.y - Math.min(bounds.min.y, 0), 1);
  /** Releases textures too: `disposeChildren` frees geometry and materials only. */
  const disposeTextured = (g: THREE.Object3D) => {
    g.traverse((c) => ((c as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined)?.map?.dispose());
    disposeChildren(g);
  };
  const sizeOrtho = (aspect: number) => {
    ortho.top = orthoHeight / 2;
    ortho.bottom = -orthoHeight / 2;
    ortho.left = (-orthoHeight * aspect) / 2;
    ortho.right = (orthoHeight * aspect) / 2;
  };
```

3d. Replace `frame` (the auto-rotate keeps the loop alive; pins are rescaled and visible patches requested each frame):

```ts
  const viewportHeight = () => o.host.clientHeight || 1;
  const updatePins = () => {
    const h = viewportHeight();
    for (const p of pins.children) {
      const wpp =
        active === ortho
          ? worldPerPixelOrtho(ortho.top, ortho.bottom, ortho.zoom, h)
          : worldPerPixelPerspective(camera.fov, camera.position.distanceTo(p.position), h);
      p.scale.setScalar(pinScale(wpp, 1));
    }
  };
  const sphere = new THREE.Sphere();
  const requestVisiblePatches = () => {
    if (!loader) return;
    const f = frustumOf(active);
    loader.update(
      items,
      (s) => f.intersectsSphere(sphere.set(new THREE.Vector3(...s.center), s.radius)),
      (c) => active.position.distanceTo(new THREE.Vector3(...c)),
    );
  };
  const frame = () => {
    raf = 0;
    if (disposed) return;
    controls.update();
    updatePins();
    requestVisiblePatches();
    renderer.render(scene, active);
    if (performance.now() < idleUntil || controls.autoRotate) raf = requestAnimationFrame(frame);
  };
```

3e. In `resize`, after `camera.updateProjectionMatrix();` add:

```ts
    sizeOrtho(w / h);
    ortho.updateProjectionMatrix();
```

3f. In `setView`, add as the first two lines (any preset view leaves focus and pose views):

```ts
    active = camera;
    controls.object = camera;
    savedView = null;
```

3g. Ghost, patch building and picking, inserted after `drawLevels` and before the `// click to select a part` comment:

```ts
  const applyGhost = () =>
    applyMaterials((m) => {
      m.transparent = ghostOn;
      m.opacity = ghostOn ? GHOST_OPACITY : 1;
      m.depthWrite = !ghostOn;
      m.needsUpdate = true;
    });

  const addPatch = async (id: string, b: PatchBuffers) => {
    const item = items.find((p) => p.sightingId === id);
    if (!item) return;
    const mesh = parsePatchMesh(b.mesh);
    const labels = parseLabelGrid(b.labels);
    const bitmap = await createImageBitmap(b.texture, { imageOrientation: "flipY" });
    if (disposed || !items.includes(item)) {
      bitmap.close();
      return;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
    g.computeBoundingSphere();
    const tex = new THREE.Texture(bitmap);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.flipY = false; // the bitmap was flipped when it was decoded
    tex.needsUpdate = true;
    const m = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        map: tex,
        alphaTest: PATCH_ALPHA_TEST,
        polygonOffset: true,
        polygonOffsetFactor: PATCH_POLYGON_OFFSET,
        polygonOffsetUnits: PATCH_POLYGON_OFFSET,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    m.renderOrder = PATCH_RENDER_ORDER;
    m.userData = { kind: "patch", findingId: item.findingId, sightingId: id, labels };
    surface.add(m);
    requestRender();
  };

  const drawSelectedCamera = () => {
    disposeChildren(helpers, (c) => c.userData.kind === "camera-selection");
    const p = selectedCam.id ? poses.find((x) => x.imageId === selectedCam.id) : undefined;
    if (!p) return;
    const pos = new THREE.Vector3(...p.position);
    const tgt = new THREE.Vector3(...p.target);
    const group = new THREE.Group();
    group.userData.kind = "camera-selection";
    group.position.copy(pos);
    group.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, tgt, new THREE.Vector3(...p.up)));
    const colour = tokenColor(tokenRgb("accent"));
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(0.1, assetHeight() * 0.004), 12, 8),
      new THREE.MeshBasicMaterial({ color: colour, toneMapped: false }),
    );
    group.add(dot);
    if (selectedCam.cone) {
      const c = frustumCorners(p.hfovDeg, p.vfovDeg, pos.distanceTo(tgt));
      const edges = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [2, 3], [3, 4], [4, 1]];
      const g = new THREE.BufferGeometry().setFromPoints(
        edges.flatMap(([a, b]) => [new THREE.Vector3(...c[a]), new THREE.Vector3(...c[b])]),
      );
      group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.95 })));
    }
    helpers.add(group);
  };

  const visibleHit = (h: THREE.Intersection) =>
    h.object.visible && (cutBearing === null || cutPlane.distanceToPoint(h.point) >= 0);

  /** Kit pickSurface: a patch counts only where its label grid has a defect and the model is not in front. */
  const pickPlacement = (): PickHit | null => {
    const hits = raycaster.intersectObjects([...surface.children, ...pins.children], false);
    let occluder: number | null = null;
    const slack = (0.035 * assetHeight()) / 80;
    for (const h of hits) {
      const u = h.object.userData as { kind: string; findingId: string; labels?: LabelGrid };
      if (u.kind === "patch") {
        if (!h.uv || !u.labels || labelAt(u.labels, h.uv.x, h.uv.y) === 0) continue;
        if (occluder === null) occluder = raycaster.intersectObject(modelRoot, true).find(visibleHit)?.distance ?? Infinity;
        if (occluder < h.distance - slack) continue;
      }
      return { kind: "finding", id: u.findingId };
    }
    return null;
  };

  const pickCameraAt = (x: number, y: number, rect: DOMRect): PickHit | null => {
    if (poses.length === 0 || !cams.visible) return null;
    const v = new THREE.Vector3();
    const pts = poses.map((p) => {
      v.set(...p.position).project(active);
      return { id: p.imageId, x: v.x, y: v.y, z: v.z };
    });
    const id = nearestOnScreen(pts, x, y, { width: rect.width, height: rect.height }, CAMERA_PICK_PX);
    return id ? { kind: "camera", id } : null;
  };
```

3h. Replace the body of `onUp` from `const rect = ...` to the end with:

```ts
    const rect = o.canvas.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      active,
    );
    const placed = pickPlacement() ?? pickCameraAt(e.clientX - rect.left, e.clientY - rect.top, rect);
    if (placed) {
      pickCb?.(placed);
      return;
    }
    // With the cut on, the half beyond the plane is clipped away: a click picks what is still drawn.
    const hit = raycaster.intersectObject(modelRoot, true).find(visibleHit);
    let n: THREE.Object3D | null = hit?.object ?? null;
    while (n && !idByNode.has(n)) n = n.parent;
    const id = (n && idByNode.get(n)) ?? null;
    engine.select(id);
    if (id) pickCb?.({ kind: "part", id });
```

3i. In `load`, after `applyCut();` add `applyGhost();`.

3j. Add the new methods to the `engine` object, after `setView,`:

```ts
    setPlacements(next, fetchPatch) {
      items = next;
      loader?.dispose();
      disposeTextured(surface);
      disposeChildren(pins);
      loader = new PatchLoader(fetchPatch, (id, b) => {
        void addPatch(id, b).catch(() => {
          // a patch that does not parse is left out; the pin list and other patches stay
        });
      });
      const lift = assetHeight() * PIN_LIFT_FRACTION;
      for (const it of next) {
        if (it.kind !== "point") continue;
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(1, 16, 12),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(it.colour), toneMapped: false }),
        );
        m.position.set(...liftedPosition(it.center, it.normal, lift));
        m.renderOrder = PIN_RENDER_ORDER;
        m.userData = { kind: "pin", findingId: it.findingId, sightingId: it.sightingId };
        pins.add(m);
      }
      requestRender();
    },
    setCameras(next, colourOf) {
      disposeChildren(cams);
      poses = next;
      if (next.length > 0) {
        const size = Math.max(0.3, assetHeight() * 0.015);
        const mesh = new THREE.InstancedMesh(
          pyramidGeometry(),
          new THREE.MeshBasicMaterial({ wireframe: true, toneMapped: false }),
          next.length,
        );
        const m = new THREE.Matrix4();
        const look = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const s = new THREE.Vector3(size, size, size);
        const c = new THREE.Color();
        next.forEach((p, i) => {
          const pos = new THREE.Vector3(...p.position);
          q.setFromRotationMatrix(look.lookAt(pos, new THREE.Vector3(...p.target), new THREE.Vector3(...p.up)));
          mesh.setMatrixAt(i, m.compose(pos, q, s));
          mesh.setColorAt(i, c.set(colourOf(p)));
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.userData.kind = "cameras";
        cams.add(mesh);
      }
      drawSelectedCamera();
      requestRender();
    },
    setSelectedCamera(imageId, cone) {
      selectedCam = { id: imageId, cone };
      drawSelectedCamera();
      requestRender();
    },
    focusFinding(findingId, settings) {
      const mine = items.filter((p) => p.findingId === findingId);
      const item = mine.find((p) => p.kind === "patch") ?? mine[0];
      if (!item) return false;
      const fv = focusView(
        { kind: item.kind, center: item.center, normal: item.normal, size: item.size },
        assetHeight(),
        settings ?? DEFAULT_FOCUS,
      );
      controls.autoRotate = false;
      orthoHeight = fv.viewHeight;
      sizeOrtho((o.host.clientWidth || 1) / viewportHeight());
      ortho.zoom = 1;
      const target = new THREE.Vector3(...fv.target);
      ortho.position.copy(target).addScaledVector(new THREE.Vector3(...fv.direction), fv.distance);
      ortho.up.set(0, 1, 0);
      ortho.near = 0.05;
      ortho.far = fv.distance * 2 + assetHeight() * 4;
      ortho.lookAt(target);
      ortho.updateProjectionMatrix();
      active = ortho;
      controls.object = ortho;
      controls.target.copy(target);
      controls.update();
      requestRender();
      return true;
    },
    setGhost(on) {
      ghostOn = on;
      applyGhost();
    },
    setAutoRotate(on, speed) {
      controls.autoRotate = on;
      controls.autoRotateSpeed = speed ?? AUTO_ROTATE_SPEED;
      requestRender();
    },
    setGround(tiles) {
      disposeTextured(ground);
      for (const t of tiles ?? []) {
        const tl = new THREE.Vector3(t.tl[0], t.y, t.tl[1]);
        const tr = new THREE.Vector3(t.tr[0], t.y, t.tr[1]);
        const bl = new THREE.Vector3(t.bl[0], t.y, t.bl[1]);
        const br = tr.clone().add(bl).sub(tl);
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute([...tl.toArray(), ...tr.toArray(), ...bl.toArray(), ...br.toArray()], 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2));
        g.setIndex([0, 2, 1, 1, 2, 3]);
        const tex = textureLoader.load(t.url, requestRender);
        tex.colorSpace = THREE.SRGBColorSpace;
        // Drawn without depth writes: the ground never hides the model, pins or cameras.
        const m = new THREE.Mesh(
          g,
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
        );
        m.renderOrder = GROUND_RENDER_ORDER;
        m.userData.kind = "ground";
        ground.add(m);
      }
      if (tiles?.length) {
        const reach = Math.max(...tiles.flatMap((t) => [Math.hypot(...t.tl), Math.hypot(...t.tr), Math.hypot(...t.bl)]));
        camera.far = Math.max(camera.far, reach * 4);
        camera.updateProjectionMatrix();
      }
      requestRender();
    },
    viewFromPose(pose) {
      active = camera;
      controls.object = camera;
      if (!pose) {
        if (savedView) {
          camera.position.copy(savedView.position);
          camera.up.copy(savedView.up);
          camera.fov = savedView.fov;
          controls.target.copy(savedView.target);
          savedView = null;
        }
        camera.updateProjectionMatrix();
        controls.update();
        requestRender();
        return;
      }
      if (!savedView) {
        savedView = { position: camera.position.clone(), target: controls.target.clone(), up: camera.up.clone(), fov: camera.fov };
      }
      const tgt = new THREE.Vector3(...pose.target);
      camera.position.set(...pose.position);
      camera.up.set(...pose.up);
      camera.fov = pose.vfovDeg;
      camera.near = 0.05;
      camera.far = Math.max(camera.far, camera.position.distanceTo(tgt) * 20);
      camera.lookAt(tgt);
      camera.updateProjectionMatrix();
      controls.target.copy(tgt);
      controls.update();
      requestRender();
    },
    onPick(cb) {
      pickCb = cb;
    },
```

3k. In `dispose`, before `renderer.dispose();` add:

```ts
      loader?.dispose();
      disposeTextured(surface);
      disposeTextured(ground);
      disposeChildren(pins);
      disposeChildren(cams);
```

Notes for the implementer:
- `controls.object` is a public, reassignable field of three 0.180's `OrbitControls`; it reads `isPerspectiveCamera` / `isOrthographicCamera` on each update, so zoom works on both cameras.
- The basemap proxy must answer with `Access-Control-Allow-Origin` for WebGL textures. Check with the dev build's network tab; if the header is missing, the proxy route in `backend/app/basemap/` needs it, which is a one-line follow-up for the unit that finds it (U2 is the first to call `setGround`).

- [ ] **Step 4: Implement the shell** in `src/assetmodels/viewer/ModelViewer.tsx`.

Change the imports and types:

```ts
import type { CameraPose } from "./cameras";
import { createModelEngine, type ModelEngine, type ModelPart, type ModelView, type PickHit } from "./engine";
import type { FocusSettings } from "./focus";
import type { GroundTile } from "./ground";
import type { FetchPatch, PlacementItem } from "./placements";

export type ModelViewerHandle = Omit<ModelEngine, "load" | "dispose" | "onPick">;
```

Add to `ModelViewerProps`:

```ts
  /** A click on a finding, a camera or a part (the part also arrives through `onSelect`). */
  onPick?(hit: PickHit): void;
```

Extend `Wanted` and its initial value:

```ts
interface Wanted {
  hidden: Set<string>;
  cut: number | null;
  levels: boolean;
  headOff: boolean;
  overlay: Float32Array | null;
  selected: string | null;
  placements: { items: PlacementItem[]; fetchPatch: FetchPatch } | null;
  cameras: { poses: CameraPose[]; colourOf: (p: CameraPose) => string } | null;
  selectedCamera: { id: string | null; cone: boolean };
  ghost: boolean;
  autoRotate: { on: boolean; speed?: number };
  ground: GroundTile[] | null;
  pose: CameraPose | null;
}
// initial:
    placements: null,
    cameras: null,
    selectedCamera: { id: null, cone: false },
    ghost: false,
    autoRotate: { on: false },
    ground: null,
    pose: null,
```

Right after `engine.current = eng;` add:

```ts
      eng.onPick((hit) => cbs.current.onPick?.(hit));
```

In the load `then`, after `live.setOverlay(w.overlay);` add:

```ts
        if (w.placements) live.setPlacements(w.placements.items, w.placements.fetchPatch);
        if (w.cameras) live.setCameras(w.cameras.poses, w.cameras.colourOf);
        live.setSelectedCamera(w.selectedCamera.id, w.selectedCamera.cone);
        live.setGhost(w.ghost);
        live.setAutoRotate(w.autoRotate.on, w.autoRotate.speed);
        live.setGround(w.ground);
        if (w.pose) live.viewFromPose(w.pose);
```

Add to the `useImperativeHandle` object, after `setView`:

```ts
      setPlacements(items, fetchPatch) {
        wanted.current.placements = { items, fetchPatch };
        engine.current?.setPlacements(items, fetchPatch);
      },
      setCameras(poses, colourOf) {
        wanted.current.cameras = { poses, colourOf };
        engine.current?.setCameras(poses, colourOf);
      },
      setSelectedCamera(id, cone) {
        wanted.current.selectedCamera = { id, cone };
        engine.current?.setSelectedCamera(id, cone);
      },
      focusFinding(id: string, settings?: FocusSettings) {
        wanted.current.pose = null;
        return engine.current?.focusFinding(id, settings) ?? false;
      },
      setGhost(on) {
        wanted.current.ghost = on;
        engine.current?.setGhost(on);
      },
      setAutoRotate(on, speed) {
        wanted.current.autoRotate = { on, speed };
        engine.current?.setAutoRotate(on, speed);
      },
      setGround(tiles) {
        wanted.current.ground = tiles;
        engine.current?.setGround(tiles);
      },
      viewFromPose(pose) {
        wanted.current.pose = pose;
        engine.current?.viewFromPose(pose);
      },
```

- [ ] **Step 5: Extend the test double** `src/test/fakeModelViewer.tsx`:

```ts
import type { PickHit } from "@/assetmodels/viewer/engine";

/** The user clicks a finding, camera or part in the 3D view; wrap it in act(). */
export function emitPick(hit: PickHit): void {
  fake.props?.onPick?.(hit);
}
```

and in the handle object add:

```ts
        setPlacements: rec("setPlacements"),
        setCameras: rec("setCameras"),
        setSelectedCamera: rec("setSelectedCamera"),
        focusFinding: (...args: unknown[]) => {
          fake.calls.push({ name: "focusFinding", args });
          return true;
        },
        setGhost: rec("setGhost"),
        setAutoRotate: rec("setAutoRotate"),
        setGround: rec("setGround"),
        viewFromPose: rec("viewFromPose"),
```

- [ ] **Step 6: Run the tests, lint and build**

Run: `pnpm -C frontend exec vitest run src/assetmodels; pnpm -C frontend lint; pnpm -C frontend build`
Expected: PASS; lint clean (check-tokens: the only colours are data colours and `tokenRgb` reads); build green.

- [ ] **Step 7: Look at it.** Run `pnpm -C contract mock` and `pnpm -C frontend dev`, open `/p/<id>/models/<id>` and, in the browser console, drive the handle through React DevTools or a temporary `window.__viewer` assignment that you remove before committing: `setPlacements` with two hand-made items (one pin, one patch whose `fetchPatch` resolves a three-triangle mesh, a 2 x 2 PNG and a label grid), `setCameras` with ten poses, `setGhost(true)`, `setAutoRotate(true)`, `focusFinding`. Check:
- pins stay about 6 px while zooming;
- the patch draws over the wall without z-fighting and a click on its labelled pixels picks the finding;
- the camera pyramids are one draw call (Spector or the three.js `renderer.info.render.calls` count);
- ghost shows the far side's pins through the model.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/assetmodels/viewer/engine.ts frontend/src/assetmodels/viewer/engine.test.ts frontend/src/assetmodels/viewer/ModelViewer.tsx frontend/src/assetmodels/viewer/ModelViewer.test.tsx frontend/src/test/fakeModelViewer.tsx
git commit -m "feat(asset-findings): engine placements, cameras, focus, ghost, rotate, ground, pose view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `src/api/assetReview.ts`, the asset review API module and hooks

**Files:**
- Create: `frontend/src/api/assetReview.ts`
- Test: `frontend/src/api/assetReview.test.tsx`

**Interfaces:**
- Consumes: C0 operations (`listImagePoses`, `estimateImagePoses`, `listPlacements`, `computePlacements`, `regroupAssetFindings`, `importAssetModelGlb`, `listFindingSightings`, `mergeFinding`, `splitFinding`, `getImageReview`, `putImageReview`, `listFindings` with `asset_model_id`); the URL builders `placementMeshUrl`, `placementTextureUrl`, `placementLabelsUrl`; `useApi`, `useBackend` (`src/api/client.ts`); `unwrap`, `messageOf` (`src/api/errors.ts`); `useOnJobsFinished` (`src/jobs/useOnJobsFinished.ts`).
- Produces (index names; Index note 3 explains the added `projectId` parameter and the extra exports):

```ts
export type ImagePose = S["ImagePose"]; export type Placement = S["Placement"];
export type FindingSighting = S["FindingSighting"]; export type ImageReview = S["ImageReview"];
export const POSES_PAGE = 2000; export const PLACEMENTS_PAGE = 2000; export const FINDINGS_PAGE = 500; export const MAX_PAGES = 50;
export interface Paged<T> { items: T[]; done: boolean; error: string | null; reload(): void }
export function usePoses(projectId: string, modelId: string | null, sequence?: string | null): Paged<ImagePose>;
export function usePlacements(projectId: string, modelId: string | null): Paged<Placement> & { version: number | null };
export function useSightings(projectId: string, findingId: string | null): { sightings: FindingSighting[] | null; error: string | null; reload(): void };
export function useAssetFindings(projectId: string, modelId: string | null, query?: Omit<FindingListQuery, "asset_model_id" | "cursor" | "limit">): Paged<Finding>;
export async function estimatePoses(api: ApiClient, projectId: string, modelId: string, imageIds?: string[]): Promise<Job>;
export async function computePlacements(api: ApiClient, projectId: string, modelId: string, onlyDirty?: boolean): Promise<Job>;
export async function regroup(api: ApiClient, projectId: string, modelId: string): Promise<Job>;
export async function importGlb(api: ApiClient, projectId: string, modelId: string, body: ImportGlbBody): Promise<{ version: AssetModelVersion; job: Job }>;
export async function mergeFinding(api: ApiClient, projectId: string, findingId: string, into: string): Promise<Finding>;
export async function splitFinding(api: ApiClient, projectId: string, findingId: string, sightingIds: string[]): Promise<Finding>;
export async function getImageReview(api: ApiClient, projectId: string, imageId: string): Promise<ImageReview>;
export async function putImageReview(api: ApiClient, projectId: string, imageId: string, body: { status: ImageReview["status"]; note?: string }): Promise<ImageReview>;
export function fetchPatchBuffers(backend: { baseUrl: string; token: string }, projectId: string, modelId: string): FetchPatch;
```

- [ ] **Step 1: Write the failing tests**

```tsx
// src/api/assetReview.test.tsx
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { TestApiProvider } from "@/test/render";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import {
  POSES_PAGE,
  computePlacements,
  estimatePoses,
  mergeFinding,
  putImageReview,
  regroup,
  splitFinding,
  useAssetFindings,
  usePlacements,
  usePoses,
} from "./assetReview";

const pose = (id: string) => ({ image_id: id, position: [1, 2, 3], target: [0, 0, 0], up: [0, 1, 0], hfov_deg: 70,
  vfov_deg: 52, source: "kit", accuracy_m: null, sequence: "A", outcome: "finding", updated_at: "2026-10-03T00:00:00Z" });
const job = { id: "j1", type: "asset_place", state: "queued" };

function wrap(api: Parameters<typeof TestApiProvider>[0]["api"]) {
  return ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;
}

describe("asset review hooks", () => {
  it("usePoses pages with after and limit until next is null", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/asset-models\/m1\/poses$/,
      body: (r) => (r.url.includes("after=c1") ? { items: [pose("i3")], next: null } : { items: [pose("i1"), pose("i2")], next: "c1" }) }]);
    const { result } = renderHook(() => usePoses(PROJECT_ID, "m1"), { wrapper: wrap(api) });
    await waitFor(() => expect(result.current.done).toBe(true));
    expect(result.current.items.map((p) => p.image_id)).toEqual(["i1", "i2", "i3"]);
    const urls = requests.filter((r) => r.url.includes("/poses")).map((r) => r.url);
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => u.includes(`limit=${POSES_PAGE}`))).toBe(true);
    expect(urls[1]).toContain("after=c1");
  });

  it("stops when the mock repeats a cursor, and keeps the version of the placements index", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/placements$/,
      body: { version: 3, items: [{ sighting_id: "s1" }], next: "string" } }]);
    const { result } = renderHook(() => usePlacements(PROJECT_ID, "m1"), { wrapper: wrap(api) });
    await waitFor(() => expect(result.current.done).toBe(true));
    expect(result.current.version).toBe(3);
    expect(requests.filter((r) => r.url.includes("/placements")).length).toBe(2);
  });

  it("useAssetFindings pages findings of one model with cursor and limit 500", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/findings$/,
      body: (r) => (r.url.includes("cursor=n2") ? { items: [{ id: "f2" }], next_cursor: null } : { items: [{ id: "f1" }], next_cursor: "n2" }) }]);
    const { result } = renderHook(() => useAssetFindings(PROJECT_ID, "m1", { sort: "-severity" }), { wrapper: wrap(api) });
    await waitFor(() => expect(result.current.done).toBe(true));
    expect(result.current.items.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(requests[0].url).toContain("asset_model_id=m1");
    expect(requests[0].url).toContain("limit=500");
  });

  it("reports a failed page as an error and keeps what arrived", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/poses$/, status: 500,
      body: { error: { code: "internal", message: "boom", details: {} } } }]);
    const { result } = renderHook(() => usePoses(PROJECT_ID, "m1"), { wrapper: wrap(api) });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.items).toEqual([]);
  });
});

describe("asset review actions", () => {
  it("starts the jobs on the slash-verb paths and returns the job", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/poses\/estimate$/, status: 202, body: { job } },
      { method: "POST", path: /\/placements\/compute$/, status: 202, body: { job } },
      { method: "POST", path: /\/findings\/regroup$/, status: 202, body: { job } },
    ]);
    expect((await estimatePoses(api, PROJECT_ID, "m1")).id).toBe("j1");
    expect((await computePlacements(api, PROJECT_ID, "m1", true)).id).toBe("j1");
    expect((await regroup(api, PROJECT_ID, "m1")).id).toBe("j1");
    expect(requests.map((r) => [r.url.replace(/^.*asset-models\/m1/, ""), r.body])).toEqual([
      ["/poses/estimate", {}],
      ["/placements/compute", { only_dirty: true }],
      ["/findings/regroup", null],
    ]);
  });

  it("merges, splits and sets a photo review", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/findings\/f1\/merge$/, body: { id: "f2" } },
      { method: "POST", path: /\/findings\/f1\/split$/, body: { id: "f9" } },
      { method: "PUT", path: /\/images\/i1\/review$/, body: { image_id: "i1", status: "uncertain" } },
    ]);
    expect((await mergeFinding(api, PROJECT_ID, "f1", "f2")).id).toBe("f2");
    expect((await splitFinding(api, PROJECT_ID, "f1", ["s1"])).id).toBe("f9");
    expect((await putImageReview(api, PROJECT_ID, "i1", { status: "uncertain" })).status).toBe("uncertain");
    expect(requests.map((r) => r.body)).toEqual([{ into: "f2" }, { sighting_ids: ["s1"] }, { status: "uncertain" }]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/api/assetReview.test.tsx`
Expected: FAIL (`Failed to resolve import "./assetReview"`)

- [ ] **Step 3: Implement**

```ts
// src/api/assetReview.ts
// The asset review operations of spec §8 (contract by C0). Lists are keyset-paged and read a page
// at a time, at most 2,000 poses or placements and 500 findings per request (Review Focus 5).
import { useCallback, useEffect, useRef, useState } from "react";
import {
  placementLabelsUrl,
  placementMeshUrl,
  placementTextureUrl,
  type ApiClient,
  type AssetModelVersion,
  type Job,
  type components,
  type paths,
} from "@contract/client";
import type { FetchPatch } from "@/assetmodels/viewer/placements";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { useApi } from "./client";
import { messageOf, unwrap } from "./errors";
import { listFindings, type Finding, type FindingListQuery } from "./findings";

type S = components["schemas"];
export type ImagePose = S["ImagePose"];
export type Placement = S["Placement"];
export type FindingSighting = S["FindingSighting"];
export type ImageReview = S["ImageReview"];

export const POSES_PAGE = 2000;
export const PLACEMENTS_PAGE = 2000;
export const FINDINGS_PAGE = 500;
export const MAX_PAGES = 50;

const P = "/api/v1/projects/{projectId}" as const;
const M = `${P}/asset-models/{assetModelId}` as const;
const mPath = (projectId: string, assetModelId: string) => ({ projectId, assetModelId });

export interface Paged<T> {
  items: T[];
  done: boolean;
  error: string | null;
  reload(): void;
}

interface PageOf<T> {
  items: T[];
  next: string | null;
}

/**
 * Reads every page of a keyset list, one request at a time, publishing after each page so a long
 * list shows as it arrives. Stops on a null or repeated cursor (the Prism mock repeats "string"),
 * on an error (kept items stay), or after MAX_PAGES.
 */
function usePaged<T, Pg extends PageOf<T>>(
  key: string | null,
  fetchPage: (after: string | null) => Promise<Pg>,
): Paged<T> & { first: Pg | null } {
  const [gen, setGen] = useState(0);
  const [state, setState] = useState<{ tag: string; items: T[]; done: boolean; error: string | null; first: Pg | null } | null>(null);
  const fetchRef = useRef(fetchPage);
  useEffect(() => {
    fetchRef.current = fetchPage;
  });
  const tag = key === null ? null : `${key}#${gen}`;
  useEffect(() => {
    if (tag === null) return;
    let alive = true;
    void (async () => {
      const seen = new Set<string>();
      let after: string | null = null;
      let items: T[] = [];
      let first: Pg | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        let got: Pg;
        try {
          got = await fetchRef.current(after);
        } catch (e) {
          if (alive) setState({ tag, items, done: true, error: messageOf(e, "The list could not be loaded."), first });
          return;
        }
        if (!alive) return;
        first ??= got;
        items = items.concat(got.items);
        const next = got.next;
        const end = !next || seen.has(next) || page === MAX_PAGES - 1;
        setState({ tag, items, done: end, error: null, first });
        if (end) return;
        seen.add(next);
        after = next;
      }
    })();
    return () => {
      alive = false;
    };
  }, [tag]);
  const reload = useCallback(() => setGen((g) => g + 1), []);
  const mine = state && state.tag === tag ? state : null;
  return { items: mine?.items ?? [], done: mine?.done ?? false, error: mine?.error ?? null, first: mine?.first ?? null, reload };
}

export function usePoses(projectId: string, modelId: string | null, sequence: string | null = null): Paged<ImagePose> {
  const api = useApi();
  const paged = usePaged<ImagePose, PageOf<ImagePose>>(
    modelId ? `${projectId}/${modelId}/poses/${sequence ?? ""}` : null,
    async (after) =>
      unwrap(
        api.GET(`${M}/poses`, {
          params: {
            path: mPath(projectId, modelId ?? ""),
            query: { limit: POSES_PAGE, ...(after ? { after } : {}), ...(sequence ? { sequence } : {}) },
          },
        }),
      ),
  );
  useOnJobsFinished("asset_pose", paged.reload);
  useOnJobsFinished("review_kit_import", paged.reload);
  return paged;
}

export function usePlacements(projectId: string, modelId: string | null): Paged<Placement> & { version: number | null } {
  const api = useApi();
  const paged = usePaged<Placement, PageOf<Placement> & { version: number }>(
    modelId ? `${projectId}/${modelId}/placements` : null,
    async (after) =>
      unwrap(
        api.GET(`${M}/placements`, {
          params: { path: mPath(projectId, modelId ?? ""), query: { limit: PLACEMENTS_PAGE, ...(after ? { after } : {}) } },
        }),
      ),
  );
  useOnJobsFinished("asset_place", paged.reload);
  useOnJobsFinished("asset_group", paged.reload);
  useOnJobsFinished("review_kit_import", paged.reload);
  return { ...paged, version: paged.first?.version ?? null };
}

export function useAssetFindings(
  projectId: string,
  modelId: string | null,
  query: Omit<FindingListQuery, "asset_model_id" | "cursor" | "limit"> = {},
): Paged<Finding> {
  const api = useApi();
  const q = JSON.stringify(query);
  const paged = usePaged<Finding, PageOf<Finding>>(modelId ? `${projectId}/${modelId}/findings/${q}` : null, async (after) => {
    const page = await listFindings(api, projectId, {
      ...(JSON.parse(q) as FindingListQuery),
      asset_model_id: modelId ?? "",
      limit: FINDINGS_PAGE,
      ...(after ? { cursor: after } : {}),
    });
    return { items: page.items, next: page.next_cursor };
  });
  useOnJobsFinished("asset_group", paged.reload);
  useOnJobsFinished("asset_place", paged.reload);
  useOnJobsFinished("review_kit_import", paged.reload);
  return paged;
}

export function useSightings(projectId: string, findingId: string | null) {
  const api = useApi();
  const [gen, setGen] = useState(0);
  const [state, setState] = useState<{ key: string; sightings: FindingSighting[] | null; error: string | null } | null>(null);
  const key = findingId ? `${projectId}/${findingId}#${gen}` : null;
  useEffect(() => {
    if (!key || !findingId) return;
    let alive = true;
    unwrap(api.GET(`${P}/findings/{findingId}/sightings`, { params: { path: { projectId, findingId } } })).then(
      (r) => alive && setState({ key, sightings: r.items, error: null }),
      (e: unknown) => alive && setState({ key, sightings: null, error: messageOf(e, "The sightings could not be loaded.") }),
    );
    return () => {
      alive = false;
    };
  }, [api, projectId, findingId, key]);
  const reload = useCallback(() => setGen((g) => g + 1), []);
  useOnJobsFinished("asset_group", reload);
  const mine = state && state.key === key ? state : null;
  return { sightings: mine?.sightings ?? null, error: mine?.error ?? null, reload };
}

export async function estimatePoses(api: ApiClient, projectId: string, modelId: string, imageIds?: string[]): Promise<Job> {
  const r = await unwrap(
    api.POST(`${M}/poses/estimate`, { params: { path: mPath(projectId, modelId) }, body: imageIds ? { image_ids: imageIds } : {} }),
  );
  return r.job;
}

export async function computePlacements(api: ApiClient, projectId: string, modelId: string, onlyDirty = false): Promise<Job> {
  const r = await unwrap(
    api.POST(`${M}/placements/compute`, { params: { path: mPath(projectId, modelId) }, body: onlyDirty ? { only_dirty: true } : {} }),
  );
  return r.job;
}

export async function regroup(api: ApiClient, projectId: string, modelId: string): Promise<Job> {
  const r = await unwrap(api.POST(`${M}/findings/regroup`, { params: { path: mPath(projectId, modelId) } }));
  return r.job;
}

export type ImportGlbBody = NonNullable<
  paths["/api/v1/projects/{projectId}/asset-models/{assetModelId}/versions/import-glb"]["post"]["requestBody"]
>["content"]["application/json"];

export async function importGlb(
  api: ApiClient,
  projectId: string,
  modelId: string,
  body: ImportGlbBody,
): Promise<{ version: AssetModelVersion; job: Job }> {
  return unwrap(api.POST(`${M}/versions/import-glb`, { params: { path: mPath(projectId, modelId) }, body }));
}

export async function mergeFinding(api: ApiClient, projectId: string, findingId: string, into: string): Promise<Finding> {
  return unwrap(api.POST(`${P}/findings/{findingId}/merge`, { params: { path: { projectId, findingId } }, body: { into } }));
}

export async function splitFinding(api: ApiClient, projectId: string, findingId: string, sightingIds: string[]): Promise<Finding> {
  return unwrap(
    api.POST(`${P}/findings/{findingId}/split`, { params: { path: { projectId, findingId } }, body: { sighting_ids: sightingIds } }),
  );
}

export async function getImageReview(api: ApiClient, projectId: string, imageId: string): Promise<ImageReview> {
  return unwrap(api.GET(`${P}/images/{imageId}/review`, { params: { path: { projectId, imageId } } }));
}

export async function putImageReview(
  api: ApiClient,
  projectId: string,
  imageId: string,
  body: { status: ImageReview["status"]; note?: string },
): Promise<ImageReview> {
  return unwrap(api.PUT(`${P}/images/{imageId}/review`, { params: { path: { projectId, imageId } }, body }));
}

/** One patch's three files, fetched in parallel (token in the query, as for GLBs and image files). */
export function fetchPatchBuffers(backend: { baseUrl: string; token: string }, projectId: string, modelId: string): FetchPatch {
  const get = async (url: string) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`patch ${r.status}`);
    return r;
  };
  return async (sightingId) => {
    const { baseUrl, token } = backend;
    const [mesh, texture, labels] = await Promise.all([
      get(placementMeshUrl(baseUrl, token, projectId, modelId, sightingId)).then((r) => r.arrayBuffer()),
      get(placementTextureUrl(baseUrl, token, projectId, modelId, sightingId)).then((r) => r.blob()),
      get(placementLabelsUrl(baseUrl, token, projectId, modelId, sightingId)).then((r) => r.arrayBuffer()),
    ]);
    return { mesh, texture, labels };
  };
}
```

Notes for the implementer:
- `api.POST` for regroup has no body; the recorded request body is `null`, which the test expects.
- If C0 named the poses page fields differently (for example `next_cursor`), adapt `PageOf` in one place and keep the hook signatures.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm -C frontend exec vitest run src/api/assetReview.test.tsx; pnpm -C frontend lint`
Expected: PASS (6 tests), lint clean

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/assetReview.ts frontend/src/api/assetReview.test.tsx
git commit -m "feat(asset-findings): asset review api module with paged hooks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Gate and land

- [ ] **Step 1: Run the full gate** from the worktree:

```
pnpm -C contract check
cd backend; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
```

Expected: all green. `models-workspace.spec.ts` and `models-build.spec.ts` must still pass unchanged (the engine's M1 behaviour is untouched). `cargo test` runs only if `frontend/src-tauri/binaries/kestrel-backend-*.exe` exists.

- [ ] **Step 2: Confirm the bundle split.** `pnpm -C frontend build` prints the chunks; the three.js chunk must still be the lazy `AssetModelsScreen` one, not the entry chunk. `src/api/assetReview.ts` imports `placements.ts` for a type only (`import type`), so it pulls no three.js into the entry.

- [ ] **Step 3: Land.** `scripts\finish-task.ps1`, or on PowerShell 5.1 the manual fallback (memory: nested-unit-controllers): merge `task/af-u1` into `main` with `--no-ff`, re-run `pnpm -C frontend test` on `main`, remove the worktree (delete junctions as links first, memory: worktree-junction-venv-rule) and delete the branch.

- [ ] **Step 4: Operator note.** This unit is not user-observable on its own (the workspace starts calling these methods in U2 and U3). Say so in one line in the hand-off.

---

## Self-review

**Spec coverage (§9 engine table):**

| Spec | Where |
| --- | --- |
| `setPlacements`: patches textured, alphaTest 0.3, polygonOffset -4, renderOrder 3, label-grid picking | T1 `labelAt`, T3 loader, T5 `addPatch`, `pickPlacement` |
| pins at about 6 px, lifted along the normal | T2 `pinScale`, `liftedPosition`; T5 `updatePins` |
| `setCameras`: wire pyramids, 13 px picking | T2 `pyramidGeometry`, `nearestOnScreen`; T5 one `InstancedMesh` |
| `focusFinding`: orthographic, frustum and oblique from the profile | T2 `focusView`; T5 ortho camera |
| `setGhost`: opacity 0.25, depthWrite off | T5 `applyGhost` |
| `setAutoRotate` | T5 (loop kept alive while on) |
| `setGround`: proxy tiles, depthWrite off, renderOrder -10 | T4 `groundTiles`; T5 `setGround` |
| `viewFromPose` | T5 |
| §11 placements index paged, patch binaries per visible patch | T6 `usePlacements` (2,000 a page), T3 `PatchLoader` |
| Review Focus 5 (`placements.test.ts` "loads only visible patch binaries") | T3 Step 1 |

**Placeholders:** none. Every name used by a later task is defined in an earlier one (`Vec3` T2, `PlacementItem`/`FetchPatch` T3, `GroundTile` T4, `PickHit` T5).

**Last task:** T7 is the full AGENTS.md gate.

## Index notes

1. **Patch mesh format.** J3's plan did not exist when this was written. U1 parses the layout the planner brief fixed: little-endian `uint32 vertexCount`, then `Float32` positions `xyz * N`, then `Float32` uvs `uv * N`, non-indexed triangles. Spec §5.7 says "Float32 positions, then uvs" without the header. **J3 must confirm** this header in `write_patch`; if J3 drops it, `parsePatchMesh` derives `N = byteLength / 20` instead (one line).
2. **Label grid format.** Spec §5.7 gives "uint8 label grid, at most 128 px" without its size. U1 assumes a 4-byte header `uint16 width, uint16 height` (little-endian) and row 0 at the top (kit `labelAt`). **J3 to confirm** or to send the size in the placements index instead.
3. **Hook signatures.** The index lists `usePoses(modelId)`, `usePlacements(modelId)`, `useSightings(findingId)`. Every existing data hook in the app takes `projectId` first (`useVersions(projectId, modelId)`), so these do too: `usePoses(projectId, modelId, sequence?)` and so on. U1 also exports `useAssetFindings`, `importGlb` and `fetchPatchBuffers`, which U2 and U3 both need, so neither unit duplicates them.
4. **Plant north convention.** `toAssetXZ` takes `north_offset_deg` as the bearing of plant north clockwise from true north. P1 (the `Frame` model) and J2 (`pose_from_exif`) must use the same sign. If they define it the other way, flip the sign of `t` in `toAssetXZ`.
5. **Extra engine method.** Spec §9 Photos asks for a "view cone" for the selected photo; the index's `ModelEngine` list has no method for it. U1 adds `setSelectedCamera(imageId, cone)`. `focusFinding` also takes an optional second argument, the profile's `FocusSettings`, because the engine does not read the asset model.
6. **Contract field names assumed** (C0 owns them): `ImagePose {image_id, position, target, up, hfov_deg, vfov_deg, sequence, outcome}` (spec §5.3 column names; §8 wrote `hfov`/`vfov`), `ImagePoseList {items, next}`, `Placement {sighting_id, finding_id, kind, center, normal, size, severity, patch_url}`, `PlacementList {version, items, next}`, query names `after`, `limit`, `sequence`, and `listFindings` accepting `asset_model_id`. `placementItems` reads `size` as a number or an array of extents, so either C0 shape works.
7. **Prerequisites already merged.** M1 U6 and U7 and the workspace rail are on `main` as of 2026-10-03 (`8340215a`), so U1 to U3 need not wait on `task/am-u6`. The route prefix on `main` is `models`, not `asset-models`.
8. **Auto-rotate speed.** `setAutoRotate(on, speed?)` defaults to `AUTO_ROTATE_SPEED = 0.6` in OrbitControls `autoRotateSpeed` units (one turn per 100 s), the kit's value. U5 calls it without a speed and gets this.
