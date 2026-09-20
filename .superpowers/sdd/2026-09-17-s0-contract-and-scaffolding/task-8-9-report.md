# Task 8 + Task 9 report (branch `s0-frontend`, worktree `E:\Dev\Yolo\app\.worktrees\s0-frontend`)

Commits:

- `be0b87c` feat(frontend): vite react shell with api client, splash, events and screens (Task 8)
- `845e149` feat(tauri): shell that boots the backend sidecar with a per-launch token (Task 9)

Nothing outside the worktree was modified. No `git checkout/merge/push/worktree` was run.

---

## 1. Task 8: frontend shell

### What was implemented

Scaffolded `frontend/` with the exact package set from the brief (`pnpm init`, then the two
`pnpm add` lines verbatim), plus two dev dependencies the brief's ESLint 9 flat config needs
(`@eslint/js@9`, `globals`) and `@types/node` (needed by `tsconfig.node.json`'s `"types": ["node"]`).

Config: `vite.config.ts` (verbatim from the brief plus one extra alias, see deviations),
`tsconfig.json` / `tsconfig.node.json`, `tailwind.config.ts`, `postcss.config.js`, `.prettierrc`,
`eslint.config.js` (flat, `typescript-eslint` + react-hooks + react-refresh), `index.html`.
Scripts are exactly the eight from the brief.

Source:

- `src/api/backend.ts` — `resolveBackend()` (tauri → env → mock) and `waitForHealth(client, timeoutMs, intervalMs)`.
- `src/api/client.tsx` — `ApiProvider` (resolve → `createApiClient` → poll health; renders `Splash` while
  polling, a blocking dialog with the message, backend URL, mode and a **Restart** button on failure;
  Restart invokes `restart_backend` first in tauri mode), `useApi()`, `useBackend()`; `useApi` throws
  outside the provider.
- `src/api/events.ts` — `connectEvents(url, onEvent)` with reconnect backoff 1 s doubling to 10 s.
- `src/app/diagnostics.ts` — `pushLog`, `setBackendContext`, `collectDiagnostics()` (last 200 UI lines +
  backend URL, mode, last health payload, user agent).
- `src/app/Splash.tsx` ("Starting backend"), `src/app/ErrorBoundary.tsx` (class component, message +
  "Copy diagnostics" → `navigator.clipboard.writeText(collectDiagnostics())`),
  `src/app/Shell.tsx` (left nav with the eight screens, top bar with project name and active-job count).
- `src/store/jobs.ts` — zustand `useJobsStore` with `jobs`, `upsert`, `applyEvent`, `active()`.
- `src/routes.tsx` — the eight routes from the brief under a `Shell` layout route.
- `src/screens/ProjectsScreen.tsx` — recent projects list (name, folder, Open), Create-project form
  (name, folder, classes textarea defaulted to the eight machinery classes, one per line) posting to
  `POST /api/v1/projects`, Open-folder form posting to `POST /api/v1/projects/open`; folder fields show a
  native **Browse** button (`@tauri-apps/plugin-dialog` `open({directory: true})`) only in tauri mode.
  Navigates to `/p/:id/data` on success. The other seven screens are `<h1>` + project id placeholders.
- `src/App.tsx` — `ErrorBoundary > ApiProvider > EventsBridge > RouterProvider`; `EventsBridge` calls
  `connectEvents(eventsUrl(info.baseUrl, info.token), useJobsStore.getState().applyEvent)` once and
  disposes on unmount.

### TDD evidence

RED — tests written first, implementation absent:

```
$ pnpm test            # after writing src/api/backend.test.ts and src/store/jobs.test.ts only
 FAIL  src/api/backend.test.ts [ src/api/backend.test.ts ]
Error: Failed to resolve import "./backend" from "src/api/backend.test.ts". Does the file exist?
 FAIL  src/store/jobs.test.ts [ src/store/jobs.test.ts ]
Error: Failed to resolve import "./jobs" from "src/store/jobs.test.ts". Does the file exist?
 Test Files  2 failed (2)
      Tests  no tests
 ELIFECYCLE  Test failed. See above for more details.
```

GREEN — after writing `src/api/backend.ts` and `src/store/jobs.ts` and nothing else:

```
$ pnpm test
 ✓ src/api/backend.test.ts (3 tests) 14ms
 ✓ src/store/jobs.test.ts (2 tests) 2ms
 Test Files  2 passed (2)
      Tests  5 passed (5)
```

A second Playwright RED/GREEN cycle happened naturally: the brief's `getByText("Ahmadia")` first failed
with a strict-mode violation (it matched both the project name and the example folder
`E:\Projects\Ahmadia`), which also proved the list really renders; `{ exact: true }` fixed it.

### Final verification (all from `frontend/`, clean `dist/`)

```
$ pnpm test
 Test Files  2 passed (2)
      Tests  5 passed (5)

$ pnpm lint
> eslint src && prettier --check src
Checking formatting...
All matched files use Prettier code style!

$ pnpm build
> tsc -b && vite build
dist/index.html                  0.45 kB
dist/assets/index-*.css          9.59 kB
dist/assets/index-*.js         232.68 kB
✓ built in 885ms

$ pnpm e2e
Running 1 test using 1 worker
  ✓  1 e2e\boot.spec.ts:3:1 › boots against the mock server and lists projects (842ms)
  1 passed (4.5s)
```

Output is pristine: no warnings from eslint, vitest, tsc, vite or playwright.

---

## 2. Task 9: Tauri shell

Step 1 (Rust install / `docs/progress.md`) was skipped per instructions — the toolchain is already
installed (rustup 1.29.1, stable-x86_64-pc-windows-msvc, rustc 1.98.1).

### What was implemented

- `pnpm tauri init --ci` with the brief's flags, then the scaffold was replaced by the brief's content:
  - `Cargo.toml`: package `machinery-app`, `[lib] name = "machinery_app_lib"`,
    crate-type `["staticlib", "cdylib", "rlib"]`, deps `tauri = { version = "2", features = [] }`,
    `tauri-plugin-shell = "2"`, `tauri-plugin-dialog = "2"`, `serde`, `serde_json`, `rand = "0.8"`.
    The scaffold's `tauri-plugin-log`/`log` were dropped (not in the brief, not used).
  - `tauri.conf.json`: `productName` "Machinery Detection", identifier
    `ai.synapse-solutions.machinery-app`, window 1400x900 / min 1024x700, bundle `targets: ["nsis"]`,
    `externalBin: ["binaries/machinery-backend"]`, `resources: {"binaries/_internal/": "_internal/"}`,
    `windows.webviewInstallMode.type = "downloadBootstrapper"`.
  - `capabilities/default.json`: `core:default`, `shell:allow-execute` and `shell:allow-spawn` scoped to
    `{"name": "binaries/machinery-backend", "sidecar": true, "args": false}`, `shell:allow-kill`,
    `dialog:allow-open`, `dialog:allow-save`.
  - `src/sidecar.rs`, `src/lib.rs`, `src/main.rs`, `build.rs` exactly as the brief specifies
    (free port, 48-char alphanumeric per-launch token, `APP_PORT`/`APP_TOKEN`/`APP_DATA_DIR` env,
    stdout/stderr pumped to `[backend] …`, `APP_BACKEND_URL` short-circuit, kill on window Destroyed,
    `backend_info` / `restart_backend` commands).
- Icons: generated with `pnpm tauri icon` from a 1024 px placeholder PNG made with the read-only
  backend venv Python; the source PNG was deleted; `src-tauri/icons/` is committed.
- `frontend/src-tauri/binaries/` contains only `.gitkeep` (committed; the rest of the folder is
  gitignored).
- `backend/machinery_backend.spec` and `backend/scripts/build.ps1` written verbatim from the brief.
  They could not be run: the backend Python package (Tasks 4–7) does not exist on this branch, so
  Step 4's PyInstaller build and Step 5's real sidecar run are left to the goal owner after merge.

### Proof that the shell boots (env mode)

`cargo build` (with the placeholder sidecar in place) compiled cleanly:

```
$ cargo build
   Compiling machinery-app v0.1.0 (…\frontend\src-tauri)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 15.07s
```

No warnings from cargo; `cargo fmt --check` is clean.

Then, with the Prism mock running on 4010 and `APP_BACKEND_URL=http://127.0.0.1:4010`,
`APP_BACKEND_TOKEN=mock` in the environment:

```
$ pnpm tauri dev
     Running BeforeDevCommand (`pnpm dev`)
  VITE v6.4.3  ready in 184 ms
  ➜  Local:   http://127.0.0.1:1420/
     Running DevCommand (`cargo  run --no-default-features --color always --`)
   Compiling machinery-app v0.1.0 (…\frontend\src-tauri)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 4.25s
     Running `target\debug\machinery-app.exe`
```

The window opened (1416x939, title "Machinery Detection"), the splash gave way to the Projects screen
with the "Ahmadia" example project. Screenshot:
`.superpowers/sdd/2026-09-17-s0-contract-and-scaffolding/task-9-tauri-dev.png`.

The mock server log confirms the boot sequence went through the Tauri command (the UI ran in
`mode: "tauri"` — the folder fields show the native **Browse** button in the screenshot — so
`invoke("backend_info")` returned the env URL and token):

```
[HTTP SERVER] get /api/v1/health   i  info  Request received
[HTTP SERVER] get /api/v1/projects i  info  Request received
[HTTP SERVER] get /api/v1/projects i  info  Request received   (StrictMode double effect in dev)
```

No `[backend] …` lines, which is correct: in env mode `sidecar::start` returns early and never spawns
the sidecar.

Closing the window ended `machinery-app.exe` (`Get-Process machinery-app` → 0) and `pnpm tauri dev`
and its Vite child exited with it. The Prism mock I started was stopped by PID. Final check: no
listeners on 1420 or 4010, no `machinery-app` process, no stray node process from this session.
Ports 8080 and 9090 were never touched.

### Placeholder sidecar (as authorised in the context)

`cargo build` fails at the `tauri-build` step when `binaries/machinery-backend-x86_64-pc-windows-msvc.exe`
is missing, and — additionally — when `binaries/_internal` is missing (the `resources` entry is validated
the same way). For the dev run I therefore created two throwaway placeholders:

```
cp C:\Windows\System32\where.exe  src-tauri\binaries\machinery-backend-x86_64-pc-windows-msvc.exe
mkdir src-tauri\binaries\_internal ; echo placeholder > src-tauri\binaries\_internal\placeholder.txt
```

Both paths are gitignored, neither was committed, and I deleted both afterwards, so `cargo build`
now fails again until `backend/scripts/build.ps1` has produced the real sidecar. Anyone who wants to
re-run `pnpm tauri dev` before the backend exists must recreate those two placeholders.

---

## 3. Deviations from the briefs (and why)

1. **`/api/v1` prefix** — `client.GET("/api/v1/health")` etc., per the controller's context note; the
   generated client already carries the prefix in every path.
2. **Extra Vite alias `openapi-fetch` → `frontend/node_modules/openapi-fetch`** (and the matching
   `tsconfig.json` `paths` entry). `contract/client/index.ts` lives outside the frontend package, so
   neither Rollup nor tsc could resolve its one runtime import from there; `pnpm build` failed with
   "Rollup failed to resolve import 'openapi-fetch'". The alternative — adding `openapi-fetch` to
   `contract/package.json` — is explicitly ruled out by the plan ("the contract package only generates
   types"), so the alias stays on the consumer side.
3. **Three extra dev dependencies**: `@eslint/js@9` and `globals` (imported by the flat ESLint config),
   `@types/node` (required by `tsconfig.node.json`). `@eslint/js` resolved to 10.x by default and was
   pinned to 9 to match ESLint 9.
4. **`tsconfig.node.json` emits to `node_modules/.tmp`** instead of `noEmit`: TypeScript 5.9 rejects a
   referenced composite project that disables emit (`TS6310`). Both tsconfigs keep their build info out
   of the repo.
5. **Playwright assertion** uses `getByText("Ahmadia", { exact: true })`; the brief's non-exact locator
   hits a strict-mode violation because the example folder path contains the same word.
6. **`react-hooks/set-state-in-effect`** (new in eslint-plugin-react-hooks 7) rejected two synchronous
   `setState` calls inside effects in the brief's sketched components. `useProjectName` now derives the
   name from a `{id, name}` record instead of clearing it in the effect, and `ApiProvider` resets its
   state in the Restart handler instead of at the top of the effect. Behaviour is unchanged.
7. **`react-refresh/only-export-components` is disabled at the top of `src/api/client.tsx`** with a
   reason comment: the brief puts `ApiProvider`, `useApi` and `useBackend` in one module.
8. **Mobile icons removed**: `pnpm tauri icon` also wrote `icons/android/` and `icons/ios/` (≈50 files).
   This is a Windows desktop app with no mobile target, so those two folders were deleted before the
   commit; all desktop icons referenced by `tauri.conf.json` are committed.
9. **`frontend/src-tauri/Cargo.lock` is committed** (standard for a binary crate; makes the Rust build
   reproducible).
10. **Task 9 Step 1 skipped** (Rust already installed, `docs/progress.md` untouched) and
    **Steps 4–5 partially skipped** (no backend to PyInstaller yet), both per the controller's context.

## 4. Self-review findings

- Every file listed in the two briefs exists; the eight routes, eight screens and both Tauri commands
  match the specified interfaces.
- No "Label Studio" string anywhere; product name and identifier are as specified.
- No secrets in any file. The per-launch token is generated in Rust and never written to disk by this code.
- YAGNI check: the only code beyond the briefs is `messageOf()` in `ProjectsScreen` (the contract wraps
  errors as `{error: {code, message, details}}`, so `err.message` does not exist) and
  `setBackendContext()` in `diagnostics.ts` (the way the backend URL/mode/health reach
  `collectDiagnostics`, which the brief requires it to report). `konva`/`react-konva` are installed per
  the brief but unused in S0 — that is the brief's choice, for S2.
- Test quality: the store test asserts `message` as well as `progress` and adds a second case for the
  "event for an unknown job is ignored" branch, and resets the store in `beforeEach` so the two tests do
  not depend on each other. `backend.test.ts` is the brief's, with `any` casts replaced by narrower types
  so it passes lint and `tsc -b`.

## 5. Concerns / notes for the goal owner

- The real sidecar path is **unproven**. `sidecar::start`'s spawn branch never ran (env mode only), and
  `backend/machinery_backend.spec` + `backend/scripts/build.ps1` have never been executed. Running
  Task 9 Steps 4–5 after the backend branch merges is still required.
- Because `externalBin` **and** the `_internal` resource are validated at build time, `cargo build` /
  `pnpm tauri dev` will not work on a fresh checkout until `backend/scripts/build.ps1` has run once.
  Consider making that explicit in the dev docs.
- Prism does not serve the `/api/v1/events` websocket, so in mock mode the events bridge reconnects in a
  1 s→10 s backoff loop and logs "events: closed, retry in N ms" to the diagnostics buffer. Harmless,
  but it means the websocket path is only smoke-tested against a real backend.
- `waitForHealth` polls for up to 60 s; with the mock this returns on the first try, so the splash is
  only visible for a frame. The "Starting backend" splash and the failure dialog have no automated test
  yet — an e2e case that points the app at a dead port would cover the dialog, and belongs with S5's
  diagnostics work.

---

# Fix round 1 (review of Tasks 8+9: "spec compliant, quality — needs fixes")

Commit: `b6928e3` fix(frontend,tauri): guard api failures and surface sidecar death

All three open findings are addressed. Nothing else was touched.

## Finding 1 (IMPORTANT) — unguarded API calls

- `frontend/src/screens/ProjectsScreen.tsx`: `onCreate` and `onOpen` now wrap the `await api.POST(...)`
  in `try { … } catch (e) { pushLog(…); setError(String(e)) } finally { setBusy(false) }`, so a rejected
  request (backend gone, connection refused) shows a message, re-enables both forms and can no longer
  escape as an unhandled rejection through `void onCreate(e)`.
- `ProjectsScreen` list fetch: `.catch` added — logs and shows the error instead of rejecting.
- `frontend/src/app/Shell.tsx` `useProjectName`: `.catch` added — logs the failure; the top bar simply
  keeps showing "No project open" rather than crashing the shell for a cosmetic fetch.

## Finding 2 (IMPORTANT) — sidecar death is now detected at runtime

- `frontend/src-tauri/src/sidecar.rs`: `Backend` gained `stopping: Arc<AtomicBool>`. The reader task
  holds a clone of it and of the `AppHandle`; on `CommandEvent::Terminated` it emits the Tauri event
  `backend-terminated` with payload `{"code": <Option<i32>>}` via `tauri::Emitter`, **unless** the flag
  is set. `stop()` sets the flag before `child.kill()`, so a deliberate shutdown or a `restart_backend`
  never fires the crash path.
- `frontend/src/api/backend.ts`: new pure `terminationMessage(payload)` → `"Backend process exited
  (code N)"` or `"Backend process exited"` when no code is reported.
- `frontend/src/api/client.tsx`: in tauri mode `ApiProvider` subscribes with
  `listen("backend-terminated", …)` from `@tauri-apps/api/event`, logs the payload to diagnostics and
  sets the error state, which renders the existing blocking dialog (message, backend URL, mode,
  **Restart** button; Restart already invokes `restart_backend` then re-polls health). The listener is
  unlistened on unmount, and a listen that resolves after unmount is torn down immediately.

  Note on the spec's "log path": the contract still exposes no backend log path (Task 8 brief: "The
  backend app log is not exposed by the contract; S5 may add a diagnostics endpoint"), so the dialog
  shows the URL and mode. Unchanged from the reviewed version and out of scope for this round.

### TDD evidence for the new logic

RED (test written first, `terminationMessage` not yet implemented):

```
$ pnpm test
 FAIL  src/api/backend.test.ts > terminationMessage > names the exit code when the sidecar reports one
TypeError: terminationMessage is not a function
 ❯ src/api/backend.test.ts:48:12
 FAIL  src/api/backend.test.ts > terminationMessage > falls back when the sidecar reports no code
TypeError: terminationMessage is not a function
 ❯ src/api/backend.test.ts:53:12
 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 5 passed (7)
```

GREEN (after adding `terminationMessage` to `src/api/backend.ts` and nothing else):

```
$ pnpm test
 ✓ src/api/backend.test.ts (5 tests) 15ms
 ✓ src/store/jobs.test.ts (2 tests) 2ms
 Test Files  2 passed (2)
      Tests  7 passed (7)
```

## Finding 3 (MINOR) — stop the sidecar on app exit

`frontend/src-tauri/src/lib.rs` now ends with `.build(generate_context!()).expect(…).run(|app, event| …)`
and calls `sidecar::stop(&app.state::<BackendState>())` on `tauri::RunEvent::Exit`, in addition to the
existing `WindowEvent::Destroyed` handler. A second `stop()` is a no-op because the state has already
been taken, so the two paths are safe together.

## Verification after the fixes

```
$ pnpm test
 ✓ src/api/backend.test.ts (5 tests) 15ms
 ✓ src/store/jobs.test.ts (2 tests) 2ms
 Test Files  2 passed (2)
      Tests  7 passed (7)

$ pnpm lint
> eslint src && prettier --check src
Checking formatting...
All matched files use Prettier code style!

$ pnpm build
> tsc -b && vite build
dist/assets/core-BEOw45JP.js     0.20 kB
dist/assets/event-lmqrH_TB.js    1.15 kB      (the new @tauri-apps/api/event chunk)
dist/assets/index-DGFJo_Tf.js  233.46 kB
✓ built in 904ms

$ pnpm e2e
Running 1 test using 1 worker
  ✓  1 e2e\boot.spec.ts:3:1 › boots against the mock server and lists projects (838ms)
  1 passed (4.6s)

$ cargo build            # placeholder sidecar temporarily in place, as before
   Compiling machinery-app v0.1.0 (…\frontend\src-tauri)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 6.78s

$ cargo fmt --check      # clean, no output
```

`pnpm tauri dev` was run once more in env mode (mock on 4010, `APP_BACKEND_URL` /`APP_BACKEND_TOKEN`
set) to confirm the new `.build(...).run(...)` lifecycle still boots: the window opened, the Projects
screen showed "Ahmadia" (screenshot refreshed at `task-9-tauri-dev.png`), and closing the window left
no `machinery-app` process. The mock I started was stopped by PID; no listeners remain on 1420 or 4010,
and ports 8080/9090 were never touched. The throwaway sidecar placeholders
(`binaries/machinery-backend-x86_64-pc-windows-msvc.exe`, `binaries/_internal/`) were recreated for the
build and deleted again; neither is committed.

## Still open (unchanged from the first report)

The crash path itself (`CommandEvent::Terminated` → `backend-terminated` → dialog) could only be
reasoned through, not exercised: there is no real sidecar to kill on this branch. It needs one run
after the backend merges — kill `machinery-backend.exe` from Task Manager and check the dialog appears.
