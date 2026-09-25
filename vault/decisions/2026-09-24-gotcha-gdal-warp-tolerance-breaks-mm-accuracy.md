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

2. **GDAL's bilinear kernel is measurably biased for a non-integer resolution ratio.** A controller
   ruling asked for `XSCALE=1, YSCALE=1` on the bilinear `WarpedVRT`, citing an independent
   reviewer's measurement of 0.01 mm at a 1.2x and a 1.5x target/source cell ratio. The bias itself
   is real: at a 1.2x ratio and a 0.3 slope it's ~12-15 mm; it's exactly periodic in the destination
   column with a period matching the ratio's reduced fraction (5 for 6:5), and it vanishes the
   moment the ratio is exactly 1.

### Consequences (fix round 1)

- Positive: `test_an_interior_nodata_hole_erodes_its_contaminated_rim_not_just_itself` pins the
  coverage-mask fix for interior holes, and it holds.
- The half-pixel erosion was replaced with a proper coverage mask (a 1.0/0.0 validity band warped
  through the identical pipeline as the heights, thresholded at `>= 1 - 1e-6`), which catches the
  interior-hole rim, the outer edge, and `Resampling.average`'s wider reach uniformly instead of
  three different fixed distances. This part of fix round 1 stood; item 2's mitigation did not, see
  fix round 2 below -- **fix round 1's own claim that `XSCALE=1, YSCALE=1` is inert on this build was
  wrong, and is corrected there, not repeated here.**

## Fix round 2 (2026-09-25): the `XSCALE`/`YSCALE` override never reached GDAL

Fix round 1 measured `XSCALE=1, YSCALE=1` as a no-op and built a substantial workaround instead (a
second WarpedVRT reprojecting the source at its own resolution, then a hand-rolled 4-neighbour
bilinear interpolation onto the real target lattice) -- entirely because of a call-site bug, not a
GDAL or rasterio limitation:

```python
# what fix round 1 did -- looks reasonable, does nothing:
WarpedVRT(src, ..., warp_extras={"XSCALE": 1, "YSCALE": 1})
```

`rasterio.vrt.WarpedVRT`'s `warp_extras` is a real parameter, but passing a dict as its value makes
rasterio store that whole dict *verbatim under its own `"warp_extras"` key* rather than merging
`XSCALE`/`YSCALE` into the option set GDAL actually reads -- `vrt.warp_extras` after construction is
`{"warp_extras": {"XSCALE": 1, "YSCALE": 1}, "init_dest": "0"}`, not `{"XSCALE": 1, "YSCALE": 1,
...}`. Fix round 1's own check of `vrt.warp_extras` (it printed a dict *containing* `{"XSCALE": 1,
"YSCALE": 1}`) was misread as confirmation the values reached GDAL; they were one level too deep.
`rasterio.warp.reproject(..., warp_extras={...})` has the identical bug.

The values only take effect passed as **real keyword arguments**:

```python
WarpedVRT(src, ..., XSCALE=1, YSCALE=1)          # correct
reproject(..., XSCALE=1, YSCALE=1)               # correct
```

Re-measured with the corrected call:

| case | dict (`warp_extras={...}`) | real kwargs |
| --- | --- | --- |
| 0.5 -> 0.6 m, slope 0.3, offset lattice | 11.92 mm | 0.0055 mm |
| ratio 1.5, same conditions | 8.15 mm | 0.0023 mm |
| UTM 38 -> 39 reprojection, ratio 1, slope 0.3 | 15.91 mm | 0.0067 mm |
| UTM 38 -> 39 reprojection, ratio 1.2, slope 0.3 | 15.48 mm | 0.0078 mm |
| windowed reads (64x64 chunks) vs one full read, real kwargs | -- | identical (0.00e+00 max diff) |

The UTM 38 -> 39 rows matter beyond confirming the bug: fix round 1's exact-bilinear workaround
(reproject at the source's own resolution, "ratio 1 is exact", then hand-interpolate) does **not**
fix a reprojected source even at ratio 1 -- the reprojection step itself still goes through the same
GDAL bilinear kernel, still biased without the real kwargs. Only the correct kwargs fix that case;
the workaround's premise ("ratio 1 is always exact") held for a same-CRS resize but not for a
reprojection, and was never actually necessary once the real bug was found.

### Decision (fix round 2)

- Pass `XSCALE=1, YSCALE=1` as real keyword arguments everywhere a bilinear `WarpedVRT` is opened
  (`_open_warped`, `_open_validity_warp`), via `_warp_params`'s `kernel_kwargs` dict unpacked with
  `**kernel_kwargs` at each call site -- never as `warp_extras={...}`.
- Delete fix round 1's exact-bilinear workaround (`_needs_exact_bilinear`,
  `_open_reprojected_native`, `_bilinear_from_native`, `_regrid_exact_bilinear`, and the branching in
  `regrid()`/`read_preview()`) -- it is no longer needed and, per the UTM 38 -> 39 measurements
  above, was not even fully correct.
- `_build_validity_source` now writes to a temporary GeoTIFF on disk (tiled, DEFLATE, uint8) instead
  of an in-memory `MemoryFile` (`/vsimem`, RAM-backed) -- a `MemoryFile` copy of a large source DEM
  (tens of thousands of pixels per side) would put a full uncompressed array in RAM, breaking the
  bounded-memory invariant regardless of the `grid.MAX_READ`-chunked writes into it. The temp
  directory is removed in a `finally` (including on cancellation or a failure partway through its
  own construction).

### Consequences (fix round 2)

- Positive: all fix-round-1 tests still hold (the edge-ring, interior-hole, 1.2x-ratio and 4x-ratio
  cases), plus a new `test_a_reprojected_steep_plane_holds_a_millimetre` (ratio 1 and 1.2, UTM 38 ->
  39, slope 0.3) that the exact-bilinear workaround would not have passed.
- Negative: none measured -- the real-kwargs fix is strictly simpler than what it replaces (one
  `WarpedVRT` per warp, not two, and no hand-rolled interpolation).
- The earlier "ruled deviation" (accepting `XSCALE`/`YSCALE` as an instructed-but-inert override) no
  longer applies: the controller's original ruling was correct, the round-1 implementation of it was
  not. Lesson for future rasterio/GDAL option passing in this codebase: verify an override actually
  changed *output*, not just that the option name appears somewhere in the constructed object's
  introspection -- `vrt.warp_extras` containing the right *substring* was not the same as it
  containing the right *keys*.
