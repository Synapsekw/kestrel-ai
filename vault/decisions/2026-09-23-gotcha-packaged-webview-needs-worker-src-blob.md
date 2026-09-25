---
type: decision
date: 2026-09-23
status: accepted
tags: [adr, gotcha, csp, webview2, pointclouds, packaging]
related: ["[[2026-09-23-point-clouds-design]]", "[[2026-09-20-gotcha-tauri-capability-allowlist-is-runtime]]"]
---

# The packaged webview needs `worker-src blob:` (and dev hides it)

**Trap.** potree-core 2.0.15 decodes octree nodes in inline workers it creates from `blob:` URLs.
The app's CSP (`default-src 'self'`) has no `worker-src`. At build time Tauri adds its own
`script-src 'self' 'sha256-…'` (hashes of its injected scripts) to the packaged CSP, and a missing
`worker-src` falls back to that `script-src` (measured below: "Note that 'worker-src' was not
explicitly set, so 'script-src' is used as a fallback"), which has no `blob:`, so the packaged
WebView2 refuses the worker. Nothing errors in the UI: the viewer stays blank, `nodesLoading` is
stuck at 1, and the violation is only in the console. `pnpm dev` and `tauri dev` render fine with
the old CSP, because the dev server's page is not under the packaged CSP. So every test outside
the packaged exe passes.

**Decision.** `tauri.conf.json` gains exactly one directive, `worker-src blob:`. No
`'unsafe-eval'`, no `'wasm-unsafe-eval'`, no new origins (`src/app/csp.test.ts` pins that).

**Three neighbours of the same trap.**

- The loader sends `Range` and `content-type: multipart/byteranges`, which makes every octree
  request a CORS preflight. The backend's `CORSMiddleware` allows `Range` and exposes
  `Content-Range`, `Accept-Ranges` and `Content-Length` (F0; `tests/test_cors.py`).
- Colours need `inputColorEncoding = outputColorEncoding = 1`, or every RGB point renders pure
  white (`makeMaterialOptions()`, pinned by a unit test).
- The URL passed to `loadPointCloud` must end in `metadata.json`: potree-core picks its Potree 2
  loader with `endsWith("metadata.json")`, so the token goes on through `RequestManager.getUrl`.

**The permanent guard.** `frontend/scripts/check-packaged-webview.{ps1,mjs}` (`pnpm check:webview`)
starts the frozen backend, imports a red/green fixture, launches the release exe over CDP, and
fails unless points render with both colours, no CSP line appears, no octree request fails, and a
centre pick lands inside the cloud. `build-installer.ps1` runs it before Inno Setup: a blank viewer
means no installer.

**Negative proof** (Task 18 Step 6, 2026-09-25, release build of `task/point-clouds-t18`):

- without `worker-src blob:`: `webview FAIL CSP: Creating a worker from 'blob:http://tauri.localhost/0643904b-d4af-4bf5-8cf3-7061d0fdd9c7' violates the following Content Security Policy directive: "script-src 'self' 'sha256-fEzsMICZLU12SBc0vwyzg2numSrGgz7fbPwWRCyXcFA=' … 'sha256-ZTYJOSGuAVt5FElkveDQCfsszFn9NY51xH15FriSpB8='". Note that 'worker-src' was not explicitly set, so 'script-src' is used as a fallback. The action has been blocked.` (8 hashes; the middle 6 elided here), then `the packaged-webview check failed (driver exit 1)`, exit 1
- `build:installer -SkipTauriBuild` on that build: `the packaged-webview check failed; no installer was built (the reason is above)`, exit 1, and no `src-tauri\target\release\bundle\inno` folder was created
- with it: `webview ok points=49723 red=0.108 green=0.109`, exit 0
