---
type: adr
date: 2026-09-21
status: accepted
tags: [decision, gotcha]
related: ["[[2026-09-21-1905-kestrel-a-identity]]"]
---

# Native icon checks must account for rasterization and ICNS order

## Context

The approved Kestrel A bird is generated from one SVG master by the installed Tauri CLI. Two
generations initially produced different ICNS hashes even though their chunks were identical: chunk
order varied. Actual Windows 16px PE resources also contain antialiased colors and corners, unlike
an imagined perfectly solid vector. The first evidence check rejected a correct rendered icon.

## Decision

Sort ICNS chunks by type before hashing/copying the generated assets. For actual Windows resources,
extract both sizes and check their dimensions, palette coverage, mostly transparent corners and exact
app/setup bitmap equality, alongside visual inspection. Accept only opaque near-charcoal pixels
within 16 per color channel, keep greater-than-3% coverage, and require corner alpha below 32.

## Rationale

The 16px bird has four exact charcoal pixels plus six at RGB(41,44,38), and corner alpha 16. The 32px
bird has 66 exact charcoal pixels and alpha-zero corners. Accounting for these observed raster edges
preserves a useful check; the old app/setup resources still fail the required amber coverage.
`ExtractIconEx` returns two handles for a large-plus-small pair, so success cannot require count one.

## Consequences

- Positive: identical generation produces identical manifests; native tests assess shipped resources
  without rejecting normal antialiasing. The source master and every output remain hash-checked.
- Negative: palette checks do not prove the exact silhouette; visual review remains necessary.
- Open follow-ups: none for this identity. Re-evaluate tolerances if the intended design changes.

## Related

- `frontend/scripts/generate-icons.mjs`
- `docs/evidence/brand/2026-09-21-kestrel-a/`
