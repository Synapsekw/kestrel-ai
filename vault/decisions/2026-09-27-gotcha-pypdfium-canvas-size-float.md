---
type: adr
date: 2026-09-27
status: accepted
tags: [decision, gotcha, backend, drawings]
related: []
---

# Gotcha: pypdfium2 sizes its render canvas from a pre-computed float scale

## Context

M-B3 renders a PDF page into `plan.tif` in strips of 1024 rows (`backend/app/drawings/pdf.py`,
`render_page_to_plan`). The DPI cap and the plan's size are computed as `ceil(pt * dpi / 72)`. But
pypdfium2's `page.render(scale=...)` sizes its canvas as `ceil(size * scale)`, where
`scale = dpi / 72` is computed **first**. The two orders of float operations can differ by one:

```python
>>> 7200 * (150 / 72), math.ceil(7200 * (150 / 72)), math.ceil(7200 * 150 / 72)
(15000.000000000002, 15001, 15000)
```

So a 100-inch page at 150 dpi renders a 15 001-pixel canvas while the plan (and the 20 000 px /
300 MP cap) expected 15 000. Strip crops computed against one size and written into a raster of the
other size are off by a row, or write past the end.

## Decision

Compute both sizes and take the smaller one: the canvas size `src = ceil(pt * scale)` (what
`render()` will draw, and what the strip crops are measured against) and the true size
`ceil(pt * dpi / 72)`. `plan.tif` is `min(ceil(pt * dpi / 72), src)` on each axis; the surplus
row/column of the canvas, if any, is cropped away.

## Rationale

The difference is float noise, not content: the extra row is at most one pixel of the page edge.
Keeping the true size keeps the plan consistent with the DPI cap and with the size the inspection
reported, and measuring crops against the canvas keeps every strip aligned with what PDFium
actually renders.

## Consequences

- Positive: the plan size never depends on float evaluation order; strips never overrun.
- Negative: anywhere else that renders with pypdfium2 at a fractional scale must use the same
  `min(...)` rule, or it will see the same off-by-one.

## Related

- `backend/app/drawings/pdf.py` (`render_page_to_plan`)
- Plan `docs/superpowers/plans/2026-09-27-maps-b3.md`, Ruling 13 (strip vs one-shot render)
