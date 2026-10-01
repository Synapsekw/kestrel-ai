---
type: adr
date: 2026-09-30
status: accepted
tags: [decision, packaging, reports]
related: ["[[2026-09-24-pdf-and-xlsx-in-the-frozen-sidecar]]", "[[2026-09-26-reports-design]]", "[[2026-09-30-reports-use-reportlab-not-webview2-print]]"]
---

# Report fonts ship in the frozen sidecar

## Context

The report PDF (spec 2026-09-26-reports §10.1) prints in the app's typefaces, Space Grotesk and
JetBrains Mono. ADR 2026-09-24 kept reportlab on the built-in Type 1 Helvetica so that no font file
had to ship. A missing font in the PyInstaller bundle would only show when an operator renders a
report, never at startup.

## Decision

- Three static TTFs (SIL OFL 1.1, with their licence texts) live in `backend/app/reports/fonts/`:
  `SpaceGrotesk-Regular.ttf`, `SpaceGrotesk-Bold.ttf`, `JetBrainsMono-Regular.ttf`
  (`OFL-SpaceGrotesk.txt`, `OFL-JetBrainsMono.txt`). They are static instances cut from the Google Fonts
  variable TTFs by `scripts/fetch_report_fonts.py`; their sha256 sums are recorded in `fonts.py`.
- `kestrel_backend.spec` adds the whole folder to `datas`
  (`(Path(SPECPATH)/"app"/"reports"/"fonts", "app/reports/fonts")`). `fonts.py` finds it
  `Path(__file__)`-relative, like the Alembic folders.
- `app/reports/pdf/fonts.py` `register_fonts()` registers the faces with `TTFont` once per folder per
  process (`KestrelSans`, `KestrelSans-Bold`, `KestrelMono`). When registration raises, it logs one
  `log.warning` line and returns the fallback FontSet (Helvetica, Helvetica-Bold, Courier); it never
  fails a render job. The renderer prints with whichever FontSet comes back.
- `reports-selftest` (`kestrel-backend.exe reports-selftest`) registers the fonts, checks their sha256
  (`verify_fonts()` must find 3, and not the fallback), draws the gradient cover, embeds a JPEG by
  passthrough, draws a vector chart and writes a write-only XLSX. `backend/scripts/smoke_frozen.ps1`
  runs it after `volumes-selftest` and expects `reports ok`.
- Output stays deterministic: the document is built with reportlab `invariant=1` and `generated_at`
  stamped as the creation date (`pdf/document.py`, `pdf/canvas.py`).

## Known limit: Latin only

There is no per-glyph fallback. Space Grotesk (735 glyphs) has no Cyrillic, CJK or emoji glyphs;
JetBrains Mono has Cyrillic but no CJK or emoji; neither is consulted for text set in the other face.
reportlab subsets the TTF it is given, so a character the face lacks prints as the font's missing-glyph
box (.notdef) and nothing is logged. Latin with diacritics, the en dash and the degree sign are covered.
Titles or notes in Cyrillic, CJK or emoji therefore print as boxes in the PDF (the on-screen preview
is unaffected). A fallback font (for example Noto Sans) for non-Latin text is a considered follow-up,
not done.

## Consequences

- Supersedes the "Helvetica only, no font files to ship" consequence of
  [[2026-09-24-pdf-and-xlsx-in-the-frozen-sidecar]]. Volume and detection PDFs still use Helvetica.
- A broken font bundle degrades the typography, never the render, and fails the frozen smoke by name
  (`reports selftest failed`, with `fonts 0`).
- The three TTFs add about 290 KB to the sidecar.
