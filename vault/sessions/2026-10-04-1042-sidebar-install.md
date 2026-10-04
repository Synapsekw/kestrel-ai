---
type: session
date: 2026-10-04-1042
branch: main
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-10-03-1803-sidebar-project-tree]]", "[[2026-10-03-sidebar-replaces-rail-and-tabs]]"]
---

# 2026-10-04-1042-sidebar-install

## What changed

- **Installer built from `main` at `bdff5806` and installed** (no code change in this block). By then `main` had moved past the sidebar wrapup (`07a6848c`): other sessions had merged the G1 plant model (pm-f0..pm-r1, including Site 3D), asset findings (af-j1..j4, u5, u6) and delete-project-data. The sidebar merge `056175f3` is included.
  - Steps:
    - `backend\scripts\fetch_starter_weights.ps1`
    - `backend\scripts\build.ps1`: a fresh freeze, needed because backend code changed since the `914c4d5b` sidecar
    - `backend\scripts\smoke_frozen.ps1`
    - `pnpm -C frontend build:installer`: 856 s, 1,893 MB, no WebView2 bootstrapper
  - Smoke lines:
    - `health ok`
    - `cuda True NVIDIA GeForce RTX 5070 Ti`
    - `starter ok 3`
    - `predict ok 0 boxes cuda`
    - `worker ok mAP50 0.0`
    - `font ok`
    - `drawings ok 200x100 2`
    - `asset-models ok 576 12092`
    - `reports ok …`, `report ok v1 8 pages pdf xlsx`
    - `keyring skip`: a key was already stored and was not touched
  - The app window was already closed. Three orphaned `kestrel-backend.exe` from the old install (started 2026-10-03 11:37, 13:51 and 15:51) were stopped with the operator's OK. Then `Kestrel AI_0.1.0_x64-setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART` exited 0. `kestrel-ai.exe` is dated 09:12 and `kestrel-backend.exe` 09:07.
  - Launch check: the UI started and one backend was listening on 127.0.0.1.
- `1224b2ba`: north star marks the build as installed. It records the operator's answer that the top bar stays page-only on collapsed canvases ("it's ok").
- **Operator acceptance:** "Side bar is working properly" (2026-10-04, on the installed `bdff5806` build).

## Why

- The operator asked to build and install from `main` so they could try the new sidebar. They then confirmed it works.

## Open threads

- Not pushed: `main` is ahead of `origin/main`.
- The sidebar's §5 minors in the north star are still open: route-driven width animation, the unannounced live dot, scroll on short windows, and no e2e for Images opening collapsed.
- The Images/report-builder collapse ruling was accepted implicitly; the operator was satisfied with the behaviour as installed.
- The other features in this build (Site 3D, the plant model, asset findings, delete data) were verified only by their own sessions' gates and this block's frozen smoke. Their walkthroughs belong to those sessions' notes.

## How to test

- Not user-observable beyond the sidebar walkthrough in [[2026-10-03-1803-sidebar-project-tree]], which the operator has already run on this build.

## Next session entry point

- Push `main` when the operator wants it on GitHub. Otherwise, pick up the sidebar minors in north star §5, or the other sessions' walkthroughs on this installed build.
