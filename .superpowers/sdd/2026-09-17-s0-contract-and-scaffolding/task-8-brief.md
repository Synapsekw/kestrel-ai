### Task 8: Frontend shell (Vite, React, Tailwind, router, API client, splash, error boundary)

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/tsconfig.node.json`, `frontend/tailwind.config.ts`, `frontend/postcss.config.js`, `frontend/index.html`, `frontend/eslint.config.js`, `frontend/.prettierrc`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/routes.tsx`, `frontend/src/index.css`, `frontend/src/test-setup.ts`, `frontend/src/vite-env.d.ts`, `frontend/src/api/backend.ts`, `frontend/src/api/client.tsx`, `frontend/src/api/events.ts`, `frontend/src/app/Splash.tsx`, `frontend/src/app/ErrorBoundary.tsx`, `frontend/src/app/Shell.tsx`, `frontend/src/app/diagnostics.ts`, `frontend/src/store/jobs.ts`, `frontend/src/screens/*.tsx` (8 placeholders), `frontend/src/api/backend.test.ts`, `frontend/src/store/jobs.test.ts`, `frontend/playwright.config.ts`, `frontend/e2e/boot.spec.ts`

**Interfaces:**
- Consumes: `createApiClient`, `eventsUrl`, types from `@contract/client` (Vite alias to `../contract/client`).
- Produces:
  - `resolveBackend(): Promise<{baseUrl: string; token: string; mode: "tauri" | "env" | "mock"}>` in `api/backend.ts`. Order: if `window.__TAURI_INTERNALS__` exists, `invoke("backend_info")`; else if `import.meta.env.APP_BACKEND_URL` is set, use it with `import.meta.env.APP_BACKEND_TOKEN`; else `{baseUrl: "http://127.0.0.1:4010", token: "mock", mode: "mock"}`.
  - `waitForHealth(client, timeoutMs, intervalMs): Promise<Health>` in `api/backend.ts`.
  - `useApi(): ApiClient`, `useBackend(): BackendInfo` and `ApiProvider` in `api/client.tsx`.
  - `connectEvents(url, onEvent): () => void` with reconnect and backoff (1 s doubling to 10 s) in `api/events.ts`.
  - `useJobsStore` (zustand) with `jobs: Record<string, Job>`, `applyEvent(ev: AppEvent)`, `upsert(job)`, `active(): Job[]`.
  - `pushLog(line: string)` and `collectDiagnostics(): string` in `app/diagnostics.ts` holding the last 200 UI log lines plus the backend URL, mode and last health payload. The backend app log is not exposed by the contract; S5 may add a diagnostics endpoint through the goal owner.
- Routes: `/` Projects, `/p/:projectId/data`, `/p/:projectId/edit/:imageId`, `/p/:projectId/review`, `/p/:projectId/models`, `/p/:projectId/train`, `/p/:projectId/query`, `/p/:projectId/settings`. Each screen other than Projects is a placeholder that renders its title as an `<h1>` and the project id.

- [ ] **Step 1: Scaffold**

```powershell
cd E:\Dev\Yolo\app\frontend
pnpm init
pnpm add react@18 react-dom@18 react-router-dom@6 zustand@5 openapi-fetch@0.13 konva@9 react-konva@18 @tauri-apps/api@2 @tauri-apps/plugin-shell@2 @tauri-apps/plugin-dialog@2
pnpm add -D vite@6 @vitejs/plugin-react@4 typescript@5 @types/react@18 @types/react-dom@18 tailwindcss@3 postcss autoprefixer vitest@3 @testing-library/react@16 @testing-library/jest-dom@6 jsdom @playwright/test@1 eslint@9 typescript-eslint@8 eslint-plugin-react-hooks eslint-plugin-react-refresh prettier@3 @tauri-apps/cli@2
```

`package.json` scripts:

```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "lint": "eslint src && prettier --check src",
  "format": "prettier --write src",
  "e2e": "playwright test",
  "tauri": "tauri"
}
```

`vite.config.ts`:

```ts
/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@contract/client": path.resolve(__dirname, "../contract/client"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  envPrefix: ["VITE_", "APP_"],
  server: { port: 1420, strictPort: true, host: "127.0.0.1" },
  clearScreen: false,
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"], include: ["src/**/*.test.{ts,tsx}"] },
});
```

`envPrefix` including `APP_` is what makes `APP_BACKEND_URL` and `APP_BACKEND_TOKEN` visible as `import.meta.env.APP_BACKEND_URL` (spec section 10). `tsconfig.json` sets `"paths": {"@contract/client": ["../contract/client"], "@/*": ["src/*"]}` and includes `../contract/client` in `include`.

- [ ] **Step 2: Write failing tests**

`src/api/backend.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("resolveBackend", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    delete (window as any).__TAURI_INTERNALS__;
  });
  it("falls back to the mock server", async () => {
    vi.stubEnv("APP_BACKEND_URL", "");
    const { resolveBackend } = await import("./backend");
    expect(await resolveBackend()).toEqual({ baseUrl: "http://127.0.0.1:4010", token: "mock", mode: "mock" });
  });
  it("uses APP_BACKEND_URL when set", async () => {
    vi.stubEnv("APP_BACKEND_URL", "http://127.0.0.1:8765");
    vi.stubEnv("APP_BACKEND_TOKEN", "abc");
    const { resolveBackend } = await import("./backend");
    expect(await resolveBackend()).toEqual({ baseUrl: "http://127.0.0.1:8765", token: "abc", mode: "env" });
  });
  it("asks tauri when running inside the shell", async () => {
    (window as any).__TAURI_INTERNALS__ = {};
    vi.doMock("@tauri-apps/api/core", () => ({
      invoke: vi.fn().mockResolvedValue({ base_url: "http://127.0.0.1:5555", token: "t" }),
    }));
    const { resolveBackend } = await import("./backend");
    expect(await resolveBackend()).toEqual({ baseUrl: "http://127.0.0.1:5555", token: "t", mode: "tauri" });
  });
});
```

`src/store/jobs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { useJobsStore } from "./jobs";

const job = {
  id: "j1", project_id: "p", type: "import", state: "queued", progress: 0, message: "",
  log_path: "runs/j1/job.log", params: {}, result: null, error: null,
  created_at: "2026-09-17T00:00:00Z", started_at: null, finished_at: null,
} as any;

describe("jobs store", () => {
  it("applies progress and state events", () => {
    const s = useJobsStore.getState();
    s.upsert(job);
    s.applyEvent({ type: "job.progress", project_id: "p", job_id: "j1", progress: 0.5, message: "half", payload: {} } as any);
    expect(useJobsStore.getState().jobs.j1.progress).toBe(0.5);
    expect(useJobsStore.getState().active().map((j) => j.id)).toEqual(["j1"]);
    s.applyEvent({ type: "job.state", project_id: "p", job_id: "j1", progress: 1, message: "", payload: { state: "succeeded" } } as any);
    expect(useJobsStore.getState().jobs.j1.state).toBe("succeeded");
    expect(useJobsStore.getState().active()).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm test`
Expected: fail, modules missing.

- [ ] **Step 4: Implement**

`src/api/backend.ts`:

```ts
import type { ApiClient, Health } from "@contract/client";

export type BackendInfo = { baseUrl: string; token: string; mode: "tauri" | "env" | "mock" };

export async function resolveBackend(): Promise<BackendInfo> {
  if ((window as any).__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<{ base_url: string; token: string }>("backend_info");
    return { baseUrl: info.base_url, token: info.token, mode: "tauri" };
  }
  const url = import.meta.env.APP_BACKEND_URL as string | undefined;
  if (url) return { baseUrl: url, token: (import.meta.env.APP_BACKEND_TOKEN as string) ?? "", mode: "env" };
  return { baseUrl: "http://127.0.0.1:4010", token: "mock", mode: "mock" };
}

export async function waitForHealth(client: ApiClient, timeoutMs = 60_000, intervalMs = 500): Promise<Health> {
  const t0 = Date.now();
  let lastError = "";
  while (Date.now() - t0 < timeoutMs) {
    try {
      const { data, error } = await client.GET("/health");
      if (data) return data;
      lastError = JSON.stringify(error);
    } catch (e) {
      lastError = String(e);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`backend not healthy after ${timeoutMs} ms: ${lastError}`);
}
```

`src/api/client.tsx`: React context holding `{client, info, health}`; `ApiProvider` renders `Splash` (text "Starting backend") until `waitForHealth` resolves, then children; on failure it renders the blocking dialog from spec section 11 with the message, the backend URL and mode, and a "Restart" button that re-runs resolve and poll (in Tauri mode it first invokes `restart_backend`). `useApi()` throws if used outside the provider.

`src/api/events.ts`:

```ts
import type { AppEvent } from "@contract/client";
import { pushLog } from "@/app/diagnostics";

export function connectEvents(url: string, onEvent: (ev: AppEvent) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let delay = 1000;
  const open = () => {
    if (closed) return;
    ws = new WebSocket(url);
    ws.onopen = () => { delay = 1000; pushLog("events: connected"); };
    ws.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch (e) { pushLog(`events: bad message ${e}`); } };
    ws.onclose = () => { if (!closed) { pushLog(`events: closed, retry in ${delay} ms`); setTimeout(open, delay); delay = Math.min(delay * 2, 10_000); } };
    ws.onerror = () => ws?.close();
  };
  open();
  return () => { closed = true; ws?.close(); };
}
```

`src/store/jobs.ts`:

```ts
import { create } from "zustand";
import type { AppEvent, Job } from "@contract/client";

const ACTIVE = new Set(["queued", "running"]);

interface JobsState {
  jobs: Record<string, Job>;
  upsert: (job: Job) => void;
  applyEvent: (ev: AppEvent) => void;
  active: () => Job[];
}

export const useJobsStore = create<JobsState>((set, get) => ({
  jobs: {},
  upsert: (job) => set((s) => ({ jobs: { ...s.jobs, [job.id]: job } })),
  applyEvent: (ev) =>
    set((s) => {
      if (!ev.job_id || !s.jobs[ev.job_id]) return s;
      const cur = s.jobs[ev.job_id];
      if (ev.type === "job.progress") {
        return { jobs: { ...s.jobs, [ev.job_id]: { ...cur, progress: ev.progress ?? cur.progress, message: ev.message ?? cur.message } } };
      }
      if (ev.type === "job.state") {
        const p = (ev.payload ?? {}) as Partial<Job>;
        return { jobs: { ...s.jobs, [ev.job_id]: { ...cur, ...p, progress: ev.progress ?? cur.progress } } };
      }
      return s;
    }),
  active: () => Object.values(get().jobs).filter((j) => ACTIVE.has(j.state)),
}));
```

`src/app/Shell.tsx`: left nav with links to the eight screens, top bar with project name and a jobs indicator (count of active jobs from the store). Tailwind only, no component library.

`src/app/ErrorBoundary.tsx`: class component; on error renders the message and a "Copy diagnostics" button calling `navigator.clipboard.writeText(collectDiagnostics())`.

`src/screens/ProjectsScreen.tsx`: `<h1>Projects</h1>`, lists `GET /projects` items (name, folder, open button) and has a "Create project" form (name, folder, classes textarea one per line, default the eight classes `excavator, wheel_loader, bulldozer, dump_truck, crane, concrete_mixer, roller, backhoe`) posting to `POST /projects`, and an "Open folder" form posting to `POST /projects/open`. In Tauri mode the folder fields use `open({directory: true})` from `@tauri-apps/plugin-dialog`; in browser mode they are plain text inputs. Navigates to `/p/:id/data` on success. The other seven screens render `<h1>` with their name.

`App.tsx`: `ErrorBoundary > ApiProvider > EventsBridge > RouterProvider`. `EventsBridge` connects `connectEvents(eventsUrl(info.baseUrl, info.token), useJobsStore.getState().applyEvent)` once and disposes on unmount.

- [ ] **Step 5: Run unit tests, lint, build**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: tests pass, no lint errors, `dist/` produced.

- [ ] **Step 6: Playwright boot test against the mock server**

`playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:1420", headless: true },
  webServer: [
    { command: "pnpm --dir ../contract mock", url: "http://127.0.0.1:4010/api/v1/health", reuseExistingServer: true, timeout: 60_000, ignoreHTTPSErrors: true },
    { command: "pnpm dev", url: "http://127.0.0.1:1420", reuseExistingServer: true, timeout: 60_000 },
  ],
});
```

Prism returns 401 for the health URL without a token; Playwright treats any HTTP response as "up", so this works.

`e2e/boot.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
test("boots against the mock server and lists projects", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Ahmadia")).toBeVisible(); // the Project example name in openapi.yaml
});
```

Run: `pnpm exec playwright install chromium` (browser download under the user profile, not a system install) then `pnpm e2e`.
Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add frontend && git commit -m "feat(frontend): vite react shell with api client, splash, events and screens"
```

---

