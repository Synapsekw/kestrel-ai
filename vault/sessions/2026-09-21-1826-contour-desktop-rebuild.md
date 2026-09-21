---
type: session
date: 2026-09-21-1826
branch: main
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-09-21-1753-contour-ui]]"]
---

# Contour desktop rebuild

## What changed

- `5555557` adds the rebuild plan, installed verification driver, package hashes, measured results,
  six native screenshots and a progress-ledger entry. It is merged and pushed to main.
- Rebuilt unchanged application source at `54b5e29` in `task/contour-desktop`. Fresh PyInstaller
  bundle: 285s, 3,522.9 MiB. Rust: 8 passed. Tauri release + Inno packaging: 451s, 1,853.8 MiB installer.
- Installed over the per-user Kestrel AI app. Installer exit 0; installed app/backend hashes match
  the build. Retained installer: `E:\Dev\Yolo\app\dist\Kestrel AI_0.1.0_Contour_2026-09-21_x64-setup.exe`.
- Frozen GPU smoke passed in 31.84s: RTX 5070 Ti, three starters, prediction, training worker and
  ONNX export. Stored provider key detected and left untouched; no cloud requests made.
- Installed UI/lifecycle driver passed 13 checks. First Projects screen 3.097s, warm 1.948s.
  Drawing, persistence after reload, undo/redo, class hotkey, navigation, hover/focus/reduced motion,
  compact viewport, Jobs/settings navigation and sidecar shutdown passed. Test project forgotten.
- The previous block's 620 backend, 517 frontend and 57 browser tests plus lint/contract checks
  apply to identical application tree hashes; this block adds packaging/native checks rather than
  claiming a new full source-suite run. Native app is open for the operator.
- Worktree removed and deregistered; task branch deleted. Shared Python environment verified after
  cleanup: torch 2.14.0+cu130, CUDA available. Only main remains registered.

## Why

The operator explicitly requested rebuilding the desktop app after selecting and shipping Contour.
The older installed executable could not display the new interface. This closes that delivery gap
with evidence from the installed Windows application instead of a development browser.

## Open threads

- Visual inspection caught an existing project-settings layout issue: class-name fields are
  squeezed beside wide hotkey selectors. Present in the earlier source screenshot too; logged
  in the north star for a focused fix. This packaging block does not change application source.
- Full eight-step cloud-provider acceptance remains stale; these installed UI checks do not replace it.
- Existing folder rename, OBB wave 2 and other deferred items remain unchanged.

## How to test

1. Open Kestrel AI and select a project. Home should have the charcoal/amber Contour interface.
2. Expand the left navigation, open Images, and open an image. Drawing classes, review controls
   and regions should share one inspector on the right.
3. On a test annotation, try drawing, Undo/Redo, Fit and Keyboard shortcuts. Resize the window
   and check the canvas remains usable. Open Jobs to inspect background work.

## Next session entry point

- `docs/evidence/ui/2026-09-21-contour-installed/README.md` and `verification.json` hold the actual
  installed results and limits. Start a focused settings-layout fix from the new north-star owed item.
