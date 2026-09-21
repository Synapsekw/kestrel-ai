---
type: session
date: 2026-09-21-2003
branch: main
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-09-21-gotcha-measuring-animated-drawers]]"]
---

# Setup agent desktop rebuilt and installed

## What changed

- The operator requested rebuilding the app after the setup agent/catalog feature. Built unchanged application source `75aa11b` in `task/setup-agent-desktop`; no behavior or dependency changes.
- `5bd2e40` adds the bounded rebuild plan and installed verification driver. `f15f89b` records successful packaging/installation, four native screenshots, hashes, frozen/Rust results and complete native verification. Both commits merged/pushed to main; owned worktree and branch removed. Shared Python environment preserved; unrelated `task/ci-green` workspace left alone.
- Fresh backend freeze: 204s, 3,522.9 MiB, 14,161 files. Frozen CUDA/import/predict/one-epoch training/ONNX smoke passed in 23.13s. Existing Anthropic key detected and untouched. Rust: 8 tests passed.
- Native/Inno build passed in 427s (367.812s compression). Installer: `dist/Kestrel AI_0.1.0_Setup-agent_2026-09-21_x64-setup.exe`, 1,943,889,030 bytes. Installation exited 0, no reboot; installed app and sidecar hashes match the build.
- Installed WebView2: 16 checks passed. Both stored GPT/Claude providers report ready; drawer close/reopen/focus/navigation and compact layout work; all 44 models appear across eight families. Real YOLO26 nano downloaded, registered 80 COCO classes, predicted successfully, and was reused from cache on rerun. Zero proposals on the smoke sample is not an accuracy claim.
- Initial compact-layout assertion measured the entrance animation. Diagnostics proved right=1040.577 mid-animation versus right=1024 at completion; the driver now awaits the actual animation. No app change or second installer was needed. Independent driver/final evidence review approved.
- First installed startup reached Projects in 3.052s, final verification in 1.966s, warm in 2.443s. No page or cleanup errors. Disposable projects forgotten; app/owned sidecars closed cleanly. Reopened normally for the operator at PID 48328, title Kestrel AI.
- Exact backend/frontend/contract trees match the preceding source gate: contract/Ruff, 666 backend, frontend lint/533 unit/build, 59 browser tests. These results carry forward; fresh packaging/native checks above cover the rebuilt binaries.

## Why

The setup feature previously existed only in verified source. This rebuild puts it and the expanded YOLO catalog into the operator's installed Windows application.

## Open threads

- No remaining work for this rebuild. The retained installer uses the existing WebView2 runtime; no bootstrapper was available to bundle.
- No paid provider calls were made. The broader live-provider acceptance backlog remains open, including a live setup conversation/first-labeling check on operator-selected images.
- Project-settings layout, folder rename, rotated-box training and older friction-list items remain separately owed.

## How to test

1. In the open Kestrel AI app, select **Setup agent** in the header. GPT and Claude should show the existing stored-key readiness.
2. Describe a detector, review its classes/model/folder and create a project. Import images, choose a first batch, estimate, start labeling and review suggestions.
3. Open **Models**, choose a family and size, and select **Download and add**. YOLO26 nano is now cached from the verified download.

## Next session entry point

`docs/evidence/setup-agent-desktop/README.md` contains the installed evidence and reproducible driver. The application is installed and open. The next source UX item remains cramped class-name fields in `frontend/src/settings/ClassesSection.tsx`.
