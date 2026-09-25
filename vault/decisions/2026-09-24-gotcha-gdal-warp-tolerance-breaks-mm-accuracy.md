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
  originally eroded the valid footprint by a fixed half-pixel reach and marked those cells NaN
  instead (R7; see `test_a_dem_offset_from_the_target_lattice_holds_a_millimetre_at_the_edge_ring`)
  -- without that erosion, an offset (non-lattice-aligned) source DEM's outer ring can be off by
  several millimetres even with an exact coordinate transform. Fix round 1 (below) replaced the
  fixed reach with a coverage mask, because a fixed pixel distance turned out not to be the right
  measure of "under-covered" either.

## Fix round 1 (2026-09-25): interior holes, and GDAL's bilinear bias at a non-integer ratio

Code review found two more gaps in "every covered cell within 1 mm" (spec §16.1), both invisible to
the original test suite:

1. **Interior nodata holes.** A fixed half-pixel edge erosion only guards the DEM's own outer edge.
   GDAL's bilinear warp *renormalises weights* across an interior nodata hole -- if at least one of
   the four source pixels in a kernel is valid, GDAL blends only the valid ones and still reports
   the destination pixel as valid, extrapolating from partial data. A destination cell one ring
   outside the hole can be tens of millimetres off while looking like ordinary data.

2. **GDAL's bilinear kernel is measurably biased for a non-integer resolution ratio, and `XSCALE=1,
   YSCALE=1` does not fix it on this rasterio/GDAL build.** A controller ruling asked for `XSCALE=1,
   YSCALE=1` on the bilinear `WarpedVRT`, citing an independent reviewer's measurement of 0.01 mm at
   a 1.2x and a 1.5x target/source cell ratio. On this repo's rasterio 1.4.4 / GDAL 3.10.3, that
   override is a verified no-op: `WarpedVRT.warp_extras` correctly records the values passed
   (`vrt.warp_extras == {"XSCALE": 1, "YSCALE": 1, ...}`), but the read output is bit-identical
   whether `XSCALE`/`YSCALE` is omitted, set to 1, or set to anything from 0.001 to 50 -- confirmed
   both via `WarpedVRT.read()` and via `rasterio.warp.reproject()`. The underlying bias itself is
   real and reproducible without any of this module's code: a plain `DatasetReader.read(out_shape=
   ..., resampling=Resampling.bilinear)` resize at a 1.2x ratio, with no CRS and no `WarpedVRT`
   involved at all, shows the same magnitude of error (10-25 mm on a 0.3 slope), and it is exactly
   periodic in the destination column with a period matching the ratio's reduced fraction (5 for
   6:5) -- a phase-locked kernel-positioning artifact, not a coordinate-transform or float-precision
   issue (unchanged by `tolerance`, by using no CRS at all, and by using float64 throughout).
   `Resampling.average` and `Resampling.cubic_spline` show the same or worse bias at this ratio;
   `Resampling.cubic` is better (~1.3 mm) but still misses 1 mm. The bias vanishes (< 0.002 mm) the
   moment the ratio is exactly 1.

   Given `XSCALE`/`YSCALE` do not work here, the fix is to avoid GDAL's ratio-dependent kernel
   entirely for the regime it's biased in: `dem_build._needs_exact_bilinear` detects a genuine
   downsampling ratio in `(1, 2]` (upsampling and same-resolution are already exact; ratio > 2 is
   `Resampling.average`, separately verified accurate via
   `test_a_four_times_ratio_target_cell_holds_a_millimetre_at_the_edge_ring`) and switches to a
   two-stage path: `_open_reprojected_native` reprojects the source (and, identically, the coverage
   validity band) into the output CRS *at the source's own cell size* -- ratio exactly 1, where
   GDAL's kernel is exact -- and `_bilinear_from_native` then interpolates onto the actual target
   lattice by hand with the plain 4-neighbour bilinear formula, in `EXACT_MAX_SIDE`-capped, bounded
   reads. Verified at both ratios the reviewer cited: 1.2x (0.6 m target on a 0.5 m source,
   `test_a_one_point_two_ratio_target_cell_holds_a_millimetre`) is within ~0.015 mm, and a spot check
   at 1.5x is within ~0.006 mm.

   The fixed half-pixel erosion was replaced at the same time with a proper coverage mask (a 1.0/0.0
   validity band warped through the identical pipeline as the heights -- the same GDAL warp, or the
   same exact-bilinear path -- thresholded at `>= 1 - 1e-6`), which catches the interior-hole rim,
   the outer edge, and `Resampling.average`'s wider reach uniformly instead of three different fixed
   distances. See `test_an_interior_nodata_hole_erodes_its_contaminated_rim_not_just_itself`.

### Consequences (fix round 1)

- Positive: all of the above tests hold, including the pre-existing edge-ring and 4x-ratio tests,
  unaffected because they fall outside the `(1, 2]` exact-bilinear regime (ratio 1 and ratio 4
  respectively).
- Negative: the exact-bilinear path does one extra reprojection (source, at its own resolution) and
  a second, manual interpolation pass, only for the `(1, 2]` downsampling regime; every other ratio
  is unaffected and unchanged in cost.
- This is a *ruled deviation* from the literal controller instruction: `XSCALE=1, YSCALE=1` is still
  set (harmless, and it is possible a different GDAL build honours it for `WarpedVRT` reads), but it
  is not what makes the new tests pass. If a future GDAL/rasterio upgrade changes this, `warp_extras`
  becoming genuinely effective would just make `_needs_exact_bilinear`'s fallback path an
  (still-correct) no-op improvement opportunity, not a regression -- worth re-measuring the 1.2x/1.5x
  cases before removing it, though, rather than assuming the newer GDAL fixed it.
