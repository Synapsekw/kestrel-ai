# Asset model U7 — build dialog, run progress, Run tab

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the asset model workspace, the operator:
- picks drawings, clouds and photos, a provider and model, and notes, then starts **Build with AI…** or **Refine…**;
- watches the run (phase, step n/80, latest render thumbnail, Stop);
- reads the run's record (steps, summary, open questions, token use) in a Run tab.

**Architecture:**
- `BuildDialog` gathers sources from the project data list (`listDataItems` filtered to `drawing`, `point_cloud`, and photos through the image list), plus a provider picker driven by `useProviders()`. Only providers with a stored key are enabled.
- `useLiveRun` polls `getRun` every 2 s while the run is `running`, and stops polling when it ends. It's the same cadence as `useTrackedJob`.
- `BuildBar` mounts into U6's build slot. `RunTab` is passed to `ModelInspector`'s `runTab` prop.

**Tech Stack:** React 18, TypeScript, `src/ui/` primitives, Vitest, Playwright against the Prism mock.

**Spec:** §8 (Build bar, Run tab, states). Index and Global Constraints: `docs/superpowers/plans/2026-10-02-asset-model-builder.md`.

**Needs:** U5 merged (runs API real, Gemini in `/providers`) and U6 merged (workspace slots). **Worktree:** `scripts\start-task.ps1 -Name am-u7`. Load the design skills and `DESIGN.md` before UI code.

---

### Task 1: `useLiveRun` and the run-progress pieces

**Files:**
- Create: `frontend/src/assetmodels/run/useLiveRun.ts`, `frontend/src/assetmodels/run/runText.ts`
- Test: `frontend/src/assetmodels/run/useLiveRun.test.tsx`, `frontend/src/assetmodels/run/runText.test.ts`

**Interfaces:**
- Consumes: `getRun`, `listRuns`, `stopRun` (U6 `src/api/assetModels.ts`).
- Produces:

```ts
export const RUN_POLL_MS = 2000;
export function useLiveRun(projectId: string, modelId: string, liveRunId: string | null):
  { run: AssetModelRun | null; stop(): Promise<void>; stopping: boolean };
// runText.ts
export function phaseLabel(phase: AssetModelRun["phase"]): string;      // "Sampling the scan", "Reading sources", "Building", "Checking", "Done"
export function stopReasonText(run: AssetModelRun): string | null;      // "Stopped: token budget used", ... null when finished
export function tokensText(usage: AssetModelRun["usage"]): string;      // "1.2 M tokens"
export function thumbUrl(baseUrl: string, token: string, projectId: string, modelId: string, runId: string, n: number): string;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/assetmodels/run/runText.test.ts
import { describe, expect, it } from "vitest";
import { phaseLabel, stopReasonText, tokensText } from "./runText";

describe("run text", () => {
  it("labels phases", () => {
    expect(phaseLabel("sampling")).toBe("Sampling the scan");
    expect(phaseLabel("checking")).toBe("Checking");
  });

  it("explains why a run stopped", () => {
    const base = { state: "stopped", stop_reason: "budget" } as never;
    expect(stopReasonText(base)).toBe("Stopped: the run used its budget");
    expect(stopReasonText({ state: "stopped", stop_reason: "user" } as never)).toBe("Stopped by you");
    expect(stopReasonText({ state: "failed", stop_reason: "interrupted" } as never)).toBe("Interrupted when the app closed");
    expect(stopReasonText({ state: "finished", stop_reason: null } as never)).toBeNull();
  });

  it("formats token use", () => {
    expect(tokensText({ input_tokens: 1_150_000, output_tokens: 80_000 })).toBe("1.2 M tokens");
    expect(tokensText({ input_tokens: 9_000, output_tokens: 500 })).toBe("9.5 k tokens");
  });
});
```

```tsx
// src/assetmodels/run/useLiveRun.test.tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestApiProvider } from "@/test/render";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { RUN_POLL_MS, useLiveRun } from "./useLiveRun";

const running = { id: "r1", state: "running", phase: "building", steps: [], usage: { input_tokens: 0, output_tokens: 0 } };
const done = { ...running, state: "finished", phase: "done" };

describe("useLiveRun", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("polls while running and stops when the run ends", async () => {
    let n = 0;
    const { api, requests } = fakeClient([{ method: "GET", path: /\/runs\/r1$/, body: () => (n++ < 1 ? running : done) }] as never);
    const { result } = renderHook(() => useLiveRun(PROJECT_ID, "m1", "r1"), {
      wrapper: ({ children }) => <TestApiProvider api={api}>{children}</TestApiProvider> });
    await waitFor(() => expect(result.current.run?.state).toBe("running"));
    await act(async () => { vi.advanceTimersByTime(RUN_POLL_MS); });
    await waitFor(() => expect(result.current.run?.state).toBe("finished"));
    const count = requests.length;
    await act(async () => { vi.advanceTimersByTime(RUN_POLL_MS * 3); });
    expect(requests.length).toBe(count);
  });
});
```

If `fakeClient` doesn't accept a function `body`, add that option to it: a `FakeRoute.body` that may be `() => unknown`, evaluated per request. Do it in `src/test/fixtures.ts` with its own small test.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend test -- src/assetmodels/run`
Expected: FAIL (the modules don't exist)

- [ ] **Step 3: Implement**

```ts
// src/assetmodels/run/runText.ts
import type { AssetModelRun } from "@contract/client";

const PHASES: Record<AssetModelRun["phase"], string> = {
  sampling: "Sampling the scan", reading: "Reading sources", building: "Building", checking: "Checking", done: "Done",
};
export const phaseLabel = (p: AssetModelRun["phase"]) => PHASES[p];

export function stopReasonText(run: Pick<AssetModelRun, "state" | "stop_reason">): string | null {
  if (run.state === "finished" || run.state === "running") return null;
  switch (run.stop_reason) {
    case "budget": return "Stopped: the run used its budget";
    case "timeout": return "Stopped: the run reached its 20-minute limit";
    case "user": return "Stopped by you";
    case "interrupted": return "Interrupted when the app closed";
    case "provider_error": return "The AI provider returned an error";
    default: return "The run did not finish";
  }
}

export function tokensText(u: AssetModelRun["usage"]): string {
  const t = u.input_tokens + u.output_tokens;
  return t >= 1_000_000 ? `${(t / 1_000_000).toFixed(1)} M tokens` : `${(t / 1000).toFixed(1)} k tokens`;
}

export function thumbUrl(baseUrl: string, token: string, projectId: string, modelId: string, runId: string, n: number): string {
  const p = `/api/v1/projects/${encodeURIComponent(projectId)}/asset-models/${encodeURIComponent(modelId)}`;
  return `${baseUrl}${p}/runs/${encodeURIComponent(runId)}/steps/${n}/thumb?token=${encodeURIComponent(token)}`;
}
```

```ts
// src/assetmodels/run/useLiveRun.ts
import { useCallback, useEffect, useState } from "react";
import type { AssetModelRun } from "@contract/client";
import { getRun, stopRun } from "@/api/assetModels";
import { useApi } from "@/api/client";

export const RUN_POLL_MS = 2000;

export function useLiveRun(projectId: string, modelId: string, liveRunId: string | null) {
  const api = useApi();
  const [run, setRun] = useState<AssetModelRun | null>(null);
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    if (!liveRunId) { setRun(null); return; }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const r = await getRun(api, projectId, modelId, liveRunId);
        if (!alive) return;
        setRun(r);
        if (r.state === "running") timer = setTimeout(tick, RUN_POLL_MS);
      } catch {
        if (alive) timer = setTimeout(tick, RUN_POLL_MS * 2);
      }
    };
    void tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [api, projectId, modelId, liveRunId]);
  const stop = useCallback(async () => {
    if (!liveRunId) return;
    setStopping(true);
    try { setRun(await stopRun(api, projectId, modelId, liveRunId)); } finally { setStopping(false); }
  }, [api, projectId, modelId, liveRunId]);
  return { run, stop, stopping };
}
```

The catch branch retries forever at 4 s. Cap it like `useTrackedJob`: stop after 5 consecutive failures and expose `error`. Add `error: string | null` to the return value and a test for it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -C frontend test -- src/assetmodels/run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/assetmodels/run frontend/src/test/fixtures.ts
git commit -m "feat(asset-models): live run polling and run text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Build dialog, Build bar, Run tab, wiring

**Files:**
- Create: `frontend/src/assetmodels/run/BuildDialog.tsx`, `BuildBar.tsx`, `RunTab.tsx`, `RunProgressCard.tsx`
- Create: `frontend/src/assetmodels/run/sources.ts` (load selectable sources: drawings and clouds from `listDataItems(type)`, photos from the project's image list API with `limit` 200 and a filter box; never the whole image set at once)
- Modify: `frontend/src/assetmodels/workspace/AssetModelWorkspace.tsx` (mount `BuildBar` in the build slot; pass `runTab={<RunTab …/>}`; show `RunProgressCard` instead of "No version yet" while a run is live; reload versions when a run ends)
- Test: `frontend/src/assetmodels/run/BuildDialog.test.tsx`, `frontend/src/assetmodels/run/RunTab.test.tsx`, extend `AssetModelWorkspace.test.tsx`

**Interfaces:**
- `BuildDialog` props: `{ open, onClose, projectId, model: AssetModel, mode: "build" | "refine", onStarted(run: AssetModelRun): void }`
- `BuildBar` props: `{ projectId, model, onStarted, run: AssetModelRun | null, onStop(): void, stopping: boolean }`
- `RunTab` props: `{ projectId, modelId, runs: AssetModelRun[] }` (newest first; selects the latest by default)

Behaviour:

**Build dialog**
- **Sources**: three groups (Drawings, Point clouds, Photos), each with checkboxes and a count. Not-ready items are disabled with their status. Photos are searchable and paged (first 200; "Show more" adds 200). For **Refine**, the sources default to the current version's `source_ids`.
- **Provider**: a `Segmented` control of the providers from `useProviders()`.
  - Providers without a key are disabled, with the hint "Add a key in App settings" linking to `/settings`.
  - The default is the first one with a key, preferring `anthropic`.
- **Model**: a text `Input` prefilled with the provider's `model_name`.
- **Notes**: a `Textarea` (≤ 4 000 characters, counter shown), e.g. "N7 is at 270°, not 90°".
- **Footer**: Cancel / **Start build** (or **Start refine**). Disabled until at least one source is picked and a keyed provider is chosen.
- **Errors**:
  - A 409 `provider_key_missing` shows "Add this provider's API key in App settings."
  - A 409 `job_running` shows "A run is already building this model."
  - A 422 `no_sources` shows "A chosen source is missing or not ready."
  - A 422 `nothing_to_refine` shows "This model has no version to refine yet."

**Build bar**
- With no live run: **Build with AI…** (primary), and **Refine…** when `current_version` is set.
- With a live run: the phase label, "step n of 80", a `Progress` bar (`steps.length / 80`), the latest step's thumbnail (64 px, `thumbUrl` of the last step with `has_thumb`), the last step's summary, and **Stop** (danger, ghost).
- When the run ends: a toast with the version written ("Built version 3", "Saved a draft as version 3", or the stop/fail reason when no version was written).

**Run tab**
- Shows the latest run's state pill, provider · model, started/ended, tokens, and summary.
- **Open questions** as a list. Each has "Refine with this note…", which opens `BuildDialog` in refine mode with that question prefilled in the notes.
- The steps as a compact list (n, tool, ok/failed dot, summary, thumbnail on hover via `Tooltip`).
- Older runs in a `Disclosure` "Earlier runs".

- [ ] **Step 1: Write the failing tests**

```tsx
// src/assetmodels/run/BuildDialog.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { MODEL } from "@/test/assetModelFixtures";
import { BuildDialog } from "./BuildDialog";

const providers = { items: [
  { name: "openai", model_name: "gpt-5", has_key: false },
  { name: "anthropic", model_name: "claude-opus-5-5", has_key: true },
  { name: "gemini", model_name: "gemini-2.5-pro", has_key: true },
] };
const drawings = { items: [{ id: "d1", type: "drawing", label: "GA drawing", status: "ready" },
                           { id: "d2", type: "drawing", label: "Importing", status: "importing" }] };

function setup(extra: unknown[] = []) {
  return fakeClient([
    { method: "GET", path: /\/providers$/, body: providers },
    { method: "GET", path: /\/data$/, body: (url: string) => (url.includes("type=drawing") ? drawings : { items: [] }) },
    { method: "GET", path: /\/images/, body: { items: [], next_cursor: null } },
    ...extra,
  ] as never);
}

describe("BuildDialog", () => {
  it("starts a build with the picked sources, provider and notes", async () => {
    const { api, requests } = setup([{ method: "POST", path: /\/runs$/, status: 202,
      body: { run: { id: "r1", state: "running" }, job: { id: "j1" } } }]);
    const onStarted = vi.fn();
    renderWithProviders(<BuildDialog open onClose={() => {}} projectId={PROJECT_ID} model={MODEL} mode="build" onStarted={onStarted} />, { api });
    fireEvent.click(await screen.findByRole("checkbox", { name: /ga drawing/i }));
    expect(screen.getByRole("checkbox", { name: /importing/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /openai/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /gemini/i }));
    fireEvent.change(screen.getByLabelText(/notes/i), { target: { value: "N7 is at 270°" } });
    fireEvent.click(screen.getByRole("button", { name: /start build/i }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    const body = JSON.parse(String(requests.find((r) => r.method === "POST")!.body));
    expect(body).toEqual({ mode: "build", provider: "gemini", model_name: "gemini-2.5-pro",
                           sources: [{ type: "drawing", id: "d1" }], notes: "N7 is at 270°" });
  });

  it("shows the server's reason when the run can't start", async () => {
    const { api } = setup([{ method: "POST", path: /\/runs$/, status: 409,
      body: { error: { code: "job_running", message: "x", details: {} } } }]);
    renderWithProviders(<BuildDialog open onClose={() => {}} projectId={PROJECT_ID} model={MODEL} mode="build" onStarted={() => {}} />, { api });
    fireEvent.click(await screen.findByRole("checkbox", { name: /ga drawing/i }));
    fireEvent.click(screen.getByRole("button", { name: /start build/i }));
    expect(await screen.findByText(/already building this model/i)).toBeInTheDocument();
  });

  it("can't start without a source", async () => {
    const { api } = setup();
    renderWithProviders(<BuildDialog open onClose={() => {}} projectId={PROJECT_ID} model={MODEL} mode="build" onStarted={() => {}} />, { api });
    expect(await screen.findByRole("button", { name: /start build/i })).toBeDisabled();
  });
});
```

Adapt the provider fixture's field names (`has_key` and so on) to the actual `ProviderOut` shape, and the `/data` route's query handling to what `fakeClient` supports (add URL-aware bodies alongside the function `body` from Task 1).

```tsx
// src/assetmodels/run/RunTab.test.tsx
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { RUN_FINISHED } from "@/test/assetModelFixtures";
import { RunTab } from "./RunTab";

describe("RunTab", () => {
  it("shows the summary, open questions and steps", () => {
    const { api } = fakeClient([]);
    renderWithProviders(<RunTab projectId={PROJECT_ID} modelId="m1" runs={[RUN_FINISHED]} />, { api });
    expect(screen.getByText(RUN_FINISHED.summary!)).toBeInTheDocument();
    expect(screen.getByText(/roof type\?/i)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem", { name: /step/i })).toHaveLength(RUN_FINISHED.steps.length);
    expect(screen.getByText(/k tokens|m tokens/i)).toBeInTheDocument();
  });

  it("refine-with-note opens the dialog with the question prefilled", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/providers$/, body: { items: [] } }]);
    renderWithProviders(<RunTab projectId={PROJECT_ID} modelId="m1" runs={[RUN_FINISHED]} />, { api });
    fireEvent.click(screen.getByRole("button", { name: /refine with this note/i }));
    expect(await screen.findByLabelText(/notes/i)).toHaveValue("Roof type?");
  });
});
```

Add `RUN_FINISHED` to `assetModelFixtures.ts`: two steps, `summary: "Built the shell and nozzles."`, `open_questions: ["Roof type?"]`, `usage: {input_tokens: 9000, output_tokens: 500}`. To `AssetModelWorkspace.test.tsx`, add a test with `MODEL.live_run_id = "r1"` and a running run: the Build bar shows "Building", "step 2 of 80" and **Stop**, and clicking Stop posts `/runs/r1/stop`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm -C frontend test -- src/assetmodels`
Expected: FAIL

- [ ] **Step 3: Implement the components to the behaviour above** using `Dialog`, `Checkbox`, `Segmented`, `Input`, `Textarea`, `Field`, `Button`, `Progress`, `Pill`, `Tooltip`, `Disclosure` and `toast` from `src/ui/`. Keep one component per file. No raw colours.

- [ ] **Step 4: Run tests, lint, build**

Run: `pnpm -C frontend test -- src/assetmodels; pnpm -C frontend lint; pnpm -C frontend build`
Expected: PASS, clean

- [ ] **Step 5: Look at it** in the dev build against the Prism mock: screenshots at 1366×768 and 1920×1080, with the dialog open and a run in progress. Check them against `DESIGN.md`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/assetmodels/run frontend/src/assetmodels/workspace/AssetModelWorkspace.tsx frontend/src/assetmodels/workspace/AssetModelWorkspace.test.tsx frontend/src/test/assetModelFixtures.ts
git commit -m "feat(asset-models): build dialog, live run bar and run tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: e2e — build, watch, stop

**Files:**
- Modify: `frontend/e2e/fixtures/assetModels.ts` (run routes: a POST returning a running run, a GET that advances through two running states to finished, a stop POST)
- Create: `frontend/e2e/models-build.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// e2e/models-build.spec.ts
import { expect, test } from "@playwright/test";
import { routeAssetModels, routeRuns } from "./fixtures/assetModels";

test.use({ launchOptions: { args: ["--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"] } });

test("build with AI from a drawing, watch progress, get a version", async ({ page }) => {
  await routeAssetModels(page, { empty: true });
  const runs = await routeRuns(page, { finishAfterPolls: 2 });
  await page.goto("/p/p1/models/m1");
  await page.getByRole("button", { name: /build with ai/i }).click();
  await page.getByRole("checkbox", { name: /ga drawing/i }).check();
  await page.getByRole("button", { name: /start build/i }).click();
  await expect(page.getByText(/step \d+ of 80/i)).toBeVisible();
  await expect(page.getByText(/built version 1/i)).toBeVisible({ timeout: 15_000 });
  expect(runs.started[0].sources).toEqual([{ type: "drawing", id: "d1" }]);
});

test("stop a run", async ({ page }) => {
  await routeAssetModels(page, { empty: true });
  const runs = await routeRuns(page, { finishAfterPolls: 99 });
  await page.goto("/p/p1/models/m1");
  await page.getByRole("button", { name: /build with ai/i }).click();
  await page.getByRole("checkbox", { name: /ga drawing/i }).check();
  await page.getByRole("button", { name: /start build/i }).click();
  await page.getByRole("button", { name: /^stop$/i }).click();
  expect(runs.stopped).toBe(1);
});
```

- [ ] **Step 2: Run it**

Run: `pnpm -C frontend e2e -- models-build.spec.ts models-workspace.spec.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/e2e/fixtures/assetModels.ts frontend/e2e/models-build.spec.ts
git commit -m "test(asset-models): e2e for building and stopping a run

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Acceptance on the installed app, docs, landing

- [ ] **Step 1: Gate and merge**: `scripts\finish-task.ps1`, or the manual fallback.

- [ ] **Step 2: Build and install the app from `main`** (memory: ui-site-office-branch; `pnpm -C frontend build:installer`, then install).

- [ ] **Step 3: Operator acceptance (spec §11).**
  1. With the HCl tank GA drawing imported as a Drawing, run **Build with AI…** using Claude.
  2. Check the result against the §11 tolerances: ID 4000 ± 5, shell 8000 ± 5, three courses, the head radii within 5 %, all 17 nozzles and manways, bearings ± 2°, elevations ± 25 mm, sources not `assumed`.
  3. Repeat with the Elios cloud added, and check that the shell's median deviation is under 15 mm.
  4. Repeat once with Gemini.
  5. Record the outcome, with run ids, token use and screenshots, in `docs/progress.md` and `docs/evidence/2026-10-xx-asset-model-acceptance/`.

- [ ] **Step 4: Operator walkthrough ("how to test this")**: write it in `docs/evidence/…/walkthrough.md` and paste it into the final message:
  1. Open a project → **Asset models** tab → **New asset model…**, name it "HCl tank".
  2. **Build with AI…** → tick the GA drawing → choose Claude → **Start build**.
  3. Watch the bar: phase, step count and thumbnail. Open the **Run** tab to see the steps arrive.
  4. When it finishes, orbit the model, use **Cut** at bearing 90, **Levels** and **Head off**, and toggle **Nozzles**.
  5. In **Parts**, pick N7 and change its projection. **Save as new version**, then check **Versions** for v2 with the note.
  6. **Versions** → compare v1 and v2. **Restore** v1.
  7. **Download** → GLB, and open it in Windows 3D Viewer. **Download** → Spec (JSON).
  8. Start another build and press **Stop**: a draft version appears.
  9. Close the app during a run and reopen it: the run says "Interrupted when the app closed", and a draft is listed.

- [ ] **Step 5: `/wrapup`**: a session note in `vault/sessions/`, an update to `vault/00-north-star.md` (M1 done; M2 next), and ADRs for the non-obvious traps found while building (for example, the append-only history rule for preserved thinking, and why the token budget is per run).
