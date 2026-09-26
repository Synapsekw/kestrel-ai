---
type: adr
date: 2026-09-24
status: accepted
tags: [decision, gotcha, surfaces]
related: ["[[2026-09-23-design-surfaces-design]]"]
---

# Gotcha: the barycentric origin decides whether block seams are bit-identical

## Context

The design-surface rasteriser works window by window (2048² in the build). Spec §9.2 first said to
compute barycentrics "relative to the block origin" to avoid cancellation at UTM magnitudes, while
§16.6 requires a triangle spanning several blocks to give output bit-identical to a single-block run.
With a block-relative origin, the same cell centre is expressed as a different small number in each
window size, so the float result differs in the last bits.

## Decision

Compute barycentrics relative to each triangle's first vertex: `px = (col + 0.5) * cell + (x0 - Ax)`.
The value at a cell no longer depends on the window, and the coordinates are still small.

## Consequences

- Positive: seam-free, bit-identical tiling (test `test_a_triangle_across_nine_blocks_is_bit_identical_to_one_block`).
- Negative: none measured; one subtraction per triangle.
- A shared edge between two triangles is still computed by both; the last write wins in triangle
  order, and the two values agree within float rounding (no cracks, `|dz| < 1 mm`).
