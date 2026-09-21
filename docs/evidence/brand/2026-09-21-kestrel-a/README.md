# Kestrel A identity — 2026-09-21

The operator selected A / Kestrel and explicitly requested implementation plus rebuilding the
desktop app. The source master refines the approved hovering bird into flat SVG geometry: swept
wings, central head, two separated lower feather forms and a diamond tail. One local master feeds
the in-app Brand and native icon assets. Contour amber/charcoal and Instrument Sans remain intact.

## Scope and source

Base: `d5a63f6`, isolated branch `task/kestrel-logo-a`. Application workflows, API and backend source
are unchanged. The separately tracked project-settings layout issue is outside this logo change.

## Verification

- Contract check and Ruff passed; no generated-client or backend diff.
- Fresh backend freeze passed: 210s, 3,522.9 MiB / 14,161 files.
- Frozen smoke passed in 23.01s: RTX 5070 Ti CUDA, three starter models, three-image import,
  prediction, worker training and 10.1 MiB ONNX export. Stored provider key was left untouched.
- Backend gate: 620 passed, 9 deselected in 191.29s. Only one backend training/test workload at a time.
- Frontend lint passed; 517 tests across 122 files passed in 44.04s. Production Vite build passed.
- Rust gate passed: 8 tests, with the fresh frozen sidecar present.
- All 17 native assets passed the source/output integrity check. Two consecutive generations produced
  the same manifest after normalizing ICNS chunk order. Task review and whole-branch source review
  found no issues. The small-raster verification adjustment also passed scoped review.
- Native-resource verification has a demonstrated red: the old installed app/setup icons extract
  successfully at 16px/32px, but fail the required Contour amber check. The extraction helper initially
  assumed one returned icon; Windows returns two for large + small, so this harness issue was corrected
  before recording the expected identity failure.
- Release and Inno installer passed in 457s (367.5s compression), 1,943,847,304 bytes / 1,853.8 MiB.
  Installation exited 0; both installed executable SHA-256 values exactly match the build.
- Actual installed app versus the distinct saved installer: extracted 16px and 32px resources match
  exactly and pass amber/charcoal/transparency checks. Both sizes were visually inspected. The 16px
  check allows normal antialiasing near charcoal and at the transparent corner; old resources still fail.
- Installed WebView2 walkthrough: **15 checks passed**, no page errors or cleanup errors. First launch
  reached Projects in **3.053s**, warm in **2.459s**; owned sidecar health/CUDA and clean shutdown passed.
  Compact/expanded bird loading and accessible product text passed; all six native captures were inspected.
  The startup screen shares the reviewed `Brand` component; its transient frame is not a separate capture.
- Start menu shortcut and uninstall display icon resolve to the updated app. Windows received an icon
  refresh notification. The installed app was reopened normally for the operator after verification.

Installer: `dist/Kestrel AI_0.1.0_Kestrel-A_2026-09-21_x64-setup.exe` (retained outside the task worktree).
Application source: `89a63a2`. `package.json` records full build/installed hashes; `verification.json`
records the walkthrough and timings; `windows-surfaces.json` records shortcut/uninstall references.
The installer uses this machine's existing WebView2 runtime; no bootstrapper was bundled. This focused
identity verification does not claim the separately owed full cloud-provider acceptance run passed.

`verify-installed.cjs` checks the installed UI against its owned, real bundled backend using a
disposable three-image project. It verifies the new local bird in both compact and expanded branding,
plus startup, drawing/save/undo/redo, responsive editor, Jobs, and clean shutdown. Tokens stay in
memory and never enter evidence. The test project is forgotten at the end; scratch files remain
outside the temporary worktree. First-after-install timings do not imply a flushed Windows file cache.

`extract-native-icons.ps1` reads actual PE icon resources from the installed app and setup executable.
`verify-native-icons.py` checks both native sizes, required colors, transparency and exact equality
between the app and installer icon bitmaps. These checks supplement visual inspection of the bird.

## Decisions carried from the working ledger

- The explicit request to implement/rebuild, together with AGENTS.md, covers routine local installation
  and merge/push. No repeated approval was requested. A mistaken interpretation would require reverting
  the source and reinstalling the prior retained installer.
- Freshness and actual image loading are checked instead of freezing SVG path strings in a test.
  Visual review covers the silhouette; a missed visual defect would require another asset generation.
- The production SVG is a vector refinement of A, not an edit of the concept-board raster. The approved
  spread wings and diamond tail are preserved; a refinement the operator dislikes can be revised in
  the single master and regenerated consistently.

## Operator walkthrough

1. Open Kestrel AI from Start. Its window/taskbar and Start shortcut should show the amber bird icon.
2. Look at the sidebar, then expand it. The same bird should appear beside Kestrel AI; it is also
   shared by the startup screen.
3. Inspect the saved installer in Explorer: it should show the same bird icon. The installed app
   should retain its normal project and annotation behavior.
