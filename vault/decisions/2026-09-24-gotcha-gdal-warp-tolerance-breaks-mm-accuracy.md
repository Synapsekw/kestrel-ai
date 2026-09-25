---
type: adr
date: 2026-09-24
status: accepted
tags: [decision, gotcha, surfaces, gdal]
related: ["[[2026-09-23-design-surfaces-design]]", "[[2026-09-22-rasterio-in-the-frozen-sidecar]]"]
---

# Gotcha: GDAL's default warp tolerance breaks millimetre re-gridding

## Context

A design DEM in another CRS is re-gridded onto the target surface's lattice through a rasterio
`WarpedVRT`. GDAL approximates the coordinate transform with a linear interpolator whose error
tolerance defaults to 0.125 source pixels. Over a small re-grid (a few hundred metres, the size of
most design imports) that approximation error is negligible -- the plan's own UTM 38 -> 39 oracle
(`test_a_plane_in_utm_38_regrids_onto_a_utm_39_target_within_a_millimetre`) passes even at the
default 0.125 tolerance on rasterio 1.4.4 / GDAL 3.10.3. Over a large enough re-grid (kilometre
scale, steep slope) the same approximation misses the spec's 1 mm oracle by ~1.6-1.8 mm; see
`test_gdal_default_warp_tolerance_misses_the_millimetre_oracle_but_1e9_holds`.

The plan's first draft asked for `tolerance=0.0` (the exact transformer, no approximation). On
this rasterio/GDAL pair that raises `ObjectNullError: Pointer 'hDS' is NULL in
'GDALSetProjection'` -- GDAL refuses an exact-zero tolerance for this warp configuration.

## Decision

Open every design `WarpedVRT` with `tolerance=1e-9` (an effectively exact transformer; GDAL
accepts a tiny nonzero value where it refuses `0.0`). The cost is a slower warp, paid once per
import in a background job.

## Consequences

- Positive: `test_a_plane_in_utm_38_regrids_onto_a_utm_39_target_within_a_millimetre` and the new
  `test_gdal_default_warp_tolerance_misses_the_millimetre_oracle_but_1e9_holds` both hold.
- Negative: re-gridding a large DEM in another CRS is measurably slower (the Task 17 evidence
  records the time on the operator's machine).
- The plan's assumption that no cheap test pins the tolerance choice did not hold on this
  rasterio/GDAL pair: a 300 x 300 cell, 1.8 km re-grid at a 0.25 slope with a 100 m source cell
  (`test_gdal_default_warp_tolerance_misses_the_millimetre_oracle_but_1e9_holds`, ~0.1 s) fails the
  1 mm oracle at GDAL's default 0.125 tolerance (~1.6-1.8 mm off) and passes at `tolerance=1e-9`
  (~0.02-0.03 mm off). That test is now part of the suite and pins this decision directly.
- Separately, `tolerance=1e-9` only bounds the *coordinate-transform* approximation, not GDAL's own
  edge handling: a destination cell whose bilinear kernel reaches past the source raster's own
  edge can still come back with a value GDAL computed from an incomplete kernel. `dem_build`
  erodes the valid footprint by the kernel's half-pixel reach and marks those cells NaN instead
  (R7; see `test_a_dem_offset_from_the_target_lattice_holds_a_millimetre_at_the_edge_ring`) --
  without that erosion, an offset (non-lattice-aligned) source DEM's outer ring can be off by
  several millimetres even with an exact coordinate transform.
