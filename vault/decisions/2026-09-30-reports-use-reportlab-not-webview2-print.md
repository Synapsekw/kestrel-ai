---
type: adr
date: 2026-09-30
status: accepted
tags: [decision, reports, pdf, packaging]
related: ["[[2026-09-26-reports-design]]", "[[2026-09-30-fonts-in-the-frozen-sidecar]]", "[[2026-09-26-gotcha-swiftshader-compositing]]", "[[2026-09-18-gotcha-inno-setup-because-nsis-and-msi-cap-at-2gb]]"]
---

# Reports render with reportlab in the sidecar, not WebView2 print

## Context

A report could be printed from the React preview (WebView2 `PrintToPdf`, or a headless Chromium),
which would make preview and PDF pixel-identical. Spec 2026-09-26-reports §5 compared four options.

## Decision

The PDF is rendered by reportlab platypus inside the `report_render` job in the Python sidecar. The
backend composes one `ReportDocument` (typed blocks); the React preview and the reportlab renderer
both render that document, so content cannot drift, only layout.

- Tauri 2 exposes no print-to-PDF; WebView2 printing needs `webview2-com` in the Rust shell and a
  hidden window alive for the whole render, which puts the job outside the job runner, its progress
  and cancel, and outside pytest.
- Map and 3D snapshots in a hidden WebView would need live WebGL, which is non-deterministic under the
  SwiftShader fallback.
- A bundled Chromium adds about 150 MB to an installer already past the NSIS limit; system Edge is an
  unpinned dependency.
- reportlab is already pinned, frozen and smoke-tested; `invariant=1` on the document gives
  reproducible output; cached JPEG snapshots embed by passthrough; above `PART_BUDGET = 160 MB`
  (`pdf/document.py`) the PDF is written in parts.

## Consequences

- Preview fidelity is content-exact, layout-approximate: page breaks are only known after a render,
  and the history shows the real page count.
- Layout is written twice (React blocks, platypus flowables), pinned by the shared
  `contract/fixtures/report-theme.json` and parity tests.
- No new runtime capability in `capabilities/default.json`.
