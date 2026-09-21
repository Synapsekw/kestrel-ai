# Kestrel A identity — 2026-09-21

The operator selected A / Kestrel and explicitly requested implementation plus rebuilding the
desktop app. The source master refines the approved hovering bird into flat SVG geometry: swept
wings, central head, two separated lower feather forms and a diamond tail. One local master feeds
the in-app Brand and native icon assets. Contour amber/charcoal and Instrument Sans remain intact.

## Scope and source

Base: `d5a63f6`, isolated branch `task/kestrel-logo-a`. Application workflows, API and backend source
are unchanged. The separately tracked project-settings layout issue is outside this logo change.

## Verification recorded so far

- Contract check and Ruff passed; no generated-client or backend diff.
- Fresh backend freeze passed: 210s, 3,522.9 MiB / 14,161 files.
- Frozen smoke passed in 23.01s: RTX 5070 Ti CUDA, three starter models, three-image import,
  prediction, worker training and 10.1 MiB ONNX export. Stored provider key was left untouched.
- Backend gate: 620 passed, 9 deselected in 191.29s. Only one backend training/test workload at a time.
- Native-resource verification has a demonstrated red: the old installed app/setup icons extract
  successfully at 16px/32px, but fail the required Contour amber check. The extraction helper initially
  assumed one returned icon; Windows returns two for large + small, so this harness issue was corrected
  before recording the expected identity failure.

`verify-installed.cjs` checks the installed UI against its owned, real bundled backend using a
disposable three-image project. It verifies the new local bird in both compact and expanded branding,
plus startup, drawing/save/undo/redo, responsive editor, Jobs, and clean shutdown. Tokens stay in
memory and never enter evidence. The test project is forgotten at the end; scratch files remain
outside the temporary worktree. First-after-install timings do not imply a flushed Windows file cache.

`extract-native-icons.ps1` reads actual PE icon resources from the installed app and setup executable.
`verify-native-icons.py` checks both native sizes, required colors, transparency and exact equality
between the app and installer icon bitmaps. These checks supplement visual inspection of the bird.

## Operator walkthrough

1. Open Kestrel AI from Start. Its window/taskbar and Start shortcut should show the amber bird icon.
2. Look at the sidebar, then expand it. The same bird should appear beside Kestrel AI; it is also
   shared by the startup screen.
3. Inspect the saved installer in Explorer: it should show the same bird icon. The installed app
   should retain its normal project and annotation behavior.
