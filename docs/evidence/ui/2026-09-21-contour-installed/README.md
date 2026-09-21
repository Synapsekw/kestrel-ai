# Contour installed desktop verification — 2026-09-21

## Source and scope

Rebuilt from `54b5e299df2ba89b9c813ce0aef1d66fe7c40773` in the isolated
`task/contour-desktop` worktree. No application source changes.

Verified application trees:

- frontend: `7c39c53e18460b06a4842bcf9726d65e8339720f`
- backend: `26c48e057c2a88481b980ed79bfad2dbd083da1d`
- contract: `81a59245ed5f8bfc4e9e48ca7da33564f14097f9`

The same source passed contract check, Ruff, 620 pytest (9 deselected), frontend lint,
517 Vitest and 57 Playwright checks in the preceding Contour block. Those source gates are
reused here because the three trees are unchanged. See the sibling `2026-09-21-contour/README.md`.
This block adds fresh packaging and installed-app checks; it is not a full eight-step provider
acceptance rerun.

## Fresh backend freeze and smoke

`backend/scripts/build.ps1 -Venv E:\Dev\Yolo\app\backend\.venv` succeeded in 285 seconds.
Payload: 3,522.9 MiB, 14,161 files. Optional-library PyInstaller warnings did not prevent the
subsequent execution checks.

`backend/scripts/smoke_frozen.ps1 -WorkDir E:\Dev\Yolo\app\dist\contour-verification-20260921\frozen -Frames 3 -Imgsz 640`
passed in 31.84 seconds:

- API health and CUDA on NVIDIA GeForce RTX 5070 Ti.
- All three bundled starter models available.
- Three sample photographs imported; starter alias mapping correct.
- Local prediction completed (zero detections at the smoke threshold; this is a runtime check).
- One training epoch in the frozen worker completed, including DataLoader multiprocessing.
- Worker font seeded; ONNX export produced a 10.1 MiB model.
- Credential write/delete test skipped because an operator key already exists; it was untouched.

Scratch artifacts are retained under the explicit work directory, outside the temporary worktree.

## Native build and installer

- Rust: 8 tests passed, 0 failed, with the fresh frozen sidecar present.
- TypeScript/Vite production build passed (332 modules, 2.28 seconds). Existing large-chunk warning.
- Optimized Tauri release build passed in 1 minute 19 seconds.
- Inno Setup compile passed in 360.672 seconds; build-plus-packaging took 451 seconds.
- Installer retained at `E:\Dev\Yolo\app\dist\Kestrel AI_0.1.0_Contour_2026-09-21_x64-setup.exe`
  (1,943,847,943 bytes, 1,853.8 MiB).
- SHA-256 identities for the installer and both executables are in `package.json`.
- This installer uses the WebView2 runtime already installed on this Windows machine. No WebView2
  bootstrapper was available for bundling; installation on a machine without that runtime is not
  covered by this result.

## Installed verification procedure

`verify.cjs` exercises the actual installed release executable through its WebView2 debugging
connection. It uses the real bundled backend, a new disposable project, and exactly three copied
sample photographs. It removes that project from Recent projects after the run and retains files
in the scratch directory. Existing projects and provider settings are not edited.

Runtime authentication is held only in memory; no tokens are included in the evidence. Screenshots
show the disposable project. Startup timing is first launch after installation and warm launch,
without flushing the Windows file cache.

## Installed results

Silent per-user installation exited 0. The installed `kestrel-ai.exe` and `kestrel-backend.exe`
SHA-256 hashes exactly match the fresh build recorded in `package.json`.

`verify.cjs` passed all 13 recorded checks; `verification.json` contains the measurements:

- First launch: Projects 3,097 ms, API health 3,118 ms, CUDA probe 7,627 ms.
- Warm launch: Projects 1,948 ms, API health 1,956 ms, CUDA probe 4,327 ms.
- Project creation, eight default classes and three-image background import.
- Real 1024px Home hero, 140ms hover, keyboard focus and reduced-motion override.
- Collapsed 82px navigation, expansion and image-grid navigation.
- Class hotkey, drawing, saved annotation after reload, undo and redo against the real backend.
- At an emulated 1024×768 WebView viewport, the canvas is 632×611 and shortcut help stays inside it.
- Jobs drawer, project-settings route, and no JavaScript page errors.
- Both window-close checks stopped the owned app and backend processes.
- Test project forgotten after verification; its files remain in the named scratch directory.

Six native WebView screenshots were inspected: Home, Images with expanded navigation, Label,
laptop shortcuts, Jobs, and project settings. This did reveal one **pre-existing visual issue**:
class-name inputs in project settings are squeezed beside the hotkey dropdowns. It is also visible
in the earlier source capture `../2026-09-21-contour/10-settings.png`; the settings component has not
changed since the Site office restyle. Record it as a follow-up rather than claiming flawless
settings layout or changing the approved application source during this packaging-only block.

## Operator walkthrough

1. Open Kestrel AI and select your project. Home should show Contour's charcoal/amber interface.
2. Expand the left navigation, open Images, then open an image. The editor should have one inspector
   on the right, with class selection, review controls and regions together.
3. Hover or keyboard-focus controls, open Keyboard shortcuts, and try Fit and Undo/Redo on a test
   annotation. Changes should save normally.
