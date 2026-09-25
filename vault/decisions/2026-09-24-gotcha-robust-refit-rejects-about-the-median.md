---
type: adr
date: 2026-09-24
status: accepted
tags: [decision, gotcha, volumes, statistics]
related: ["[[2026-09-23-volumes-design]]", "[[2026-09-20-gotcha-symmetric-fixtures-make-tests-that-cannot-fail]]"]
---

# Gotcha: a robust refit must reject about the median residual, not about zero

## Context

The volumes spec (§6.3) fits a toe plane to the polygon's edge, then rejects samples with
`|r| > max(3s, 0.05 m)`, `s = 1.4826·MAD(r)`, and refits once. Its own fixture pushes 10 % of the
edge samples up by 0.8 m. Spread around the ring, those samples lift the first fit by 0.08 m, so
every clean residual is −0.08 m: MAD is 0, the threshold is the 0.05 m floor, and `|r| = 0.08`
rejects **every** sample. Measured while planning: 760 of 760 rejected, a degenerate refit.

## Decision

Residuals are measured about their median: reject `|r − median(r)| > max(3s, 0.05 m)`. The same
fixture then rejects exactly the 76 pushed samples, spread or in one contiguous arc, and the plane
comes back to 1e-4 in slope. `app/volumes/bases.py::robust_plane` carries the rule and a test for
both patterns.

## Consequences

- Any later robust fit in the app (patch rings, alignment) uses a median-centred rule.
- A fixture whose outliers are symmetric would never have shown this: the pushed samples must be
  one-sided, as a pile bleeding over its toe is.
