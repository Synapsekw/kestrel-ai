# Asset findings U3: split inspection: the model beside the photo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The operator opens one finding in a split view: the asset model on the left, focused on the finding, and the photo that saw it on the right, with the finding's polygons filled in its severity colour. They:
- drag or key the splitter between 22 and 75 % (remembered);
- set the overlay opacity, and hold **Space** to compare with the bare photo;
- read the HUD (finding, height, side, capture time, sighting n of m);
- step through the finding's sightings with the arrow keys and through findings with **J** and **K**;
- switch the right pane between **Photo**, **View from pose** and **Model**;
- split the current sighting off into a new finding, or merge the finding into another.

**Architecture:**
- A lazy screen at `/p/:projectId/models/:modelId/inspect?finding=<id>[&sighting=<id>]` (the `models` route prefix of M1 U6; Index note 1), registered in `src/routes/projectRoutes.tsx`. The register's `findingHref` sends asset findings here.
- The left pane is a `ModelViewer` (U1) with the placements, the finding's sighting cameras and the current one's view cone, focused with the profile's focus settings.
- The right pane's **Photo** mode is the existing `ImageCanvas`, loaded through `useImageData` (it fills the images store); the overlay is Konva `Line`s passed as its `overlay` prop, built by a pure `overlayRings` from the store's boxes. **View from pose** and **Model** mount a second `ModelViewer`.
- Pure modules (`split.ts`, `nav.ts`) are unit tested; `useHoldKey` and the screen are tested with Testing Library, a fake `ImageCanvas` and `fakeModelViewer`; one Playwright e2e runs it on the Prism mock with fixtures.
- Keys come from `src/ui/keymap.ts`: a new `inspect` scope holds the arrows and **J**/**K**; **Space** stays the global hold key (its help line names both meanings), held through a small `useHoldKey` hook because `useToolShortcuts` has no key-up.

**Tech Stack:** React 18, TypeScript, react-konva, three 0.180 through U1's `ModelViewer`, `src/ui` primitives (`GlassPanel`, `Segmented`, `Slider`, `Button`, `Dialog`, `Select`, `Field`, `SeverityPill`, `Alert`, `toast`, `useToolShortcuts`), Vitest and Testing Library, Playwright on the Prism mock.

**Spec sections covered:** §9 "Split inspection" (route, splitter 22 to 75 % keyboard accessible and remembered, three right-pane modes, overlay with opacity and hold to compare, HUD, prev and next across sightings and findings), §8 merge and split, §12 e2e "split inspection with hold-to-compare".

**Index and Global Constraints:** `docs/superpowers/plans/2026-10-03-asset-findings.md`

**Needs:** U1 merged (`ModelViewer` methods, `fakeModelViewer`, `src/api/assetReview.ts`: `useAssetFindings`, `useSightings`, `usePoses`, `usePlacements`, `fetchPatchBuffers`, `mergeFinding`, `splitFinding`; `viewer/placements.ts`, `viewer/cameras.ts`). U4 merged (`findingHref`'s `asset` case and `src/test/assetFindingFixtures.ts`; U4 is batch 2, so it lands before this batch-3 unit). C0 merged (contract). U2 is not needed: U3 shares only U1's modules with it.

**Worktree:** `scripts\start-task.ps1 -Name af-u3`

**Before any UI code:** load the design skills (`impeccable`, `emil-design-eng`), read `DESIGN.md`, `src/images/canvas/ImageCanvas.tsx`, `src/images/canvas/useImageData.ts`, `src/store/imagesWorkspace.ts` (the parts this screen drives: `loadImage`, `boxes`, `showAnnotations`, `toggleAnnotations`, `setTool`) and `src/mapws/compare/CompareStage.tsx` (the swipe handle this splitter follows).

**Budget:** no background job. Bounded reads: the findings list in pages of 500 (for J/K), the finding's sightings (one request, a few dozen rows), one photo at a time through the images store (its preview, then the two-level image; never a set), the poses in pages of 2,000 (for the current pose), the placements index in pages of 2,000 and patch binaries only when visible (U1). The cameras drawn are only this finding's sightings.

**Execution DAG:**

```
T1 split.ts + Splitter ─┐
T2 nav.ts (rings, steps) ┼──> T5 screen ──> T6 e2e ──> T7 gate
T3 useHoldKey + keymap ─┤
T4 route, lazy screen, findingHref ┘
```

- Independent: T1, T2, T3, T4.
- Batches: {T1, T2, T3, T4}, then T5, T6, T7.
- Critical path: T2, T5, T6, T7.

---

### Task 1: The splitter

**Files:**
- Create: `frontend/src/assetmodels/inspect/split.ts`
- Create: `frontend/src/assetmodels/inspect/Splitter.tsx`
- Test: `frontend/src/assetmodels/inspect/split.test.ts`, `frontend/src/assetmodels/inspect/Splitter.test.tsx`

**Interfaces:**

```ts
// split.ts
export const SPLIT_MIN = 22; export const SPLIT_MAX = 75; export const SPLIT_DEFAULT = 50;
export const SPLIT_KEY = "kestrel.inspect.split";
export function clampSplit(v: number): number;
export function splitFromKey(current: number, key: string, shift: boolean): number | null;  // ±2, Shift ±10, Home, End
export function splitFromPointer(clientX: number, left: number, width: number): number;
export function readSplit(): number;           // SPLIT_DEFAULT when unset, blocked or garbage
export function writeSplit(v: number): void;
// Splitter.tsx
export function Splitter(p: { value: number; onChange(v: number): void; label?: string }): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/assetmodels/inspect/split.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { SPLIT_DEFAULT, SPLIT_KEY, SPLIT_MAX, SPLIT_MIN, clampSplit, readSplit, splitFromKey, splitFromPointer, writeSplit } from "./split";

afterEach(() => localStorage.clear());

describe("split", () => {
  it("keeps the asset stage between 22 and 75 % of the width", () => {
    expect([SPLIT_MIN, SPLIT_MAX, SPLIT_DEFAULT]).toEqual([22, 75, 50]);
    expect(clampSplit(10)).toBe(22);
    expect(clampSplit(90)).toBe(75);
    expect(clampSplit(Number.NaN)).toBe(50);
  });

  it("moves by keys", () => {
    expect(splitFromKey(50, "ArrowLeft", false)).toBe(48);
    expect(splitFromKey(50, "ArrowRight", true)).toBe(60);
    expect(splitFromKey(74, "ArrowRight", true)).toBe(75);
    expect(splitFromKey(50, "Home", false)).toBe(22);
    expect(splitFromKey(50, "End", false)).toBe(75);
    expect(splitFromKey(50, "a", false)).toBeNull();
  });

  it("follows the pointer across the screen's width", () => {
    expect(splitFromPointer(600, 100, 1000)).toBe(50);
    expect(splitFromPointer(0, 100, 1000)).toBe(22);
  });

  it("remembers the split, and ignores garbage", () => {
    expect(readSplit()).toBe(50);
    writeSplit(63);
    expect(localStorage.getItem(SPLIT_KEY)).toBe("63");
    expect(readSplit()).toBe(63);
    localStorage.setItem(SPLIT_KEY, "banana");
    expect(readSplit()).toBe(50);
  });
});
```

```tsx
// src/assetmodels/inspect/Splitter.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Splitter } from "./Splitter";

function Harness({ onKeyUp = vi.fn() }: { onKeyUp?: () => void }) {
  const [v, setV] = useState(50);
  return (
    <div onKeyDown={onKeyUp}>
      <Splitter value={v} onChange={setV} />
    </div>
  );
}

describe("Splitter", () => {
  it("is a keyboard separator with its value", () => {
    const outer = vi.fn();
    render(<Harness onKeyUp={outer} />);
    const sep = screen.getByRole("separator", { name: /resize the model and photo panes/i });
    expect(sep).toHaveAttribute("aria-orientation", "vertical");
    expect(sep).toHaveAttribute("aria-valuemin", "22");
    expect(sep).toHaveAttribute("aria-valuemax", "75");
    sep.focus();
    fireEvent.keyDown(sep, { key: "End" });
    expect(sep).toHaveAttribute("aria-valuenow", "75");
    fireEvent.keyDown(sep, { key: "ArrowLeft" });
    expect(sep).toHaveAttribute("aria-valuenow", "73");
    // the arrows move the splitter, never the sighting behind it
    expect(outer).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/assetmodels/inspect/split.test.ts src/assetmodels/inspect/Splitter.test.tsx`
Expected: FAIL (the modules don't exist)

- [ ] **Step 3: Implement**

```ts
// src/assetmodels/inspect/split.ts
// The split inspection's splitter (spec §9): the asset stage takes 22 to 75 % of the width, moved
// by pointer or keys, and remembered (one operator, one machine: localStorage is the user setting).
export const SPLIT_MIN = 22;
export const SPLIT_MAX = 75;
export const SPLIT_DEFAULT = 50;
export const SPLIT_KEY = "kestrel.inspect.split";

export function clampSplit(v: number): number {
  if (!Number.isFinite(v)) return SPLIT_DEFAULT;
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, v));
}

export function splitFromKey(current: number, key: string, shift: boolean): number | null {
  const step = shift ? 10 : 2;
  if (key === "ArrowLeft") return clampSplit(current - step);
  if (key === "ArrowRight") return clampSplit(current + step);
  if (key === "Home") return SPLIT_MIN;
  if (key === "End") return SPLIT_MAX;
  return null;
}

export function splitFromPointer(clientX: number, left: number, width: number): number {
  return clampSplit(((clientX - left) / Math.max(width, 1)) * 100);
}

export function readSplit(): number {
  try {
    const raw = localStorage.getItem(SPLIT_KEY);
    return raw === null ? SPLIT_DEFAULT : clampSplit(Number(raw));
  } catch {
    return SPLIT_DEFAULT;
  }
}

export function writeSplit(v: number): void {
  try {
    localStorage.setItem(SPLIT_KEY, String(Math.round(clampSplit(v))));
  } catch {
    // a blocked storage only forgets the split
  }
}
```

```tsx
// src/assetmodels/inspect/Splitter.tsx
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { cx, focusRing } from "@/ui";
import { SPLIT_MAX, SPLIT_MIN, splitFromKey, splitFromPointer } from "./split";

/** A vertical separator between the asset stage and the photo (keys: arrows, Shift+arrows, Home, End). */
export function Splitter({
  value,
  onChange,
  label = "Resize the model and photo panes",
}: {
  value: number;
  onChange(v: number): void;
  label?: string;
}) {
  const drag = useRef<{ left: number; width: number } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const host = e.currentTarget.parentElement?.getBoundingClientRect();
    if (!host) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { left: host.left, width: host.width };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) onChange(splitFromPointer(e.clientX, drag.current.left, drag.current.width));
  };
  const end = () => {
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = splitFromKey(value, e.key, e.shiftKey);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(next);
  };
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={SPLIT_MIN}
      aria-valuemax={SPLIT_MAX}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`${Math.round(value)}% model`}
      data-testid="inspect-splitter"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      className={cx(
        "group relative z-20 w-2 shrink-0 cursor-col-resize touch-none bg-line/40 hover:bg-accent/40",
        focusRing,
      )}
    >
      <span aria-hidden className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line-strong group-hover:bg-accent" />
    </div>
  );
}
```

(Check that `bg-line/40`, `bg-line-strong` and `bg-accent/40` resolve in the Tailwind theme; `pnpm -C frontend lint` runs check-tokens. Use the nearest existing token classes if not.)

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm -C frontend exec vitest run src/assetmodels/inspect/split.test.ts src/assetmodels/inspect/Splitter.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/assetmodels/inspect/split.ts frontend/src/assetmodels/inspect/split.test.ts frontend/src/assetmodels/inspect/Splitter.tsx frontend/src/assetmodels/inspect/Splitter.test.tsx
git commit -m "feat(asset-findings): keyboard splitter for the split inspection

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Navigation and overlay rings

**Files:**
- Create: `frontend/src/assetmodels/inspect/nav.ts`
- Test: `frontend/src/assetmodels/inspect/nav.test.ts`

**Interfaces:**
- Consumes: `Box` (`@contract/client`), `cornersOf`, `orientedRectOf` (`src/images/canvas/geometry.ts`), `FindingSighting` (U1 `assetReview.ts`; J4 `FindingSightingOut {id, finding_id, image_id, annotation_id, severity, placement, center, normal, representative, ...}`).
- Produces:

```ts
export function stepId(ids: readonly string[], current: string | null, dir: 1 | -1): string | null;  // no wrap; null at the ends
export function currentSighting(sightings: readonly FindingSighting[], wanted: string | null): FindingSighting | null;
export interface OverlayRing { id: string; points: number[]; colour: string }
export function overlayRings(boxes: Readonly<Record<string, Box>>, sightings: readonly FindingSighting[], imageId: string,
  colourOf: (severity: number | null) => string): OverlayRing[];
export function captureText(iso: string | null | undefined): string | null;
```

- [ ] **Step 1: Write the failing test**

```ts
// src/assetmodels/inspect/nav.test.ts
import { describe, expect, it } from "vitest";
import { captureText, currentSighting, overlayRings, stepId } from "./nav";

const sighting = (id: string, image_id: string, annotation_id: string | null, extra: object = {}) =>
  ({ id, finding_id: "f1", image_id, annotation_id, severity: 2, group_tag: null, placement: "patch", center: null,
     normal: null, part: null, coverage: null, placed_version: 1, representative: false, created_at: "", ...extra }) as never;

const box = (id: string, extra: object = {}) =>
  ({ id, image_id: "img-1", class_id: "t", x: 10, y: 20, w: 100, h: 50, angle: 0, points: null, ...extra }) as never;

describe("split inspection navigation", () => {
  it("steps without wrapping", () => {
    expect(stepId(["a", "b", "c"], "b", 1)).toBe("c");
    expect(stepId(["a", "b", "c"], "c", 1)).toBeNull();
    expect(stepId(["a", "b", "c"], "a", -1)).toBeNull();
    expect(stepId(["a", "b"], null, 1)).toBe("a");
    expect(stepId(["a", "b"], "gone", 1)).toBe("a");
    expect(stepId([], null, 1)).toBeNull();
  });

  it("opens the asked sighting, else the representative, else the first", () => {
    const list = [sighting("s1", "img-1", "b1"), sighting("s2", "img-2", "b2", { representative: true })];
    expect(currentSighting(list, "s1")?.id).toBe("s1");
    expect(currentSighting(list, null)?.id).toBe("s2");
    expect(currentSighting(list, "gone")?.id).toBe("s2");
    expect(currentSighting([sighting("s9", "img-9", null)], null)?.id).toBe("s9");
    expect(currentSighting([], null)).toBeNull();
  });

  it("rings the finding's polygons and boxes on this photo only", () => {
    const boxes = {
      b1: box("b1", { points: [[0, 0], [10, 0], [10, 10]] }),
      b2: box("b2"),
      other: box("other"),
    };
    const sightings = [sighting("s1", "img-1", "b1"), sighting("s2", "img-1", "b2", { severity: 3 }), sighting("s3", "img-2", "b3")];
    const rings = overlayRings(boxes, sightings, "img-1", (s) => (s === 3 ? "#ff9c3a" : "#e2bf2e"));
    expect(rings.map((r) => r.id)).toEqual(["s1", "s2"]);
    expect(rings[0]).toEqual({ id: "s1", points: [0, 0, 10, 0, 10, 10], colour: "#e2bf2e" });
    expect(rings[1].points).toEqual([10, 20, 110, 20, 110, 70, 10, 70]);
    expect(rings[1].colour).toBe("#ff9c3a");
  });

  it("formats the capture time for the HUD", () => {
    expect(captureText("2026-09-14T06:05:00Z")).toMatch(/14 Sept? 2026/);
    expect(captureText(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/assetmodels/inspect/nav.test.ts`
Expected: FAIL (`Failed to resolve import "./nav"`)

- [ ] **Step 3: Implement**

```ts
// src/assetmodels/inspect/nav.ts
import type { Box } from "@contract/client";
import type { FindingSighting } from "@/api/assetReview";
import { cornersOf, orientedRectOf } from "@/images/canvas/geometry";

export function stepId(ids: readonly string[], current: string | null, dir: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const i = current === null ? -1 : ids.indexOf(current);
  if (i < 0) return ids[0];
  return ids[i + dir] ?? null;
}

export function currentSighting(sightings: readonly FindingSighting[], wanted: string | null): FindingSighting | null {
  return (
    sightings.find((s) => s.id === wanted) ?? sightings.find((s) => s.representative) ?? sightings[0] ?? null
  );
}

export interface OverlayRing {
  id: string;
  /** Flat [x0, y0, x1, y1, ...] in stored-image pixels, for a closed Konva Line. */
  points: number[];
  colour: string;
}

/** Spec §9 overlay: the finding's own shapes on this photo; the polygon when there is one (A4: polygons are the truth). */
export function overlayRings(
  boxes: Readonly<Record<string, Box>>,
  sightings: readonly FindingSighting[],
  imageId: string,
  colourOf: (severity: number | null) => string,
): OverlayRing[] {
  const out: OverlayRing[] = [];
  for (const s of sightings) {
    if (s.image_id !== imageId || !s.annotation_id) continue;
    const b = boxes[s.annotation_id];
    if (!b) continue;
    const points = b.points?.length ? b.points.flat() : cornersOf(orientedRectOf(b)).flatMap((p) => [p.x, p.y]);
    out.push({ id: s.id, points, colour: colourOf(s.severity ?? null) });
  }
  return out;
}

export function captureText(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return t.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm -C frontend exec vitest run src/assetmodels/inspect/nav.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/assetmodels/inspect/nav.ts frontend/src/assetmodels/inspect/nav.test.ts
git commit -m "feat(asset-findings): sighting and finding stepping, overlay rings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The inspect keys and hold to compare

**Files:**
- Modify: `frontend/src/ui/keymap.ts` (`WorkspaceScope` += `"inspect"`; `WORKSPACE_KEYS.inspect`; the global Space help)
- Modify: `frontend/src/app/routeModel.ts` (`RouteInfo.sheet?`; `sheetScope` returns `"inspect"` on the inspect route)
- Create: `frontend/src/assetmodels/inspect/useHoldKey.ts`
- Test: `frontend/src/assetmodels/inspect/useHoldKey.test.tsx`, `frontend/src/ui/keymap.test.tsx` (still green: no collisions), `frontend/src/app/routeModel.test.ts` (extend)

**Interfaces:**

```ts
// keymap.ts
export type WorkspaceScope = "images" | "maps" | "clouds" | "clouds.fly" | "models" | "findings" | "inspect";
// WORKSPACE_KEYS.inspect: ArrowLeft previous-sighting, ArrowRight next-sighting, J next-finding, K previous-finding
// useHoldKey.ts
export function useHoldKey(chord: string, onChange: (held: boolean) => void, enabled?: boolean): void;
```

- [ ] **Step 1: Write the failing tests**

```tsx
// src/assetmodels/inspect/useHoldKey.test.tsx
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHoldKey } from "./useHoldKey";

function Harness({ onChange }: { onChange: (h: boolean) => void }) {
  useHoldKey("Space", onChange);
  return <input aria-label="note" />;
}

describe("useHoldKey", () => {
  it("reports press and release once each, ignoring key repeat", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.keyDown(window, { key: " " });
    fireEvent.keyDown(window, { key: " ", repeat: true });
    fireEvent.keyUp(window, { key: " " });
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it("does not fire while typing and lets go when the window loses focus", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<Harness onChange={onChange} />);
    fireEvent.keyDown(getByLabelText("note"), { key: " " });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: " " });
    fireEvent.blur(window);
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });
});
```

Add to `src/app/routeModel.test.ts`:

```ts
it("the split inspection's ? sheet shows the inspect keys", () => {
  const info = routeInfo("/p/p1/models/m1/inspect");
  expect(info.tab).toBe("models");
  expect(info.layout).toBe("fullbleed");
  expect(sheetScope(info)).toBe("inspect");
  expect(sheetScope(routeInfo("/p/p1/models/m1"))).toBe("models");
});
```

(Add `sheetScope` to that file's import from `./routeModel` if missing.)

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/assetmodels/inspect/useHoldKey.test.tsx src/app/routeModel.test.ts src/ui/keymap.test.tsx`
Expected: FAIL (`useHoldKey` missing; `sheetScope` answers `"models"`)

- [ ] **Step 3: Implement**

`src/ui/keymap.ts`:
- `export type WorkspaceScope = "images" | "maps" | "clouds" | "clouds.fly" | "models" | "findings" | "inspect";`
- after `const md = entry("models");` add `const ins = entry("inspect");`
- change the global Space line to:

```ts
  g("Space", "pan-hold", "Hold to pan from any tool; in split inspection, hold to compare with the bare photo"),
```

- add to `WORKSPACE_KEYS`, after `findings`:

```ts
  // Split inspection (asset findings spec §9): sightings with the arrows, findings with J and K as
  // the register does; Space is the global hold key (hold to compare here).
  inspect: [
    ins("ArrowLeft", "previous-sighting", "Previous sighting of this finding"),
    ins("ArrowRight", "next-sighting", "Next sighting of this finding"),
    ins("J", "next-finding", "Next finding"),
    ins("K", "previous-finding", "Previous finding"),
  ],
```

`src/app/routeModel.ts`:
- add to `RouteInfo`: `/** A screen inside a tab with keys of its own (the split inspection). */ sheet?: WorkspaceScope;`
- in the `head === "p"` branch, return `...(seg === "models" && parts[4] === "inspect" ? { sheet: "inspect" as const } : {})` inside the object;
- `sheetScope`: first line `if (info.sheet) return info.sheet;`

```ts
// src/assetmodels/inspect/useHoldKey.ts
import { useEffect, useRef } from "react";
import { chordOf, isTypingTarget, normaliseChord } from "@/ui";

/**
 * Calls `onChange(true)` when `chord` goes down and `onChange(false)` when it comes up (or the window
 * loses focus mid-hold). For hold-to-compare: `useToolShortcuts` binds key-down only.
 */
export function useHoldKey(chord: string, onChange: (held: boolean) => void, enabled = true): void {
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  });
  useEffect(() => {
    if (!enabled) return;
    const want = normaliseChord(chord);
    let held = false;
    const set = (on: boolean) => {
      if (held === on) return;
      held = on;
      cb.current(on);
    };
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.defaultPrevented || isTypingTarget(e.target) || chordOf(e) !== want) return;
      e.preventDefault();
      set(true);
    };
    const up = (e: KeyboardEvent) => {
      if (chordOf(e) === want || e.key === " ") set(false);
    };
    const blur = () => set(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      if (held) cb.current(false);
    };
  }, [chord, enabled]);
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm -C frontend exec vitest run src/assetmodels/inspect/useHoldKey.test.tsx src/app/routeModel.test.ts src/ui/keymap.test.tsx`
Expected: PASS (the keymap walk finds no collision: `inspect` shares no chord with the global or review keys; J and K repeat other workspace scopes, which never fire together)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ui/keymap.ts frontend/src/app/routeModel.ts frontend/src/app/routeModel.test.ts frontend/src/assetmodels/inspect/useHoldKey.ts frontend/src/assetmodels/inspect/useHoldKey.test.tsx
git commit -m "feat(asset-findings): inspect keys and hold to compare

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Route, lazy screen and the register's link

**Files:**
- Create: `frontend/src/screens/AssetInspectScreen.tsx` (thin wrapper)
- Modify: `frontend/src/app/lazyScreens.tsx` (`AssetInspectScreen`)
- Modify: `frontend/src/routes/projectRoutes.tsx` (`models/:modelId/inspect`)
- Modify: `frontend/src/findings/links.ts` (`findingHref`'s `asset` case points at the inspection)
- Modify: `frontend/src/findings/model.test.ts` (U4's asset link test moves with it)
- Test: `frontend/src/routes/routes.test.tsx` (extend)

**Interfaces:**
- Consumes: `findingHref` (`src/findings/links.ts`, U4's `asset` case), `exampleAssetFinding`, `ASSET_MODEL_ID` (`src/test/assetFindingFixtures.ts`, U4).
- Produces: route `/p/:projectId/models/:modelId/inspect?finding=<id>[&sighting=<id>]`; `findingHref(projectId, assetFinding) === "/p/<p>/models/<model>/inspect?finding=<id>"`; lazy `AssetInspectScreen` (`data-testid="asset-inspect"`, built in Task 5; this task renders a placeholder with that test id).

- [ ] **Step 1: Write the failing tests**

In `src/findings/model.test.ts`, replace U4's test `"links an asset finding to its asset model workspace"` with:

```ts
  it("links an asset finding to its split inspection", () => {
    expect(findingHref(PROJECT_ID, exampleAssetFinding)).toBe(
      `/p/${PROJECT_ID}/models/${ASSET_MODEL_ID}/inspect?finding=${exampleAssetFinding.id}`,
    );
  });
```

In `src/routes/routes.test.tsx`, following the existing `models` route test (which mocks the lazy screen module), add:

```tsx
it("mounts the split inspection under the asset model", async () => {
  renderRoute(`/p/${PROJECT_ID}/models/m1/inspect?finding=f1`);
  expect(await screen.findByTestId("asset-inspect")).toBeInTheDocument();
});
```

using the file's own render helper and mock pattern (mock `@/screens/AssetInspectScreen` the way the file mocks `@/screens/AssetModelsScreen`).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/findings/model.test.ts src/routes/routes.test.tsx`
Expected: FAIL (the link still points at the workspace; no inspect route)

- [ ] **Step 3: Implement**

`src/findings/links.ts`, the `asset` case:

```ts
    case "asset":
      // Asset findings open in the split inspection (asset findings spec §9).
      return `/p/${projectId}/models/${a.asset_model_id}/inspect?finding=${fid}`;
```

`src/screens/AssetInspectScreen.tsx`:

```tsx
import { AssetInspect } from "@/assetmodels/inspect/AssetInspect";

export function AssetInspectScreen() {
  return <AssetInspect />;
}
```

`src/assetmodels/inspect/AssetInspect.tsx` (placeholder until Task 5 replaces it whole):

```tsx
export function AssetInspect() {
  return <div data-testid="asset-inspect" className="h-full" />;
}
```

`src/app/lazyScreens.tsx`, after `AssetModelsScreen`:

```ts
export const AssetInspectScreen = lazy(() =>
  import("@/screens/AssetInspectScreen").then((m) => ({ default: m.AssetInspectScreen })),
);
```

`src/routes/projectRoutes.tsx`: add `AssetInspectScreen` to the `@/app/lazyScreens` import and, after the `models/:modelId` entry:

```tsx
  // Split inspection (asset findings spec §9): /p/:projectId/models/:modelId/inspect?finding=<id>[&sighting=<id>].
  // The register's findingHref sends asset findings here.
  {
    path: "models/:modelId/inspect",
    element: (
      <Later>
        <AssetInspectScreen />
      </Later>
    ),
  },
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm -C frontend exec vitest run src/findings/model.test.ts src/routes/routes.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/findings/links.ts frontend/src/findings/model.test.ts frontend/src/screens/AssetInspectScreen.tsx frontend/src/assetmodels/inspect/AssetInspect.tsx frontend/src/app/lazyScreens.tsx frontend/src/routes/projectRoutes.tsx frontend/src/routes/routes.test.tsx
git commit -m "feat(asset-findings): split inspection route; asset findings link to it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The split inspection screen

**Files:**
- Modify (replace): `frontend/src/assetmodels/inspect/AssetInspect.tsx`
- Create: `frontend/src/assetmodels/inspect/InspectOverlay.tsx` (Konva rings)
- Create: `frontend/src/assetmodels/inspect/PhotoPane.tsx` (the `ImageCanvas`, overlay, opacity, compare)
- Create: `frontend/src/assetmodels/inspect/StagePane.tsx` (a `ModelViewer` for the left stage and the two 3D modes)
- Create: `frontend/src/assetmodels/inspect/InspectHud.tsx`
- Create: `frontend/src/assetmodels/inspect/FindingActions.tsx` (split and merge)
- Test: `frontend/src/assetmodels/inspect/AssetInspect.test.tsx`

**Interfaces:**
- Consumes: Tasks 1 to 4; U1 `useAssetFindings`, `useSightings`, `usePoses`, `usePlacements`, `fetchPatchBuffers`, `mergeFinding`, `splitFinding`, `placementItems`, `cameraPosesFrom`, `ModelViewer`, `ModelViewerHandle`; `useImageData` (`src/images/canvas/useImageData.ts`); `useImageUrl` (`src/images/workspace/seams.tsx`); `ImageCanvas` (`src/images/canvas/ImageCanvas.tsx`); `useImagesWorkspace` (`src/store/imagesWorkspace.ts`); `useProjectTypes`; `useAssetModelList`, `useVersions` (`src/assetmodels/useAssetModels.ts`); `assetModelGlbUrl`; `focusSettingsOf`-equivalent read of `model.review.focus`; `formatFindingNumber`; `fetchFinding` (`src/api/findings.ts`); `WORKSPACE_KEYS.inspect`.
- Produces: `AssetInspect` (`data-testid="asset-inspect"`), the right pane `data-testid="inspect-photo"` with `data-overlay="on" | "off"` and `data-rings="<n>"`, the HUD `data-testid="inspect-hud"`.

Layout:

| Element | Placement |
| --- | --- |
| Asset stage | left, `width: <split>%`, full height; a `GlassPanel` bar at `left-3.5 top-3.5`: **Back to the model** link, the finding's number and type, **Previous finding** / **Next finding** buttons |
| Splitter | between the panes, 8 px |
| Right pane | the rest; a `GlassPanel` bar at `right-3.5 top-3.5`: the mode `Segmented` (Photo, View from pose, Model), the opacity `Slider` and **Hold to compare** (Photo mode only); the HUD at `left-3.5 bottom-3.5`; the actions (Previous / Next sighting, Split off this sighting, Merge into…) at `right-3.5 bottom-3.5` |

- [ ] **Step 1: Write the failing test**

```tsx
// src/assetmodels/inspect/AssetInspect.test.tsx
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { forwardRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { exampleImage, fakeClient, personBox, PROJECT_ID } from "@/test/fixtures";
import { ASSET_FINDINGS, MODEL_REVIEWED, PLACEMENTS } from "@/test/assetFindingFixtures";
import { VERSION_2 } from "@/test/assetModelFixtures";
import { useImagesWorkspace } from "@/store/imagesWorkspace";

vi.mock("@/assetmodels/viewer/ModelViewer", async () => ({
  ModelViewer: (await import("@/test/fakeModelViewer")).FakeModelViewer,
}));
vi.mock("@/images/canvas/ImageCanvas", () => ({
  ImageCanvas: forwardRef(function FakeCanvas(p: { overlay?: ReactNode }, _ref) {
    return <div data-testid="image-canvas" data-has-overlay={p.overlay ? "yes" : "no"} />;
  }),
}));
import { callsTo, emitState, resetFake } from "@/test/fakeModelViewer";
import { SPLIT_KEY } from "./split";
import { AssetInspect } from "./AssetInspect";

const sighting = (id: string, image_id: string, annotation_id: string, representative = false) => ({
  id, finding_id: "f1", image_id, annotation_id, severity: 2, group_tag: null, placement: "patch",
  center: [10, 12.4, -3], normal: [0, 0, -1], part: null, coverage: 0.01, placed_version: 2, representative,
  created_at: "2026-10-03T00:00:00Z",
});
const SIGHTINGS = [sighting("s1", "img-1", "b-1", true), sighting("s2", "img-2", "b-2")];
const pose = (image_id: string) => ({ image_id, position: [30, 12, 0], target: [10, 12, -3], up: [0, 1, 0], hfov_deg: 70,
  vfov_deg: 52, source: "kit", accuracy_m: null, sequence: "A", outcome: "finding", updated_at: "2026-10-03T00:00:00Z" });
const image = (id: string) => ({ ...exampleImage, id, width: 4000, height: 3000, capture_time: "2026-09-14T06:05:00Z",
  camera: {}, footprint: null, footprint_kind: "none" });
const boxOn = (imageId: string, id: string) => ({ ...personBox, id, image_id: imageId, points: [[0, 0], [100, 0], [100, 80]] });

const routes = (extra: unknown[] = []) => [
  ...extra,
  { method: "GET", path: /\/asset-models$/, body: { items: [MODEL_REVIEWED] } },
  { method: "GET", path: /\/asset-models\/m1\/versions$/, body: { items: [VERSION_2] } },
  { method: "GET", path: /\/findings$/, body: { items: ASSET_FINDINGS, next_cursor: null } },
  { method: "GET", path: /\/findings\/f1\/sightings$/, body: { items: SIGHTINGS } },
  { method: "GET", path: /\/findings\/f2\/sightings$/, body: { items: [] } },
  { method: "GET", path: /\/placements$/, body: PLACEMENTS },
  { method: "GET", path: /\/poses$/, body: { items: [pose("img-1"), pose("img-2")], next: null } },
  { method: "GET", path: /\/images\/img-1$/, body: image("img-1") },
  { method: "GET", path: /\/images\/img-2$/, body: image("img-2") },
  { method: "GET", path: /\/images\/img-1\/boxes$/, body: { items: [boxOn("img-1", "b-1")] } },
  { method: "GET", path: /\/images\/img-2\/boxes$/, body: { items: [boxOn("img-2", "b-2")] } },
  { method: "GET", path: /\/measurements$/, body: { items: [] } },
];

const open = (search = "?finding=f1", extra: unknown[] = []) => {
  const client = fakeClient(routes(extra) as never);
  renderWithProviders(
    <>
      <AssetInspect />
      <LocationProbe />
    </>,
    { api: client.api, route: `/p/${PROJECT_ID}/models/m1/inspect${search}`, path: "/p/:projectId/models/:modelId/inspect" },
  );
  return client;
};

beforeEach(() => resetFake());
afterEach(() => {
  localStorage.clear();
  useImagesWorkspace.getState().reset();
});

describe("split inspection", () => {
  it("opens the representative sighting with its overlay, HUD and the model focused on the finding", async () => {
    open();
    const pane = await screen.findByTestId("inspect-photo");
    await waitFor(() => expect(pane).toHaveAttribute("data-rings", "1"));
    expect(pane).toHaveAttribute("data-overlay", "on");
    expect(screen.getByTestId("image-canvas")).toHaveAttribute("data-has-overlay", "yes");
    const hud = screen.getByTestId("inspect-hud");
    expect(hud).toHaveTextContent("F-0042");
    expect(hud).toHaveTextContent("12.4 m");
    expect(hud).toHaveTextContent("West");
    expect(hud).toHaveTextContent(/14 Sept? 2026/);
    expect(hud).toHaveTextContent("Sighting 1 of 2");
    act(() => emitState("running"));
    await waitFor(() => expect(callsTo("focusFinding")).toContainEqual(["f1", { frustum: [0.05, 0.125], oblique_deg: 20 }]));
    expect(callsTo("setSelectedCamera")).toContainEqual(["img-1", true]);
  });

  it("hold to compare hides the overlay while Space is down", async () => {
    open();
    const pane = await screen.findByTestId("inspect-photo");
    await waitFor(() => expect(pane).toHaveAttribute("data-rings", "1"));
    fireEvent.keyDown(window, { key: " " });
    expect(pane).toHaveAttribute("data-overlay", "off");
    expect(screen.getByTestId("image-canvas")).toHaveAttribute("data-has-overlay", "no");
    fireEvent.keyUp(window, { key: " " });
    expect(pane).toHaveAttribute("data-overlay", "on");
  });

  it("arrows step the sightings and J and K step the findings", async () => {
    open();
    await screen.findByText("Sighting 1 of 2");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("sighting=s2"));
    expect(await screen.findByText("Sighting 2 of 2")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("finding=f2"));
    fireEvent.keyDown(window, { key: "k" });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("finding=f1"));
  });

  it("the splitter is a keyboard separator and its width is remembered", async () => {
    open();
    const sep = await screen.findByRole("separator", { name: /resize the model and photo panes/i });
    sep.focus();
    fireEvent.keyDown(sep, { key: "Home" });
    expect(sep).toHaveAttribute("aria-valuenow", "22");
    expect(localStorage.getItem(SPLIT_KEY)).toBe("22");
    expect(screen.getByTestId("location")).toHaveTextContent("finding=f1"); // the arrow never reached the sightings
  });

  it("splits the current sighting off into a new finding", async () => {
    const client = open("?finding=f1", [
      { method: "POST", path: /\/findings\/f1\/split$/, body: { ...ASSET_FINDINGS[0], id: "f9", number: 99 } },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /split off this sighting/i }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("finding=f9"));
    expect(client.requests.find((r) => r.method === "POST")!.body).toEqual({ sighting_ids: ["s1"] });
  });

  it("merges the finding into another one", async () => {
    const client = open("?finding=f1", [
      { method: "POST", path: /\/findings\/f1\/merge$/, body: ASSET_FINDINGS[1] },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /merge into/i }));
    const dialog = await screen.findByRole("dialog", { name: /merge f-0042/i });
    fireEvent.change(within(dialog).getByLabelText(/merge into/i), { target: { value: "f2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^merge$/i }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("finding=f2"));
    expect(client.requests.find((r) => r.method === "POST")!.body).toEqual({ into: "f2" });
  });

  it("looks from the photo's pose in the View from pose mode", async () => {
    open();
    await screen.findByTestId("inspect-photo");
    fireEvent.click(screen.getByRole("radio", { name: /view from pose/i }));
    act(() => emitState("running"));
    await waitFor(() =>
      expect(callsTo("viewFromPose").some((c) => (c[0] as { imageId?: string } | null)?.imageId === "img-1")).toBe(true),
    );
    expect(screen.queryByTestId("inspect-photo")).not.toBeInTheDocument();
  });

  it("says so when the finding is not on this model", async () => {
    open("?finding=nope", [
      { method: "GET", path: /\/findings\/nope$/, status: 404, body: { error: { code: "not_found", message: "no", details: {} } } },
    ]);
    expect(await screen.findByText(/this finding is not on this asset model/i)).toBeInTheDocument();
  });
});
```

Notes for the test: the fixture names (`personBox`, `exampleImage`) are in `src/test/fixtures.ts`; `MODEL_REVIEWED`, `ASSET_FINDINGS` and `PLACEMENTS` are U2's additions to U4's `src/test/assetFindingFixtures.ts`. If U2 has not landed yet, add the same exports there in this task (U2's Task 3 Step 1 has them verbatim; whichever unit lands second keeps one copy).

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/assetmodels/inspect/AssetInspect.test.tsx`
Expected: FAIL (the placeholder renders none of it)

- [ ] **Step 3: Implement the pieces**

```tsx
// src/assetmodels/inspect/InspectOverlay.tsx
import { Line } from "react-konva";
import type { OverlayRing } from "./nav";

/** The finding's shapes, filled in severity colours (data colours) at the slider's opacity. */
export function InspectOverlay({ rings, opacity }: { rings: readonly OverlayRing[]; opacity: number }) {
  return (
    <>
      {rings.map((r) => (
        <Line
          key={r.id}
          points={r.points}
          closed
          fill={r.colour}
          stroke={r.colour}
          strokeWidth={2}
          strokeScaleEnabled={false}
          opacity={opacity}
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}
    </>
  );
}
```

```tsx
// src/assetmodels/inspect/PhotoPane.tsx
// The Photo mode: the existing ImageCanvas, loaded through the images store (useImageData), with the
// finding's polygons as its overlay. Annotations of other findings are hidden while it is mounted,
// and the pan tool is on, so a drag pans and nothing is edited by accident; both are restored after.
import { useEffect, useMemo } from "react";
import type { FindingSighting } from "@/api/assetReview";
import { useProjectTypes } from "@/findings/useProjectTypes";
import { ImageCanvas } from "@/images/canvas/ImageCanvas";
import { useImageData } from "@/images/canvas/useImageData";
import { useImageUrl } from "@/images/workspace/seams";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { Alert, Skeleton, severityOf, useSeverityScale } from "@/ui";
import { InspectOverlay } from "./InspectOverlay";
import { overlayRings } from "./nav";

export function PhotoPane({
  projectId,
  imageId,
  sightings,
  opacity,
  comparing,
}: {
  projectId: string;
  imageId: string;
  sightings: readonly FindingSighting[];
  opacity: number;
  comparing: boolean;
}) {
  const { error } = useImageData(projectId, imageId);
  const { all: types } = useProjectTypes(projectId);
  const imageUrl = useImageUrl(projectId);
  const scale = useSeverityScale();
  const boxes = useImagesWorkspace((s) => s.boxes);
  const loadedId = useImagesWorkspace((s) => s.imageId);

  useEffect(() => {
    const s = useImagesWorkspace.getState();
    const before = { tool: s.tool, annotations: s.showAnnotations };
    s.setTool("pan");
    if (s.showAnnotations) s.toggleAnnotations();
    return () => {
      const now = useImagesWorkspace.getState();
      now.setTool(before.tool);
      if (now.showAnnotations !== before.annotations) now.toggleAnnotations();
    };
  }, []);

  const rings = useMemo(
    () =>
      loadedId === imageId
        ? overlayRings(boxes, sightings, imageId, (sev) => severityOf(scale, sev)?.colour ?? scale[0]?.colour ?? "")
        : [],
    [boxes, sightings, imageId, loadedId, scale],
  );
  const showing = !comparing && rings.length > 0;
  return (
    <div
      data-testid="inspect-photo"
      data-overlay={comparing ? "off" : "on"}
      data-rings={rings.length}
      className="relative h-full w-full"
    >
      {error ? (
        <div className="absolute inset-x-4 top-16 z-10">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : loadedId !== imageId ? (
        <div role="status" aria-label="Loading the photo" className="absolute inset-0 grid place-items-center">
          <Skeleton className="h-40 w-56 rounded-panel" />
        </div>
      ) : null}
      <ImageCanvas
        projectId={projectId}
        types={types}
        imageUrl={imageUrl}
        overlay={showing ? <InspectOverlay rings={rings} opacity={opacity} /> : null}
      />
    </div>
  );
}
```

```tsx
// src/assetmodels/inspect/StagePane.tsx
// A ModelViewer fed with the finding's context: the placements (patches load when visible), the
// cameras of this finding's sightings with the current one's view cone, and either a focus on the
// finding (the left stage), a photo pose (View from pose) or a preset (Model mode).
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { CameraPose } from "@/assetmodels/viewer/cameras";
import type { FocusSettings } from "@/assetmodels/viewer/focus";
import { ModelViewer, type ModelViewerHandle, type ModelViewState } from "@/assetmodels/viewer/ModelViewer";
import type { FetchPatch, PlacementItem } from "@/assetmodels/viewer/placements";

export type StageAim =
  | { kind: "focus"; findingId: string; settings?: FocusSettings }
  | { kind: "pose"; pose: CameraPose | null }
  | { kind: "preset"; pose: CameraPose | null };

export function StagePane({
  glbUrl,
  items,
  fetchPatch,
  cameras,
  colour,
  selectedImageId,
  aim,
  testId,
}: {
  glbUrl: string | null;
  items: PlacementItem[];
  fetchPatch: FetchPatch;
  cameras: CameraPose[];
  colour: string;
  selectedImageId: string | null;
  aim: StageAim;
  testId: string;
}) {
  const viewer = useRef<ModelViewerHandle>(null);
  const running = useRef(false);
  const apply = useCallback(() => {
    const v = viewer.current;
    if (!v || !running.current) return;
    v.setPlacements(items, fetchPatch);
    v.setCameras(cameras, () => colour);
    v.setSelectedCamera(selectedImageId, aim.kind === "focus");
    if (aim.kind === "focus") v.focusFinding(aim.findingId, aim.settings);
    else v.viewFromPose(aim.pose);
  }, [items, fetchPatch, cameras, colour, selectedImageId, aim]);
  useEffect(apply, [apply]);
  const onState = useCallback(
    (s: ModelViewState) => {
      running.current = s === "running";
      apply();
    },
    [apply],
  );
  const noop = useMemo(() => () => {}, []);
  return (
    <div data-testid={testId} className="relative flex h-full w-full">
      {glbUrl && <ModelViewer ref={viewer} glbUrl={glbUrl} onParts={noop} onSelect={noop} onState={onState} />}
    </div>
  );
}
```

The `aim` object must be memoised by the caller (a new object each render would re-focus on every render).

```tsx
// src/assetmodels/inspect/InspectHud.tsx
import type { Finding } from "@/api/findings";
import { formatFindingNumber } from "@/findings/format";
import { GlassPanel, SeverityPill } from "@/ui";
import { captureText } from "./nav";

/** Spec §9 HUD: height, side and capture time, with the finding and the sighting position. */
export function InspectHud({
  finding,
  typeName,
  zone,
  captureTime,
  index,
  count,
}: {
  finding: Finding;
  typeName: string | undefined;
  zone: string | null;
  captureTime: string | null | undefined;
  index: number;
  count: number;
}) {
  const facts: [string, string | null][] = [
    ["Height", finding.height_m == null ? null : `${finding.height_m.toFixed(1)} m`],
    ["Side", finding.side ?? null],
    ["Zone", zone],
    ["Taken", captureText(captureTime)],
  ];
  return (
    <GlassPanel
      variant="float"
      radius="control"
      data-testid="inspect-hud"
      className="pointer-events-none absolute bottom-3.5 left-3.5 z-10 flex max-w-[calc(100%-28px)] flex-col gap-1 px-3 py-2"
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm text-ink">{formatFindingNumber(finding.number)}</span>
        {typeName && <span className="text-sm text-ink">{typeName}</span>}
        <SeverityPill level={finding.severity} size="sm" />
        <span className="text-xs text-muted">{count > 0 ? `Sighting ${index + 1} of ${count}` : "No sightings"}</span>
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
        {facts.map(([k, v]) => (
          <div key={k} className="flex gap-1.5">
            <dt className="text-muted">{k}</dt>
            <dd className="tabular-nums text-ink">{v ?? "Not placed"}</dd>
          </div>
        ))}
      </dl>
    </GlassPanel>
  );
}
```

For "Taken", a missing capture time reads "Not placed" in the loop above; give it its own fallback: change the `dd` to `{v ?? (k === "Taken" ? "Unknown" : "Not placed")}`.

```tsx
// src/assetmodels/inspect/FindingActions.tsx
// Spec §8 merge and split, as explicit operator actions (A3): split the current sighting off into a
// new finding; merge this finding into another one on the same model. Both answer synchronously.
import { useState } from "react";
import { mergeFinding, splitFinding, type FindingSighting } from "@/api/assetReview";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import type { Finding } from "@/api/findings";
import { formatFindingNumber } from "@/findings/format";
import { Button, Dialog, Field, Select, toast } from "@/ui";

export function FindingActions({
  projectId,
  finding,
  sightings,
  current,
  others,
  typeName,
  onGo,
}: {
  projectId: string;
  finding: Finding;
  sightings: readonly FindingSighting[];
  current: FindingSighting | null;
  others: readonly Finding[];
  typeName(id: string): string | undefined;
  onGo(findingId: string): void;
}) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [merging, setMerging] = useState(false);
  const [into, setInto] = useState("");
  const label = formatFindingNumber(finding.number);
  // same type first, then by number
  const candidates = [...others]
    .filter((f) => f.id !== finding.id)
    .sort((a, b) => Number(b.type_id === finding.type_id) - Number(a.type_id === finding.type_id) || a.number - b.number);

  const split = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const made = await splitFinding(api, projectId, finding.id, [current.id]);
      toast("ok", `Split this sighting into ${formatFindingNumber(made.number)}`);
      onGo(made.id);
    } catch (e) {
      toast("danger", messageOf(e, "The sighting could not be split off."));
    } finally {
      setBusy(false);
    }
  };
  const merge = async () => {
    if (!into) return;
    setBusy(true);
    try {
      const survivor = await mergeFinding(api, projectId, finding.id, into);
      toast("ok", `Merged ${label} into ${formatFindingNumber(survivor.number)}`);
      setMerging(false);
      onGo(survivor.id);
    } catch (e) {
      toast("danger", messageOf(e, "The findings could not be merged."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" icon="minus" disabled={busy || !current || sightings.length < 2} onClick={() => void split()}>
        Split off this sighting
      </Button>
      <Button size="sm" icon="plus" disabled={busy || candidates.length === 0} onClick={() => setMerging(true)}>
        Merge into…
      </Button>
      <Dialog
        open={merging}
        title={`Merge ${label} into another finding`}
        description="Its sightings move to the finding you pick. This one is closed with a comment naming that finding; nothing is deleted."
        onClose={() => !busy && setMerging(false)}
        footer={
          <>
            <Button onClick={() => setMerging(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} disabled={!into} onClick={() => void merge()}>
              Merge
            </Button>
          </>
        }
      >
        <Field label="Merge into" htmlFor="merge-into">
          <Select id="merge-into" value={into} onChange={(e) => setInto(e.target.value)}>
            <option value="">Pick a finding</option>
            {candidates.map((f) => (
              <option key={f.id} value={f.id}>
                {[formatFindingNumber(f.number), typeName(f.type_id), f.zone, f.side].filter(Boolean).join(" · ")}
              </option>
            ))}
          </Select>
        </Field>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 4: Implement the screen** (replaces the Task 4 placeholder)

```tsx
// src/assetmodels/inspect/AssetInspect.tsx
// Split inspection (asset findings spec §9): /p/:projectId/models/:modelId/inspect?finding=&sighting=
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { assetModelGlbUrl } from "@contract/client";
import { fetchPatchBuffers, useAssetFindings, usePlacements, usePoses, useSightings } from "@/api/assetReview";
import { useBackend, useApi } from "@/api/client";
import { fetchFinding, type Finding } from "@/api/findings";
import { useAssetModelList } from "@/assetmodels/useAssetModels";
import { cameraPosesFrom, type CameraPose } from "@/assetmodels/viewer/cameras";
import type { FocusSettings } from "@/assetmodels/viewer/focus";
import { placementItems } from "@/assetmodels/viewer/placements";
import { tokenRgb } from "@/clouds/viewer/overlay";
import { formatFindingNumber } from "@/findings/format";
import { useProjectTypes } from "@/findings/useProjectTypes";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import {
  Alert,
  Button,
  EmptyState,
  GlassPanel,
  Segmented,
  Skeleton,
  Slider,
  WORKSPACE_KEYS,
  useSeverityScale,
  useToolShortcuts,
} from "@/ui";
import { FindingActions } from "./FindingActions";
import { InspectHud } from "./InspectHud";
import { currentSighting, stepId } from "./nav";
import { PhotoPane } from "./PhotoPane";
import { readSplit, writeSplit } from "./split";
import { Splitter } from "./Splitter";
import { StagePane, type StageAim } from "./StagePane";
import { useHoldKey } from "./useHoldKey";

type Mode = "photo" | "pose" | "model";
const MODES: { value: Mode; label: string }[] = [
  { value: "photo", label: "Photo" },
  { value: "pose", label: "View from pose" },
  { value: "model", label: "Model" },
];
const keyOf = (action: string) => WORKSPACE_KEYS.inspect.find((k) => k.action === action)?.keys[0];
const rgb = (t: string) => `rgb(${tokenRgb(t).join(", ")})`;

export function AssetInspect() {
  const { projectId = "", modelId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const findingId = params.get("finding");
  const wantedSighting = params.get("sighting");
  const api = useApi();
  const backend = useBackend();
  const scale = useSeverityScale();
  const { all: types } = useProjectTypes(projectId);
  const typeName = useCallback((id: string) => types.find((t) => t.id === id)?.name, [types]);

  const { models } = useAssetModelList(projectId);
  const model = models?.find((m) => m.id === modelId) ?? null;
  const glbUrl =
    model?.current_version != null ? assetModelGlbUrl(backend.baseUrl, backend.token, projectId, modelId, model.current_version) : null;

  const list = useAssetFindings(projectId, modelId, { sort: "-severity" });
  const listed = list.items.find((f) => f.id === findingId) ?? null;
  const [fetched, setFetched] = useState<{ id: string; finding: Finding | null } | null>(null);
  useEffect(() => {
    if (!findingId || listed || !list.done) return;
    let live = true;
    fetchFinding(api, projectId, findingId).then(
      (f) => live && setFetched({ id: findingId, finding: f.asset_model_id === modelId ? f : null }),
      () => live && setFetched({ id: findingId, finding: null }),
    );
    return () => {
      live = false;
    };
  }, [api, projectId, modelId, findingId, listed, list.done]);
  const finding = listed ?? (fetched?.id === findingId ? fetched.finding : null);
  const missing = !listed && list.done && fetched?.id === findingId && fetched.finding === null;

  const { sightings } = useSightings(projectId, findingId);
  const current = currentSighting(sightings ?? [], wantedSighting);
  const index = current && sightings ? sightings.indexOf(current) : 0;

  const go = useCallback(
    (next: { finding?: string; sighting?: string | null }) => {
      const p = new URLSearchParams(params);
      if (next.finding !== undefined) {
        p.set("finding", next.finding);
        p.delete("sighting");
      }
      if (next.sighting) p.set("sighting", next.sighting);
      setParams(p, { replace: true });
    },
    [params, setParams],
  );
  const ids = useMemo(() => list.items.map((f) => f.id), [list.items]);
  const sightingIds = useMemo(() => (sightings ?? []).map((s) => s.id), [sightings]);
  const stepFinding = (dir: 1 | -1) => {
    const id = stepId(ids, findingId, dir);
    if (id) go({ finding: id });
  };
  const stepSighting = (dir: 1 | -1) => {
    const id = stepId(sightingIds, current?.id ?? null, dir);
    if (id) go({ sighting: id });
  };
  useToolShortcuts([
    { shortcut: keyOf("previous-sighting"), action: "previous-sighting", onTrigger: () => stepSighting(-1) },
    { shortcut: keyOf("next-sighting"), action: "next-sighting", onTrigger: () => stepSighting(1) },
    { shortcut: keyOf("next-finding"), action: "next-finding", onTrigger: () => stepFinding(1) },
    { shortcut: keyOf("previous-finding"), action: "previous-finding", onTrigger: () => stepFinding(-1) },
  ]);

  const [split, setSplit] = useState(readSplit);
  const onSplit = (v: number) => {
    setSplit(v);
    writeSplit(v);
  };
  const [mode, setMode] = useState<Mode>("photo");
  const [opacity, setOpacity] = useState(55);
  const [comparing, setComparing] = useState(false);
  useHoldKey("Space", setComparing, mode === "photo");

  // The stage's data: placements of the model, cameras of this finding's sightings only.
  const placements = usePlacements(projectId, modelId);
  const items = useMemo(() => placementItems(placements.items, scale, rgb("muted")), [placements.items, scale]);
  const fetchPatch = useMemo(() => fetchPatchBuffers(backend, projectId, modelId), [backend, projectId, modelId]);
  const poses = usePoses(projectId, modelId);
  const allPoses = useMemo(() => cameraPosesFrom(poses.items), [poses.items]);
  const seenFrom = useMemo(() => new Set((sightings ?? []).map((s) => s.image_id)), [sightings]);
  const cameras = useMemo(() => allPoses.filter((p) => seenFrom.has(p.imageId)), [allPoses, seenFrom]);
  const currentPose = useMemo(() => allPoses.find((p) => p.imageId === current?.image_id) ?? null, [allPoses, current]);
  const accent = useMemo(() => rgb("accent"), []);
  const focus = model?.review?.focus;
  const settings: FocusSettings | undefined = focus ? { frustum: [focus.frustum[0], focus.frustum[1]], oblique_deg: focus.oblique_deg ?? 0 } : undefined;
  const settingsKey = JSON.stringify(settings ?? null);
  const stageAim = useMemo<StageAim>(
    () => ({ kind: "focus", findingId: findingId ?? "", settings: JSON.parse(settingsKey) ?? undefined }),
    [findingId, settingsKey],
  );
  const [preset, setPreset] = useState<CameraPose | null>(null);
  const presets = useMemo<CameraPose[]>(
    () =>
      (model?.frame?.presets ?? []).map((p) => ({
        imageId: `preset:${p.id}`,
        position: [p.camera[0], p.camera[1], p.camera[2]],
        target: [p.target[0], p.target[1], p.target[2]],
        up: [0, 1, 0],
        hfovDeg: 50,
        vfovDeg: 38,
        sequence: p.label,
        outcome: null,
      })),
    [model?.frame?.presets],
  );
  const rightAim = useMemo<StageAim>(
    () => (mode === "pose" ? { kind: "pose", pose: currentPose } : { kind: "preset", pose: preset }),
    [mode, currentPose, preset],
  );
  const captureTime = useImagesWorkspace((s) => (s.image?.id === current?.image_id ? s.image?.capture_time : null));

  if (!findingId)
    return (
      <div data-testid="asset-inspect" className="grid h-full place-items-center p-6">
        <EmptyState icon="findings" title="No finding chosen">
          Open a finding from the asset model&apos;s Findings topic or from the register.
        </EmptyState>
      </div>
    );
  if (missing)
    return (
      <div data-testid="asset-inspect" className="grid h-full place-items-center p-6">
        <EmptyState
          icon="findings"
          title="This finding is not on this asset model"
          action={
            <Link className="text-sm text-accent-ink hover:underline" to={`/p/${projectId}/models/${modelId}`}>
              Back to the model
            </Link>
          }
        >
          It may have been merged, split or deleted.
        </EmptyState>
      </div>
    );

  return (
    <div data-testid="asset-inspect" className="relative flex h-full min-h-0 w-full bg-bg">
      <h1 className="sr-only">{finding ? `Inspect ${formatFindingNumber(finding.number)}` : "Inspect a finding"}</h1>
      <section aria-label="Asset model" className="relative h-full min-w-0" style={{ width: `${split}%` }}>
        <StagePane
          testId="inspect-stage"
          glbUrl={glbUrl}
          items={items}
          fetchPatch={fetchPatch}
          cameras={cameras}
          colour={accent}
          selectedImageId={current?.image_id ?? null}
          aim={stageAim}
        />
        <GlassPanel variant="float" radius="control" className="absolute left-3.5 top-3.5 z-10 flex items-center gap-1.5 p-1.5">
          <Link to={`/p/${projectId}/models/${modelId}`} className="rounded-control px-2 text-sm text-accent-ink hover:underline">
            Back to the model
          </Link>
          <Button size="sm" variant="ghost" icon="chevron-left" disabled={!stepId(ids, findingId, -1)} onClick={() => stepFinding(-1)}>
            Previous finding
          </Button>
          <Button size="sm" variant="ghost" icon="chevron-right" disabled={!stepId(ids, findingId, 1)} onClick={() => stepFinding(1)}>
            Next finding
          </Button>
        </GlassPanel>
      </section>
      <Splitter value={split} onChange={onSplit} />
      <section aria-label="Photo" className="relative h-full min-w-0 flex-1">
        {mode === "photo" ? (
          current ? (
            <PhotoPane projectId={projectId} imageId={current.image_id} sightings={sightings ?? []} opacity={opacity / 100} comparing={comparing} />
          ) : sightings && sightings.length === 0 ? (
            <div className="grid h-full place-items-center p-6">
              <Alert tone="info">This finding has no sightings left. It stays in the register, closed.</Alert>
            </div>
          ) : (
            <div role="status" aria-label="Loading the sightings" className="grid h-full place-items-center">
              <Skeleton className="h-40 w-56 rounded-panel" />
            </div>
          )
        ) : (
          <StagePane
            testId="inspect-right-stage"
            glbUrl={glbUrl}
            items={items}
            fetchPatch={fetchPatch}
            cameras={mode === "pose" ? [] : cameras}
            colour={accent}
            selectedImageId={null}
            aim={rightAim}
          />
        )}
        {mode === "pose" && !currentPose && poses.done && (
          <div className="absolute inset-x-4 top-16 z-10">
            <Alert tone="warn">This photo has no pose yet. Estimate the poses in the asset model&apos;s Photos topic.</Alert>
          </div>
        )}
        <GlassPanel variant="float" radius="control" className="absolute right-3.5 top-3.5 z-10 flex flex-wrap items-center gap-3 p-1.5">
          <Segmented size="sm" label="Right pane" options={MODES} value={mode} onChange={setMode} />
          {mode === "photo" && (
            <>
              <Slider className="w-40" label="Overlay opacity" min={0} max={100} step={5} value={opacity} onChange={setOpacity} format={(v) => `${v}%`} />
              <Button
                size="sm"
                variant="ghost"
                icon="eye-off"
                aria-pressed={comparing}
                onPointerDown={() => setComparing(true)}
                onPointerUp={() => setComparing(false)}
                onPointerLeave={() => setComparing(false)}
              >
                Hold to compare
              </Button>
            </>
          )}
          {mode === "model" &&
            (presets.length > 0 ? (
              presets.map((p) => (
                <Button key={p.imageId} size="sm" variant={preset?.imageId === p.imageId ? "primary" : "ghost"} onClick={() => setPreset(p)}>
                  {p.sequence}
                </Button>
              ))
            ) : (
              <span className="text-xs text-muted">This model has no view presets.</span>
            ))}
        </GlassPanel>
        {finding && (
          <InspectHud
            finding={finding}
            typeName={typeName(finding.type_id)}
            zone={model?.review?.zones?.find((z) => z.id === finding.zone)?.label ?? finding.zone ?? null}
            captureTime={captureTime}
            index={index}
            count={sightings?.length ?? 0}
          />
        )}
        {finding && (
          <GlassPanel variant="float" radius="control" className="absolute bottom-3.5 right-3.5 z-10 flex flex-wrap items-center gap-1.5 p-1.5">
            <Button size="sm" variant="ghost" icon="arrow-left" disabled={!stepId(sightingIds, current?.id ?? null, -1)} onClick={() => stepSighting(-1)}>
              Previous sighting
            </Button>
            <Button size="sm" variant="ghost" icon="arrow-right" disabled={!stepId(sightingIds, current?.id ?? null, 1)} onClick={() => stepSighting(1)}>
              Next sighting
            </Button>
            <FindingActions
              projectId={projectId}
              finding={finding}
              sightings={sightings ?? []}
              current={current}
              others={list.items}
              typeName={typeName}
              onGo={(id) => go({ finding: id })}
            />
          </GlassPanel>
        )}
      </section>
    </div>
  );
}
```

Notes for the implementer:
- `useBackend()` returns `{ baseUrl, token, mode }`; `fetchPatchBuffers` reads only `baseUrl` and `token`.
- `Slider` takes `className`; if not, wrap it in a `div className="w-40"`.
- `Button` forwards `onPointerDown`/`onPointerUp`/`aria-pressed` to the `button`; check `src/ui/Button.tsx` and wrap a plain `button` with the same classes if it does not spread rest props.
- `focusFinding` in the stage runs whenever the finding changes (J/K), so the model turns to each finding as the operator steps.

- [ ] **Step 5: Run the tests, lint and build**

Run: `pnpm -C frontend exec vitest run src/assetmodels/inspect; pnpm -C frontend lint; pnpm -C frontend build`
Expected: PASS (8 screen tests plus Tasks 1 to 3), lint clean, build green with `AssetInspectScreen` its own lazy chunk.

- [ ] **Step 6: Look at it.** `pnpm -C contract mock` and `pnpm -C frontend dev`, with the e2e fixture routes of Task 6 loaded through the Playwright MCP (or Claude in Chrome with the same `page.route` setup), open `/p/<id>/models/<id>/inspect?finding=<id>`. Screenshot at 1366 x 768 and 1920 x 1080 in each mode. Check against `DESIGN.md`: the two top bars never overlap at a 22 % split; the HUD and the action bar do not collide at 1366 width (the action bar wraps); the overlay colours are the severity scale's; the splitter's focus ring shows. Fix anything off before committing.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/assetmodels/inspect/AssetInspect.tsx frontend/src/assetmodels/inspect/AssetInspect.test.tsx frontend/src/assetmodels/inspect/InspectOverlay.tsx frontend/src/assetmodels/inspect/PhotoPane.tsx frontend/src/assetmodels/inspect/StagePane.tsx frontend/src/assetmodels/inspect/InspectHud.tsx frontend/src/assetmodels/inspect/FindingActions.tsx frontend/src/test/assetFindingFixtures.ts
git commit -m "feat(asset-findings): split inspection with overlay, compare, HUD, stepping, merge and split

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Drop `assetFindingFixtures.ts` from the list if U2 already added those exports and this task did not touch it.)

---

### Task 6: e2e, split inspection with hold to compare, on Prism

**Files:**
- Create: `frontend/e2e/fixtures/assetInspect.ts` (U3 owns it; U2's workspace fixture is `assetReviewWorkspace.ts`)
- Create: `frontend/e2e/asset-inspect.spec.ts`

- [ ] **Step 1: Write the fixture**

```ts
// e2e/fixtures/assetInspect.ts
import type { Page, Route } from "@playwright/test";
import { fromMock } from "../mock";
import { MODEL, P } from "./assetModels";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS" };
const T = "2026-10-03T09:00:00Z";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaGhgAAAChACB8f3CzwAAAABJRU5ErkJggg==", "base64");

export const IMG = ["10000000-0000-4000-8000-0000000000a1", "10000000-0000-4000-8000-0000000000a2"];
export const F1 = "f0000000-bbbb-4000-8000-000000000001";
export const F2 = "f0000000-bbbb-4000-8000-000000000002";
const SIZES: Record<string, [number, number]> = { [IMG[0]]: [4000, 3000], [IMG[1]]: [5280, 3956] };

const finding = (id: string, number: number, severity: number, height: number) => ({
  id, number, type_id: "c1a2b3c4-0000-4000-8000-000000000009", severity, status: "open", note: "", created_by: "human",
  confidence: null, anchor: { kind: "asset", asset_model_id: MODEL }, lon: null, lat: null, data_type: "asset_model",
  data_id: MODEL, created_at: T, updated_at: T, reviewed_at: null, closed_at: null, asset_model_id: MODEL,
  height_m: height, bearing_deg: 270, side: "W", zone: "shell", component: null, placement: "point",
  sighting_count: id === F1 ? 2 : 1, representative: { image_id: IMG[0], annotation_id: "b0000000-cccc-4000-8000-000000000001" },
});

const sighting = (n: number, findingId: string, imageId: string) => ({
  id: `50000000-cccc-4000-8000-00000000000${n}`, finding_id: findingId, image_id: imageId,
  annotation_id: `b0000000-cccc-4000-8000-00000000000${n}`, severity: 2, group_tag: null, placement: "point",
  center: [2, 6, -2], normal: [0, 0, -1], part: null, coverage: 0.01, placed_version: 2, representative: n === 1, created_at: T,
});

/** Serves two asset findings on the M1 e2e model, F1 seen from two photos, with their photos and polygons. */
export async function routeAssetInspect(page: Page): Promise<void> {
  const imageExample = await fromMock<Record<string, unknown>>(page, `/api/v1/projects/${P}/images/${IMG[0]}`);
  const boxExample = (await fromMock<{ items: Record<string, unknown>[] }>(page, `/api/v1/projects/${P}/images/${IMG[0]}/boxes`)).items[0];
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
  const sightings = [sighting(1, F1, IMG[0]), sighting(2, F1, IMG[1]), sighting(3, F2, IMG[1])];
  await page.route(
    (u) => u.pathname.startsWith(`/api/v1/projects/${P}/findings`) || u.pathname.startsWith(`/api/v1/projects/${P}/images/`),
    async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      const path = new URL(req.url()).pathname.slice(`/api/v1/projects/${P}`.length);
      if (path === "/findings") return json(route, { items: [finding(F1, 1, 2, 6.2), finding(F2, 2, 1, 1.1)], next_cursor: null });
      const s = /^\/findings\/([^/]+)\/sightings$/.exec(path);
      if (s) return json(route, { items: sightings.filter((x) => x.finding_id === s[1]) });
      const img = /^\/images\/([^/]+)(\/[a-z]+)?$/.exec(path);
      if (img && SIZES[img[1]]) {
        const [w, h] = SIZES[img[1]];
        if (!img[2]) return json(route, { ...imageExample, id: img[1], width: w, height: h, capture_time: "2026-09-14T06:05:00Z" });
        if (img[2] === "/boxes")
          return json(route, {
            items: sightings
              .filter((x) => x.image_id === img[1])
              .map((x) => ({ ...boxExample, id: x.annotation_id, image_id: img[1], shape: "polygon", x: 1000, y: 800, w: 900, h: 700, angle: 0,
                points: [[1000, 800], [1900, 850], [1800, 1500], [1050, 1400]] })),
          });
        if (img[2] === "/measurements") return json(route, { items: [] });
        if (img[2] === "/file") return route.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: PNG });
      }
      return route.fallback();
    },
  );
  const base = `/api/v1/projects/${P}/asset-models/${MODEL}`;
  await page.route(
    (u) => u.pathname === `${base}/poses` || u.pathname === `${base}/placements`,
    (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      if (new URL(route.request().url()).pathname.endsWith("/poses"))
        return json(route, {
          items: IMG.map((id, i) => ({ image_id: id, position: [8, 4 + i, 6], target: [0, 4, 0], up: [0, 1, 0], hfov_deg: 70, vfov_deg: 52,
            source: "exif_gimbal", accuracy_m: 3, sequence: "Flight 1", outcome: "finding", updated_at: T })),
          next: null,
        });
      return json(route, {
        version: 2,
        items: [{ sighting_id: sightings[0].id, finding_id: F1, kind: "point", center: [2, 6, -2], normal: [0, 0, -1], size: null, severity: 2, patch_url: null }],
        next: null,
      });
    },
  );
}
```

- [ ] **Step 2: Write the spec**

```ts
// e2e/asset-inspect.spec.ts
import { expect, test } from "@playwright/test";
import { MODEL, P, routeAssetModels } from "./fixtures/assetModels";
import { F1, F2, routeAssetInspect } from "./fixtures/assetInspect";
import { SWIFTSHADER } from "./fixtures/cloudWorkspace";

test.use(SWIFTSHADER);

test("split inspection: overlay, hold to compare, stepping, splitter", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await routeAssetModels(page);
  await routeAssetInspect(page);
  await page.goto(`/p/${P}/models/${MODEL}/inspect?finding=${F1}`);

  const photo = page.getByTestId("inspect-photo");
  await expect(page.getByTestId("image-canvas")).toHaveAttribute("data-image", "4000x3000", { timeout: 15_000 });
  await expect(photo).toHaveAttribute("data-rings", "1");
  await expect(photo).toHaveAttribute("data-overlay", "on");
  await expect(page.getByTestId("inspect-hud")).toContainText("6.2 m");
  await expect(page.getByTestId("inspect-hud")).toContainText("Sighting 1 of 2");

  // hold to compare
  await page.keyboard.down(" ");
  await expect(photo).toHaveAttribute("data-overlay", "off");
  await page.keyboard.up(" ");
  await expect(photo).toHaveAttribute("data-overlay", "on");

  // next sighting: the other photo opens
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("image-canvas")).toHaveAttribute("data-image", "5280x3956");
  await expect(page.getByTestId("inspect-hud")).toContainText("Sighting 2 of 2");

  // next finding, then back
  await page.keyboard.press("j");
  await expect(page).toHaveURL(new RegExp(`finding=${F2}`));
  await page.keyboard.press("k");
  await expect(page).toHaveURL(new RegExp(`finding=${F1}`));

  // the splitter, by keyboard, remembered across a reload
  const sep = page.getByRole("separator", { name: /resize the model and photo panes/i });
  await sep.focus();
  await page.keyboard.press("End");
  await expect(sep).toHaveAttribute("aria-valuenow", "75");
  await page.reload();
  await expect(page.getByRole("separator", { name: /resize the model and photo panes/i })).toHaveAttribute("aria-valuenow", "75");

  // the 3D modes mount without errors
  await page.getByRole("radio", { name: /view from pose/i }).click();
  await expect(page.getByTestId("inspect-right-stage")).toBeVisible();
  await page.getByRole("radio", { name: /^model$/i }).click();
  await expect(page.getByText(/no view presets/i)).toBeVisible();
  expect(pageErrors).toEqual([]);
});
```

- [ ] **Step 3: Run it**

Run: `pnpm -C frontend e2e -- asset-inspect.spec.ts models-workspace.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/fixtures/assetInspect.ts frontend/e2e/asset-inspect.spec.ts
git commit -m "test(asset-findings): e2e for the split inspection with hold to compare

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Gate, land and the operator walkthrough

- [ ] **Step 1: Run the full gate** from the worktree:

```
pnpm -C contract check
cd backend; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
```

Expected: all green. The Images workspace e2e specs must still pass: the inspection borrows the images store and puts the tool and annotation visibility back on unmount. `cargo test` only if the frozen sidecar is present.

- [ ] **Step 2: Land.** `scripts\finish-task.ps1`, or the manual fallback (memory: nested-unit-controllers): merge `task/af-u3` into `main` with `--no-ff`, re-run `pnpm -C frontend test` on `main`, remove the worktree (junctions as links first) and delete the branch.

- [ ] **Step 3: Operator walkthrough ("how to test this")**, in the hand-off message:
  1. Open the Findings register, filter by source **Asset**, and open a finding: the split inspection opens with the model on the left and the photo on the right.
  2. The model is turned square on to the finding; the photo shows the finding's outline filled in its severity colour. Move **Overlay opacity**.
  3. Hold **Space** (or press and hold **Hold to compare**): the fill disappears; let go and it returns.
  4. Press the **right arrow**: the next photo that saw the finding opens, and its camera cone moves on the model. The HUD reads "Sighting 2 of n" with that photo's time.
  5. Press **J** and **K**: the next and previous findings open, in the register's order.
  6. Drag the splitter, or focus it with **Tab** and press **Home** and **End**: it stops at 22 % and 75 %. Reload: the split is where you left it.
  7. Switch the right pane to **View from pose**: the model as that photo saw it. **Model** shows the asset's view presets.
  8. **Split off this sighting** on a finding with two or more sightings: a new finding opens. **Merge into…** a finding of the same type: the survivor opens, and the merged one shows as closed in the register with a comment.
  9. Press **?**: the sheet lists the inspection's keys.

---

## Self-review

**Spec coverage (§9 split inspection):**

| Spec | Where |
| --- | --- |
| Route `/p/:id/…/:modelId/inspect?finding=` | T4 (`models/:modelId/inspect`; Index note 1) |
| Asset stage left, existing `ImageCanvas` right | T5 `StagePane`, `PhotoPane` |
| Splitter 22 to 75 %, keyboard accessible, remembered | T1, T5, T6 |
| Modes Photo, View from pose, Model (presets) | T5 |
| Overlay filled by severity colour, opacity slider | T2 `overlayRings`, T5 `InspectOverlay` |
| Hold to compare (Space) hides it | T3 `useHoldKey`, T5, T6 |
| HUD: height, side, capture time | T5 `InspectHud` |
| Prev and next sightings (arrows), findings (J/K via keymap) | T2 `stepId`, T3 `inspect` scope, T5 |
| §8 merge and split | T5 `FindingActions` |
| §12 e2e "split inspection with hold-to-compare" | T6 |

**Placeholders:** none; Task 4's placeholder component is replaced in Task 5 by full code.

**Last task:** T7 is the full AGENTS.md gate.

## Index notes

1. **Route prefix.** The spec writes `/p/:id/asset-models/:modelId/inspect`. M1 U6 merged the asset model workspace at `/p/:projectId/models[/:modelId]` (`src/routes/projectRoutes.tsx`), so the inspection is `/p/:projectId/models/:modelId/inspect?finding=<id>[&sighting=<id>]`. The API paths keep `asset-models`.
2. **`findingHref`.** U4 sends asset findings to the workspace (`/p/<id>/models/<modelId>?finding=`). U3 repoints them to the inspection and moves U4's test in `src/findings/model.test.ts` in the same commit (Task 4), as the coordinator asked.
3. **Space.** Space is the global "pan-hold" key and the keymap test forbids a workspace key equal to a global one. The inspection holds Space through `useHoldKey` (key-down and key-up), not through `useToolShortcuts`, and the global Space help line now names both meanings. The images workspace's own Space handler (`useCanvasKeys`) is not mounted in the inspection, so the two never fire together.
4. **The `?` sheet.** `RouteInfo` gains an optional `sheet` so the inspection's sheet shows the `inspect` scope instead of the workspace's `models` keys.
5. **The images store is shared.** `ImageCanvas` reads the app-wide `useImagesWorkspace` store; the inspection loads its photo there with `useImageData`, switches to the pan tool and hides other annotations, and restores both on unmount. Opening the Images workspace afterwards loads its own image as usual.
6. **Sightings payload.** U3 reads J4's `FindingSightingOut {id, finding_id, image_id, annotation_id, severity, placement, center, normal, part, coverage, placed_version, representative, created_at}`; `representative` picks the sighting opened when the URL names none.
7. **Fixtures.** The screen test uses `MODEL_REVIEWED`, `ASSET_FINDINGS` and `PLACEMENTS`, which U2 adds to U4's `src/test/assetFindingFixtures.ts`. U2 and U3 run in the same batch; whichever lands second keeps a single copy.
