---
type: adr
date: 2026-09-21
status: accepted
tags: [decision, gotcha]
related: ["[[2026-09-21-contour-ui-design]]"]
---

# UI captures need real image bounds

## Context

The first Contour screenshot fixture returned a full 4000px photograph for both the image-file and
thumbnail routes. That made the new Home hero look sharp while its production URL still requested a
256px thumbnail. The fixture concealed a real visual defect.

## Decision

Use the existing image-file endpoint with `max_side=1024` for the single Home hero; keep smaller
previews on thumbnails and metadata limited to one page of three. Capture fixtures must reproduce
the backend's actual image sizes and quality. The evidence helper prepares 256px and 1024px derivatives;
the 4000px editor fixture already fits its existing 4096px cap.

## Rationale

Screenshots should show what the application actually serves. Rendering a high-resolution substitute
for every image endpoint can hide scaling blur and inflate confidence in a design review.

## Consequences

- Positive: the Home hero stays sharp and screenshot evidence reflects production image bounds.
- Negative: one Home image is larger than a thumbnail, but still capped at 1024px.
- Open follow-ups: installed WebView2 verification is separate from this browser evidence.

## Related

- `backend/app/datasets/images.py`: `THUMB_SIDE=256`, quality 85 and bounded image-file derivation.
- `docs/evidence/ui/2026-09-21-contour/prepare-fixtures.py` and `capture.cjs`.
- `bd145d4`: bounded Home hero correction, tested alongside tooltip fixes.
