---
type: session
date: 2026-10-03-1705
branch: task/overlay-smooth
trigger: wrapup
status: complete
tags: [session]
related: []
---

# 2026-10-03-1705-scan-overlay-smooth

## What changed

- **Scan overlay draw.** On `task/overlay-smooth` (`1ce7ad64`, pushed to `origin/task/overlay-smooth`), the asset-model viewer no longer draws the whole scan on every orbit frame.
  - `frontend/src/assetmodels/viewer/renderLoop.ts` keeps one paint in flight. Orbit damping asks for another frame from inside the frame that is already running; that used to queue a second paint.
  - `frontend/src/assetmodels/viewer/overlayBudget.ts` bins the scan (up to 300,000 points) and draws at most 32,000 points from the cells in front of the camera. `engine.ts` uses that buffer. `AssetModelWorkspace.tsx` notes the fetch is still the full buffer.
  - Tests: `renderLoop.test.ts` (4), `overlayBudget.test.ts` (5, including a 300,000-point gather), `engine.test.ts` (3), `ModelViewer.test.tsx` (7), then `AssetModelWorkspace.test.tsx` (30) on the first run. After the overlay was set to refresh whenever the visible cells change, the viewer files were re-run: 19 passed. eslint was clean on the touched files. The full frontend, backend, contract and e2e gates were not run.
- **Installer, not installed.** Release `kestrel-ai.exe` built in the worktree at 15:28 (12,573,184 bytes). The first `pnpm build:installer` stopped because Kestrel AI was open, after the exe existed. A second run with `-SkipTauriBuild` passed the packaged-webview check (`webview ok`) and wrote `frontend/src-tauri/target/release/bundle/inno/Kestrel AI_0.1.0_x64-setup.exe` (1,983,709,653 bytes, 15:39). The install command was aborted before the setup process started. The installed `kestrel-ai.exe` is still the 11:28 copy (12,570,112 bytes). The operator then said not to install, because other edges are running.
- Not merged to `main`.

## Why

Showing the scan overlay made rotation and scrolling choppy. The view was painting up to 300,000 point sprites, and often painting them twice per frame while the camera was damping.

## Open threads

- **Not installed and not on `main`.** The running app (started 15:51 from `%LOCALAPPDATA%\Programs\Kestrel AI`) does not have this fix. Install only after the other edges are finished and Kestrel AI is closed.
- **Not operator-checked.** No one has orbited a real scan with the overlay on in this build.
- **Full gate not run** for `1ce7ad64`.
- The 32,000-point budget is a judgment. Zoomed-out it is a sample of the whole scan; zoomed-in it spends the budget on the cells in frame. If the overlay looks too thin, raise `OVERLAY_BUDGET` in `overlayBudget.ts`.

## How to test

1. Close Kestrel AI. Run `E:\Dev\Yolo\app\.claude\worktrees\overlay-smooth\frontend\src-tauri\target\release\bundle\inno\Kestrel AI_0.1.0_x64-setup.exe`.
2. Open a project, go to Asset models, and open a model whose version was compared with a scan.
3. Turn on **Show scan overlay**. Rotate and scroll the model.
4. Expected: the overlay stays on the model and the motion stays smooth. Zoom in on one part: the dots should tighten up on that part rather than staying a thin dusting of the whole asset.

## Next session entry point

- Merge `task/overlay-smooth` (`1ce7ad64`) when the other edges allow it, then install the setup exe above and run the four steps in How to test. Do not rebuild first; the installer is already written.
