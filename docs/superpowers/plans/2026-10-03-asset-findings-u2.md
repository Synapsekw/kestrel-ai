# Asset findings U2: asset workspace topics: Findings and Photos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the asset model workspace the operator sees the findings and the photos on the model:
- a **Findings** topic lists the model's findings with zone, side and height, filters them by severity, type, zone, side and placed, focuses one in the view, opens its split inspection, and starts **Compute placements** and **Regroup**;
- a **Photos** topic colours the camera glyphs by photo outcome, filters by sequence, includes or leaves out context photos, turns the cameras and the view cone on and off, looks through a photo's pose, and starts **Estimate poses**;
- a **Model** topic keeps the M1 model panel and adds **See through**, **Turn slowly** and **Street map**;
- **Import a GLB…** adds an existing GLB as a new version;
- **Import inspection review…** (Model topic and Add data) checks a kit job folder with a dry run, shows the photo match and the sightings it will make, lets the operator confirm the class mapping, then imports;
- every job ends with a toast that says what it did.

**Architecture:**
- The asset workspace moves onto the **workspace rail** (`src/ui/WorkspaceRail.tsx`), as the clouds workspace did (`clouds/workspace/useCloudRail.tsx`). The rail's navigation buttons are M1's view tools; its topics are Model, Findings and Photos. `RailWorkspace` gains `"models"`, so the open topic is remembered.
- **Data lives in the workspace, not in a topic.** The rail mounts only the open topic's body, but pins, patches and camera glyphs must stay in the view whatever topic is open. So each topic has a layer hook (`useFindingsLayer`, `usePhotosLayer`) that the workspace calls; it owns the paged data (U1 `assetReview.ts`), the filters and the selection, and pushes them into the viewer. The topic components are presentational.
- Pure helpers (`findingRows.ts`, `outcome.ts`) are unit tested; the layers and topics are tested with Testing Library and a fake viewer handle; the workspace wiring is tested with `fakeModelViewer`.
- Job actions (`useReviewActions`) post the job, put it in the jobs store, and leave the end toast to `useJobToasts`, which gains the five new job types.

**Tech Stack:** React 18, TypeScript, `src/ui` primitives (`WorkspaceRail`, `TopicPanel`, `TopicList`, `Select`, `Segmented`, `Switch`, `MenuButton`, `Dialog`, `SeverityPill`, `toast`), Vitest and Testing Library, Playwright on the Prism mock.

**Spec sections covered:** §9 "Asset workspace" (Findings, Photos), §9 engine calls from the workspace (ghost, auto-rotate, ground), §2 "Importing an existing GLB as an asset model version", §6 job entry points (`asset_pose`, `asset_place`, `asset_group`, `asset_glb_import`, `review_kit_import`), §6.5 operator confirmation of the class mapping, §12 e2e "asset workspace topics".

**Index and Global Constraints:** `docs/superpowers/plans/2026-10-03-asset-findings.md`

**Needs:** J5's request and preview shapes (in the contract by C0; the J5 job itself is needed only for the acceptance run, never for these tests). U1 merged (engine methods, `ModelViewerHandle` additions, `fakeModelViewer` additions, `src/api/assetReview.ts`, `viewer/ground.ts`, `viewer/cameras.ts`). C0 merged (contract). M1 U6 and U7 and the workspace rail are on `main` already. U2 does not need U4: it builds its own finding query (Index note 2).

**Worktree:** `scripts\start-task.ps1 -Name af-u2`

**Before any UI code:** load the design skills (`impeccable`, `emil-design-eng`), read `DESIGN.md` ("Aero glass") and `src/ui/WorkspaceRail.tsx`, `src/ui/TopicPanel.tsx`, `src/clouds/workspace/useCloudRail.tsx`, and look at `/gallery.html` (Rail section) under `pnpm -C frontend dev` (AGENTS.md rule 3).

**Budget:** background jobs started here: `asset_pose` (Estimate poses), `asset_place` then `asset_group` (Compute placements), `asset_group` (Regroup), `asset_glb_import` (Import a GLB), `review_kit_import` (a dry run, then the import). No route blocks; each POST answers 202 with the job. Bounded reads: poses come in pages of 2,000, placements in pages of 2,000, findings in pages of 500 (U1 hooks); the camera glyphs are one instanced mesh; the Findings list is virtualised (`TopicList`); the Photos topic shows counts and one selected photo, never a list of thousands of rows.

**Execution DAG:**

```
T1 job toasts ───────────────────────────────┐
T2 photos: outcome.ts, layer, topic (RF 5) ──┼──> T5 workspace on the rail ──> T6 review import ──> T7 e2e ──> T8 gate
T3 findings: rows, layer, topic ─────────────┤
T4 import GLB dialog + review actions ───────┘
```

- Independent: T1, T2, T3, T4 (T3 and T2 both use `useReviewActions` from T4: build T4's `useReviewActions.ts` first or stub it with the signature below).
- Batches: {T4}, then {T1, T2, T3}, then {T5}, {T6}, {T7}, {T8}. T6's helpers and dialog (Steps 1 to 4) need only U1 and can run beside T5; its Step 5 wires into the workspace T5 reshaped.
- Critical path: T4, T3, T5, T6, T7, T8.

---

### Task 1: Job toasts for the asset review jobs

**Files:**
- Modify: `frontend/src/ui/useJobToasts.ts` (`TYPE_NAME` and `jobToastText`)
- Test: `frontend/src/ui/useJobToasts.test.ts` (extend)

**Interfaces:**
- Consumes: `JobType` += `asset_glb_import`, `asset_pose`, `asset_place`, `asset_group`, `review_kit_import` (C0).
- Produces: `jobToastText(job)` lines for the five types. Result fields read (C0's `Job.result` description, Index note 3): `asset_pose {estimated, kept, skipped}`, `asset_place {point, patch, none}`, `asset_group {created, kept, merged, split}`; `review_kit_import` is finished in Task 6.

- [ ] **Step 1: Write the failing test** (append to `src/ui/useJobToasts.test.ts`)

```ts
describe("asset review job toasts", () => {
  const done = (type: string, result: Record<string, unknown> | null = null) =>
    ({ id: "j", project_id: "p", type, state: "succeeded", progress: 1, message: "", log_path: "", params: {},
      result, error: null, created_at: "", started_at: null, finished_at: null }) as never;

  it("says what each asset job did", () => {
    expect(jobToastText(done("asset_glb_import"))).toBe("GLB imported as a new version");
    expect(jobToastText(done("asset_pose", { estimated: 296, kept: 0, skipped: 3 }))).toBe("Photo poses estimated: 296 photos (3 skipped)");
    expect(jobToastText(done("asset_pose", { estimated: 1, kept: 0, skipped: 0 }))).toBe("Photo poses estimated: 1 photo");
    expect(jobToastText(done("asset_place", { patch: 715, point: 625, none: 101 }))).toBe(
      "Placements computed: 715 patches, 625 pins, 101 not placed",
    );
    expect(jobToastText(done("asset_place"))).toBe("Placements computed");
    expect(jobToastText(done("asset_group", { created: 4, kept: 650, merged: 2, split: 0 }))).toBe(
      "Findings regrouped: 650 kept, 4 new, 2 merged",
    );
    expect(jobToastText(done("asset_group", { created: 656, kept: 0, merged: 0, split: 0 }))).toBe(
      "Findings regrouped: 0 kept, 656 new",
    );
    expect(jobToastText(done("asset_group"))).toBe("Findings regrouped");
    expect(jobToastText(done("review_kit_import"))).toBe("Review job imported");
  });

  it("names the job when it fails", () => {
    const failed = { ...done("asset_place"), state: "failed", error: "the GLB has no faces" } as never;
    expect(jobToastText(failed)).toBe("Placement failed: the GLB has no faces");
  });
});
```

(`jobToastText` is already imported at the top of that file; if not, add it to the `./useJobToasts` import.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/ui/useJobToasts.test.ts`
Expected: FAIL (the texts differ from what C0 left, or the cases fall through)

- [ ] **Step 3: Implement.** In `TYPE_NAME`, set (replacing any placeholder lines C0 added to keep `tsc` green):

```ts
  asset_glb_import: "GLB import",
  asset_pose: "Pose estimate",
  asset_place: "Placement",
  asset_group: "Regroup",
  review_kit_import: "Review import",
```

In `jobToastText`'s `switch`, add before the closing brace (again replacing C0 placeholders):

```ts
    case "asset_glb_import":
      return "GLB imported as a new version";
    case "asset_pose": {
      const posed = num(r.estimated);
      const skipped = num(r.skipped) ?? 0;
      if (posed === null) return "Photo poses estimated";
      return `Photo poses estimated: ${posed} ${posed === 1 ? "photo" : "photos"}${skipped > 0 ? ` (${skipped} skipped)` : ""}`;
    }
    case "asset_place": {
      const patch = num(r.patch);
      const point = num(r.point);
      const none = num(r.none) ?? 0;
      if (patch === null || point === null) return "Placements computed";
      return `Placements computed: ${patch} patches, ${point} pins${none > 0 ? `, ${none} not placed` : ""}`;
    }
    case "asset_group": {
      // J4 GroupResult: {created, kept, merged, split}
      const kept = num(r.kept);
      const created = num(r.created);
      const merged = num(r.merged) ?? 0;
      if (kept === null || created === null) return "Findings regrouped";
      return `Findings regrouped: ${kept} kept, ${created} new${merged > 0 ? `, ${merged} merged` : ""}`;
    }
    case "review_kit_import":
      return "Review job imported";
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm -C frontend exec vitest run src/ui/useJobToasts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ui/useJobToasts.ts frontend/src/ui/useJobToasts.test.ts
git commit -m "feat(asset-findings): job toasts for poses, placements, regroup and GLB import

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Photos: outcome colours, the photos layer and the Photos topic (Review Focus 5)

**Files:**
- Create: `frontend/src/assetmodels/review/outcome.ts`
- Create: `frontend/src/assetmodels/review/usePhotosLayer.ts`
- Create: `frontend/src/assetmodels/review/PhotosTopic.tsx`
- Test: `frontend/src/assetmodels/review/outcome.test.ts`, `frontend/src/assetmodels/review/PhotosTopic.test.tsx`

**Interfaces:**
- Consumes: `usePoses`, `POSES_PAGE`, `type ImagePose` (U1 `src/api/assetReview.ts`); `cameraPosesFrom`, `type CameraPose` (U1 `viewer/cameras.ts`); `ModelViewerHandle` (U1); `tokenRgb` (`src/clouds/viewer/overlay.ts`); `thumbnailUrl` (`@contract/client`); `useBackend` (`src/api/client.ts`); `ReviewActions` (Task 4).
- Produces:

```ts
// outcome.ts
export type OutcomeKey = "finding" | "uncertain" | "none" | "not_assessed" | "unreviewed";
export const OUTCOME_KEYS: readonly OutcomeKey[];
export const OUTCOME_LABEL: Record<OutcomeKey, string>;
export function outcomeKey(o: string | null): OutcomeKey;
export function isContext(o: string | null): boolean;   // none, not assessed or not reviewed
export function outcomeColours(read?: (token: string) => [number, number, number]): Record<OutcomeKey, string>;  // "rgb(r, g, b)"
export function filterPoses(poses: readonly CameraPose[], f: { sequence: string | null; includeContext: boolean }): CameraPose[];
export function outcomeCounts(poses: readonly CameraPose[]): Record<OutcomeKey, number>;
export function sequencesOf(poses: readonly CameraPose[]): string[];

// usePhotosLayer.ts
export interface PhotosLayer {
  loaded: number; done: boolean; error: string | null; reload(): void;
  shown: CameraPose[]; counts: Record<OutcomeKey, number>; sequences: string[]; colours: Record<OutcomeKey, string>;
  sequence: string | null; setSequence(s: string | null): void;
  includeContext: boolean; setIncludeContext(on: boolean): void;
  camerasOn: boolean; setCamerasOn(on: boolean): void;
  cone: boolean; setCone(on: boolean): void;
  selected: CameraPose | null; select(imageId: string | null): void;
  viewing: boolean; viewFrom(p: CameraPose | null): void;
  push(): void;   // re-sends cameras and selection to the viewer (a fresh viewer after a reload)
}
export function usePhotosLayer(projectId: string, modelId: string, viewer: RefObject<ModelViewerHandle | null>): PhotosLayer;

// PhotosTopic.tsx
export function PhotosTopic(p: { projectId: string; layer: PhotosLayer; actions: ReviewActions }): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/assetmodels/review/outcome.test.ts
import { describe, expect, it } from "vitest";
import type { CameraPose } from "@/assetmodels/viewer/cameras";
import { filterPoses, isContext, outcomeColours, outcomeCounts, outcomeKey, sequencesOf } from "./outcome";

const pose = (id: string, outcome: string | null, sequence: string | null = "A"): CameraPose => ({
  imageId: id, position: [0, 0, 0], target: [1, 0, 0], up: [0, 1, 0], hfovDeg: 70, vfovDeg: 50, sequence, outcome,
});

describe("photo outcomes", () => {
  it("keys and context", () => {
    expect(outcomeKey("finding")).toBe("finding");
    expect(outcomeKey(null)).toBe("unreviewed");
    expect(outcomeKey("something else")).toBe("unreviewed");
    expect(isContext("uncertain")).toBe(false);
    expect(isContext("none")).toBe(true);
    expect(isContext("not_assessed")).toBe(true);
    expect(isContext(null)).toBe(true);
  });

  it("colours come from the theme tokens", () => {
    const read = (t: string): [number, number, number] => (t === "danger" ? [255, 138, 160] : [1, 2, 3]);
    const c = outcomeColours(read);
    expect(c.finding).toBe("rgb(255, 138, 160)");
    expect(c.none).toBe("rgb(1, 2, 3)");
  });

  it("filters by sequence and leaves context photos out unless asked", () => {
    const all = [pose("a", "finding", "A"), pose("b", "none", "A"), pose("c", "uncertain", "B"), pose("d", null, null)];
    expect(filterPoses(all, { sequence: null, includeContext: false }).map((p) => p.imageId)).toEqual(["a", "c"]);
    expect(filterPoses(all, { sequence: null, includeContext: true }).map((p) => p.imageId)).toEqual(["a", "b", "c", "d"]);
    expect(filterPoses(all, { sequence: "A", includeContext: true }).map((p) => p.imageId)).toEqual(["a", "b"]);
    expect(outcomeCounts(all)).toEqual({ finding: 1, uncertain: 1, none: 1, not_assessed: 0, unreviewed: 1 });
    expect(sequencesOf(all)).toEqual(["A", "B"]);
  });
});
```

```tsx
// src/assetmodels/review/PhotosTopic.test.tsx
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ModelViewerHandle } from "@/assetmodels/viewer/ModelViewer";
import { renderWithProviders } from "@/test/render";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { POSES_PAGE } from "@/api/assetReview";
import { PhotosTopic } from "./PhotosTopic";
import { usePhotosLayer } from "./usePhotosLayer";

const pose = (i: number, outcome = "finding", sequence = "Flight 1") => ({
  image_id: `img-${i}`, position: [i, 2, 3], target: [0, 0, 0], up: [0, 1, 0], hfov_deg: 70, vfov_deg: 52,
  source: "exif_gimbal", accuracy_m: 3, sequence, outcome, updated_at: "2026-10-03T00:00:00Z",
});

function fakeHandle() {
  return {
    setCameras: vi.fn(),
    setSelectedCamera: vi.fn(),
    viewFromPose: vi.fn(),
  } as unknown as ModelViewerHandle & Record<"setCameras" | "setSelectedCamera" | "viewFromPose", ReturnType<typeof vi.fn>>;
}

function Harness({ handle }: { handle: ModelViewerHandle }) {
  const viewer = useRef<ModelViewerHandle | null>(handle);
  const layer = usePhotosLayer(PROJECT_ID, "m1", viewer);
  const actions = { running: { pose: false, place: false, group: false }, estimate: vi.fn(), compute: vi.fn(), regroup: vi.fn() };
  return <PhotosTopic projectId={PROJECT_ID} layer={layer} actions={actions} />;
}

describe("PhotosTopic", () => {
  it("pages poses", async () => {
    const page1 = Array.from({ length: POSES_PAGE }, (_, i) => pose(i));
    const page2 = Array.from({ length: 500 }, (_, i) => pose(POSES_PAGE + i));
    const { api, requests } = fakeClient([{ method: "GET", path: /\/asset-models\/m1\/poses$/,
      body: (r) => (r.url.includes("after=c1") ? { items: page2, next: null } : { items: page1, next: "c1" }) }]);
    const handle = fakeHandle();
    renderWithProviders(<Harness handle={handle} />, { api });
    expect(await screen.findByText("2,500 photos")).toBeInTheDocument();
    const urls = requests.filter((r) => r.url.includes("/poses")).map((r) => r.url);
    expect(urls).toHaveLength(2); // two pages, never one request for everything
    expect(urls.every((u) => u.includes(`limit=${POSES_PAGE}`))).toBe(true);
    expect(urls[1]).toContain("after=c1");
    await waitFor(() => expect(handle.setCameras.mock.calls.at(-1)?.[0]).toHaveLength(2500));
    // one call per page that arrived (plus the first empty one), not one per pose
    expect(handle.setCameras.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("filters the cameras and turns them off", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/poses$/,
      body: { items: [pose(1, "finding", "A"), pose(2, "none", "A"), pose(3, "uncertain", "B")], next: null } }]);
    const handle = fakeHandle();
    renderWithProviders(<Harness handle={handle} />, { api });
    expect(await screen.findByText("2 photos")).toBeInTheDocument(); // the context photo is left out
    fireEvent.click(screen.getByRole("switch", { name: /include context photos/i }));
    expect(await screen.findByText("3 photos")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/sequence/i), { target: { value: "B" } });
    expect(await screen.findByText("1 photo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: /show cameras/i }));
    await waitFor(() => expect(handle.setCameras.mock.calls.at(-1)?.[0]).toEqual([]));
  });

  it("starts a pose estimate from the empty state", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/poses$/, body: { items: [], next: null } }]);
    const handle = fakeHandle();
    const estimate = vi.fn();
    function WithActions() {
      const viewer = useRef<ModelViewerHandle | null>(handle);
      const layer = usePhotosLayer(PROJECT_ID, "m1", viewer);
      return <PhotosTopic projectId={PROJECT_ID} layer={layer}
        actions={{ running: { pose: false, place: false, group: false }, estimate, compute: vi.fn(), regroup: vi.fn() }} />;
    }
    renderWithProviders(<WithActions />, { api });
    fireEvent.click(await screen.findByRole("button", { name: /estimate poses/i }));
    expect(estimate).toHaveBeenCalled();
  });

  it("looks through a selected photo's pose and back", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/poses$/, body: { items: [pose(7)], next: null } }]);
    const handle = fakeHandle();
    let select: (id: string) => void = () => {};
    function Selecting() {
      const viewer = useRef<ModelViewerHandle | null>(handle);
      const layer = usePhotosLayer(PROJECT_ID, "m1", viewer);
      select = layer.select;
      return <PhotosTopic projectId={PROJECT_ID} layer={layer}
        actions={{ running: { pose: false, place: false, group: false }, estimate: vi.fn(), compute: vi.fn(), regroup: vi.fn() }} />;
    }
    renderWithProviders(<Selecting />, { api });
    await screen.findByText("1 photo");
    act(() => select("img-7"));
    fireEvent.click(await screen.findByRole("button", { name: /view from here/i }));
    expect(handle.viewFromPose.mock.calls.at(-1)?.[0]).toMatchObject({ imageId: "img-7" });
    fireEvent.click(screen.getByRole("button", { name: /back to the model view/i }));
    expect(handle.viewFromPose.mock.calls.at(-1)?.[0]).toBeNull();
    expect(screen.getByRole("link", { name: /open photo/i })).toHaveAttribute("href", `/p/${PROJECT_ID}/images/img-7`);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/assetmodels/review/outcome.test.ts src/assetmodels/review/PhotosTopic.test.tsx`
Expected: FAIL (the modules don't exist)

- [ ] **Step 3: Implement**

```ts
// src/assetmodels/review/outcome.ts
// Photo outcomes (spec §5.4 image_review.status) as camera glyph colours. The colours are the
// theme's status tokens, read at runtime and passed on as data (DESIGN.md: no raw colours).
import type { CameraPose } from "@/assetmodels/viewer/cameras";
import { tokenRgb } from "@/clouds/viewer/overlay";

export type OutcomeKey = "finding" | "uncertain" | "none" | "not_assessed" | "unreviewed";
export const OUTCOME_KEYS: readonly OutcomeKey[] = ["finding", "uncertain", "none", "not_assessed", "unreviewed"];

export const OUTCOME_LABEL: Record<OutcomeKey, string> = {
  finding: "Finding",
  uncertain: "Uncertain",
  none: "No finding",
  not_assessed: "Not assessed",
  unreviewed: "Not reviewed",
};

const TOKEN: Record<OutcomeKey, string> = {
  finding: "danger",
  uncertain: "warn",
  none: "ok",
  not_assessed: "dim",
  unreviewed: "muted",
};

export function outcomeKey(o: string | null): OutcomeKey {
  return o === "finding" || o === "uncertain" || o === "none" || o === "not_assessed" ? o : "unreviewed";
}

/** A context photo shows the asset but holds no finding to look at. */
export function isContext(o: string | null): boolean {
  const k = outcomeKey(o);
  return k !== "finding" && k !== "uncertain";
}

export function outcomeColours(
  read: (token: string) => [number, number, number] = (t) => tokenRgb(t),
): Record<OutcomeKey, string> {
  const out = {} as Record<OutcomeKey, string>;
  for (const k of OUTCOME_KEYS) {
    const [r, g, b] = read(TOKEN[k]);
    out[k] = `rgb(${r}, ${g}, ${b})`;
  }
  return out;
}

export function filterPoses(
  poses: readonly CameraPose[],
  f: { sequence: string | null; includeContext: boolean },
): CameraPose[] {
  return poses.filter(
    (p) => (f.sequence === null || p.sequence === f.sequence) && (f.includeContext || !isContext(p.outcome)),
  );
}

export function outcomeCounts(poses: readonly CameraPose[]): Record<OutcomeKey, number> {
  const out: Record<OutcomeKey, number> = { finding: 0, uncertain: 0, none: 0, not_assessed: 0, unreviewed: 0 };
  for (const p of poses) out[outcomeKey(p.outcome)] += 1;
  return out;
}

export function sequencesOf(poses: readonly CameraPose[]): string[] {
  return [...new Set(poses.map((p) => p.sequence).filter((s): s is string => !!s))].sort();
}
```

```ts
// src/assetmodels/review/usePhotosLayer.ts
// The cameras layer (spec §9 Photos): the model's poses, paged (2,000 a page, Review Focus 5), as
// one instanced glyph set in the viewer, filtered and coloured by outcome. Lives in the workspace
// so the glyphs stay in the view whatever rail topic is open.
import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { usePoses } from "@/api/assetReview";
import { cameraPosesFrom, type CameraPose } from "@/assetmodels/viewer/cameras";
import type { ModelViewerHandle } from "@/assetmodels/viewer/ModelViewer";
import { filterPoses, outcomeColours, outcomeCounts, outcomeKey, sequencesOf, type OutcomeKey } from "./outcome";

export interface PhotosLayer {
  loaded: number;
  done: boolean;
  error: string | null;
  reload(): void;
  shown: CameraPose[];
  counts: Record<OutcomeKey, number>;
  sequences: string[];
  colours: Record<OutcomeKey, string>;
  sequence: string | null;
  setSequence(s: string | null): void;
  includeContext: boolean;
  setIncludeContext(on: boolean): void;
  camerasOn: boolean;
  setCamerasOn(on: boolean): void;
  cone: boolean;
  setCone(on: boolean): void;
  selected: CameraPose | null;
  select(imageId: string | null): void;
  viewing: boolean;
  viewFrom(p: CameraPose | null): void;
  push(): void;
}

export function usePhotosLayer(
  projectId: string,
  modelId: string,
  viewer: RefObject<ModelViewerHandle | null>,
): PhotosLayer {
  const poses = usePoses(projectId, modelId);
  const all = useMemo(() => cameraPosesFrom(poses.items), [poses.items]);
  const [sequence, setSequence] = useState<string | null>(null);
  const [includeContext, setIncludeContext] = useState(false);
  const [camerasOn, setCamerasOn] = useState(true);
  const [cone, setCone] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const shown = useMemo(() => filterPoses(all, { sequence, includeContext }), [all, sequence, includeContext]);
  const counts = useMemo(() => outcomeCounts(shown), [shown]);
  const sequences = useMemo(() => sequencesOf(all), [all]);
  const colours = useMemo(() => outcomeColours(), []);
  const selected = useMemo(() => all.find((p) => p.imageId === selectedId) ?? null, [all, selectedId]);

  const push = useCallback(() => {
    const v = viewer.current;
    if (!v) return;
    v.setCameras(camerasOn ? shown : [], (p) => colours[outcomeKey(p.outcome)]);
    v.setSelectedCamera(camerasOn ? selectedId : null, cone);
  }, [viewer, camerasOn, shown, colours, selectedId, cone]);
  useEffect(push, [push]);

  const viewFrom = useCallback(
    (p: CameraPose | null) => {
      setViewing(p !== null);
      viewer.current?.viewFromPose(p);
    },
    [viewer],
  );

  return {
    loaded: all.length,
    done: poses.done,
    error: poses.error,
    reload: poses.reload,
    shown,
    counts,
    sequences,
    colours,
    sequence,
    setSequence,
    includeContext,
    setIncludeContext,
    camerasOn,
    setCamerasOn,
    cone,
    setCone,
    selected,
    select: setSelectedId,
    viewing,
    viewFrom,
    push,
  };
}
```

```tsx
// src/assetmodels/review/PhotosTopic.tsx
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { thumbnailUrl } from "@contract/client";
import { useBackend } from "@/api/client";
import { Alert, Button, EmptyState, Field, MenuButton, Select, Skeleton, Switch, TopicPanel } from "@/ui";
import { OUTCOME_KEYS, OUTCOME_LABEL } from "./outcome";
import type { ReviewActions } from "./useReviewActions";
import type { PhotosLayer } from "./usePhotosLayer";

const n = (x: number) => x.toLocaleString("en-US");
const photos = (x: number) => `${n(x)} ${x === 1 ? "photo" : "photos"}`;

/** Spec §9 Photos: sequence, outcome colours, context photos, cameras and the view cone. */
export function PhotosTopic({ projectId, layer, actions }: { projectId: string; layer: PhotosLayer; actions: ReviewActions }) {
  const backend = useBackend();
  const estimating = actions.running.pose;
  const menu = (
    <MenuButton
      label="Photos actions"
      iconOnly
      size="sm"
      items={[
        {
          id: "estimate",
          label: "Estimate poses from photo metadata",
          icon: "camera",
          disabled: estimating,
          hint: estimating ? "Running" : undefined,
          onSelect: () => void actions.estimate(),
        },
      ]}
    />
  );
  const empty = layer.done && layer.loaded === 0 && !layer.error;
  return (
    <TopicPanel
      title="Photos"
      count={layer.loaded > 0 ? photos(layer.shown.length) : null}
      menu={menu}
      filters={
        <div className="flex flex-col gap-2.5">
          {layer.sequences.length > 0 && (
            <Field label="Sequence" htmlFor="photos-sequence">
              <Select
                id="photos-sequence"
                dense
                value={layer.sequence ?? ""}
                onChange={(e) => layer.setSequence(e.target.value || null)}
              >
                <option value="">All sequences</option>
                {layer.sequences.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Switch label="Include context photos" checked={layer.includeContext} onChange={layer.setIncludeContext} />
          <Switch label="Show cameras" checked={layer.camerasOn} onChange={layer.setCamerasOn} />
          <Switch label="View cone" checked={layer.cone} disabled={!layer.camerasOn} onChange={layer.setCone} />
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1">
        {layer.error && (
          <Alert
            tone="danger"
            actions={
              <Button size="sm" icon="refresh" onClick={layer.reload}>
                Retry
              </Button>
            }
          >
            The photo poses could not be loaded. {layer.error}
          </Alert>
        )}
        {!layer.done && <Skeleton className="h-4 w-40" />}
        {empty ? (
          <EmptyState
            icon="camera"
            title="No photo poses yet"
            action={
              <Button size="sm" variant="primary" icon="camera" disabled={estimating} onClick={() => void actions.estimate()}>
                Estimate poses
              </Button>
            }
          >
            Poses come from each photo&apos;s GPS and gimbal data, or from an imported review job.
          </EmptyState>
        ) : (
          <>
            <p className="text-sm text-ink">{photos(layer.shown.length)}</p>
            <ul aria-label="Photo outcomes" className="flex flex-col gap-1">
              {OUTCOME_KEYS.map((k) => (
                <li key={k} className="flex items-center gap-2 text-sm" style={{ "--c": layer.colours[k] } as CSSProperties}>
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[var(--c)]" />
                  <span className="flex-1 text-muted">{OUTCOME_LABEL[k]}</span>
                  <span className="font-mono text-2xs tabular-nums text-muted">{n(layer.counts[k])}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {layer.selected && (
          <section aria-label="Selected photo" className="flex flex-col gap-2 border-t border-line pt-3">
            <img
              alt=""
              className="aspect-[4/3] w-full rounded-control bg-surface-2 object-cover"
              src={thumbnailUrl(backend.baseUrl, backend.token, projectId, layer.selected.imageId)}
            />
            {layer.selected.sequence && <p className="text-xs text-muted">{layer.selected.sequence}</p>}
            <div className="flex flex-wrap gap-1.5">
              {layer.viewing ? (
                <Button size="sm" icon="orbit" onClick={() => layer.viewFrom(null)}>
                  Back to the model view
                </Button>
              ) : (
                <Button size="sm" icon="camera" onClick={() => layer.selected && layer.viewFrom(layer.selected)}>
                  View from here
                </Button>
              )}
              <Link
                to={`/p/${projectId}/images/${layer.selected.imageId}`}
                className="inline-flex items-center rounded-control px-2 text-sm text-accent-ink hover:underline"
              >
                Open photo
              </Link>
            </div>
          </section>
        )}
      </div>
    </TopicPanel>
  );
}
```

Notes for the implementer:
- `bg-surface-2` and `text-accent-ink` must be existing Tailwind tokens; check `tailwind.config` and use the nearest existing names if they differ (`pnpm -C frontend lint` runs check-tokens).
- `Field`'s prop names (`label`, `htmlFor`) are taken from `src/ui/Field.tsx`; match them if they differ.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm -C frontend exec vitest run src/assetmodels/review/outcome.test.ts src/assetmodels/review/PhotosTopic.test.tsx`
Expected: PASS (7 tests, including "pages poses")

- [ ] **Step 5: Commit**

```bash
git add frontend/src/assetmodels/review/outcome.ts frontend/src/assetmodels/review/outcome.test.ts frontend/src/assetmodels/review/usePhotosLayer.ts frontend/src/assetmodels/review/PhotosTopic.tsx frontend/src/assetmodels/review/PhotosTopic.test.tsx
git commit -m "feat(asset-findings): photos topic with paged cameras and outcome colours

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Findings: rows, the findings layer and the Findings topic

**Files:**
- Create: `frontend/src/assetmodels/review/findingRows.ts`
- Create: `frontend/src/assetmodels/review/useFindingsLayer.ts`
- Create: `frontend/src/assetmodels/review/FindingsTopic.tsx`
- Modify: `frontend/src/test/assetFindingFixtures.ts` (U4's shared fixtures: add `REVIEW`, `FRAME`, `MODEL_REVIEWED`, `ASSET_FINDINGS`, `PLACEMENTS`)
- Test: `frontend/src/assetmodels/review/findingRows.test.ts`, `frontend/src/assetmodels/review/FindingsTopic.test.tsx`

**Interfaces:**
- Consumes: `useAssetFindings`, `usePlacements`, `fetchPatchBuffers`, `type Placement` (U1); `placementItems` (U1 `viewer/placements.ts`); `FocusSettings` (U1 `viewer/focus.ts`); `formatFindingNumber` (`src/findings/format.ts`); `useProjectTypes` (`src/findings/useProjectTypes.ts`); `useSeverityScale`, `severityOf`, `TopicList`, `TopicPanel`, `SeverityPill` (`src/ui`); `AssetModel.review` (C0 `AssetReviewConfig`).
- Produces:

```ts
// findingRows.ts
export type Placed = "all" | "placed" | "unplaced";
export interface FindingsFilter { severity: string | null; typeId: string | null; zone: string | null; side: string | null; placed: Placed }
export const NO_FILTER: FindingsFilter;
export type AssetFindingsQuery = Omit<FindingListQuery, "asset_model_id" | "cursor" | "limit">;
export function findingsQuery(f: FindingsFilter): AssetFindingsQuery;
export function isFiltered(f: FindingsFilter): boolean;
export function heightText(m: number | null | undefined): string | null;
export function zoneOptions(review: AssetReview | null): { value: string; label: string }[];
export function sideOptions(review: AssetReview | null): { value: string; label: string }[];
export function zoneLabel(review: AssetReview | null, zone: string | null | undefined): string | null;
export function findingItem(f: Finding, typeName: string | undefined, scale: readonly SeverityLevel[], review: AssetReview | null): TopicItem;
export function focusSettingsOf(review: AssetReview | null): FocusSettings | undefined;

// useFindingsLayer.ts
export interface FindingsLayer {
  findings: Finding[]; done: boolean; error: string | null; reload(): void;
  placedCount: number;
  filter: FindingsFilter; setFilter(f: FindingsFilter): void;
  selectedId: string | null; select(id: string | null): void;
  focus(id: string): boolean;
  push(): void;
}
export function useFindingsLayer(o: { projectId: string; model: AssetModel; viewer: RefObject<ModelViewerHandle | null> }): FindingsLayer;

// FindingsTopic.tsx
export function FindingsTopic(p: { projectId: string; model: AssetModel; layer: FindingsLayer; actions: ReviewActions }): JSX.Element;
```

- [ ] **Step 1: Add the fixtures** to `src/test/assetFindingFixtures.ts` (U4's shared file; extend it, do not start another). These are shaped for the workspace tests, whose fake routes use model id `m1` (`MODEL` in `assetModelFixtures.ts`), so they build on U4's `exampleAssetFinding` and override the ids:

```ts
import { MODEL } from "./assetModelFixtures";

export const FRAME = {
  origin: { lat: 25.2, lon: 55.3, ground_alt_m: 4 },
  north_offset_deg: 0,
  height_m: 74.4,
  datum_label: "Ground",
  datum_note: "",
  line_azimuth_deg: null,
  silhouette: [[0, 12], [74.4, 12]],
  levels: [3, 6, 9],
  presets: [],
};

export const REVIEW = {
  profile_id: "building_facade",
  finding_unit: "region",
  placement: "mixed",
  patch_grid: 14,
  cluster_m: 1.5,
  zones: [
    { id: "podium", label: "Podium", min_m: 0, max_m: 10 },
    { id: "middle", label: "Middle", min_m: 10, max_m: 50 },
  ],
  sides: { type: "faces", labels: ["North", "East", "South", "West"], basis: "normal" },
  focus: { frustum: [0.05, 0.125], oblique_deg: 20 },
  report: { pages: "finding", min_severity: 2 },
};

/** The workspace's model `m1` with a frame and a resolved review profile. */
export const MODEL_REVIEWED = { ...MODEL, frame: FRAME, review: REVIEW };

const onM1 = { asset_model_id: "m1", anchor: { kind: "asset", asset_model_id: "m1" }, data_id: "m1", type_id: "t-crack" };

export const ASSET_FINDINGS = [
  { ...exampleAssetFinding, ...onM1, id: "f1", number: 42, severity: 2, height_m: 12.43, bearing_deg: 271,
    side: "West", zone: "middle", placement: "patch", sighting_count: 3 },
  { ...exampleUnplacedAssetFinding, ...onM1, id: "f2", number: 43, severity: 1 },
];

export const PLACEMENTS = {
  version: 2,
  items: [
    { sighting_id: "s1", finding_id: "f1", kind: "patch", center: [10, 12.4, -3], normal: [0, 0, -1], size: 1.2, severity: 2, patch_url: "x" },
    { sighting_id: "s2", finding_id: "f1", kind: "point", center: [10, 12.5, -3], normal: [0, 0, -1], size: null, severity: 2, patch_url: null },
  ],
  next: null,
};
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/assetmodels/review/findingRows.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_SEVERITY_SCALE } from "@/ui/severityScale";
import { ASSET_FINDINGS, REVIEW } from "@/test/assetFindingFixtures";
import {
  NO_FILTER,
  findingItem,
  findingsQuery,
  focusSettingsOf,
  heightText,
  isFiltered,
  sideOptions,
  zoneLabel,
  zoneOptions,
} from "./findingRows";

const review = REVIEW as never;

describe("finding rows", () => {
  it("builds the list query from the filter", () => {
    expect(findingsQuery(NO_FILTER)).toEqual({ sort: "-severity" });
    expect(findingsQuery({ severity: "2", typeId: "t", zone: "middle", side: "West", placed: "unplaced" })).toEqual({
      sort: "-severity", severity: ["2"], type_id: ["t"], zone: ["middle"], side: ["West"], placed: false,
    });
    expect(isFiltered(NO_FILTER)).toBe(false);
    expect(isFiltered({ ...NO_FILTER, placed: "placed" })).toBe(true);
  });

  it("reads zone and side options from the profile", () => {
    expect(zoneOptions(review)).toEqual([{ value: "podium", label: "Podium" }, { value: "middle", label: "Middle" }]);
    expect(sideOptions(review).map((o) => o.label)).toEqual(["North", "East", "South", "West"]);
    expect(zoneOptions(null)).toEqual([]);
    expect(zoneLabel(review, "middle")).toBe("Middle");
    expect(zoneLabel(review, "roof")).toBe("roof");
  });

  it("shows number, type, zone, side and height, and says when a finding is not placed", () => {
    const [placed, unplaced] = ASSET_FINDINGS;
    expect(findingItem(placed as never, "Crack", DEFAULT_SEVERITY_SCALE, review)).toEqual({
      id: "f1", label: "F-0042 · Crack", meta: "Middle · West · 12.4 m", swatch: "#e2bf2e",
    });
    expect(findingItem(unplaced as never, undefined, DEFAULT_SEVERITY_SCALE, review).meta).toBe("Not placed");
    expect(heightText(null)).toBeNull();
  });

  it("passes the profile's focus settings to the engine", () => {
    expect(focusSettingsOf(review)).toEqual({ frustum: [0.05, 0.125], oblique_deg: 20 });
    expect(focusSettingsOf(null)).toBeUndefined();
  });
});
```

```tsx
// src/assetmodels/review/FindingsTopic.test.tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ModelViewerHandle } from "@/assetmodels/viewer/ModelViewer";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { ASSET_FINDINGS, MODEL_REVIEWED, PLACEMENTS } from "@/test/assetFindingFixtures";
import { FindingsTopic } from "./FindingsTopic";
import { useFindingsLayer } from "./useFindingsLayer";

function handle() {
  return { setPlacements: vi.fn(), focusFinding: vi.fn(() => true) } as unknown as ModelViewerHandle &
    Record<"setPlacements" | "focusFinding", ReturnType<typeof vi.fn>>;
}

const actions = () => ({ running: { pose: false, place: false, group: false }, estimate: vi.fn(), compute: vi.fn(), regroup: vi.fn() });

function Harness({ h, a = actions() }: { h: ModelViewerHandle; a?: ReturnType<typeof actions> }) {
  const viewer = useRef<ModelViewerHandle | null>(h);
  const layer = useFindingsLayer({ projectId: PROJECT_ID, model: MODEL_REVIEWED as never, viewer });
  return (
    <>
      <FindingsTopic projectId={PROJECT_ID} model={MODEL_REVIEWED as never} layer={layer} actions={a} />
      <LocationProbe />
    </>
  );
}

const routes = () => [
  { method: "GET", path: /\/findings$/, body: { items: ASSET_FINDINGS, next_cursor: null } },
  { method: "GET", path: /\/placements$/, body: PLACEMENTS },
];

describe("FindingsTopic", () => {
  it("lists the model's findings with zone, side and height and sends the placements to the view", async () => {
    const { api, requests } = fakeClient(routes() as never);
    const h = handle();
    renderWithProviders(<Harness h={h} />, { api, route: `/p/${PROJECT_ID}/models/m1` });
    const list = await screen.findByRole("listbox", { name: /findings/i });
    expect(within(list).getByRole("option", { name: /F-0042/ })).toHaveTextContent("Middle · West · 12.4 m");
    expect(within(list).getByRole("option", { name: /F-0043/ })).toHaveTextContent("Not placed");
    expect(requests.find((r) => r.url.includes("/findings"))!.url).toContain("asset_model_id=m1");
    await waitFor(() => expect(h.setPlacements.mock.calls.at(-1)?.[0]).toHaveLength(2));
  });

  it("filters on the server and narrows the placements in the view to the listed findings", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/findings$/, body: (r) => ({ items: r.url.includes("zone=podium") ? [] : ASSET_FINDINGS, next_cursor: null }) },
      { method: "GET", path: /\/placements$/, body: PLACEMENTS },
    ] as never);
    const h = handle();
    renderWithProviders(<Harness h={h} />, { api, route: `/p/${PROJECT_ID}/models/m1` });
    await screen.findByRole("option", { name: /F-0042/ });
    fireEvent.change(screen.getByLabelText(/zone/i), { target: { value: "podium" } });
    await waitFor(() => expect(requests.some((r) => r.url.includes("zone=podium"))).toBe(true));
    await waitFor(() => expect(h.setPlacements.mock.calls.at(-1)?.[0]).toEqual([]));
    expect(await screen.findByText(/no findings match/i)).toBeInTheDocument();
  });

  it("focuses the selected finding with the profile's focus settings and opens its inspection", async () => {
    const { api } = fakeClient(routes() as never);
    const h = handle();
    renderWithProviders(<Harness h={h} />, { api, route: `/p/${PROJECT_ID}/models/m1` });
    fireEvent.click(await screen.findByRole("option", { name: /F-0042/ }));
    fireEvent.click(screen.getByRole("button", { name: /^focus$/i }));
    expect(h.focusFinding).toHaveBeenCalledWith("f1", { frustum: [0.05, 0.125], oblique_deg: 20 });
    fireEvent.click(screen.getByRole("link", { name: /inspect/i }));
    expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/models/m1/inspect?finding=f1`);
  });

  it("asks before Regroup and starts Compute placements from the menu", async () => {
    const { api } = fakeClient(routes() as never);
    const a = actions();
    renderWithProviders(<Harness h={handle()} a={a} />, { api, route: `/p/${PROJECT_ID}/models/m1` });
    await screen.findByRole("option", { name: /F-0042/ });
    fireEvent.click(screen.getByRole("button", { name: /findings actions/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^compute placements$/i }));
    expect(a.compute).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: /findings actions/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /regroup findings/i }));
    const dialog = await screen.findByRole("dialog", { name: /regroup findings/i });
    expect(dialog).toHaveTextContent(/keep their number, status, notes and comments/i);
    fireEvent.click(within(dialog).getByRole("button", { name: /^regroup$/i }));
    expect(a.regroup).toHaveBeenCalled();
  });
});
```

Check `LocationProbe`'s test id in `src/test/render.tsx` and use it (the workspace test already does).

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/assetmodels/review/findingRows.test.ts src/assetmodels/review/FindingsTopic.test.tsx`
Expected: FAIL (the modules don't exist)

- [ ] **Step 4: Implement**

```ts
// src/assetmodels/review/findingRows.ts
import type { AssetModel } from "@contract/client";
import type { Finding, FindingListQuery } from "@/api/findings";
import type { FocusSettings } from "@/assetmodels/viewer/focus";
import { formatFindingNumber } from "@/findings/format";
import type { TopicItem } from "@/ui";
import { severityOf, type SeverityLevel } from "@/ui/severityScale";

export type AssetReview = NonNullable<AssetModel["review"]>;
export type Placed = "all" | "placed" | "unplaced";

export interface FindingsFilter {
  severity: string | null;
  typeId: string | null;
  zone: string | null;
  side: string | null;
  placed: Placed;
}

export const NO_FILTER: FindingsFilter = { severity: null, typeId: null, zone: null, side: null, placed: "all" };

export type AssetFindingsQuery = Omit<FindingListQuery, "asset_model_id" | "cursor" | "limit">;

export function findingsQuery(f: FindingsFilter): AssetFindingsQuery {
  const q: AssetFindingsQuery = { sort: "-severity" };
  if (f.severity) q.severity = [f.severity];
  if (f.typeId) q.type_id = [f.typeId];
  if (f.zone) q.zone = [f.zone];
  if (f.side) q.side = [f.side];
  if (f.placed !== "all") q.placed = f.placed === "placed";
  return q;
}

export function isFiltered(f: FindingsFilter): boolean {
  return Boolean(f.severity || f.typeId || f.zone || f.side || f.placed !== "all");
}

export function heightText(m: number | null | undefined): string | null {
  return m === null || m === undefined ? null : `${m.toFixed(1)} m`;
}

export function zoneOptions(review: AssetReview | null): { value: string; label: string }[] {
  return (review?.zones ?? []).map((z) => ({ value: z.id, label: z.label }));
}

export function sideOptions(review: AssetReview | null): { value: string; label: string }[] {
  return (review?.sides?.labels ?? []).map((l) => ({ value: l, label: l }));
}

export function zoneLabel(review: AssetReview | null, zone: string | null | undefined): string | null {
  if (!zone) return null;
  return review?.zones?.find((z) => z.id === zone)?.label ?? zone;
}

export function findingItem(
  f: Finding,
  typeName: string | undefined,
  scale: readonly SeverityLevel[],
  review: AssetReview | null,
): TopicItem {
  const placed = f.placement === "point" || f.placement === "patch";
  const meta = placed ? [zoneLabel(review, f.zone), f.side, heightText(f.height_m)].filter(Boolean).join(" · ") : "Not placed";
  return {
    id: f.id,
    label: [formatFindingNumber(f.number), typeName].filter(Boolean).join(" · "),
    meta,
    swatch: severityOf(scale, f.severity)?.colour,
  };
}

export function focusSettingsOf(review: AssetReview | null): FocusSettings | undefined {
  const f = review?.focus;
  if (!f) return undefined;
  return { frustum: [f.frustum[0], f.frustum[1]], oblique_deg: f.oblique_deg ?? 0 };
}
```

```ts
// src/assetmodels/review/useFindingsLayer.ts
// The findings layer (spec §9 Findings): the model's findings (paged 500, filtered on the server)
// and its placements index (paged 2,000), pushed into the viewer as pins and patches. Patch
// binaries load only when visible (U1 PatchLoader). Lives in the workspace, not in the topic.
import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import type { AssetModel } from "@contract/client";
import { fetchPatchBuffers, useAssetFindings, usePlacements } from "@/api/assetReview";
import { useBackend } from "@/api/client";
import type { Finding } from "@/api/findings";
import type { ModelViewerHandle } from "@/assetmodels/viewer/ModelViewer";
import { placementItems } from "@/assetmodels/viewer/placements";
import { tokenRgb } from "@/clouds/viewer/overlay";
import { useSeverityScale } from "@/ui";
import { NO_FILTER, findingsQuery, focusSettingsOf, isFiltered, type FindingsFilter } from "./findingRows";

export interface FindingsLayer {
  findings: Finding[];
  done: boolean;
  error: string | null;
  reload(): void;
  placedCount: number;
  filter: FindingsFilter;
  setFilter(f: FindingsFilter): void;
  selectedId: string | null;
  select(id: string | null): void;
  focus(id: string): boolean;
  push(): void;
}

export function useFindingsLayer(o: {
  projectId: string;
  model: AssetModel;
  viewer: RefObject<ModelViewerHandle | null>;
}): FindingsLayer {
  const { projectId, model, viewer } = o;
  const backend = useBackend();
  const scale = useSeverityScale();
  const [filter, setFilter] = useState<FindingsFilter>(NO_FILTER);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = useMemo(() => findingsQuery(filter), [filter]);
  const findings = useAssetFindings(projectId, model.id, query);
  const placements = usePlacements(projectId, model.id);
  const fetchPatch = useMemo(
    () => fetchPatchBuffers({ baseUrl: backend.baseUrl, token: backend.token }, projectId, model.id),
    [backend.baseUrl, backend.token, projectId, model.id],
  );
  const fallback = useMemo(() => `rgb(${tokenRgb("muted").join(", ")})`, []);
  const items = useMemo(() => {
    const all = placementItems(placements.items, scale, fallback);
    if (!isFiltered(filter)) return all;
    const listed = new Set(findings.items.map((f) => f.id));
    return all.filter((p) => listed.has(p.findingId));
  }, [placements.items, scale, fallback, filter, findings.items]);

  const push = useCallback(() => {
    viewer.current?.setPlacements(items, fetchPatch);
  }, [viewer, items, fetchPatch]);
  useEffect(push, [push]);

  const review = model.review ?? null;
  const focus = useCallback(
    (id: string) => viewer.current?.focusFinding(id, focusSettingsOf(review)) ?? false,
    [viewer, review],
  );

  return {
    findings: findings.items,
    done: findings.done,
    error: findings.error ?? placements.error,
    reload: () => {
      findings.reload();
      placements.reload();
    },
    placedCount: new Set(items.map((i) => i.findingId)).size,
    filter,
    setFilter,
    selectedId,
    select: setSelectedId,
    focus,
    push,
  };
}
```

```tsx
// src/assetmodels/review/FindingsTopic.tsx
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AssetModel } from "@contract/client";
import { formatFindingNumber } from "@/findings/format";
import { useProjectTypes } from "@/findings/useProjectTypes";
import {
  Alert,
  Button,
  Dialog,
  Field,
  MenuButton,
  Segmented,
  Select,
  SeverityPill,
  TopicList,
  TopicPanel,
  useSeverityScale,
} from "@/ui";
import { findingItem, heightText, isFiltered, sideOptions, zoneLabel, zoneOptions, type Placed } from "./findingRows";
import type { FindingsLayer } from "./useFindingsLayer";
import type { ReviewActions } from "./useReviewActions";

const PLACED: { value: Placed; label: string }[] = [
  { value: "all", label: "All" },
  { value: "placed", label: "Placed" },
  { value: "unplaced", label: "Not placed" },
];

/** Spec §9 Findings: the list with zone, side and height; filters; Focus; Regroup. */
export function FindingsTopic({
  projectId,
  model,
  layer,
  actions,
}: {
  projectId: string;
  model: AssetModel;
  layer: FindingsLayer;
  actions: ReviewActions;
}) {
  const scale = useSeverityScale();
  const { all: types } = useProjectTypes(projectId);
  const review = model.review ?? null;
  const [confirm, setConfirm] = useState(false);
  const items = useMemo(() => {
    const name = (id: string) => types.find((t) => t.id === id)?.name;
    return layer.findings.map((f) => findingItem(f, name(f.type_id), scale, review));
  }, [layer.findings, types, scale, review]);
  const selected = layer.findings.find((f) => f.id === layer.selectedId) ?? null;
  const f = layer.filter;
  const set = (patch: Partial<typeof f>) => layer.setFilter({ ...f, ...patch });
  const busy = actions.running.place || actions.running.group;

  return (
    <TopicPanel
      title="Findings"
      count={layer.done ? layer.findings.length : null}
      menu={
        <MenuButton
          label="Findings actions"
          iconOnly
          size="sm"
          items={[
            { id: "compute", label: "Compute placements", icon: "pin", disabled: busy, onSelect: () => void actions.compute(false) },
            { id: "compute-dirty", label: "Compute changed placements", disabled: busy, onSelect: () => void actions.compute(true) },
            { id: "regroup", label: "Regroup findings", icon: "refresh", disabled: busy, onSelect: () => setConfirm(true) },
          ]}
        />
      }
      filters={
        <div className="grid grid-cols-2 gap-2">
          <Field label="Severity" htmlFor="af-severity">
            <Select id="af-severity" dense value={f.severity ?? ""} onChange={(e) => set({ severity: e.target.value || null })}>
              <option value="">Any</option>
              {scale.map((s) => (
                <option key={s.level} value={String(s.level)}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type" htmlFor="af-type">
            <Select id="af-type" dense value={f.typeId ?? ""} onChange={(e) => set({ typeId: e.target.value || null })}>
              <option value="">Any</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Zone" htmlFor="af-zone">
            <Select id="af-zone" dense value={f.zone ?? ""} onChange={(e) => set({ zone: e.target.value || null })}>
              <option value="">Any</option>
              {zoneOptions(review).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Side" htmlFor="af-side">
            <Select id="af-side" dense value={f.side ?? ""} onChange={(e) => set({ side: e.target.value || null })}>
              <option value="">Any</option>
              {sideOptions(review).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Segmented
            className="col-span-2"
            size="sm"
            label="Placed"
            options={PLACED}
            value={f.placed}
            onChange={(v) => set({ placed: v })}
          />
        </div>
      }
    >
      {layer.error && (
        <Alert
          tone="danger"
          actions={
            <Button size="sm" icon="refresh" onClick={layer.reload}>
              Retry
            </Button>
          }
        >
          {layer.error}
        </Alert>
      )}
      <TopicList
        label="Findings"
        items={items}
        selectedId={layer.selectedId}
        onSelect={layer.select}
        empty={
          layer.done ? (
            <p className="px-2 py-3 text-sm text-muted">
              {isFiltered(f) ? "No findings match these filters." : "No findings yet."}
            </p>
          ) : null
        }
      />
      {selected && (
        <section aria-label="Selected finding" className="flex flex-col gap-2 border-t border-line px-1 pt-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-ink">{formatFindingNumber(selected.number)}</span>
            <SeverityPill level={selected.severity} size="sm" />
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-muted">Zone</dt>
            <dd className="text-ink">{zoneLabel(review, selected.zone) ?? "Not placed"}</dd>
            <dt className="text-muted">Side</dt>
            <dd className="text-ink">{selected.side ?? "Not placed"}</dd>
            <dt className="text-muted">Height</dt>
            <dd className="tabular-nums text-ink">{heightText(selected.height_m) ?? "Not placed"}</dd>
            <dt className="text-muted">Sightings</dt>
            <dd className="tabular-nums text-ink">{selected.sighting_count ?? 0}</dd>
          </dl>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              icon="crosshair"
              disabled={selected.placement !== "point" && selected.placement !== "patch"}
              onClick={() => layer.focus(selected.id)}
            >
              Focus
            </Button>
            <Link
              to={`/p/${projectId}/models/${model.id}/inspect?finding=${selected.id}`}
              className="inline-flex items-center rounded-control px-2 text-sm text-accent-ink hover:underline"
            >
              Inspect
            </Link>
            <Link
              to={`/p/${projectId}/findings/${selected.id}`}
              className="inline-flex items-center rounded-control px-2 text-sm text-accent-ink hover:underline"
            >
              Open in register
            </Link>
          </div>
        </section>
      )}
      <Dialog
        open={confirm}
        title="Regroup findings"
        onClose={() => setConfirm(false)}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirm(false);
                void actions.regroup();
              }}
            >
              Regroup
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Sightings are grouped again by distance and group tags. Findings that survive keep their number, status, notes and
          comments. A finding merged into another is closed with a comment naming the one it joined; nothing is deleted.
        </p>
      </Dialog>
    </TopicPanel>
  );
}
```

The empty-list copy: with a filter set and nothing matching, "No findings match these filters."; with no filter, "No findings yet."

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm -C frontend exec vitest run src/assetmodels/review/findingRows.test.ts src/assetmodels/review/FindingsTopic.test.tsx`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/assetmodels/review/findingRows.ts frontend/src/assetmodels/review/findingRows.test.ts frontend/src/assetmodels/review/useFindingsLayer.ts frontend/src/assetmodels/review/FindingsTopic.tsx frontend/src/assetmodels/review/FindingsTopic.test.tsx frontend/src/test/assetFindingFixtures.ts
git commit -m "feat(asset-findings): findings topic with filters, focus and regroup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Review actions and the Import a GLB dialog

**Files:**
- Create: `frontend/src/assetmodels/review/useReviewActions.ts`
- Create: `frontend/src/assetmodels/review/ImportGlbDialog.tsx`
- Test: `frontend/src/assetmodels/review/useReviewActions.test.tsx`, `frontend/src/assetmodels/review/ImportGlbDialog.test.tsx`

**Interfaces:**
- Consumes: `estimatePoses`, `computePlacements`, `regroup`, `importGlb`, `type ImportGlbBody` (U1); `useJobsStore`, `isActiveJob` (`src/store/jobs.ts`); `toast` (`src/ui`); `useBackend` (`mode`); `@tauri-apps/plugin-dialog` `open` (Tauri only, dynamic import as `ImportCloudDialog.tsx` does).
- Produces:

```ts
export interface ReviewActions {
  running: { pose: boolean; place: boolean; group: boolean };
  estimate(): Promise<void>;
  compute(onlyDirty: boolean): Promise<void>;
  regroup(): Promise<void>;
}
export function useReviewActions(projectId: string, modelId: string): ReviewActions;
export const FRAME_CONVERSIONS: readonly { value: string; label: string }[];
export function ImportGlbDialog(p: { projectId: string; modelId: string; onClose(): void; onStarted(version: number, jobId: string): void }): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

```tsx
// src/assetmodels/review/useReviewActions.test.tsx
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { TestApiProvider } from "@/test/render";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { useJobsStore } from "@/store/jobs";
import { useToastStore } from "@/ui";
import { useReviewActions } from "./useReviewActions";

const job = (type: string, state = "queued") => ({ id: `j-${type}`, project_id: PROJECT_ID, type, state, progress: 0,
  message: "", log_path: "", params: { asset_model_id: "m1" }, result: null, error: null, created_at: "",
  started_at: null, finished_at: null });

afterEach(() => useJobsStore.setState({ jobs: {} }));

describe("useReviewActions", () => {
  it("posts each job, tracks it in the jobs store and says it started", async () => {
    const { api } = fakeClient([
      { method: "POST", path: /\/placements\/compute$/, status: 202, body: { job: job("asset_place") } },
    ]);
    const { result } = renderHook(() => useReviewActions(PROJECT_ID, "m1"), {
      wrapper: ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>,
    });
    await act(() => result.current.compute(false));
    expect(useJobsStore.getState().jobs["j-asset_place"]).toBeDefined();
    expect(result.current.running.place).toBe(true);
    expect(useToastStore.getState().toasts.at(-1)?.text).toMatch(/computing placements/i);
  });

  it("shows the server's reason when a job cannot start", async () => {
    const { api } = fakeClient([{ method: "POST", path: /\/findings\/regroup$/, status: 409,
      body: { error: { code: "job_running", message: "A placement job is running for this model.", details: {} } } }]);
    const { result } = renderHook(() => useReviewActions(PROJECT_ID, "m1"), {
      wrapper: ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>,
    });
    await act(() => result.current.regroup());
    expect(useToastStore.getState().toasts.at(-1)?.text).toMatch(/placement job is running/i);
  });
});
```

```tsx
// src/assetmodels/review/ImportGlbDialog.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { ImportGlbDialog } from "./ImportGlbDialog";

describe("ImportGlbDialog", () => {
  it("imports a GLB with a frame conversion and an origin", async () => {
    const { api, requests } = fakeClient([{ method: "POST", path: /\/versions\/import-glb$/, status: 202,
      body: { version: { version: 3 }, job: { id: "j9", type: "asset_glb_import", state: "queued" } } }]);
    const onStarted = vi.fn();
    renderWithProviders(<ImportGlbDialog projectId={PROJECT_ID} modelId="m1" onClose={() => {}} onStarted={onStarted} />, { api });
    fireEvent.change(screen.getByLabelText(/glb file/i), { target: { value: "D:\\models\\tower.glb" } });
    fireEvent.change(screen.getByLabelText(/axes in the file/i), { target: { value: "x_east_minus_z_north" } });
    fireEvent.change(screen.getByLabelText(/latitude/i), { target: { value: "25.2" } });
    fireEvent.change(screen.getByLabelText(/longitude/i), { target: { value: "55.3" } });
    fireEvent.change(screen.getByLabelText(/ground altitude/i), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(3, "j9"));
    expect(requests[0].body).toEqual({
      path: "D:\\models\\tower.glb",
      frame_conversion: "x_east_minus_z_north",
      origin: { lat: 25.2, lon: 55.3, ground_alt_m: 4 },
    });
  });

  it("needs all three origin fields or none", async () => {
    const { api } = fakeClient([]);
    renderWithProviders(<ImportGlbDialog projectId={PROJECT_ID} modelId="m1" onClose={() => {}} onStarted={() => {}} />, { api });
    fireEvent.change(screen.getByLabelText(/glb file/i), { target: { value: "D:\\a.glb" } });
    fireEvent.change(screen.getByLabelText(/latitude/i), { target: { value: "25.2" } });
    expect(screen.getByRole("button", { name: /^import$/i })).toBeDisabled();
    expect(screen.getByText(/latitude, longitude and ground altitude together/i)).toBeInTheDocument();
  });
});
```

Check `useToastStore`'s state shape (`toasts`, each with `text`) in `src/ui/toastStore.ts` and adapt the two assertions to it.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/assetmodels/review/useReviewActions.test.tsx src/assetmodels/review/ImportGlbDialog.test.tsx`
Expected: FAIL (the modules don't exist)

- [ ] **Step 3: Implement**

```ts
// src/assetmodels/review/useReviewActions.ts
// The workspace's job buttons (spec §6): Estimate poses, Compute placements, Regroup. Each posts
// the job (202), puts it in the jobs store so the jobs dock and the end toast follow it, and says
// that it started. A job of the same kind already running for this model disables its button.
import { useCallback } from "react";
import type { Job } from "@contract/client";
import { computePlacements, estimatePoses, regroup as regroupFindings } from "@/api/assetReview";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { toast } from "@/ui";

export interface ReviewActions {
  running: { pose: boolean; place: boolean; group: boolean };
  estimate(): Promise<void>;
  compute(onlyDirty: boolean): Promise<void>;
  regroup(): Promise<void>;
}

const activeFor = (jobs: Record<string, Job>, type: Job["type"], modelId: string) =>
  Object.values(jobs).some((j) => j.type === type && isActiveJob(j) && j.params?.asset_model_id === modelId);

export function useReviewActions(projectId: string, modelId: string): ReviewActions {
  const api = useApi();
  const pose = useJobsStore((s) => activeFor(s.jobs, "asset_pose", modelId));
  const place = useJobsStore((s) => activeFor(s.jobs, "asset_place", modelId));
  const group = useJobsStore((s) => activeFor(s.jobs, "asset_group", modelId));
  const start = useCallback(async (run: () => Promise<Job>, started: string, failed: string) => {
    try {
      const job = await run();
      useJobsStore.getState().upsert(job);
      toast("info", started);
    } catch (e) {
      toast("danger", messageOf(e, failed));
    }
  }, []);
  return {
    running: { pose, place, group },
    estimate: () =>
      start(() => estimatePoses(api, projectId, modelId), "Estimating photo poses. You can keep working.", "The pose estimate could not start."),
    compute: (onlyDirty) =>
      start(
        () => computePlacements(api, projectId, modelId, onlyDirty),
        "Computing placements, then grouping the findings. You can keep working.",
        "The placements could not start.",
      ),
    regroup: () =>
      start(() => regroupFindings(api, projectId, modelId), "Regrouping the findings. You can keep working.", "Regroup could not start."),
  };
}
```

```tsx
// src/assetmodels/review/ImportGlbDialog.tsx
// Spec §2 and §6.1: an existing GLB becomes a new version of this asset model, converted once into
// the asset frame (metres, Y up, X plant north, Z plant east). The import is a background job.
import { useState, type FormEvent } from "react";
import { importGlb } from "@/api/assetReview";
import { useApi, useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, Dialog, Field, Input, Select } from "@/ui";

export const FRAME_CONVERSIONS: readonly { value: string; label: string }[] = [
  { value: "none", label: "Already in the asset frame: Y up, X north" },
  { value: "x_east_minus_z_north", label: "Y up, X east, minus Z north (most glTF exports)" },
];

const num = (s: string) => (s.trim() === "" ? null : Number(s));

export function ImportGlbDialog({
  projectId,
  modelId,
  onClose,
  onStarted,
}: {
  projectId: string;
  modelId: string;
  onClose(): void;
  onStarted(version: number, jobId: string): void;
}) {
  const api = useApi();
  const { mode } = useBackend();
  const [path, setPath] = useState("");
  const [conversion, setConversion] = useState("none");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const origin = [num(lat), num(lon), num(alt)];
  const some = origin.some((v) => v !== null);
  const all = origin.every((v) => v !== null && Number.isFinite(v));
  const originError = some && !all ? "Enter latitude, longitude and ground altitude together, or none of them." : null;
  const ready = path.trim().length > 0 && !originError;

  async function browse() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: false, filters: [{ name: "glTF binary", extensions: ["glb"] }] });
    if (typeof picked === "string") setPath(picked);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const r = await importGlb(api, projectId, modelId, {
        path: path.trim(),
        frame_conversion: conversion,
        origin: all ? { lat: origin[0]!, lon: origin[1]!, ground_alt_m: origin[2]! } : null,
      });
      useJobsStore.getState().upsert(r.job);
      onStarted(r.version.version, r.job.id);
    } catch (err) {
      setError(messageOf(err, "The import could not start."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title="Import a GLB"
      description="The file is copied into the project and never changed. It becomes a new version of this asset model."
      onClose={() => !busy && onClose()}
      onSubmit={(e) => void submit(e)}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="import" loading={busy} disabled={!ready}>
            Import
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="GLB file" htmlFor="glb-path" error={error}>
          <div className="flex gap-2">
            <Input
              id="glb-path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="D:\models\asset.glb"
              className="min-w-0 flex-1 font-mono"
            />
            {mode === "tauri" && <Button onClick={() => void browse()}>Browse</Button>}
          </div>
        </Field>
        <Field label="Axes in the file" htmlFor="glb-frame">
          <Select id="glb-frame" value={conversion} onChange={(e) => setConversion(e.target.value)}>
            {FRAME_CONVERSIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <fieldset className="grid grid-cols-3 gap-2">
          <legend className="mb-1 text-xs text-muted">Where the asset stands (optional; puts it on the street map)</legend>
          <Field label="Latitude" htmlFor="glb-lat">
            <Input id="glb-lat" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
          </Field>
          <Field label="Longitude" htmlFor="glb-lon">
            <Input id="glb-lon" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} />
          </Field>
          <Field label="Ground altitude (m)" htmlFor="glb-alt">
            <Input id="glb-alt" inputMode="decimal" value={alt} onChange={(e) => setAlt(e.target.value)} />
          </Field>
        </fieldset>
        {originError && <Alert tone="warn">{originError}</Alert>}
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm -C frontend exec vitest run src/assetmodels/review/useReviewActions.test.tsx src/assetmodels/review/ImportGlbDialog.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/assetmodels/review/useReviewActions.ts frontend/src/assetmodels/review/useReviewActions.test.tsx frontend/src/assetmodels/review/ImportGlbDialog.tsx frontend/src/assetmodels/review/ImportGlbDialog.test.tsx
git commit -m "feat(asset-findings): review job actions and the import a GLB dialog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The asset workspace on the rail

**Files:**
- Modify: `frontend/src/ui/railStore.ts` (`RailWorkspace` += `"models"`)
- Create: `frontend/src/assetmodels/workspace/topics.ts`
- Create: `frontend/src/assetmodels/workspace/useModelRail.tsx`
- Create: `frontend/src/assetmodels/review/useGroundTiles.ts`
- Modify: `frontend/src/assetmodels/workspace/ViewTools.tsx` (`ViewTools` becomes `ViewToolButtons`, the rail's navigation; `CutBearing`, `VIEWS`, `modelKey` unchanged)
- Modify: `frontend/src/assetmodels/workspace/ModelPanel.tsx` (no glass wrapper: it is the Model topic's body; view switches; Import a GLB in the picker)
- Modify: `frontend/src/assetmodels/workspace/AssetModelWorkspace.tsx` (rail, layers, picks, view switches, import dialog)
- Test: `frontend/src/assetmodels/workspace/useModelRail.test.tsx`, `frontend/src/assetmodels/workspace/AssetModelWorkspace.test.tsx` (extend; `afterEach(() => localStorage.clear())`)

**Interfaces:**
- Consumes: Tasks 2 to 4; `WorkspaceRail`, `createRailStore`, `TopicPanel` (`src/ui`); `groundTiles` (U1 `viewer/ground.ts`); `basemapTileUrl` (`@contract/client`); `PickHit`, `emitPick` (U1).
- Produces:

```ts
// topics.ts
export const MODEL_TOPICS = ["model", "findings", "photos"] as const;
export type ModelTopicId = (typeof MODEL_TOPICS)[number];
// useModelRail.tsx
export function useModelRail(p: { running: boolean; tools: ViewToolState; onToggle(t: keyof ViewToolState): void;
  onView(v: ModelView): void; modelBody: ReactNode; findingsBody: ReactNode; photosBody: ReactNode;
  findingsCount: number | null }): { store: StoreApi<RailState>; topics: RailTopic[]; nav: ReactNode };
export function showTopic(store: StoreApi<RailState>, id: ModelTopicId): void;
// useGroundTiles.ts
export function useGroundTiles(model: AssetModel): GroundTile[] | null;   // null without a geographic origin
```

Layout after this task (geometry unchanged from M1 except the left column):

| Element | Placement |
| --- | --- |
| Rail toolbar | `left-3.5 top-3.5`: Orbit, Cut, Levels, Head off, Fit, Views, then Model, Findings, Photos |
| Topic panel | `left-[72px] top-3.5 w-[340px]`, bottom 84 (the build bar) |
| Inspector, Download, build slot | unchanged |

- [ ] **Step 1: Write the failing tests**

```tsx
// src/assetmodels/workspace/useModelRail.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RAIL_STORAGE_PREFIX, WorkspaceRail } from "@/ui";
import { showTopic, useModelRail } from "./useModelRail";

afterEach(() => localStorage.clear());

function Harness({ onToggle = vi.fn() }: { onToggle?: (t: string) => void }) {
  const rail = useModelRail({
    running: true,
    tools: { cut: false, levels: false, headOff: false },
    onToggle,
    onView: () => {},
    modelBody: <p>model body</p>,
    findingsBody: <p>findings body</p>,
    photosBody: <p>photos body</p>,
    findingsCount: 12,
  });
  return (
    <>
      <WorkspaceRail label="Model view tools" store={rail.store} nav={rail.nav} topics={rail.topics} inspectorOpen bottomInset={84} />
      <button type="button" onClick={() => showTopic(rail.store, "findings")}>show findings</button>
    </>
  );
}

describe("useModelRail", () => {
  it("opens on the Model topic and switches topics from the rail", () => {
    render(<Harness />);
    expect(screen.getByText("model body")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^photos/i }));
    expect(screen.getByText("photos body")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(`${RAIL_STORAGE_PREFIX}models`)!)).toEqual({ open: true, topic: "photos" });
  });

  it("keeps the view tools on the rail", () => {
    const onToggle = vi.fn();
    render(<Harness onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /^cut/i }));
    expect(onToggle).toHaveBeenCalledWith("cut");
  });

  it("showTopic opens a topic without closing it when it is already open", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "show findings" }));
    fireEvent.click(screen.getByRole("button", { name: "show findings" }));
    expect(screen.getByText("findings body")).toBeInTheDocument();
  });
});
```

Add to `src/assetmodels/workspace/AssetModelWorkspace.test.tsx` (and `afterEach(() => localStorage.clear())` at the top level; import `emitPick` from `@/test/fakeModelViewer`, and `ASSET_FINDINGS`, `MODEL_REVIEWED`, `PLACEMENTS` from `@/test/assetFindingFixtures`):

```tsx
describe("findings on the asset", () => {
  const review = [
    { method: "GET", path: /\/asset-models$/, body: { items: [MODEL_REVIEWED] } },
    { method: "GET", path: /\/asset-models\/m1$/, body: MODEL_REVIEWED },
    { method: "GET", path: /\/findings$/, body: { items: ASSET_FINDINGS, next_cursor: null } },
    { method: "GET", path: /\/placements$/, body: PLACEMENTS },
    { method: "GET", path: /\/poses$/, body: { items: [], next: null } },
  ];

  it("puts the view tools and the Model, Findings and Photos topics on one rail", async () => {
    open(review);
    const rail = await screen.findByRole("toolbar", { name: /model view tools/i });
    for (const name of [/^cut/i, /^levels/i, /^model/i, /^findings/i, /^photos/i]) {
      expect(within(rail).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(await screen.findByRole("switch", { name: /see through/i })).toBeInTheDocument();
  });

  it("sends the placements to the view and opens the Findings topic on a picked finding", async () => {
    open(review);
    await screen.findByTestId("model-workspace");
    await waitFor(() => expect(callsTo("setPlacements").at(-1)?.[0]).toHaveLength(2));
    act(() => emitPick({ kind: "finding", id: "f1" }));
    const panel = await screen.findByTestId("rail-panel");
    expect(panel).toHaveAttribute("data-topic", "findings");
    expect(within(panel).getByRole("option", { name: /F-0042/ })).toHaveAttribute("aria-selected", "true");
  });

  it("the view switches reach the engine and come back after a reload of the view", async () => {
    open(review);
    await screen.findByTestId("model-workspace");
    fireEvent.click(await screen.findByRole("switch", { name: /see through/i }));
    fireEvent.click(screen.getByRole("switch", { name: /turn slowly/i }));
    fireEvent.click(screen.getByRole("switch", { name: /street map/i }));
    expect(callsTo("setGhost").at(-1)).toEqual([true]);
    expect(callsTo("setAutoRotate").at(-1)?.[0]).toBe(true);
    expect((callsTo("setGround").at(-1)?.[0] as unknown[]).length).toBeGreaterThan(0);
    resetCalls();
    act(() => emitState("running"));
    expect(callsTo("setGhost").at(-1)).toEqual([true]);
    expect(callsTo("setPlacements").length).toBeGreaterThan(0);
  });

  it("imports a GLB from the model picker", async () => {
    const client = open([
      ...review,
      { method: "POST", path: /\/versions\/import-glb$/, status: 202,
        body: { version: { ...VERSION_2, version: 3, kind: "imported", glb_status: "pending" }, job: { id: "jg", type: "asset_glb_import", state: "queued" } } },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /asset model: /i }));
    fireEvent.click(await screen.findByRole("button", { name: /import a glb/i }));
    fireEvent.change(await screen.findByLabelText(/glb file/i), { target: { value: "D:\\t.glb" } });
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
    await waitFor(() => expect(client.requests.some((r) => r.url.endsWith("/versions/import-glb"))).toBe(true));
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/assetmodels/workspace`
Expected: FAIL (`useModelRail` does not exist; the workspace has no rail)

- [ ] **Step 3: Implement the rail pieces**

`src/ui/railStore.ts`:

```ts
export type RailWorkspace = "maps" | "clouds" | "models";
```

```ts
// src/assetmodels/workspace/topics.ts
/** The asset workspace's rail topics (asset findings spec §9), the model panel first. */
export const MODEL_TOPICS = ["model", "findings", "photos"] as const;
export type ModelTopicId = (typeof MODEL_TOPICS)[number];
```

```tsx
// src/assetmodels/workspace/useModelRail.tsx
import { useState, type ReactNode } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { ModelView } from "@/assetmodels/viewer/engine";
import { createRailStore, TopicPanel, type RailState, type RailTopic } from "@/ui";
import { MODEL_TOPICS, type ModelTopicId } from "./topics";
import { ViewToolButtons, type ViewToolState } from "./ViewTools";

/** Opens a topic; on the topic already open it stays open (the store's openTopic would close it). */
export function showTopic(store: StoreApi<RailState>, id: ModelTopicId): void {
  const s = store.getState();
  if (!s.open || s.topic !== id) s.openTopic(id);
}

/**
 * The asset workspace rail (workspace-rail spec §2): M1's view tools as navigation, then the Model,
 * Findings and Photos topics. One store per mount; the open topic is remembered.
 */
export function useModelRail(p: {
  running: boolean;
  tools: ViewToolState;
  onToggle(t: keyof ViewToolState): void;
  onView(v: ModelView): void;
  modelBody: ReactNode;
  findingsBody: ReactNode;
  photosBody: ReactNode;
  findingsCount: number | null;
}): { store: StoreApi<RailState>; topics: RailTopic[]; nav: ReactNode } {
  const [store] = useState(() => createRailStore("models", MODEL_TOPICS, "model"));
  const nav = <ViewToolButtons state={p.tools} disabled={!p.running} onToggle={p.onToggle} onView={p.onView} />;
  const topics: RailTopic[] = [
    { id: "model", label: "Model", icon: "cube", group: "shared", body: <TopicPanel title="Model">{p.modelBody}</TopicPanel> },
    { id: "findings", label: "Findings", icon: "findings", group: "shared", body: p.findingsBody },
    { id: "photos", label: "Photos", icon: "camera", group: "workspace", body: p.photosBody },
  ];
  return { store, topics, nav };
}
```

The Findings rail button shows no badge (`badge` is for items waiting on the operator; findings are not).

`ViewTools.tsx`: rename the component to `ViewToolButtons`, drop the `FloatingToolbar` wrapper (the rail's `GlassPanel role="toolbar"` replaces it) and return a fragment of the same `ToolButton`s, separators and the Views `Menu`. Its props are unchanged. Remove `FloatingToolbar` from its imports.

```ts
// src/assetmodels/review/useGroundTiles.ts
import { useMemo } from "react";
import { basemapTileUrl, type AssetModel } from "@contract/client";
import { useBackend } from "@/api/client";
import { groundTiles, type GroundTile } from "@/assetmodels/viewer/ground";

/** The streets basemap around the asset (spec §9 setGround); null when the frame has no origin. */
export function useGroundTiles(model: AssetModel): GroundTile[] | null {
  const { baseUrl, token } = useBackend();
  const frame = model.frame ?? null;
  return useMemo(() => {
    if (!frame?.origin) return null;
    const radius = Math.max(60, 3 * (frame.height_m ?? 20));
    return groundTiles(frame.origin, frame.north_offset_deg ?? 0, basemapTileUrl(baseUrl, token, "streets"), radius);
  }, [frame, baseUrl, token]);
}
```

- [ ] **Step 4: Change `ModelPanel.tsx`**

- The outer `GlassPanel` becomes `<div data-testid="model-panel" aria-label="Asset model" className="flex min-h-0 flex-1 flex-col gap-[11px] overflow-y-auto px-1">`. Drop `stagger`, `GlassPanel` from imports.
- New props:

```ts
  view: { ghost: boolean; rotate: boolean; ground: boolean };
  onViewSwitch(k: "ghost" | "rotate" | "ground", on: boolean): void;
  /** False when the asset has no geographic origin, so there is no street map to show. */
  groundAvailable: boolean;
  onImportGlb(): void;
```

- After the overlay block, before `{children}`, add:

```tsx
      <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
        <span className="text-xs text-muted">View</span>
        <Switch label="See through" checked={view.ghost} onChange={(on) => onViewSwitch("ghost", on)} />
        <Switch label="Turn slowly" checked={view.rotate} onChange={(on) => onViewSwitch("rotate", on)} />
        <Switch
          label="Street map"
          checked={view.ground && groundAvailable}
          disabled={!groundAvailable}
          onChange={(on) => onViewSwitch("ground", on)}
        />
        {!groundAvailable && (
          <p className="text-xs leading-relaxed text-muted">The street map needs the asset&apos;s location.</p>
        )}
      </div>
```

- In `ModelPicker`, pass `onImportGlb` and add in the popover footer, after **New asset model…**:

```tsx
          <Button
            size="sm"
            variant="ghost"
            icon="import"
            onClick={() => {
              setOpen(false);
              onImportGlb();
            }}
          >
            Import a GLB…
          </Button>
```

- [ ] **Step 5: Wire `AssetModelWorkspace.tsx`**

5a. Imports: replace `ViewTools` with nothing from `./ViewTools` except `CutBearing, VIEWS, modelKey, type ViewToolState`; add:

```ts
import type { PickHit } from "@/assetmodels/viewer/engine";
import { FindingsTopic } from "@/assetmodels/review/FindingsTopic";
import { ImportGlbDialog } from "@/assetmodels/review/ImportGlbDialog";
import { PhotosTopic } from "@/assetmodels/review/PhotosTopic";
import { useFindingsLayer } from "@/assetmodels/review/useFindingsLayer";
import { useGroundTiles } from "@/assetmodels/review/useGroundTiles";
import { usePhotosLayer } from "@/assetmodels/review/usePhotosLayer";
import { useReviewActions } from "@/assetmodels/review/useReviewActions";
import { showTopic, useModelRail } from "./useModelRail";
```

and `WorkspaceRail` in the `@/ui` import list.

5b. In `ModelWorkspace`, after `const deviation = …` and before the `replay` effect, add the layers and switches:

```tsx
  // Findings on the asset (asset findings spec §9): pins, patches and cameras stay in the view
  // whatever topic is open, so their data lives here and the topics only show it.
  const findingsLayer = useFindingsLayer({ projectId, model, viewer });
  const photosLayer = usePhotosLayer(projectId, model.id, viewer);
  const actions = useReviewActions(projectId, model.id);
  const ground = useGroundTiles(model);
  const [view3d, setView3d] = useState({ ghost: false, rotate: false, ground: false });
  const onViewSwitch = (k: "ghost" | "rotate" | "ground", on: boolean) => {
    setView3d((s) => ({ ...s, [k]: on }));
    const v = viewer.current;
    if (k === "ghost") v?.setGhost(on);
    else if (k === "rotate") v?.setAutoRotate(on);
    else v?.setGround(on ? ground : null);
  };
  const [importOpen, setImportOpen] = useState(false);
```

5c. In the `replay.current = () => { … }` body, after `if (selected) v.select(selected);` add:

```ts
      v.setGhost(view3d.ghost);
      v.setAutoRotate(view3d.rotate);
      v.setGround(view3d.ground ? ground : null);
      findingsLayer.push();
      photosLayer.push();
```

5d. Replace the `const panel = (<ModelPanel …>…</ModelPanel>);` block with the panel body, the rail and the pick handler:

```tsx
  const panelBody = (
    <ModelPanel
      projectId={projectId}
      model={model}
      models={models}
      onNew={onNew}
      onDetails={onDetails}
      groups={groups}
      hiddenGroups={hiddenGroups}
      onGroup={onGroup}
      overlay={versions !== null && versions.length === 0 ? null : overlayOn}
      overlayAvailable={!!overlayRun}
      onOverlay={setOverlayWanted}
      view={view3d}
      onViewSwitch={onViewSwitch}
      groundAvailable={ground !== null}
      onImportGlb={() => setImportOpen(true)}
    >
      {tools.cut && <CutBearing bearing={bearing} onBearing={onBearing} />}
    </ModelPanel>
  );
  const rail = useModelRail({
    running,
    tools,
    onToggle: toggle,
    onView: setViewTo,
    modelBody: panelBody,
    findingsBody: <FindingsTopic projectId={projectId} model={model} layer={findingsLayer} actions={actions} />,
    photosBody: <PhotosTopic projectId={projectId} layer={photosLayer} actions={actions} />,
    findingsCount: findingsLayer.done ? findingsLayer.findings.length : null,
  });
  const onPick = (hit: PickHit) => {
    if (hit.kind === "finding") {
      findingsLayer.select(hit.id);
      showTopic(rail.store, "findings");
    } else if (hit.kind === "camera") {
      photosLayer.select(hit.id);
      showTopic(rail.store, "photos");
    }
  };
  const panel = (
    <WorkspaceRail
      label="Model view tools"
      store={rail.store}
      nav={rail.nav}
      topics={rail.topics}
      inspectorOpen
      bottomInset={84}
    />
  );
  const importDialog = importOpen && (
    <ImportGlbDialog
      projectId={projectId}
      modelId={model.id}
      onClose={() => setImportOpen(false)}
      onStarted={(version, jobId) => {
        setImportOpen(false);
        toast("ok", `Importing the GLB as version ${version}`);
        opened(version, jobId);
      }}
    />
  );
```

Move the `opened` function above this block if it is declared after it (it is a plain function; hoisting a `const` arrow is not possible, so place this block after `opened` and `restore`, which sit just above `const noVersion`). `useModelRail` is a hook: this block must stay before the `if (noVersion) return …` early return.

5e. In the `noVersion` branch: `{panel}` stays (it is now the rail); add `{importDialog}` at the end of the fragment; in the `CentreCard`'s plain paragraph branch, add after the paragraph:

```tsx
                <div>
                  <Button size="sm" icon="import" onClick={() => setImportOpen(true)}>
                    Import a GLB…
                  </Button>
                </div>
```

5f. In the main return: delete `<ViewTools state={tools} disabled={!running} onToggle={toggle} onView={setViewTo} />` (the rail holds the tools); keep `{panel}`; add `onPick={onPick}` to `<ModelViewer …/>`; add `{importDialog}` before the closing fragment.

- [ ] **Step 6: Run the tests, lint and build**

Run: `pnpm -C frontend exec vitest run src/assetmodels src/ui; pnpm -C frontend lint; pnpm -C frontend build`
Expected: PASS (the M1 workspace tests still pass: the Model topic is open by default, so group switches and the overlay switch are where they were), lint clean, build green.

- [ ] **Step 7: Look at it.** `pnpm -C contract mock` and `pnpm -C frontend dev`; open `/p/<id>/models/<id>`. Screenshot at 1366 x 768 and 1920 x 1080 with each topic open (Playwright MCP or Claude in Chrome). Check against `DESIGN.md`: the rail and topic panel match the clouds workspace; the topic panel does not cover the build bar; the Findings filters fit two columns at 340 px; the outcome legend swatches are the theme's status colours; nothing has a raw colour. Fix anything off before committing.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/ui/railStore.ts frontend/src/assetmodels/workspace/topics.ts frontend/src/assetmodels/workspace/useModelRail.tsx frontend/src/assetmodels/workspace/useModelRail.test.tsx frontend/src/assetmodels/review/useGroundTiles.ts frontend/src/assetmodels/workspace/ViewTools.tsx frontend/src/assetmodels/workspace/ModelPanel.tsx frontend/src/assetmodels/workspace/AssetModelWorkspace.tsx frontend/src/assetmodels/workspace/AssetModelWorkspace.test.tsx
git commit -m "feat(asset-findings): asset workspace on the rail with findings and photos topics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Import inspection review (the kit job folder)

Spec §6.5 says the operator confirms the kit's class mapping before the import runs. This task adds that screen. It is reachable from the asset workspace's Model topic (**Import inspection review…**, with the shown model preselected) and from **Add data** (a sixth tile, **Inspection review**).

The flow:
1. **Pick.** The operator picks:
   - the kit job folder (the Tauri dialog, or a path field in the browser, as U6's `BrandLogoField` does);
   - the image set the photos were imported into;
   - the asset model to fill, or a name for a new one.
2. **Check the folder.** This runs `startReviewImport` with `dry_run: true`. The job's `result` is J5's `ReviewImportPreview`, and the dialog follows the job with `useTrackedJob`. It claims the dry run's outcome, so no global toast repeats it.
3. **Preview.** The dialog shows:
   - the profile and the unit;
   - the photos matched (by which rule) and not matched, each with its reason;
   - the photo statuses;
   - how many sightings it will create;
   - whether a surface, GLB and polygons are present;
   - the target model's state (a ready version, existing sightings).
   - Then a mapping table: each kit class key, its label and count, and a catalogue type `Combobox`. The type is prefilled from the server's suggestion, else by a name match.
4. **Import.** This posts the same request with `dry_run: false` and the confirmed `class_map`, then puts the job in the jobs store and closes. The end toast comes from `useJobToasts` (Task 1).

**Files:**
- Modify: `frontend/src/api/assetReview.ts` (add `startReviewImport` and the types; U1 owns the file, and this is an addition)
- Create: `frontend/src/assetmodels/review/reviewImport.ts` (pure: prefill, missing classes, reason text, summary lines)
- Create: `frontend/src/assetmodels/review/ReviewImportDialog.tsx`
- Modify: `frontend/src/app/addDataStore.ts` (`AddDataTile` += `"review"`)
- Modify: `frontend/src/data/addDataTiles.ts` (the tile), `frontend/src/data/AddDataDialog.tsx` (`TILE_NAME.review`; the branch that opens the dialog)
- Modify: `frontend/src/assetmodels/workspace/ModelPanel.tsx` (`onImportReview` prop and its button), `frontend/src/assetmodels/workspace/AssetModelWorkspace.tsx` (state and dialog)
- Modify: `frontend/src/ui/useJobToasts.ts` (the `review_kit_import` text from the C0 result; see Step 6)
- Test: `frontend/src/assetmodels/review/reviewImport.test.ts`, `frontend/src/assetmodels/review/ReviewImportDialog.test.tsx`, `frontend/src/data/AddDataDialog.test.tsx` (extend)

**Interfaces:**
- Consumes:
  - C0: `startReviewImport` POST `/api/v1/projects/{projectId}/review-imports` with a `ReviewImportRequest {folder, image_source_id, asset_model_id?, new_model_name?, class_map?, dry_run}` body, answering 202 `JobRef`; a 422 `kit_invalid` or `validation_error`; a 404 for an unknown source or model; a 409 `job_running`.
  - J5 (Task 1 and Index note N5): the job `result` when `params.dry_run`:

    ```
    {unit, profile, profile_id, photos, matched, unmatched_count, unmatched: string[],
     classes: [{key, label, count, type_id | null}], statuses: {finding, none, uncertain, not_assessed},
     has_surface, has_glb, has_merged, dry_run: true, matched_by: {path?, suffix?, name?, time_size?},
     unmatched_reasons: [{kit_id, source_name, reason: "not_found" | "ambiguous" | "duplicate" | "size_mismatch"}],
     sightings, model: {ready_version | null, existing_sightings}}
    ```

    An unknown profile or an unreadable kit fails the dry-run job; its `error` is the operator message.
  - Also: `fetchAllSources` (`src/api/sources.ts`); `useAssetModelList` (`src/assetmodels/useAssetModels.ts`); `useProjectTypes` (`src/findings/useProjectTypes.ts`); `useTrackedJob` (`src/jobs/useTrackedJob.ts`); `claimJobOutcome`, `Combobox`, `Dialog`, `Field`, `Input`, `Select`, `Alert`, `Button`, `Pill`, `toast` (`src/ui`).
- Produces:

```ts
// api/assetReview.ts
export type ReviewImportRequest = S["ReviewImportRequest"];
export type ReviewImportPreview = S["ReviewImportPreview"] & {
  dry_run?: boolean; matched_by?: Partial<Record<"path" | "suffix" | "name" | "time_size", number>>;
  unmatched_reasons?: { kit_id: string; source_name: string; reason: UnmatchedReason }[];
  sightings?: number; model?: { ready_version: number | null; existing_sightings: number } | null;
};
export type UnmatchedReason = "not_found" | "ambiguous" | "duplicate" | "size_mismatch";
export async function startReviewImport(api: ApiClient, projectId: string, body: ReviewImportRequest): Promise<Job>;

// reviewImport.ts
export function normName(s: string): string;
export function prefillClassMap(classes: ReviewImportPreview["classes"], types: readonly { id: string; name: string }[]): Record<string, string | null>;
export function missingClasses(classes: ReviewImportPreview["classes"], map: Record<string, string | null>): string[];
export const REASON_TEXT: Record<UnmatchedReason, string>;
export function matchedByText(by: ReviewImportPreview["matched_by"]): string | null;
export function blockers(p: ReviewImportPreview): string[];   // refusals J5 would fail the real run on

// ReviewImportDialog.tsx
export function ReviewImportDialog(p: { projectId: string; modelId?: string | null; onClose(): void; onStarted(job: Job): void }): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/assetmodels/review/reviewImport.test.ts
import { describe, expect, it } from "vitest";
import { REASON_TEXT, blockers, matchedByText, missingClasses, normName, prefillClassMap } from "./reviewImport";

const types = [
  { id: "t-crack", name: "Crack" },
  { id: "t-stain", name: "Staining" },
  { id: "t-corr", name: "Corrosion" },
];
const classes = [
  { key: "cracks", label: "Cracks", count: 12, type_id: null },
  { key: "staining", label: "Staining", count: 3, type_id: "t-stain" },
  { key: "spalling", label: "Spalling", count: 1, type_id: null },
] as never;

describe("review import helpers", () => {
  it("normalises names for matching", () => {
    expect(normName("Cracks ")).toBe("crack");
    expect(normName("Paint_Failure")).toBe("paintfailure");
  });

  it("prefills from the server's suggestion, else by name, else nothing", () => {
    expect(prefillClassMap(classes, types)).toEqual({ cracks: "t-crack", staining: "t-stain", spalling: null });
  });

  it("lists classes still without a type", () => {
    expect(missingClasses(classes, { cracks: "t-crack", staining: "t-stain", spalling: null })).toEqual(["spalling"]);
  });

  it("explains unmatched photos and how photos matched", () => {
    expect(REASON_TEXT.not_found).toBe("No image with this name in the image set");
    expect(REASON_TEXT.ambiguous).toBe("More than one image could be this photo");
    expect(matchedByText({ path: 2, time_size: 1 })).toBe("2 by path, 1 by capture time and size");
    expect(matchedByText({})).toBeNull();
  });

  it("names the refusals J5 would fail the real run on", () => {
    const base = { matched: 2, has_glb: false, model: { ready_version: 1, existing_sightings: 0 } } as never;
    expect(blockers(base)).toEqual([]);
    expect(blockers({ ...(base as object), matched: 0 } as never)).toEqual(["No photo in the folder matches an image in this image set."]);
    expect(blockers({ ...(base as object), model: { ready_version: null, existing_sightings: 0 } } as never)).toEqual([
      "The asset model has no 3D model yet and the folder has no model.glb. Import the GLB first.",
    ]);
    expect(blockers({ ...(base as object), model: { ready_version: 1, existing_sightings: 40 } } as never)).toEqual([
      "This asset model already holds 40 sightings. Import into a new asset model instead.",
    ]);
  });
});
```

```tsx
// src/assetmodels/review/ReviewImportDialog.test.tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { MODEL_REVIEWED } from "@/test/assetFindingFixtures";
import { useJobsStore } from "@/store/jobs";
import { reportedInline } from "@/ui";
import { ReviewImportDialog } from "./ReviewImportDialog";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => "D:\\kits\\tower\\job") }));

const SOURCE = { id: "src-1", kind: "images", label: "Flight 14 Sep", captured_on: null, map_id: null, folder: "D:\\photos",
  site: null, settings: {}, image_count: 3, duplicate_count: 0, job_id: null, imported_at: null, created_at: "" };

const PREVIEW = {
  dry_run: true, unit: "region", profile: "building-facade", profile_id: "building_facade",
  photos: 3, matched: 2, matched_by: { path: 2 }, unmatched_count: 1, unmatched: ["flight-b/DJI_0003.JPG"],
  unmatched_reasons: [{ kit_id: "p03", source_name: "flight-b/DJI_0003.JPG", reason: "not_found" }],
  classes: [
    { key: "cladding", label: "Cladding damage", count: 2, type_id: "t-clad" },
    { key: "staining", label: "Staining", count: 1, type_id: null },
  ],
  statuses: { finding: 2, none: 0, uncertain: 0, not_assessed: 0 },
  sightings: 3, has_surface: true, has_glb: false, has_merged: true,
  model: { ready_version: 2, existing_sightings: 0 },
};

const job = (id: string, dry: boolean, extra: object = {}) => ({
  id, project_id: PROJECT_ID, type: "review_kit_import", state: "succeeded", progress: 1, message: "", log_path: "",
  params: { dry_run: dry }, result: dry ? PREVIEW : null, error: null, created_at: "", started_at: null, finished_at: null, ...extra,
});

function setup(extra: unknown[] = [], mode: "mock" | "tauri" = "mock") {
  let n = 0;
  const client = fakeClient([
    ...extra,
    { method: "GET", path: /\/sources$/, body: { items: [SOURCE], next_cursor: null } },
    { method: "GET", path: /\/asset-models$/, body: { items: [MODEL_REVIEWED] } },
    { method: "POST", path: /\/review-imports$/, status: 202,
      body: (r) => ({ job: job(`j${++n}`, (r.body as { dry_run: boolean }).dry_run) }) },
  ] as never);
  const onStarted = vi.fn();
  renderWithProviders(<ReviewImportDialog projectId={PROJECT_ID} modelId="m1" onClose={() => {}} onStarted={onStarted} />,
    { api: client.api, mode });
  return { ...client, onStarted };
}

afterEach(() => useJobsStore.setState({ jobs: {} }));

describe("ReviewImportDialog", () => {
  it("checks the folder, shows the preview, maps the classes and starts the import", async () => {
    const { requests, onStarted } = setup();
    fireEvent.change(screen.getByLabelText(/review job folder/i), { target: { value: "D:\\kits\\tower\\job" } });
    await screen.findByRole("option", { name: /flight 14 sep/i });
    fireEvent.click(screen.getByRole("button", { name: /check the folder/i }));

    const preview = await screen.findByRole("region", { name: /what this import will do/i });
    expect(preview).toHaveTextContent("building-facade");
    expect(preview).toHaveTextContent("2 of 3 photos matched");
    expect(preview).toHaveTextContent("2 by path");
    expect(preview).toHaveTextContent("3 sightings");
    const unmatched = within(preview).getByRole("list", { name: /photos not matched/i });
    expect(unmatched).toHaveTextContent("flight-b/DJI_0003.JPG");
    expect(unmatched).toHaveTextContent("No image with this name in the image set");

    // "staining" has no suggestion: Import waits until it has a type
    const importButton = screen.getByRole("button", { name: /^import$/i });
    expect(importButton).toBeDisabled();
    expect(screen.getByText(/1 class still needs a type/i)).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /staining/i });
    fireEvent.click(within(row).getByRole("button", { name: /type for staining/i }));
    fireEvent.click(await screen.findByRole("option", { name: /^staining$/i }));
    await waitFor(() => expect(importButton).toBeEnabled());
    fireEvent.click(importButton);

    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    const posts = requests.filter((r) => r.method === "POST").map((r) => r.body);
    expect(posts[0]).toEqual({ folder: "D:\\kits\\tower\\job", image_source_id: "src-1", asset_model_id: "m1", dry_run: true });
    expect(posts[1]).toEqual({
      folder: "D:\\kits\\tower\\job", image_source_id: "src-1", asset_model_id: "m1", dry_run: false,
      class_map: { cladding: "t-clad", staining: "t-staining" },
    });
    expect(useJobsStore.getState().jobs.j2).toBeDefined();
  });

  it("claims the dry run's outcome so the global toast stays quiet", async () => {
    setup();
    fireEvent.change(screen.getByLabelText(/review job folder/i), { target: { value: "D:\\k" } });
    await screen.findByRole("option", { name: /flight 14 sep/i });
    fireEvent.click(screen.getByRole("button", { name: /check the folder/i }));
    await screen.findByRole("region", { name: /what this import will do/i });
    expect(reportedInline(job("j1", true) as never, "/p/x/models/m1")).toBe(true);
  });

  it("shows the server's reason for a folder that is not a review job", async () => {
    setup([{ method: "POST", path: /\/review-imports$/, status: 422,
      body: { error: { code: "kit_invalid", message: "This folder has no job.yaml.", details: {} } } }]);
    fireEvent.change(screen.getByLabelText(/review job folder/i), { target: { value: "D:\\nothing" } });
    await screen.findByRole("option", { name: /flight 14 sep/i });
    fireEvent.click(screen.getByRole("button", { name: /check the folder/i }));
    expect(await screen.findByText(/no job\.yaml/i)).toBeInTheDocument();
  });

  it("shows a failed dry run's message", async () => {
    setup([{ method: "POST", path: /\/review-imports$/, status: 202,
      body: { job: job("jf", true, { state: "failed", result: null, error: "Unknown review profile: chimney." }) } }]);
    fireEvent.change(screen.getByLabelText(/review job folder/i), { target: { value: "D:\\k" } });
    await screen.findByRole("option", { name: /flight 14 sep/i });
    fireEvent.click(screen.getByRole("button", { name: /check the folder/i }));
    expect(await screen.findByText(/unknown review profile: chimney/i)).toBeInTheDocument();
  });

  it("picks the folder with the Tauri dialog in the desktop app", async () => {
    setup([], "tauri");
    fireEvent.click(screen.getByRole("button", { name: /^browse$/i }));
    await waitFor(() => expect(screen.getByLabelText(/review job folder/i)).toHaveValue("D:\\kits\\tower\\job"));
  });

  it("imports into a new asset model by name", async () => {
    const { requests } = setup();
    fireEvent.change(screen.getByLabelText(/review job folder/i), { target: { value: "D:\\k" } });
    await screen.findByRole("option", { name: /flight 14 sep/i });
    fireEvent.change(screen.getByLabelText(/^asset model$/i), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/new asset model name/i), { target: { value: "Tower B" } });
    fireEvent.click(screen.getByRole("button", { name: /check the folder/i }));
    await screen.findByRole("region", { name: /what this import will do/i });
    expect(requests.find((r) => r.method === "POST")!.body).toMatchObject({ new_model_name: "Tower B" });
    expect(requests.find((r) => r.method === "POST")!.body).not.toHaveProperty("asset_model_id");
  });
});
```

The test's catalogue type list comes from `useProjectTypes`, which reads the project. Add `{ id: "t-clad", name: "Cladding damage" }` and `{ id: "t-staining", name: "Staining" }` as defect classes to the project route of this test (`{ method: "GET", path: /\/projects\/[^/]+$/, body: { ...exampleProject, classes: [...] } }`, using the project fixture and class shape from `src/test/fixtures.ts`). Put that route first in `setup`'s list.

In `src/data/AddDataDialog.test.tsx`, add:

```tsx
it("offers an inspection review import", async () => {
  // render as the file's other tests do
  fireEvent.click(screen.getByRole("button", { name: /inspection review/i }));
  expect(await screen.findByRole("dialog", { name: /import inspection review/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend exec vitest run src/assetmodels/review/reviewImport.test.ts src/assetmodels/review/ReviewImportDialog.test.tsx src/data/AddDataDialog.test.tsx`
Expected: FAIL (the modules and the tile don't exist)

- [ ] **Step 3: Implement the API call and the helpers**

Append to `src/api/assetReview.ts`:

```ts
export type UnmatchedReason = "not_found" | "ambiguous" | "duplicate" | "size_mismatch";
export type ReviewImportRequest = S["ReviewImportRequest"];
/** C0's preview plus the fields J5 adds (J5 Task 1, note N5); the schema leaves extra properties open. */
export type ReviewImportPreview = S["ReviewImportPreview"] & {
  dry_run?: boolean;
  matched_by?: Partial<Record<"path" | "suffix" | "name" | "time_size", number>>;
  unmatched_reasons?: { kit_id: string; source_name: string; reason: UnmatchedReason }[];
  sightings?: number;
  model?: { ready_version: number | null; existing_sightings: number } | null;
};

export async function startReviewImport(api: ApiClient, projectId: string, body: ReviewImportRequest): Promise<Job> {
  const r = await unwrap(api.POST(`${P}/review-imports`, { params: { path: { projectId } }, body }));
  return r.job;
}
```

```ts
// src/assetmodels/review/reviewImport.ts
import type { ReviewImportPreview, UnmatchedReason } from "@/api/assetReview";

type Classes = ReviewImportPreview["classes"];

/** "Cracks " and "crack" match: lower case, letters and digits only, one trailing s dropped. */
export function normName(s: string): string {
  const n = s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return n.length > 3 && n.endsWith("s") ? n.slice(0, -1) : n;
}

export function prefillClassMap(classes: Classes, types: readonly { id: string; name: string }[]): Record<string, string | null> {
  const byName = new Map(types.map((t) => [normName(t.name), t.id]));
  const out: Record<string, string | null> = {};
  for (const c of classes) out[c.key] = c.type_id ?? byName.get(normName(c.label)) ?? byName.get(normName(c.key)) ?? null;
  return out;
}

export function missingClasses(classes: Classes, map: Record<string, string | null>): string[] {
  return classes.filter((c) => !map[c.key]).map((c) => c.key);
}

export const REASON_TEXT: Record<UnmatchedReason, string> = {
  not_found: "No image with this name in the image set",
  ambiguous: "More than one image could be this photo",
  duplicate: "Another kit photo already took this image",
  size_mismatch: "The image's shape does not match the kit's photo",
};

const BY_TEXT = { path: "by path", suffix: "by folder and name", name: "by name", time_size: "by capture time and size" } as const;

export function matchedByText(by: ReviewImportPreview["matched_by"]): string | null {
  const parts = (Object.keys(BY_TEXT) as (keyof typeof BY_TEXT)[])
    .filter((k) => (by?.[k] ?? 0) > 0)
    .map((k) => `${by![k]} ${BY_TEXT[k]}`);
  return parts.length ? parts.join(", ") : null;
}

/** The refusals J5 fails the real run on (J5 note N8), said before the operator presses Import. */
export function blockers(p: ReviewImportPreview): string[] {
  const out: string[] = [];
  if (p.matched === 0) out.push("No photo in the folder matches an image in this image set.");
  if (p.model && p.model.ready_version === null && !p.has_glb) {
    out.push("The asset model has no 3D model yet and the folder has no model.glb. Import the GLB first.");
  }
  if (p.model && p.model.existing_sightings > 0) {
    out.push(`This asset model already holds ${p.model.existing_sightings} sightings. Import into a new asset model instead.`);
  }
  return out;
}
```

- [ ] **Step 4: Implement the dialog**

```tsx
// src/assetmodels/review/ReviewImportDialog.tsx
// Spec §6.5: import a kit job folder. A dry run reads the folder and matches the photos without
// writing anything; the operator checks the preview and confirms the class mapping; then the real
// import runs as a background job.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Job } from "@contract/client";
import { startReviewImport, type ReviewImportPreview, type ReviewImportRequest } from "@/api/assetReview";
import { useApi, useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchAllSources } from "@/api/sources";
import { useAssetModelList } from "@/assetmodels/useAssetModels";
import { useProjectTypes } from "@/findings/useProjectTypes";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, Combobox, Dialog, Field, Input, Pill, Progress, Select, claimJobOutcome } from "@/ui";
import { REASON_TEXT, blockers, matchedByText, missingClasses, prefillClassMap } from "./reviewImport";

const n = (x: number) => x.toLocaleString("en-US");

export function ReviewImportDialog({
  projectId,
  modelId = null,
  onClose,
  onStarted,
}: {
  projectId: string;
  modelId?: string | null;
  onClose(): void;
  onStarted(job: Job): void;
}) {
  const api = useApi();
  const { mode } = useBackend();
  const { models } = useAssetModelList(projectId);
  const { all: types } = useProjectTypes(projectId);
  const [sources, setSources] = useState<{ id: string; label: string }[] | null>(null);
  const [folder, setFolder] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [target, setTarget] = useState<string>(modelId ?? "");
  const [newName, setNewName] = useState("");
  const [dryJobId, setDryJobId] = useState<string | null>(null);
  const [map, setMap] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const release = useRef<(() => void) | null>(null);

  useEffect(() => {
    fetchAllSources(api, projectId).then(
      (all) => {
        const images = all.filter((s) => s.kind === "images").map((s) => ({ id: s.id, label: s.label ?? s.folder }));
        setSources(images);
        setSourceId((cur) => cur || (images[0]?.id ?? ""));
      },
      (e: unknown) => setError(messageOf(e, "The image sets could not be loaded.")),
    );
  }, [api, projectId]);
  useEffect(() => () => release.current?.(), []);

  const tracked = useTrackedJob(projectId, dryJobId);
  const dry = tracked.job;
  const preview = dry?.state === "succeeded" ? (dry.result as unknown as ReviewImportPreview | null) : null;
  const dryError = dry?.state === "failed" ? (dry.error ?? "The folder could not be read.") : tracked.error;
  const checking = dryJobId !== null && !preview && !dryError;

  // Prefill the mapping once per preview: the server's suggestion, else a name match.
  const prefilledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!preview || !dry || prefilledFor.current === dry.id) return;
    prefilledFor.current = dry.id;
    setMap(prefillClassMap(preview.classes, types));
  }, [preview, dry, types]);

  const request = (dryRun: boolean): ReviewImportRequest => ({
    folder: folder.trim(),
    image_source_id: sourceId,
    ...(target ? { asset_model_id: target } : { new_model_name: newName.trim() }),
    ...(dryRun ? {} : { class_map: Object.fromEntries(Object.entries(map).filter(([, v]) => !!v)) as Record<string, string> }),
    dry_run: dryRun,
  });
  const formReady = folder.trim() !== "" && sourceId !== "" && (target !== "" || newName.trim() !== "");
  const missing = preview ? missingClasses(preview.classes, map) : [];
  const stops = preview ? blockers(preview) : [];
  const canImport = !!preview && missing.length === 0 && stops.length === 0 && !busy;

  async function browse() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string") setFolder(picked);
  }

  async function check() {
    setBusy(true);
    setError(null);
    release.current?.();
    try {
      const job = await startReviewImport(api, projectId, request(true));
      release.current = claimJobOutcome(job.id); // the preview is shown here, not as a toast
      useJobsStore.getState().upsert(job);
      setDryJobId(job.id);
    } catch (e) {
      setError(messageOf(e, "The folder could not be checked."));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const job = await startReviewImport(api, projectId, request(false));
      useJobsStore.getState().upsert(job);
      onStarted(job);
    } catch (e) {
      setError(messageOf(e, "The import could not start."));
    } finally {
      setBusy(false);
    }
  }

  const typeItems = useMemo(() => types.map((t) => ({ id: t.id, label: t.name })), [types]);
  const reasons = preview?.unmatched_reasons ?? (preview?.unmatched ?? []).map((s) => ({ kit_id: s, source_name: s, reason: "not_found" as const }));

  return (
    <Dialog
      open
      width="lg"
      title="Import inspection review"
      description="A review job folder (job.yaml, cameras, assessment and masks) becomes sightings and findings on an asset model. Nothing is written until you press Import."
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {preview ? (
            <Button variant="primary" icon="import" loading={busy} disabled={!canImport} onClick={() => void run()}>
              Import
            </Button>
          ) : (
            <Button variant="primary" loading={busy || checking} disabled={!formReady || checking} onClick={() => void check()}>
              Check the folder
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Review job folder" htmlFor="kit-folder" error={error}>
          <div className="flex gap-2">
            <Input
              id="kit-folder"
              value={folder}
              onChange={(e) => {
                setFolder(e.target.value);
                setDryJobId(null);
              }}
              placeholder="D:\reviews\tower\job"
              className="min-w-0 flex-1 font-mono"
            />
            {mode === "tauri" && <Button onClick={() => void browse()}>Browse</Button>}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Image set with the photos" htmlFor="kit-source">
            <Select id="kit-source" value={sourceId} onChange={(e) => { setSourceId(e.target.value); setDryJobId(null); }}>
              {(sources ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Asset model" htmlFor="kit-model">
            <Select id="kit-model" value={target} onChange={(e) => { setTarget(e.target.value); setDryJobId(null); }}>
              <option value="">A new asset model</option>
              {(models ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {target === "" && (
          <Field label="New asset model name" htmlFor="kit-name">
            <Input id="kit-name" value={newName} onChange={(e) => { setNewName(e.target.value); setDryJobId(null); }} />
          </Field>
        )}
        {sources && sources.length === 0 && (
          <Alert tone="warn">Import the review&apos;s photos first (Add data, Photos). The kit&apos;s photos are matched to them.</Alert>
        )}
        {checking && <Progress thin running value={dry?.progress ?? undefined} label="Checking the folder" />}
        {dryError && <Alert tone="danger">{dryError}</Alert>}
        {preview && (
          <section aria-label="What this import will do" className="flex flex-col gap-3 border-t border-line pt-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Pill size="sm">{preview.profile}</Pill>
              <span className="text-muted">{preview.unit === "region" ? "One finding per region" : "One finding per photo"}</span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">Photos</dt>
              <dd className="text-ink">
                {`${n(preview.matched)} of ${n(preview.photos)} photos matched`}
                {matchedByText(preview.matched_by) ? ` (${matchedByText(preview.matched_by)})` : ""}
              </dd>
              <dt className="text-muted">Sightings</dt>
              <dd className="text-ink">{`${n(preview.sightings ?? preview.classes.reduce((a, c) => a + c.count, 0))} sightings`}</dd>
              <dt className="text-muted">Photo review</dt>
              <dd className="text-ink">
                {`${n(preview.statuses.finding)} with findings, ${n(preview.statuses.uncertain)} uncertain, ${n(preview.statuses.none)} no finding, ${n(preview.statuses.not_assessed)} not assessed`}
              </dd>
              <dt className="text-muted">In the folder</dt>
              <dd className="text-ink">
                {[preview.has_surface ? "placements to replay" : "placements computed after import", preview.has_merged ? "polygons" : "boxes only", preview.has_glb ? "a GLB" : null]
                  .filter(Boolean)
                  .join(", ")}
              </dd>
            </dl>
            {stops.map((s) => (
              <Alert key={s} tone="danger">
                {s}
              </Alert>
            ))}
            {preview.unmatched_count > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-ink">{`${n(preview.unmatched_count)} photos not matched; they are left out`}</summary>
                <ul aria-label="Photos not matched" className="mt-1 max-h-40 overflow-y-auto">
                  {reasons.map((r) => (
                    <li key={r.kit_id} className="flex gap-2 py-0.5">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{r.source_name}</span>
                      <span className="shrink-0 text-xs text-muted">{REASON_TEXT[r.reason]}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <table aria-label="Class mapping" className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 font-normal">Kit class</th>
                  <th className="py-1 font-normal">Sightings</th>
                  <th className="py-1 font-normal">Catalogue type</th>
                </tr>
              </thead>
              <tbody>
                {preview.classes.map((c) => (
                  <tr key={c.key} aria-label={c.label}>
                    <td className="py-1 pr-2 text-ink">
                      {c.label} <span className="font-mono text-xs text-muted">{c.key}</span>
                    </td>
                    <td className="py-1 pr-2 tabular-nums text-ink">{n(c.count)}</td>
                    <td className="py-1">
                      <Combobox
                        label={`Type for ${c.label}`}
                        items={typeItems}
                        value={map[c.key] ?? null}
                        onChange={(id) => setMap((m) => ({ ...m, [c.key]: id }))}
                        triggerPlaceholder="Choose a type"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {missing.length > 0 && (
              <p className="text-xs text-warn">{`${missing.length} ${missing.length === 1 ? "class still needs" : "classes still need"} a type.`}</p>
            )}
          </section>
        )}
      </div>
    </Dialog>
  );
}
```

Notes for the implementer:
- Check the `Combobox` trigger's accessible name. The test clicks a button named "Type for Staining", so pass `label` through to the trigger's `aria-label` if `Combobox` does not already do that. Also check its `value` type (`string | null`) in `src/ui/Combobox.tsx`.
- `Source.label` can be null, so the label falls back to the folder.
- `text-warn` must be an existing token class; use the nearest one if not.

- [ ] **Step 5: Wire the two entry points**

`src/app/addDataStore.ts`: `export type AddDataTile = "photos" | "orthomosaic" | "elevation" | "point_cloud" | "drawing" | "review";`

`src/data/addDataTiles.ts`, last entry of `ADD_DATA_TILES` (and change its doc comment to "F §6.4's tiles, plus the inspection review import"):

```ts
  {
    tile: "review",
    title: "Inspection review",
    hint: "A review job folder: findings and photo poses on an asset model",
    icon: "findings",
  },
```

`src/data/AddDataDialog.tsx`: add `review: "Inspection review"` to `TILE_NAME`, and before the tile grid's `return`:

```tsx
  if (tile === "review")
    return <ReviewImportDialog projectId={pid} onClose={onClose} onStarted={() => started("review")} />;
```

with `import { ReviewImportDialog } from "@/assetmodels/review/ReviewImportDialog";`. The dialog imports no three.js: its modules are `api/assetReview.ts` (type-only import of `viewer/placements`), `reviewImport.ts` and `useAssetModels.ts`. Confirm in `pnpm -C frontend build` that the entry chunk did not grow a three.js import.

`ModelPanel.tsx`: add the prop `onImportReview(): void` and, in the picker popover footer after **Import a GLB…**:

```tsx
          <Button
            size="sm"
            variant="ghost"
            icon="findings"
            onClick={() => {
              setOpen(false);
              onImportReview();
            }}
          >
            Import inspection review…
          </Button>
```

`AssetModelWorkspace.tsx`: `const [reviewOpen, setReviewOpen] = useState(false);` beside `importOpen`. Pass `onImportReview={() => setReviewOpen(true)}` to `ModelPanel`, and render this next to `importDialog`, in both branches:

```tsx
  const reviewDialog = reviewOpen && (
    <ReviewImportDialog
      projectId={projectId}
      modelId={model.id}
      onClose={() => setReviewOpen(false)}
      onStarted={() => {
        setReviewOpen(false);
        toast("info", "Importing the review. Findings appear when it ends; you can keep working.");
      }}
    />
  );
```

The layers reload on their own: U1's hooks listen for `review_kit_import` finishing.

- [ ] **Step 6: The end toast.** In `src/ui/useJobToasts.ts`, replace the `review_kit_import` case from Task 1 with the version that reads C0's result (`{asset_model_id, findings, sightings, statuses, unmatched_count, unmatched}`; a dry run's result is the preview):

```ts
    case "review_kit_import": {
      if (job.params?.dry_run) return "Review folder checked";
      const findings = num(r.findings);
      const sightings = num(r.sightings);
      const unmatched = num(r.unmatched_count) ?? 0;
      if (findings === null || sightings === null) return "Review job imported";
      return `Review job imported: ${findings} findings from ${sightings} sightings${unmatched > 0 ? `, ${unmatched} photos not matched` : ""}`;
    }
```

and in Task 1's test replace the `review_kit_import` line with:

```ts
    expect(jobToastText(done("review_kit_import"))).toBe("Review job imported");
    expect(jobToastText(done("review_kit_import", { findings: 656, sightings: 1441, unmatched_count: 0 }))).toBe(
      "Review job imported: 656 findings from 1441 sightings",
    );
    expect(jobToastText({ ...done("review_kit_import", { photos: 3 }), params: { dry_run: true } } as never)).toBe("Review folder checked");
```

- [ ] **Step 7: Run them to verify they pass**

Run: `pnpm -C frontend exec vitest run src/assetmodels/review src/data src/ui/useJobToasts.test.ts src/assetmodels/workspace; pnpm -C frontend lint`
Expected: PASS, lint clean

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/assetReview.ts frontend/src/assetmodels/review/reviewImport.ts frontend/src/assetmodels/review/reviewImport.test.ts frontend/src/assetmodels/review/ReviewImportDialog.tsx frontend/src/assetmodels/review/ReviewImportDialog.test.tsx frontend/src/app/addDataStore.ts frontend/src/data/addDataTiles.ts frontend/src/data/AddDataDialog.tsx frontend/src/data/AddDataDialog.test.tsx frontend/src/assetmodels/workspace/ModelPanel.tsx frontend/src/assetmodels/workspace/AssetModelWorkspace.tsx frontend/src/ui/useJobToasts.ts frontend/src/ui/useJobToasts.test.ts
git commit -m "feat(asset-findings): import inspection review with a dry-run preview and class mapping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: e2e: the asset workspace topics and the review import on Prism

**Files:**
- Create: `frontend/e2e/fixtures/assetReviewWorkspace.ts` (U2 owns it; U3 has its own `assetInspect.ts`)
- Create: `frontend/e2e/asset-findings-workspace.spec.ts`

- [ ] **Step 1: Write the fixture**

```ts
// e2e/fixtures/assetReviewWorkspace.ts
import type { Page, Route } from "@playwright/test";
import { MODEL, P } from "./assetModels";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const T = "2026-10-03T09:00:00Z";

const finding = (id: string, number: number, severity: number, extra: object = {}) => ({
  id, number, type_id: "c1a2b3c4-0000-4000-8000-000000000009", severity, status: "open", note: "", created_by: "human",
  confidence: null, anchor: { kind: "asset", asset_model_id: MODEL }, lon: null, lat: null, data_type: "asset_model",
  data_id: MODEL, created_at: T, updated_at: T, reviewed_at: null, closed_at: null, asset_model_id: MODEL,
  height_m: 6.2, bearing_deg: 270, side: "West", zone: "shell", component: null, placement: "point",
  sighting_count: 2, representative: { image_id: "10000000-0000-4000-8000-000000000001", annotation_id: "b1" },
  ...extra,
});

export const FINDINGS = [finding("f0000000-aaaa-4000-8000-000000000001", 1, 2), finding("f0000000-aaaa-4000-8000-000000000002", 2, 1, { height_m: 1.1, zone: "bottom" })];

const pose = (i: number, outcome: string) => ({
  image_id: `10000000-0000-4000-8000-00000000000${i}`, position: [6 * Math.cos(i), 3 + i, 6 * Math.sin(i)], target: [0, 4, 0],
  up: [0, 1, 0], hfov_deg: 70, vfov_deg: 52, source: "exif_gimbal", accuracy_m: 3, sequence: "Flight 1", outcome, updated_at: T,
});

export const SOURCE_ID = "50000000-3333-4000-8000-000000000001";
type ImportBody = { dry_run: boolean; class_map?: Record<string, string> };

/** Records the job POSTs and review imports; serves findings, placements (pins only), three poses, an image set and a dry-run preview. */
export async function routeAssetReview(page: Page): Promise<{ posts: string[]; imports: ImportBody[] }> {
  const posts: string[] = [];
  const imports: ImportBody[] = [];
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
  const job = (type: string) => ({ job: { id: `c0000000-af00-4000-8000-00000000000${posts.length}`, project_id: P, type,
    state: "queued", progress: 0, message: "", log_path: "", params: { asset_model_id: MODEL }, result: null, error: null,
    created_at: T, started_at: null, finished_at: null } });
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/findings`,
    (route) => (route.request().method() === "OPTIONS" ? route.fulfill({ status: 204, headers: CORS }) : json(route, { items: FINDINGS, next_cursor: null })),
  );
  const base = `/api/v1/projects/${P}/asset-models/${MODEL}`;
  await page.route(
    (u) => u.pathname.startsWith(`${base}/poses`) || u.pathname.startsWith(`${base}/placements`) || u.pathname === `${base}/findings/regroup`,
    async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      const path = new URL(req.url()).pathname.slice(base.length);
      if (req.method() === "POST") {
        posts.push(path);
        const type = path === "/poses/estimate" ? "asset_pose" : path === "/placements/compute" ? "asset_place" : "asset_group";
        return json(route, job(type), 202);
      }
      if (path === "/poses") return json(route, { items: [pose(1, "finding"), pose(2, "uncertain"), pose(3, "none")], next: null });
      if (path === "/placements")
        return json(route, {
          version: 1,
          items: FINDINGS.map((f, i) => ({ sighting_id: `s${i}`, finding_id: f.id, kind: "point", center: [2, f.height_m, -2],
            normal: [0, 0, -1], size: null, severity: f.severity, patch_url: null })),
          next: null,
        });
      return route.fallback();
    },
  );
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/review-imports` || u.pathname === `/api/v1/projects/${P}/sources`,
    async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      if (req.method() === "GET")
        return json(route, { items: [{ id: SOURCE_ID, kind: "images", label: "Flight 14 Sep", captured_on: null, map_id: null,
          folder: "D:\\photos", site: null, settings: {}, image_count: 3, duplicate_count: 0, job_id: null, imported_at: T,
          created_at: T }], next_cursor: null });
      const body = req.postDataJSON() as ImportBody;
      imports.push(body);
      const preview = { dry_run: true, unit: "region", profile: "building-facade", profile_id: "building_facade",
        photos: 3, matched: 2, matched_by: { path: 2 }, unmatched_count: 1, unmatched: ["flight-b/DJI_0003.JPG"],
        unmatched_reasons: [{ kit_id: "p03", source_name: "flight-b/DJI_0003.JPG", reason: "not_found" }],
        classes: [{ key: "crack", label: "Crack", count: 3, type_id: FINDINGS[0].type_id }],
        statuses: { finding: 2, none: 0, uncertain: 0, not_assessed: 0 }, sightings: 3,
        has_surface: false, has_glb: false, has_merged: true, model: { ready_version: 2, existing_sightings: 0 } };
      const j = job("review_kit_import").job;
      return json(route, { job: body.dry_run
        ? { ...j, state: "succeeded", progress: 1, params: { dry_run: true }, result: preview, finished_at: T }
        : { ...j, params: { dry_run: false } } }, 202);
    },
  );
  return { posts, imports };
}
```

- [ ] **Step 2: Write the spec**

```ts
// e2e/asset-findings-workspace.spec.ts
import { expect, test } from "@playwright/test";
import { MODEL, P, routeAssetModels } from "./fixtures/assetModels";
import { SOURCE_ID, routeAssetReview } from "./fixtures/assetReviewWorkspace";
import { SWIFTSHADER } from "./fixtures/cloudWorkspace";

test.use(SWIFTSHADER);

test("findings and photos topics on the asset model", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await routeAssetModels(page);
  const review = await routeAssetReview(page);
  await page.goto(`/p/${P}/models/${MODEL}`);
  const rail = page.getByRole("toolbar", { name: /model view tools/i });
  await expect(rail).toBeVisible();

  await rail.getByRole("button", { name: /^findings/i }).click();
  const panel = page.getByTestId("rail-panel");
  await expect(panel).toHaveAttribute("data-topic", "findings");
  await panel.getByRole("option", { name: /F-0001/ }).click();
  await expect(panel.getByText("6.2 m")).toBeVisible();
  await panel.getByRole("button", { name: /^focus$/i }).click();
  await panel.getByRole("button", { name: /findings actions/i }).click();
  await page.getByRole("menuitem", { name: /^compute placements$/i }).click();
  await expect.poll(() => review.posts).toContain("/placements/compute");

  await rail.getByRole("button", { name: /^photos/i }).click();
  await expect(panel).toHaveAttribute("data-topic", "photos");
  await expect(panel.getByText("2 photos")).toBeVisible(); // the context photo is left out
  await panel.getByRole("switch", { name: /include context photos/i }).click();
  await expect(panel.getByText("3 photos")).toBeVisible();
  await panel.getByRole("button", { name: /photos actions/i }).click();
  await page.getByRole("menuitem", { name: /estimate poses/i }).click();
  await expect.poll(() => review.posts).toContain("/poses/estimate");

  await page.reload();
  await expect(page.getByTestId("rail-panel")).toHaveAttribute("data-topic", "photos"); // remembered
  expect(pageErrors).toEqual([]);
});

test("import an inspection review: dry run, preview, mapping, import", async ({ page }) => {
  await routeAssetModels(page);
  const review = await routeAssetReview(page);
  await page.goto(`/p/${P}/models/${MODEL}`);
  // a fresh browser context opens the rail on the Model topic, where the picker is
  await expect(page.getByTestId("rail-panel")).toHaveAttribute("data-topic", "model");
  await page.getByRole("button", { name: /asset model: /i }).click();
  await page.getByRole("button", { name: /import inspection review/i }).click();
  const dialog = page.getByRole("dialog", { name: /import inspection review/i });
  await dialog.getByLabel(/review job folder/i).fill("D:\\kits\\tower\\job");
  await expect(dialog.getByLabel(/image set with the photos/i)).toHaveValue(SOURCE_ID);
  await dialog.getByRole("button", { name: /check the folder/i }).click();
  const preview = dialog.getByRole("region", { name: /what this import will do/i });
  await expect(preview).toContainText("2 of 3 photos matched");
  await expect(preview).toContainText("3 sightings");
  await preview.getByText(/photos not matched; they are left out/i).click();
  await expect(preview.getByRole("list", { name: /photos not matched/i })).toContainText("No image with this name in the image set");
  await dialog.getByRole("button", { name: /^import$/i }).click();
  await expect(dialog).toBeHidden();
  expect(review.imports.map((b) => b.dry_run)).toEqual([true, false]);
  expect(review.imports[1].class_map).toEqual({ crack: "c1a2b3c4-0000-4000-8000-000000000009" });
});
```

- [ ] **Step 3: Run it**

Run: `pnpm -C frontend e2e -- asset-findings-workspace.spec.ts models-workspace.spec.ts models-build.spec.ts`
Expected: PASS (the M1 specs too: the parts list, the group switches and the build bar still work on the rail)

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/fixtures/assetReviewWorkspace.ts frontend/e2e/asset-findings-workspace.spec.ts
git commit -m "test(asset-findings): e2e for the findings and photos topics and the review import

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Gate, land and the operator walkthrough

- [ ] **Step 1: Run the full gate** from the worktree:

```
pnpm -C contract check
cd backend; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check .; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff format --check .; & E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
```

Expected: all green. `cargo test` only if the frozen sidecar is present.

- [ ] **Step 2: Land.** `scripts\finish-task.ps1`, or the manual fallback (memory: nested-unit-controllers): merge `task/af-u2` into `main` with `--no-ff`, re-run `pnpm -C frontend test` on `main`, remove the worktree (junctions as links first) and delete the branch.

- [ ] **Step 3: Operator walkthrough ("how to test this")**, in the hand-off message:
  1. Open a project with an asset model, then **Asset models**. The left rail shows the view tools, then **Model**, **Findings** and **Photos**.
  2. **Model**: switch **See through** on: the model turns glassy. Switch **Turn slowly** on and off. With a model that has a location, switch **Street map** on: streets appear under the model.
  3. Model picker, then **Import a GLB…**: pick a GLB, choose its axes, optionally its latitude, longitude and ground altitude, and **Import**. A toast says the version is importing; the view shows it when the job ends.
  4. **Photos**: the count and the outcome legend show; **Include context photos** adds the no-finding photos; **Show cameras** hides the glyphs. Click a camera in the view: the Photos topic opens with that photo; **View from here** looks through it; **Back to the model view** returns.
  5. **Photos** menu, then **Estimate poses from photo metadata**: a toast says it started; another says how many photos were posed when it ends.
  6. **Findings**: findings list with zone, side and height. Filter by zone, then by **Not placed**. Pick a finding, then **Focus**: the view turns square on to it. **Inspect** opens the split inspection (U3).
  7. **Findings** menu, then **Compute placements**: two toasts follow, placements then regroup. **Regroup findings** asks first, then runs.
  8. Model picker, then **Import inspection review…** (or **Add data**, then **Inspection review**): pick a kit job folder and the image set its photos were imported into, then **Check the folder**. The preview lists the matched and unmatched photos with reasons, the sightings it will make and a type per kit class. Fix any class without a type, then **Import**. A toast says how many findings and sightings it made, and the Findings and Photos topics fill in.

---

## Self-review

**Spec coverage:**

| Spec | Where |
| --- | --- |
| §9 Findings: list with zone, side and height | T3 `findingItem`, `FindingsTopic` |
| §9 Findings: filters severity, type, zone, side, placed | T3 `findingsQuery`, server-side |
| §9 Findings: Focus button | T3 (`focusFinding` with the profile's focus settings) |
| §9 Findings: Regroup | T3 menu and confirm, T4 `regroup` |
| §9 Photos: sequence filter, outcome colours, include context photos | T2 `outcome.ts`, `PhotosTopic` |
| §9 Photos: cameras on or off, view cone | T2 switches, U1 `setCameras`, `setSelectedCamera` |
| §9 engine from the workspace: ghost, auto-rotate, ground, view from pose, picks | T5, T2 |
| §2/§6.1 GLB import entry | T4 `ImportGlbDialog`, T5 picker and no-version card |
| §6 jobs with toasts | T1, T4 |
| §6.5 operator confirms the class mapping; the dry run lists unmatched photos | T6 `ReviewImportDialog` (Model topic and Add data) |
| §12 e2e "asset workspace topics" | T7 (with the review import flow) |
| Review Focus 5 (`PhotosTopic.test.tsx` "pages poses") | T2 Step 1 |

**Placeholders:** none. Names used across tasks are defined where first used: `ReviewActions` (T4, consumed by T2 and T3 tests as a plain object), `FindingsLayer` (T3), `PhotosLayer` (T2), `useModelRail` and `showTopic` (T5).

**Last task:** T8 is the full AGENTS.md gate.

## Index notes

1. **The asset workspace had no rail.** The spec says the new topics go "on U7's rail", but M1 U7 built the build dialog and Run tab only; the asset workspace on `main` still has M1 U6's floating `ViewTools` and `ModelPanel`. U2 therefore moves the workspace onto `WorkspaceRail` (Task 5), as `useCloudRail` did for clouds, with the M1 panel as the **Model** topic. `RailWorkspace` gains `"models"` (`src/ui/railStore.ts`).
2. **U2 does not use U4's `FindingFilters`.** The topic offers one zone and one side at a time (a `Select` each), not the register's multi-select, so it builds the `listFindings` query directly from C0's parameter names (`asset_model_id`, `zone: string[]`, `side: string[]`, `placed`, `severity`, `type_id`, `sort`), the shapes U4's plan consumes.
3. **Job result fields.** The toasts read the fields C0 lists in `Job.result`: `asset_pose {estimated, kept, skipped}`, `asset_place {point, patch, none}`, `asset_group {created, kept, merged, split}`, `review_kit_import {findings, sightings, unmatched_count}` (or the preview when `params.dry_run`). C0 must add the five job types to `TYPE_NAME` and `jobToastText` (or the frontend build fails); U2 replaces whatever text C0 put there.
4. **Import body.** `ImportGlbDialog` posts `{path, frame_conversion, origin: {lat, lon, ground_alt_m} | null}` and offers the conversions `none` and `x_east_minus_z_north` (spec §5.2). This matches J1's `GlbImportRequest {path, frame_conversion, origin, note}` and `FrameConversion = Literal["none", "x_east_minus_z_north"]`; if J1 adds conversions, add them to `FRAME_CONVERSIONS`.
5. **Ghost, auto-rotate and street map switches** are not in spec §9's topic list, but the engine methods exist for them and the scope list (§2) names them; they sit in the Model topic.
6. **U4's fixture `exampleAssetModel.review.focus.frustum` is `4`.** P1 defines `Focus.frustum` as `[min, max]` fractions of the asset height (default `[0.05, 0.125]`), which U1's `focusView` and U2's `focusSettingsOf` read. U4 should change its fixture to `[0.05, 0.125]`; `focusSettingsOf` would otherwise hand the engine a number where it expects a pair.
7. **Photos topic shows counts, not a list.** A 4,500-row list of photo ids helps nobody and the pose rows carry no file name; the topic shows the outcome legend with counts, and the photo picked in the view (thumbnail, View from here, Open photo).
8. **Kit import UI (coordinator ask; J5 note N6).** Task 6 adds the screen spec §6.5 implies. It reads J5's `ReviewImportPreview` with J5's added fields (`matched_by`, `unmatched_reasons`, `sightings`, `model`), typed as an intersection on C0's schema. Before Import it names the refusals J5 fails a real run on (no photo matched; no 3D model and no `model.glb`; a model that already holds sightings; J5 N8), so the operator does not wait for a job that will fail. The dry-run job's outcome is claimed while the dialog is open (no toast); the real run ends with the Task 1 toast.
