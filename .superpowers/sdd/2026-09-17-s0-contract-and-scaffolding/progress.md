# SDD ledger — plan: docs/superpowers/plans/2026-09-17-s0-contract-and-scaffolding.md

Spec: docs/superpowers/specs/2026-09-17-machinery-detection-app-design.md (reachable).

## Pre-flight scan

| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T2 contract vs T3 client | T3 wraps generated `paths`; T2 paths now carry `/api/v1` prefix (Prism 5 ignores server base paths) | Ruling: paths in openapi.yaml include `/api/v1`; `createApiClient` uses the bare origin. Plan Task 3 text (`${baseUrl}/api/v1`) superseded. Cost if wrong: one-line client change. |
| T2 contract vs T7 conformance | T7 test prefixes "/api/v1" + p | Ruling: T7 compares spec paths directly (no prefix add). |
| T4 main.py vs T6 runner | `JobRunner(events)` / `start()` `stop()` sync | Consistent. |
| T4 api.py vs T5/T7 routers | imports 6 routers; T4 stubs them as empty routers until T5/T7 | Consistent (T4 step 5 says so). |
| T5 ProjectHandle vs T6 JobContext | `project.session()`, `runs_dir` | Consistent. |
| T3 client vs T8 frontend | `createApiClient`, `eventsUrl`, `Health`, `AppEvent`, `Job` types | Consistent; client also exports `imageFileUrl`, `thumbnailUrl` (extra). |
| T8 frontend vs T9 tauri | `invoke("backend_info")` returns `{base_url, token}`; `restart_backend` | Consistent. |
| T9 tauri vs T4 backend | env `APP_PORT`, `APP_TOKEN`, `APP_DATA_DIR`; stdout JSON `{"event":"starting"}` | Consistent. |
| T2 Health schema vs T4 health.py | `{status, version, pid, started_at}` | Consistent. |
| T5 Project schema | contract `Project` requires `folder`, `preannotation_model_id`, `import_defaults` | T5 ProjectOut must include all; noted for my implementation. |
| T8 e2e vs T2 example | e2e looks for "Ahmadia" | Project example is "Ahmadia". |
| Each task self-consistency | tests vs code | T4 xfail note covers ordering; T6 sketch imports unused `select` (noted in plan). |

Ruling: Tasks 2-7 (contract, backend) are implemented by the goal owner directly (spec 13.3: goal owner implements or closely directs S0). Tasks 8-9 go to one sub-agent in worktree `.worktrees/s0-frontend` on branch `s0-frontend`; Task 10-12 by goal owner. Cost if wrong: none structural.
Ruling: explicit `git worktree add` under `.worktrees/` instead of the harness `isolation: worktree` so branch and path are recorded in docs/progress.md. Cost if wrong: manual cleanup.

## Progress

Task 1: complete (commit c5b5722, skeleton; reviewed by goal owner)
Task 2: complete (commit 4d71fcd; mock verified: 200 with token, 401 without, query token ok, 201/422 on POST)
Task 3: complete (commit 4d71fcd, client generated + wrapper)
Task 4: complete (commit 715e772, goal owner; 6 tests)
Task 5: complete (commit f74ba9a, goal owner; 23 tests)
Task 6: complete (commit ebe00de, goal owner; 36 tests)
Task 8+9: implemented by sub-agent on s0-frontend (be0b87c, 845e149); review (fable): spec ✅, quality Needs fixes.
  Important: unguarded awaits in ProjectsScreen/Shell. Important (plan gap): runtime sidecar death not detected (spec 11).
  Ruling: spec 11 is binding; runtime death detection (Tauri event `backend-terminated` + failure dialog) added to fix round 1 rather than a separate task. Cost if wrong: one extra review round.
  Minor (deferred): setup() expect on sidecar start failure; eprintln lost in windows_subsystem release; free_port unwrap; no abort for waitForHealth in StrictMode; WebSocket ctor throw; ACTIVE duplicated in Shell; envPrefix APP_ can inline APP_TOKEN at build (doc note); csp null in tauri.conf.json; clipboard result discarded; no tests for waitForHealth/backoff; mock-mode events reconnect spam in diagnostics buffer.
  Task 8+9: fix round 1/5 dispatched (findings 1, 2 + RunEvent::Exit minor).
Task 7: complete (commit 88c7160, goal owner; 49 contract tests; findings fixed along the way: 405 Allow header dropped, naive datetimes from SQLite -> UTCDateTime type, extra=forbid on ProjectUpdate removed)
  Ruling: schemathesis checks negative_data_rejection, unsupported_method, allow_header_conformance excluded (FastAPI ignores unknown query params; /projects/open shares a prefix with /projects/{id}). 501 stubs validated on schema/content-type/status only. Cost if wrong: weaker negative testing; revisit when stubs are gone.
Task 10: complete (commit ba8728c, goal owner; dev.ps1, ci.yml, uvicorn ws=auto after deprecation warning in smoke run)
Backend branch s0-backend (715e772..ba8728c): review dispatched (fable).
Task 4-7 fix: absolute folder validation (commit fb2e4d9); junk dirs from generated relative folders removed
Task 8+9: fix round 1/5 (3 addressed, 0 open; commits 845e149..b6928e3)
  Minor (deferred) from re-review: listener IIFE in client.tsx lacks .catch; effect depends on [info] so restart re-subscribes with a short unsubscribed window (use [info?.mode]); reader task exits silently if channel closes without Terminated; failed restart leaves BackendState None until next Restart; CommandChild::kill only kills the direct child (PyInstaller helpers may orphan); failure dialog lacks the log path (deferred to S5); no component test for listen->dialog wiring.
Task 8+9: complete (commits f348f1e..b6928e3, review clean after round 1)
Backend review (fable): spec ❌ (3 Important: recent order reversed by list; folder unnormalised; CI torch override ineffective), many minors.
Backend fix round 1/5 (goal owner, commits ba8728c..HEAD): Importants fixed with new tests (order stable across listings/restarts; folder resolve + lock; --override ci-overrides-cpu.txt). Minors fixed: compare_digest bytes; cursor key validation -> 422; env.py sys.path guard; unhandled-error log.exception; logging handler replacement; queued jobs' handlers closed at stop; terminal job update guarded + app-log mirror; appdata validation + atomic write; dev.ps1 token via env; test_jobs stop test made decisive; dead import removed; EXPECTED_STUBS set; assert <500 for real endpoints.
  Ruling: `session=client` minor not applicable (Starlette 1.6 TestClient is httpx-based, schemathesis needs requests); kept per-call ASGI client. Ruling: generated `cursor` query values are stripped in the contract test (opaque cursors; 422 on garbage is by design and unit-tested). Cost if wrong: contract test does not exercise cursor negatives.
  Deferred minors: GET /projects ignores limit/cursor (bounded by MAX_RECENT=20); listing opens engines/migrations for up to 20 projects on GET; internal_error message echoes exception text (traceback goes to log); _free_port/uvicorn TOCTOU; forget() unused.
Backend fix round 1/5 re-review (opus): 15/16 addressed; finding 3 (CI torch) NOT addressed (index flags removed; override alone matches +cu130).
Backend fix round 2/5 (goal owner, commit ed81442): CI line = --index-url cpu + --extra-index-url pypi + --override; verified with uv pip compile -> torch==2.14.0, torchvision==0.29.0. Also: stop() per-context try/except/finally; app log no longer prints job params (secrets); close_all under lock; unique temp name in AppData._write; invalid escape in test fixed.
  Deferred minors: test_stub_list_matches_routers only guards one direction (rename/strengthen later); configure_logging replaces the file handler when data_dir changes (one app per process in production); _finish leaves a row 'running' if the terminal write fails (needs an orphan sweep at startup, follow-up for S3/S6); read_settings not hardened; unwritable folder -> 500; submit after stop -> AttributeError; per-job loggers never released from the logging manager.
Backend fix round 2/5 re-review (sonnet): 6/6 addressed. Backend complete (commits 715e772..ed81442, review clean after round 2).
Merged to main: s0-backend (ff) + s0-frontend (cb2d354). main verification: backend 91 passed + ruff clean; contract pnpm check clean; frontend lint/7 tests/build/e2e clean.
Checkpoint 1 attempt 1 (main cb2d354): real app booted the sidecar, but the webview's CORS preflight (OPTIONS with Authorization) got 405 -> splash never cleared. Prism had masked this. Fixed test-first in 42675ca/389687c: CORSMiddleware restricted to tauri.localhost (http/https) and 127.0.0.1/localhost:1420; 97 backend tests. Ruling: CORS origin allow-list is configuration (Settings.cors_origins), not a contract change. Cost if wrong: none for the API shape.
Also: build.ps1 tolerates PyInstaller stderr under PowerShell 5.1; frontend/scripts/checkpoint1.mjs drives the real WebView2 over CDP (WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222).
