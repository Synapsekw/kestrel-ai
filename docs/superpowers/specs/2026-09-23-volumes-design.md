---
type: spec
date: 2026-09-23
status: proposed
tags: [spec, volumes, surfaces, dsm, earthworks, point-clouds, export]
related: ["[[2026-09-22-geotiff-maps-design]]", "[[2026-09-23-point-clouds-design]]", "[[2026-09-23-design-surfaces-design]]", "[[2026-09-23-survey-timeline-design]]", "[[2026-09-19-site-office-ui-design]]"]
---

# Volumes: surfaces from point clouds, cut/fill against a toe, a survey or a design

## 1. Goal

The operator turns an imported point cloud (S1) into a **surface**: a height grid on disk. They then
draw a polygon around a stockpile or a work area and get **fill, cut and net volumes** measured
against one of four bases:

- a plane through the stockpile toe;
- a surface fitted through the toe;
- a flat level;
- another surface: an earlier survey, or a design from S3.

Machines and vehicles on the surface are masked out, using the detection runs already made on the
ortho of the same flight, plus polygons the operator draws. When two surveys are compared, the app
checks how well they agree on ground that did not change, warns when they disagree, and can
correct a vertical shift. Every number carries its areas, what was masked, what had no data, and
an indicative ± with its terms broken out. The results export as a PDF report, a GeoPackage plus a
cut/fill GeoTIFF, CSV and Excel.

Volumes are the part of the product the operator is paid for, so this spec is mostly about making
the numbers **trustworthy**:

- closed-form fixtures;
- measured choices, not guessed ones;
- nodata that is reported, never silently turned into zero;
- a cross-check against an independent tool.

Done means, on the operator's real Pix4D chimney cloud (21.7 M points, EPSG:32639), with the
steps in this order:

1. **Build a surface.** It builds with the automatic cell size in under 60 s from local disk. The
   backend's peak memory stays at or below 2 GB.
2. **Measure a stockpile.** The operator sees the hillshade with the linked ortho underneath,
   draws a polygon around a mound, and reads its fill, cut and net for the toe-plane base and the
   flat base. Each result has its ±, its areas and its warnings.
3. **Mask a machine.** The operator ticks a detection run on the linked map. The machine
   footprints appear, the volume changes, and the masked area is reported.
4. **Compare two surveys.** A second surface is built from a copy of the cloud raised by exactly
   0.100 m (made by a laspy script at acceptance). Compared against the first, the stable-area
   check reports a median offset of 0.100 ± 0.005 m and warns. With the shift applied, net is
   within ± the reported uncertainty of 0 m³.
5. **Cross-check.** Fill and cut on a rectangle agree with CloudCompare's "2.5D Volume" within
   0.5% (§7.3).
6. **Export.** PDF, GPKG with the cut/fill GeoTIFF, CSV and XLSX all come out. The GPKG and TIFF
   open in QGIS in EPSG:32639, with the polygon on the mound.
7. **Worst case.** The 195 M-point cloud (the spike's tiled copy) builds a surface in 10 min or
   less, with peak backend memory at or below 2 GB. The spike's one-grid approach needed 4.3 GB.

Why it matters: a volume quoted to a client is a number someone pays against. A DSM tool that
takes the highest point per cell overstates a stockpile by 2–7% on ordinary photogrammetry noise
(§5.3, measured). One that counts empty cells as zero understates it by about 2% at the default
cell size. A wrong base, or two surveys that are 5 cm apart vertically, moves the answer by area ×
5 cm. The operator needs to see each of these effects and have it controlled, not buried.

## 2. Decisions that shape everything

| Decision | Choice | Why (rejected options included) |
| --- | --- | --- |
| Per-cell statistic | **Median** by default. Mean, highest and lowest are also offered, each with its measured bias shown in the build dialog. | Measured (§5.3). Median and mean are within +0.1–0.4% of the closed-form cone volume. Median stays at +0.3% with 0.1% outliers, while mean drifts to +0.8%. Highest gives +2.5% to +7.4%, lowest −1.9% to −3.8%. Highest (the spike's DSM) was rejected as the default: it models the top of the noise, not the ground. |
| Cell size | **Auto:** the smallest value on a fixed ladder that is at least 2 × the measured point spacing, which gives about 4 points per cell. The spacing is measured in a density pre-pass. The operator can override. | At 1.6 points per cell, 20% of cells are empty and the volume drops 2.6% (measured). At 4 points per cell, 1.8% are empty and small-gap filling recovers them. Rejected: S1's `octree_spacing_m`, which is the octree **root** spacing, not the point spacing. Rejected: a fixed 10 cm, which is too sparse for thin clouds and wasteful for dense ones. |
| Grid lattice | Grid origins are snapped to **integer multiples of the cell size** in the CRS (`aligned_grid`). | Two surfaces with the same cell size and CRS then share cells exactly, so the most common comparison (survey against survey) needs no resampling at all. S3 snaps to the same lattice. |
| Build pipeline | **Bin, then reduce, per 512 × 512 block.** Points are streamed into per-block spill files (8 B per point), then each block is reduced on its own. | Memory is set by the block, not the site. The spike's single full grid needed 4.3 GB at 195 M points. Rejected: a single-pass running mean or max, which cannot compute a median. Rejected: holding every point, which runs out of RAM. |
| Noise | **No automatic global Z fences.** The build drops LAS classes 7 and 18 and withheld points, uses the per-cell median, and despikes isolated sparse cells. An optional manual Z clip is available. | The real file has a 190 m chimney: IQR fences would cut real structure. The real noise rate is 0.009%, and a median absorbs it (§5.5). |
| Holes | Gaps **up to 1 m wide** are filled by averaging enclosed neighbours. Larger gaps stay nodata and are reported. | This recovers the Poisson empty cells without inventing ground at the cloud's edge. An edge cell never has enough valid neighbours to be filled. |
| Volume method | **Prism per cell.** Height difference × cell area, summed at cell centres in float64 inside the polygon. | Exact for the cell model. Measured discretisation error is 0.03% or less on the analytic fixtures (§7.2). Rejected: TIN-to-TIN volumes, which S3's grid-based designs could not share, and which are heavier for no measurable gain at these cell sizes. |
| CRS | Grids must be in a **projected CRS in metres**. A geographic cloud is reprojected to its UTM zone at build time. Feet-based CRSs are refused. A cloud with no CRS builds as "local metres", and detection masking is then disabled. | Areas need a linear unit. Feet clouds would need vertical unit handling, and the operator's work is metric. Grid areas are reported with the CRS's areal scale factor, not corrected (§6.2). |
| Base surface onto the top grid | **Exact** when the two grids share a lattice. Otherwise **bilinear at the top cell centres**, which are reprojected with pyproj when the CRSs differ. The result is NaN if any of the four neighbours is NaN. A much finer base is averaged down first. | Predictable and testable. A plane resamples exactly. Rejected: GDAL's warp bilinear, which renormalises across nodata and quietly invents base heights at holes. |
| Toe bases | **Toe plane:** a robust least-squares plane through the samples on the edge. **Toe surface:** a linear TIN through the edge samples after smoothing them along the ring. | A TIN interpolates linearly between opposite edges, which follows a sloping hillside toe. Rejected: IDW, which pulls the middle of a large pile toward the edge mean (in effect a flat base) and leaves bull's-eyes. |
| Clutter cells | **Patched from the surrounding ground of the same surface.** Each masked region is re-interpolated with a TIN through a ring of unmasked cells around it. | A machine usually stands *on* the pile. Filling from the base (dz = 0), or treating the cells as nodata, removes the pile under the machine: 20 m² × 5 m = 100 m³ gone. Patching is an estimate, so its area and uncertainty term are reported. |
| Exclusion polygons | Two modes. **Patch** handles clutter the detector missed. **Exclude** removes an area from the measurement altogether. | Both needs are real: a parked container on the pile, or a neighbouring pile inside the outline. The two areas are reported separately. |
| Alignment | Robust **median and MAD of dZ** on an operator-drawn stable area, with a **tilt check**. The only correction is a vertical shift. | The brief's scope: full ICP is out. The tilt check says when a shift cannot fix the misalignment. |
| Uncertainty | **Named terms** (base or alignment, cell size, nodata, patches) plus their root-sum-square, labelled "indicative". | A reviewer can see where the ± comes from. Rejected: a flat "±x%" rule of thumb, which hides which input is weak. |
| When numbers exist | **Only from a `volume_calc` job.** Results are fingerprinted against their inputs and turn **stale** when any input changes. | There are no preview numbers that could drift from what the report says. An `engine_version` in the fingerprint makes old results stale when the maths changes. |
| Display space | The **top surface's pixel grid**, exactly like `MapView`. Hillshade tiles come from the backend. The ortho underlay is **warped server-side** into the same tile. | This reuses `grid.ts`, `makeTileGrid` and the maps drawing hooks unchanged. Rejected: reprojecting ortho tiles client-side in OpenLayers, which needs a projection per map in the WebView, is slow and can't be tested in pytest. |
| Surfaces are immutable | A rebuild is a new surface. A surface used by a measurement can't be deleted. | Results stay reproducible, and tiles can be cached as `immutable`. |
| Report engine | **reportlab** (BSD) with a plan-view image composed in **PIL**. | Pure Python, freezes cleanly. Rejected: HTML-to-PDF, which needs a browser engine in the sidecar. Rejected: matplotlib, a heavy freeze for one image. |
| Raster in the GPKG export | A **GeoTIFF (plus a QGIS `.qml` style) beside the GPKG**. | `app/maps/gpkg.py` writes vectors only. GPKG raster tiles are 8-bit PNG or JPEG, which can't hold float heights. |
| Grid file detail | Single band, float32, nodata **NaN only, no internal mask**. | One source of truth for validity. GDAL's overview averaging skips NaN (tested, §13). S3 writes the same. |

## 3. Data model

These tables are created by F0's single migration (§11). Names are fixed by the brief; the columns
S2 adds are marked **(S2)**.

**`Surface`** (`surface`)

| Field | Type / meaning |
| --- | --- |
| `id`, `name`, `created_at` | identity |
| `kind` | `cloud_dsm` / `design` (`design` rows are S3's) |
| `status` | `building` / `ready` / `failed` |
| `error` **(S2)** | readable text; null unless failed |
| `point_cloud_id` | nullable FK → `point_cloud.id`, **ON DELETE SET NULL**. The tif is self-contained, so a surface survives its cloud. |
| `design_source` | JSON of S3's `DesignSource` schema (S3 §12); null for `cloud_dsm` |
| `crs_wkt`, `epsg` | the grid's CRS. Null means "local metres". |
| `cell_size_m`, `width`, `height`, `geotransform` | the `GridSpec` (§4). `geotransform` is GDAL order, north-up. |
| `bounds_native` | `[minx, miny, maxx, maxy]` of the grid |
| `z_min`, `z_max`, `coverage_fraction` | from `grid.SurfaceStats` (§4), returned by `SurfaceWriter.finish()` |
| `method` | one `SurfaceMethod` value (§11.2): `median` / `mean` / `max` / `min` for `cloud_dsm`; `tin` / `delaunay` / `dem_resample` / `dem_copy` for `design` (S3 §3) |
| `build_params` **(S2)** | JSON echo of `SurfaceBuildRequest` with the defaults resolved (§5.1) |
| `stats` **(S2)** | null for `design`. For `cloud_dsm`, JSON (`SurfaceBuildStats`, §11.2): `points_read`, `points_used`, `points_dropped {noise_class, withheld, z_clip}`, `density_per_m2`, `spacing_m`, `auto_cell`, `cells_valid`, `cells_despiked`, `cells_filled`, `z_p02`, `z_p98`, `reprojected_from_epsg`, `build_s` |
| `job_id` | the build job |

**`VolumeMeasurement`** (`volume_measurement`)

| Field | Type / meaning |
| --- | --- |
| `id`, `name`, `created_at`, `updated_at` | identity |
| `polygon_native` | JSON ring `[[x, y], …]` in the top surface's CRS: 3–5 000 vertices, simple, not self-intersecting |
| `top_surface_id` | FK → `surface.id`, ON DELETE RESTRICT. The API answers 409 first. |
| `base` | `{kind: "toe_plane" \| "toe_surface" \| "flat" \| "surface", z?, surface_id?}`. `z` is required for `flat` and `surface_id` for `surface`. |
| `masks` | `{detection_run_ids: [...], class_ids: [...] \| null, buffer_m, exclusion_polygons: [{id, ring, mode: "patch" \| "exclude"}]}`. `class_ids` **(S2)**: null means every class. |
| `alignment` | `{stable_polygon?, apply_shift}` plus `measured {median_dz, mad, n_cells, sigma, tilt_mm_per_m, span_m}`. The first three are the brief's names; the last three are **(S2)**. |
| `status` | `calculating` / `ready` / `failed` / `stale` |
| `error` **(S2)** | readable text when failed |
| `results` | `VolumeResults` JSON (§6.9), including `inputs` (a snapshot) and `inputs_fingerprint` |
| `job_id` | the latest `volume_calc` job |

Storage:

```
<project>/surfaces/<surface_id>/
  surface.tif              # the grid convention (§4); written as surface.tif.partial, then renamed
  .build/                  # spill files and raw.tif during a build; always removed at the end
<project>/volumes/<measurement_id>/
  diff.tif                 # dz = top − base (shift applied), NaN outside the measured cells; grid convention
```

`ProjectHandle.surfaces_dir` and `ProjectHandle.volumes_dir` are added by F0.

**Startup** (wired into `project_opened()` by F0 as no-op `sweep_interrupted` functions, S1 §5
item 5; S2 fills only the bodies of `app/surfaces/startup.py` (V2) and `app/volumes/startup.py`
(V5)). None of this blocks startup:

- A `building` surface of **any kind** (S3's design builds included; the sweep never filters on
  `kind`) whose job isn't live is marked `failed` ("interrupted by application restart; build it
  again"), and its `.build/` folder is removed.
- A `calculating` measurement whose job isn't live becomes `stale` if it has earlier results, and
  `failed` otherwise.
- Orphan `*.partial` files under `surfaces/` and `volumes/` are removed.

## 4. The surface grid module: `app/surfaces/grid.py` (S2 owns it; S3 imports it)

This module is pure: rasterio, numpy, pyproj and affine only. It has no database and no project
handle. File paths come from a sibling, `app/surfaces/paths.py`:

- `surface_dir(handle, surface_id) -> Path`
- `surface_path(handle, surface_id) -> Path`, which points at `surface.tif`.

The interface below is frozen for S3, and it is the **one** grid interface of S1–S3: S3's §13
maps each of its needs onto these names. Decimated (overview) reads are
`SurfaceReader.read(window, out_shape=…)`; there is no separate decimated-read function.
`convention_problems`, `compute_stats` and `hillshade` exist for S3's DEM copy path and S3's
images, and S2's tiles use the same `hillshade`.

```python
BLOCK: int = 512                 # internal TIFF tile and write unit
MAX_READ: int = 2048             # largest output side of any single read
MAX_CELLS: int = 500_000_000     # width * height ceiling (2 GB of raw float32)

class GridError(ValueError): ...  # geographic CRS, bad cell size, too many cells, misaligned write, oversized read

@dataclass(frozen=True)
class GridSpec:
    crs_wkt: str | None          # None = local metres
    epsg: int | None
    cell_size: float             # metres
    x0: float                    # west edge of column 0
    y0: float                    # north edge of row 0
    width: int
    height: int
    @property
    def transform(self) -> Affine: ...                  # Affine(cell, 0, x0, 0, -cell, y0)
    @property
    def geotransform(self) -> tuple[float, float, float, float, float, float]: ...  # GDAL order
    @property
    def bounds(self) -> tuple[float, float, float, float]: ...  # minx, miny, maxx, maxy
    def window_transform(self, window: Window) -> Affine: ...
    def window_for_bounds(self, bounds: tuple[float, float, float, float], *, pad: int = 0) -> Window: ...
        # the cells whose area meets the bounds, grown by `pad` cells, clipped to the grid; width or height 0 when disjoint
    def cell_centres(self, window: Window) -> tuple[np.ndarray, np.ndarray]: ...  # float64 X, Y, shape (h, w)
    def crop(self, window: Window) -> "GridSpec": ...    # a sub-grid on the same lattice
    def to_json(self) -> dict: ...
    @classmethod
    def from_json(cls, d: dict) -> "GridSpec": ...
    @classmethod
    def from_dataset(cls, ds) -> "GridSpec": ...         # from an open rasterio dataset; GridError if not north-up

def aligned_grid(bounds: tuple[float, float, float, float], cell_size: float,
                 crs_wkt: str | None, epsg: int | None, *, max_cells: int = MAX_CELLS) -> GridSpec: ...
    # x0 = floor(minx / c) * c; y0 = ceil(maxy / c) * c   (quotients rounded to 1e-9 first, so 12.3 / 0.1 is 123)
    # width = floor((maxx - x0) / c) + 1; height = floor((y0 - miny) / c) + 1   (a point on maxx/miny still lands inside)
    # GridError: cell_size <= 0, CRS geographic or not in metres, width * height > max_cells

def same_lattice(a: GridSpec, b: GridSpec, *, tol: float = 1e-6) -> bool: ...
    # same CRS (pyproj CRS.equals, or both None), |a.cell - b.cell| <= tol * cell,
    # and (a.x0 - b.x0) / cell and (a.y0 - b.y0) / cell within tol of integers

def block_windows(spec: GridSpec, within: Window | None = None) -> Iterator[Window]: ...
    # BLOCK-aligned blocks, row-major, clipped to the grid (and to `within`, expanded outward to block edges)
def read_windows(spec: GridSpec, within: Window | None = None, max_side: int = MAX_READ) -> Iterator[Window]: ...
    # BLOCK-aligned windows of at most max_side (a multiple of BLOCK), row-major, covering `within` or the grid

@dataclass(frozen=True)
class SurfaceStats:
    z_min: float | None
    z_max: float | None
    valid_cells: int
    coverage_fraction: float      # valid_cells / (width * height)
    z_p02: float | None           # from a deterministic sample of at most 1 M valid cells
    z_p98: float | None

class SurfaceWriter:
    """Writes `path` block by block, as `<path>.partial`, renamed on finish(). Profile: GTiff,
    float32, 1 band, nodata NaN, tiled 512, DEFLATE, PREDICTOR=3, BIGTIFF=IF_SAFER, SPARSE_OK=TRUE,
    crs and transform from the spec. Overviews: factors 2, 4, 8… while the side divided by the factor
    is at least 256, Resampling.average (NaN-aware), DEFLATE plus PREDICTOR 3."""
    def __init__(self, path: Path, spec: GridSpec, *,
                 progress: Callable[[float, str], None] | None = None,   # (fraction of blocks written, message)
                 check_cancelled: Callable[[], None] | None = None,
                 overviews: bool = True) -> None: ...
    def __enter__(self) -> "SurfaceWriter": ...
    def __exit__(self, *exc) -> None: ...   # on an exception: close and delete the .partial; `path` is never touched
    def write_block(self, window: Window, data: np.ndarray) -> None: ...
        # window offsets are multiples of BLOCK; each side is a multiple of BLOCK or reaches the grid edge;
        # data.shape == (window.height, window.width); cast to float32; ±inf become NaN; calls check_cancelled
        # first; GridError when misaligned. Blocks never written read back as NaN.
    def finish(self) -> SurfaceStats: ...   # overviews, close, os.replace(.partial -> path), return stats

class SurfaceReader:
    spec: GridSpec
    def __init__(self, path: Path) -> None: ...
    def __enter__(self) -> "SurfaceReader": ...
    def __exit__(self, *exc) -> None: ...
    def read(self, window: Window, *, out_shape: tuple[int, int] | None = None,
             resampling: Resampling = Resampling.average, boundless: bool = False) -> np.ndarray: ...
        # float32 (h, w), NaN = nodata. GridError when the output (out_shape, or else the window) exceeds
        # MAX_READ on either side, so a larger window is only legal as an overview read. With boundless,
        # cells outside the grid come back as NaN.
    def sample_bilinear(self, xs: np.ndarray, ys: np.ndarray) -> np.ndarray: ...
        # xs, ys in the surface CRS (any shape); bilinear between the four surrounding cell centres; NaN
        # when any of the four is NaN or outside the grid; reads only windows covering the points,
        # split so that each read is at most MAX_READ
    def close(self) -> None: ...

def open_surface(path: Path) -> SurfaceReader: ...

def resample_onto(src: SurfaceReader, dst: GridSpec, window: Window) -> np.ndarray: ...
    # `src` sampled at the cell centres of `dst` inside `window` -> float32 (window.height, window.width):
    # R1  same_lattice(src.spec, dst): an integer-offset read, no interpolation (NaN where src has no cell).
    # R2  same CRS, other lattice: bilinear at the centres, NaN if any neighbour is NaN. When
    #     src.cell < 0.5 * dst.cell, src is first read with out_shape at an integer factor
    #     f = floor(dst.cell / src.cell), using Resampling.average, then treated as a grid of cell src.cell * f.
    # R3  different CRS: the centres are transformed dst -> src with pyproj Transformer(always_xy=True),
    #     then R2. The transform is horizontal only; heights are never datum-converted.
    # Windows are split internally so that no read exceeds MAX_READ.

def convention_problems(path: Path) -> list[str]: ...
    # Opens `path` (metadata only, no pixel read) and returns one readable string per breach of the grid
    # convention; [] means the file may be used as a surface.tif unchanged. Checked: GTiff; 1 band;
    # float32; nodata NaN; NO internal or per-dataset mask (NaN is the only validity signal); tiled
    # 512 x 512; DEFLATE with PREDICTOR 3; north-up (GridSpec.from_dataset succeeds); CRS projected in
    # metres, or absent (local metres); origin on the aligned lattice (x0 / cell and y0 / cell within
    # 1e-6 of integers, as aligned_grid makes it); width * height <= MAX_CELLS; internal overviews present
    # whenever SurfaceWriter would build them (the same factor rule). A file SurfaceWriter wrote always
    # passes; a test pins that.

def compute_stats(path: Path, *, progress: Callable[[float, str], None] | None = None,
                  check_cancelled: Callable[[], None] | None = None) -> SurfaceStats: ...
    # The same SurfaceStats that SurfaceWriter.finish() returns, computed by a windowed pass over
    # read_windows(spec) (no read above MAX_READ) for a file that was not written by SurfaceWriter
    # (S3's copied DEM). The p02/p98 sample uses the same deterministic rule as the writer.

def hillshade(z: np.ndarray, cell_x: float, cell_y: float, *,
              azimuth: float = 315.0, altitude: float = 45.0) -> np.ndarray: ...
    # Horn gradient, NaN-aware. z is float (h, w); the result is uint8 (h, w): shade 1..255, and 0
    # wherever z is NaN or any of its 8 Horn neighbours is NaN (callers make 0 transparent). Grid edges
    # use edge-replicated neighbours, so callers wanting exact edges pass a one-cell halo and crop.
    # cell_x, cell_y are the effective cell sizes of `z` in metres (an overview read passes its
    # coarsened cell). The one hillshade in the app: S2's tiles (§8), S2's plan image (§10) and S3's
    # thumbnails and preview image all call it.
```

## 5. Building a surface (`surface_build` job)

### 5.1 Request, CRS and admission

`POST /surfaces` takes a `SurfaceBuildRequest`. The server resolves the defaults into
`build_params`:

| Field | Default | Rule |
| --- | --- | --- |
| `point_cloud_id` | required | the cloud must be `ready` |
| `name` | `"<cloud name> surface"` | |
| `method` | `median` | one of `median`, `mean`, `max`, `min` |
| `cell_size_m` | null (auto, §5.2) | 0.01–5.0 when given |
| `hole_fill_max_gap_m` | 1.0 | 0 turns filling off. Rings filled = ceil(gap / (2 × cell)), capped at 8. |
| `despike_m` | 1.0 | null turns despiking off |
| `z_clip` | null | `[lo, hi]`; points outside are dropped and counted |
| `drop_noise_classes` | true | drops LAS classification 7 and 18. Withheld points are always dropped. |
| `assume_metres` | false | must be true when the cloud has no CRS; otherwise 422 |

CRS rules, from `PointCloud.crs_wkt`:

- **Projected, in metres:** used as is.
- **Geographic:** points are transformed per chunk to the WGS84 UTM zone of the cloud's centre.
  The grid bounds come from the densified bounds edges, the way `Georef` does it, and the source
  EPSG goes into `stats.reprojected_from_epsg`.
- **Projected, not in metres:** 422, "feet-based clouds are not supported; export the cloud in a
  metric CRS".
- **No CRS:** needs `assume_metres`. The surface is labelled "local coordinates".

Admission checks run before the job is queued, and fail with 422:

- The source file must exist and have the size S1 recorded ("source file not found at `<path>` —
  reconnect the drive or re-import").
- Free disk on the project's volume must be at least `8 B × point_count × 1.25` (spill) plus
  `4 B × estimated cells` (raw and final grids): code `insufficient_disk`.
- The grid must have at most `MAX_CELLS` cells at the chosen cell size: code `grid_too_large`,
  naming the smallest cell size that fits.

### 5.2 Cell size

Pass 0 runs only in auto mode. It streams the points once (laspy `chunk_iterator(2_000_000)`) into
an occupancy count grid:

- The count grid's cell is `max(1 m, sqrt(extent_area / 16 M))`, so it holds at most 64 MB of
  int32.
- `density` is the **median** count over occupied cells, divided by that cell's area. The median
  keeps a dense structure from dragging the estimate.
- `spacing = 1 / sqrt(density)`.
- `cell` is the smallest value on the ladder **[0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1.0, 2.0] m** that
  is at least `2 × spacing × (1 − 1e-6)`, which averages about 4 points per cell. The tolerance
  stops float noise from pushing 0.2 up to 0.25. It moves up the ladder until the grid holds at most
  `MAX_CELLS`. If even 2.0 m is too many cells, the request fails with `grid_too_large`.

`density_per_m2`, `spacing_m` and `auto_cell` are stored in `stats`. An explicit cell smaller than
`2 × spacing` builds as asked, and `stats` shows the expected empty fraction, `exp(−(cell/spacing)²)`.

### 5.3 Per-cell statistic: why the median

These figures were measured on 2026-09-23 with a synthetic cloud:

- a cone of R 10 m and H 5 m on a tilted plane, closed form 523.599 m³;
- uniform random points with Gaussian vertical noise;
- outliers at −50 m or +30 m;
- neighbour-average gap filling as in §5.6.

The script is `vol_stats2.py` in the session scratchpad. The table shows the volume error against
the closed form:

| Points/m² | σ noise | Outliers | Cell | median | mean | max | min |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 2 cm | 0 | 0.2 | +0.13% | +0.12% | +2.52% | −1.92% |
| 100 | 2 cm | 0.01% | 0.2 | +0.13% | +0.11% | +2.53% | −1.95% |
| 100 | 3 cm | 0.1% | 0.2 | **+0.31%** | +0.82% | +7.38% | −2.56% |
| 25 | 3 cm | 0.01% | 0.4 | +0.20% | +0.34% | +5.44% | −3.58% |
| 400 | 2 cm | 0.01% | 0.1 | +0.18% | +0.22% | +2.48% | −1.37% |
| 100 | 3 cm | 0.1% | **0.1** (1.6 pts/cell) | −2.62% | −2.55% | −0.74% | −3.84% |

The last row is the cell-size lesson: 1 657 cells in the polygon stayed nodata, and the volume
dropped. That row is why nodata is always reported (§6.6), and why the auto cell size is chosen as
it is.

- **median** is the default. It is unbiased under symmetric noise and has a 50% breakdown point.
- **mean** is offered for comparison with tools that use it; CloudCompare's "average height" is
  one (§7.3).
- **max** ("Highest point — structures") and **min** ("Lowest point") are offered, and the dialog
  states their bias.

### 5.4 Tiled pipeline (RAM bounded by block, not by site)

The grid is `aligned_grid(bounds_native[xy], cell, crs)`. Each block is 512 × 512 cells, the same
as the TIFF tile.

| Pass | Work | Memory |
| --- | --- | --- |
| **1 · bin** | Stream chunks of 2 M points and apply the drops (noise class, withheld, Z clip). Reproject if the cloud is geographic. Compute the cell index. Append `(uint32 cell-in-block, float32 z)` into a RAM buffer per block. When the buffers total more than `BIN_BUFFER_BYTES` (256 MiB), the largest ones are appended to `.build/bins/<br>_<bc>.bin` (open, append, close, so at most one file handle is open) until the total is under half the cap. At the end, everything is flushed. | ≤ 256 MiB of buffers, plus one laspy chunk (~150 MB) |
| **2 · reduce** | For each non-empty block file, in row-major order: load it, `np.lexsort((z, cell))`, then take per-cell counts, the statistic (median = middle value, or the mean of the two middle values) and the count. Write `z` and `count` to `.build/raw.tif` (float32, two bands, same grid, uncompressed tiles). A block file with more than `REDUCE_MAX_POINTS` (16 M) points is reduced in row bands (512 / 2ᵏ rows), each read by chunked filtering of the file, so a step never holds more than 16 M points. | ≤ ~600 MB (16 M × z, cell, sort index and working copies) |
| **3 · finish** | For each block, read raw.tif with a halo of `max(1, rings)` cells, despike (§5.5), fill holes (§5.6), and write the interior with `SurfaceWriter.write_block`. `finish()` builds the overviews and renames. | ≤ ~50 MB |

Progress messages look like these:

- "reading points 42.0 M / 195.0 M" (0–45%);
- "gridding block 120 / 400" (45–80%);
- "filling gaps 120 / 400" (80–95%);
- "building zoom levels" (95–100%).

**Cancel** is checked between chunks and between blocks. On cancel, the partial files and `.build/`
are deleted, **the `Surface` row is deleted**, and `surfaces.changed` is published. **A failure**
sets `failed` with the readable error and deletes `.build/`. `.build/` is also removed after
success.

The peak target, for any site size and point count, is **1.5 GB or less** for the backend process.
That is 256 MiB of buffers, a 150 MB chunk and a 600 MB reduce step, plus the Python and GDAL
baseline.

The disk target is `8 B × points` of spill plus the raw grid. For 195 M points that is about 1.6 GB
of spill, deleted at the end.

### 5.5 Noise

1. **Per point:** LAS classes 7 (low noise) and 18 (high noise) are dropped when present, withheld
   points are always dropped, and the optional Z clip applies. **There is no automatic global
   fence.** The spike's cloud has real structure 235 m above ground (Z −45 to +190), and
   percentile or IQR fences would cut it.
2. **Per cell:** the median ignores a minority of wild points in any cell with 3 or more points.
3. **Despike (pass 3):** a cell is set to NaN when its point count is 2 or less **and**
   `|z − median(valid 8-neighbours)| > despike_m` (default 1.0 m). This catches the isolated noise
   points (1 915 below −52 m in the real file) that land alone in a sparse cell. The count
   condition protects real edges, such as a pile face or a wall, which are backed by many points.
   Despiked cells can then be hole-filled. Their number is `stats.cells_despiked`.

### 5.6 Hole filling

Filling is iterative for `rings` iterations. In each iteration, a NaN cell becomes the mean of its
valid 8-neighbours **only if at least 5 of the 8 are valid**.

- Holes up to `2 × rings` cells wide inside the data are closed. With the defaults at a 0.2 m cell,
  that means rings = 3 and gaps up to about 1.2 m.
- A cell on a straight data edge has only 3 valid neighbours, so the surface **never grows outward**.
- Larger gaps (under a roof overhang, water, dark shadow) stay NaN and surface as `nodata_area_m2`
  in every volume that touches them.
- `stats.cells_filled` is recorded.

This rule is exactly what the measurement in §5.3 used. Filled cells are not tracked per cell (a
design choice, see Risks); they are bounded in size by construction.

## 6. Volume maths (`volume_calc` job)

### 6.1 Conventions

`dz = top − base` per cell. When `apply_shift` is on, `dz = top − (base + shift)`.

- `fill_m3 = Σ max(dz, 0) × A`: material **above** the base.
- `cut_m3 = Σ max(−dz, 0) × A`: material **below** the base.
- `net_m3 = fill_m3 − cut_m3`.
- `A = cell_size²`. Sums are float64.

The same three numbers are **labelled by base kind** everywhere (UI, PDF, CSV headers carry both
the label and the stored name):

| Base kind | fill label | cut label | Headline |
| --- | --- | --- | --- |
| toe plane / toe surface / flat | "Stockpile volume (above base)" | "Below base" | fill |
| surface = an earlier survey | "Added since <date> (fill)" | "Removed since <date> (cut)" | net |
| surface = a design | "Above design (to cut)" | "Below design (to fill)" | both |

The design row matches earthworks usage: existing ground above the design is material still to be
cut.

### 6.2 Polygon, cells and area

- **Cells in the polygon:** `rasterio.features.geometry_mask(..., all_touched=False)` per window.
  A cell counts **if its centre is inside** (GDAL's rule).
- `area_m2` is the cells inside the polygon, minus excluded cells, × A.
- `polygon_area_m2` is shapely's exact area of the polygon, minus the exclude polygons. The two
  are shown side by side; their difference is the rasterisation error, 0.03% or less on the
  fixtures.
- **Grid versus ground:** areas and volumes are **grid** quantities in the CRS. The areal scale
  factor at the polygon centroid (`pyproj.Proj(crs).get_factors(lon, lat).areal_scale`) is stored
  as `areal_scale_factor` and printed with the percentage it implies. In UTM this is 0.08% or
  less. Nothing is corrected silently.
- **Validation (422):** the polygon must be valid and simple, cover at least 25 cells, have at most
  5 000 vertices, and intersect the top grid. A `top_surface_id` must be in the same CRS as the
  stored polygon (422 otherwise, on create and on PATCH). A base surface may be in any CRS (§6.4).

### 6.3 Bases

**Edge samples**, for the three toe kinds:

- The ring is densified at a step of one cell (at most 20 000 samples; the step grows beyond that).
- The top surface is sampled at each point with `sample_bilinear`.
- Samples that are NaN, or inside any patch or exclude region, are dropped. The toe comes from
  **observed** ground only.
- `usable_edge_fraction` is the share of samples kept. Below 0.5, the job fails: "the polygon edge
  runs over N m of missing or masked ground — redraw the edge on bare ground". Below 0.8, it warns
  (`edge_coverage_low`).

| Kind | Model | Fit-quality output |
| --- | --- | --- |
| `toe_plane` | A least-squares plane `z = a·x + b·y + c`, with x and y centred on the ring's mean. Residuals r give `s = 1.4826·MAD(r)`. Samples with `|r| > max(3s, 0.05 m)` are rejected and the plane is refitted once. It needs 10 or more kept samples whose xy covariance has its smaller eigenvalue at least (0.5 m)²; otherwise the job fails with "edge too short or too straight for a plane". | samples, rejected, `rms_m` of kept residuals, plane `[a, b, c]` |
| `toe_surface` | Samples are ordered along the ring. A circular running median over 5 samples is taken. Samples with `|z − runmed| > max(3s, 0.05 m)` are rejected, where `s = 1.4826·MAD(z − runmed)`. A Delaunay TIN is built on the kept samples (`scipy.spatial.Delaunay`), and `LinearNDInterpolator` is evaluated per window at the cell centres. A cell outside the TIN hull takes the robust-plane value, and those cells are counted. | samples, rejected, `rms_m` of `z − runmed` |
| `flat` | `z` as given. The UI's "pick on map" sets it from `GET /surfaces/{surfaceId}/sample`. | edge `rms_m` about z, **information only** |
| `surface` | `resample_onto(base_reader, top_grid, window)` (§4, R1–R3). It is **patched with the same clutter regions** as the top (§6.5), because the earlier survey may have had machines too. | none; see alignment |

`base_fit_poor` warns when a toe `rms_m` is above 0.10 m: the toe isn't planar or smooth, and the
choice of base kind matters.

### 6.4 Grid alignment rules, top against base surface

The computation grid is always the **top** grid.

| Case | Handling |
| --- | --- |
| Same CRS, same cell, lattice offset a whole number of cells (`same_lattice`) | R1: exact, with no interpolation. This is the normal case for two S2 surfaces at the same cell size, and for S3 designs rasterised on the top lattice. |
| Same CRS, different cell or offset | R2: bilinear at the top cell centres, strict NaN. A base cell finer than half the top cell is averaged down first. |
| Different CRS | R3: the centres are reprojected with pyproj, then R2. Heights are **not** datum-converted; the alignment check exposes offsets. |
| Base does not cover a top cell | NaN, which counts as nodata. |

### 6.5 Clutter masks and exclusions

**Detection footprints** (`app/volumes/footprints.py`), for each run in `masks.detection_run_ids`:

1. The run must be `succeeded` and its map must have a CRS. Otherwise the job fails, naming the
   run.
2. The polygon's bbox is buffered by `buffer_m + 5 m`, transformed into the map's CRS (densified
   edges, `pyproj`), and then into map pixels through the inverse of the map's affine.
3. The query is `MapDetection` rows in that pixel bbox with `confidence >= run.conf` (the export
   rule), filtered by `class_ids` when it is set. There is no 5 000 cap here: the bbox bounds it,
   and a hard ceiling of 20 000 footprints per measurement fails with a message.
4. Each box becomes a footprint:
   - `box_corners(x, y, w, h, angle)` (rotated boxes included);
   - `Georef.pixel_to_native` into the map's CRS;
   - then, **when the map's CRS differs from the surface's**, `Transformer(map → surface, always_xy)`;
   - then a shapely `Polygon`, buffered by `buffer_m` (default **1.0 m**, 0–5).

   The buffer covers the photogrammetric smear and shadow around a vertical object; ortho-to-cloud
   registration within one flight is centimetres.

Runs offered for masking are grouped in the UI as "same flight as top", "same flight as base" and
"other maps". Runs from other maps trigger a `mask_other_flight` notice: machines move between
flights.

**Regions.** Before any cell is touched, these are formed:

- **Patch regions** are `unary_union(footprints ∪ exclusions[mode=patch])`, split into polygon
  parts.
- **Exclude regions** are `exclusions[mode=exclude]`.
- A patch part larger than **400 m²** (`MAX_PATCH_AREA_M2`) is not interpolated: guessing across
  20 × 20 m is not an estimate. Its cells become nodata, with the warning `patch_too_large`.

**Patching one part P.** It reads its own small window:

- The ring band is `buffer(P, w) − P`, with `w = max(2·cell, 0.3 m)`. The ring cells are those
  whose centres fall in the band, that are valid, and that are outside every other region.
- There must be at least 8 ring cells, covering at least 3 of the 4 quadrants around P's centroid.
  Otherwise P's cells become nodata (`patch_failed`).
- P's cells take a linear TIN of the ring cells. Cells outside the TIN hull take the ring's
  least-squares plane.
- `rms_p` is the RMS of the ring about that plane, and feeds the patch term (§7.1).

Cells for masks are rasterised with `all_touched=True`: a machine touching a cell corrupts it.
The measurement polygon keeps the cell-centre rule.

### 6.6 Nodata: reported, never zero

A cell inside the polygon and not excluded is **nodata** when:

- the top is NaN;
- or the base is NaN;
- or a patch failed.

Nodata cells contribute nothing to fill or cut. This is stated beside every number:

- `nodata_area_m2`;
- the nodata uncertainty term (§7.1), which puts a size on the missing volume;
- `nodata_high`, which warns above 2% of `area_m2` and is **danger** above 10%.

The PDF prints "No data: X m² (Y%) — volume there is unknown, estimated ± Z m³".

### 6.7 Stable-area alignment check and vertical shift

This applies only when `base.kind = surface` and `alignment.stable_polygon` is set.

1. Over the stable polygon's cells, take those valid in both surfaces and not in any region, and
   compute `d = top − base_resampled`. A deterministic stride keeps the sample at 4 M cells or
   fewer; `n_cells` records the number used.
2. The statistics are:
   - `median_dz` = median(d);
   - `mad` = median(|d − median_dz|);
   - `sigma` = 1.4826·mad.
3. The tilt is a least-squares plane of d on centred x and y, fitted after dropping
   `|d − median| > 3·sigma`. `tilt_mm_per_m` is 1000·√(a² + b²), and `span_m` is the bbox diagonal
   of the stable cells.
4. When `apply_shift` is on, `shift_applied_m = median_dz`. The main result then uses the shifted
   dz, and `unshifted` stores the totals computed without it. **Both totals are always computed,
   in the same pass.**

| Check | Threshold | Severity and message |
| --- | --- | --- |
| `stable_area_small` | `n_cells < 400` or area < 50 m² | warn; no statistics, no shift possible, and the alignment term is missing (uncertainty incomplete) |
| `alignment_offset` | `|median_dz| > 0.03 m` and no shift applied | warn: "surveys differ by X m on stable ground; apply the shift?" |
| `alignment_datum` | `|median_dz| > 2 m` | danger: "different height references (ellipsoidal vs sea level?)" |
| `alignment_noisy` | `sigma > 0.05 m` | warn: "stable area disagrees by ±X m — is it really unchanged, or are the surveys offset horizontally?" |
| `alignment_tilt` | `tilt_mm_per_m > 0.5` and `tilt_mm_per_m × span_m / 1000 > 0.025 m` | warn: "tilted by X mm/m: a vertical shift cannot correct this; tie both flights to the same control" |
| `no_stable_area` | base kind is surface with no stable polygon | warn; alignment term missing |

The thresholds follow typical photogrammetric vertical accuracy of about 1–3 × GSD, which is 2–5
cm at the operator's GSDs. They are constants in `app/volumes/engine.py`, and the PDF prints them.

### 6.8 The job, step by step

1. **Load and validate.** Load the measurement, the surfaces (they must be `ready`) and the runs,
   and compute the `inputs` snapshot and the fingerprint (§6.10).
2. **Build regions.** Build the footprints, then the patch and exclude regions (§6.5).
3. **Alignment.** When it applies (§6.7), read over the stable polygon's bbox.
4. **Base model.** For the toe kinds, sample the edge and fit (§6.3).
5. **Measure.** For each window from `read_windows(top, window_for_bounds(polygon bbox))` (at
   most 2048², BLOCK-aligned):
   - read the top;
   - build the base for the window;
   - rasterise the polygon, the exclude regions and the patch regions;
   - patch the top (and, for a surface base, the base);
   - classify each cell as measured, patched, excluded or nodata;
   - accumulate fill and cut (shifted and unshifted), cell counts, `Σ|dz|` and the cell-size
     sensitivity sums (§7.1);
   - write the dz block to `volumes/<id>/diff.tif.partial` through `SurfaceWriter`, on the
     `crop` of the top grid to the polygon bbox, expanded outward to BLOCK edges so every window
     is aligned.

   Progress reads "window i / n". Cancel is checked per window.
6. **Finish.** Compute uncertainty and warnings, write `results` and `status = ready`, rename
   `diff.tif`, and publish `volumes.changed`.

**Cancel or failure** deletes the partial diff and puts the status back:

- `stale` if earlier results exist;
- `failed` (with the readable error) otherwise.

### 6.9 `VolumeResults`

| Field | Meaning |
| --- | --- |
| `fill_m3`, `cut_m3`, `net_m3` | §6.1 (shift applied if chosen) |
| `unshifted` | `{fill_m3, cut_m3, net_m3}` or null |
| `area_m2`, `polygon_area_m2`, `measured_area_m2`, `masked_area_m2`, `excluded_area_m2`, `nodata_area_m2` | §6.2–6.6. `measured_area_m2` includes the patched cells: `measured = area − nodata`, `masked ⊆ measured`. |
| `cell_size_m`, `areal_scale_factor` | §6.2 |
| `shift_applied_m` | 0 unless applied |
| `alignment` | the measured block (§6.7) or null |
| `base_fit` | `{kind, samples, rejected, usable_edge_fraction, rms_m, plane}` or null |
| `uncertainty` | `{total_m3, base_m3, alignment_m3, cell_size_m3, nodata_m3, patch_m3, complete}` (§7.1) |
| `warnings` | `[{code, severity: warn \| danger, message}]` |
| `footprints_used`, `patch_regions`, `diff_scale_m` | counts, and the symmetric colour scale: p98 of \|dz\| over the measured cells, at least 0.1 m |
| `top_surface`, `base_surface` | provenance snapshots: `{id, name, kind, method, cell_size_m, captured_on, cloud_file, cloud_sha256}` |
| `inputs`, `inputs_fingerprint`, `engine_version` | §6.10 |
| `computed_at`, `duration_s` | |

### 6.10 Stale

`inputs` is a canonical dict of:

- `polygon_native`, `top_surface_id` with that surface's `job_id`, and `base` (plus the base
  surface's `job_id`);
- `masks`, with each run's `{id, finished_at, kept}`: `kept` is, per class, the count and the
  integer sums (thousandths of a pixel) of x, y, w, h and angle of the boxes the masking uses (not
  rejected, at or above the run's confidence), so swapping which box is rejected or redrawing one
  changes it (follow-up fix wave, 2026-09-26; masked measurements calculated before it turn
  stale once, with "masks: detection run changed");
- the alignment inputs;
- `engine_version` (a constant in `app/volumes/engine.py`, bumped on any maths change).

`inputs_fingerprint` is the sha256 of its canonical JSON.

- **PATCH** of any field other than `name` sets `stale` (409 while `calculating`).
- **GET and list** recompute the fingerprint. The cost is a few indexed lookups. A `ready`
  measurement whose fingerprint differs becomes `stale`, and `volumes.changed` is published.
  `stale_reasons` (response only) names the top-level `inputs` keys that differ, for example
  "masks: detection run deleted".
- A detection review (accept/reject/unreview/reclass), a box drawn by a person, and deleting a
  run or its map refresh every measurement masking with that run at once and publish
  `volumes.changed`.
- A surface used by any measurement **cannot be deleted** (409, naming them).
- A deleted map run leaves the measurement stale. Recalculating then fails with "run X no longer
  exists", and the UI offers to remove it.
- `volume_export` refuses stale or failed measurements (409): an exported number always matches
  its inputs.

## 7. Accuracy statement

### 7.1 How uncertainty is reported

Every result shows "± U m³ (indicative)" and lists each term. `A_m` is `measured_area_m2`.

| Term | Formula | Meaning |
| --- | --- | --- |
| `base_m3` (toe kinds) | `A_m × base_fit.rms_m` | How far the real toe departs from the base model. It is conservative: correlated across the area. |
| `base_m3` (flat) | 0 | A flat base is exact by definition; the edge `rms_m` is shown as information. |
| `alignment_m3` (surface) | `A_m × sigma`, or `A_m × √(median_dz² + sigma²)` when the shift is not applied | Repeatability between the two surfaces on unchanged ground, including a known, uncorrected offset. It is null when there is no usable stable area (`complete = false`). |
| `cell_size_m3` | `|V_fill(2c) − V_fill(c)| × (valid cells / cells in full 2 × 2 blocks)` | Recomputed in the same pass on 2 × 2 block means of top and base, over blocks whose four cells are all measured. It captures how much the answer depends on the grid. |
| `nodata_m3` | `nodata_area_m2 × mean(|dz|)` over the measured cells | The size of what is missing. |
| `patch_m3` | `Σ area(P) × rms_p` | How uneven the ground around each patched machine is. |
| `total_m3` | root-sum-square of the non-null terms | Headline ±, marked "incomplete" when a term is missing. |

The PDF states what is **not** included:

- the survey's own georeferencing accuracy (from the Pix4D quality report);
- heights reference, stored as the cloud stores them (the chimney file is ellipsoidal: ground is
  at about −45 m);
- grid versus ground scale (the factor is printed).

### 7.2 Analytic fixtures (pytest; generated at test time)

These fixtures were measured on 2026-09-23 by evaluating the closed-form surfaces at the cell
centres on an offset origin (`vol_fixtures.py` in the session scratchpad).

- Every fixture sits on the **tilted** plane `z = 50 + 0.02·(x − x0) − 0.013·(y − y1)`.
- The origin is offset by (+0.037, −0.021) m.
- Shapes are rotated by non-right angles, per `vault/decisions/2026-09-20-gotcha-symmetric-fixtures-make-tests-that-cannot-fail.md`.

| Fixture | Closed form | Measured worst error (0.05–0.5 m cells) | Test tolerance |
| --- | --- | --- | --- |
| Cone R 10, H 5, polygon a circle of R 12, base toe plane | πR²H/3 = 523.599 m³ | 0.002% | 0.1% |
| Box 20.3 × 12.7 × 2 m rotated 30°, polygon a circle of R 16, base toe plane | 515.620 m³ | 0.025% | 0.1% |
| Frustum: square base 20, top 8, H 4, rotated 17°, toe plane | H/3·(A₁ + A₂ + √(A₁A₂)) = 832.000 m³ | 0.000% | 0.1% |
| Cut/fill: cone up (R 8, H 3) plus inverted cone (R 6, D 2), top raised 0.07 m, stable strip away from both, surface base, shift applied | fill 201.062, cut 75.398 m³; shift 0.0700 | 0.005%; shift exact | 0.1%; shift ±0.001 m |
| The same, without the shift | fill and cut include 0.07 × area | exact | 0.1% |
| Toe plane on a tilted plane, with 10% of the edge samples pushed +0.8 m (a pile bleeding over the edge) | the plane recovered | n/a | a, b within 1e-4; c within 5 mm; `rejected` equals the pushed count |
| Base on another lattice: cell 0.25 against 0.1, origin offset 0.037 m, base = the plane | bilinear of a plane is exact | n/a | |Δz| < 1e-4 m per cell |
| Base in another CRS: top EPSG:32639, base EPSG:3857, both the same tilted plane in the top CRS | same | n/a | |Δz| < 1 mm |
| Machine box 3 × 2 × 2.5 m on the cone's flank; a detection on a synthetic map in **EPSG:4326** (so the reprojection path is taken); buffer 0.5 m | the cone volume | n/a | 0.5% with masking; without masking, cone + 15 m³ within 0.5% |
| Hole of 6 × 6 cells cut from the cone | cone volume minus the hole's dz | n/a | `nodata_area_m2` = 36·A exactly; the nodata term > 0 |
| End to end: synthetic laspy cloud (100 pts/m², σ 3 cm, 0.1% outliers) → `surface_build` median at auto cell → volume | 523.599 m³ | +0.31% (the §5.3 simulation) | 0.6% |

### 7.3 Cross-check against CloudCompare (acceptance; the operator runs it)

The independent tool is CloudCompare 2.13, *Tools › Volume › Compute 2.5D volume*. It runs on the
operator's chimney file, and the numbers go into `docs/evidence/volumes-crosscheck.md` with
screenshots.

1. **Choose the rectangle.** The operator picks a mound on the site. The rectangle R has its
   corners on multiples of 0.1 m in EPSG:32639 and is about 100 × 80 m.
2. **CloudCompare side:**
   - *Edit › Crop* the cloud to R;
   - *Compute 2.5D volume* with ceil = the cropped cloud, ground = constant height H (the
     operator's toe level, about −45 m), step 0.1 m, cell height "average", empty cells "leave
     empty";
   - record Added, Removed and Surface.
3. **Kestrel side:** build a surface with method `mean`, cell 0.1, `hole_fill_max_gap_m` 0,
   despike off and `drop_noise_classes` false. Measure polygon R against a flat base at H.
4. **Pass:** fill against Added and cut against Removed within **0.5%**, and the area matches the
   Surface value within 0.5%. CloudCompare's grid starts at the cropped points' bbox, so edge
   cells differ by up to one cell; that is the tolerance.
5. **Repeat at step 0.25 m.** Then record the Kestrel default (median, auto cell, hole fill) on
   the same R as information: it shows the effect of the defaults.
6. **Two-surface.** Ground = the +0.100 m copy of the cloud from §1. CloudCompare's Removed should
   be about Surface × 0.100. Kestrel without the shift must agree within 0.5%. With a stable area
   and the shift applied, Kestrel's net must be within ± U of 0.

## 8. Tiles and sampling (synchronous, bounded)

| Endpoint | Work | Bound |
| --- | --- | --- |
| `GET /surfaces/{surfaceId}/tiles/{z}/{x}/{y}?tint=` | Hillshade in the surface's pixel grid, the same tiling as maps (reusing `app.maps.tiles.max_zoom` and `tile_window`). **One** `SurfaceReader.read` of the tile window, expanded by one output pixel on each side, into a 258 × 258 `out_shape` (overviews, average). `grid.hillshade` (§4) with the effective cell `cell × 2^(max_zoom − z)`, azimuth 315°, altitude 45°, cropped to the 256² interior. `tint=true` multiplies by a muted 5-stop hypsometric ramp across `stats.z_p02…z_p98`, or across `z_min…z_max` when `stats` is null (design surfaces). NaN (shade 0) is transparent. PNG. 204 when the tile is outside the grid or all NaN. | 1 read of ≤ 258² output; LRU of 512 tiles; `Cache-Control: immutable` (surfaces never change) |
| `GET /surfaces/{surfaceId}/ortho-tiles/{z}/{x}/{y}?map_id=` | The map's display raster warped into this tile. The map is opened at the overview level whose resolution is at or below the tile's (`rasterio.open(..., overview_level=k)`), then `WarpedVRT(crs=surface CRS, transform=tile transform, width=256, height=256, resampling=bilinear)` is read. JPEG, or PNG when it holds nodata. 204 when there is no overlap. 422 when the map or the surface has no CRS. | 1 warped read of 256² from one overview level; LRU keyed with `map_id` |
| `GET /volumes/{measurementId}/diff-tiles/{z}/{x}/{y}?v=` | `diff.tif`, read in the **top surface's** tile grid: the diff grid is an integer-block offset of the top grid. Diverging red (below base) and blue (above base), symmetric at ±`diff_scale_m`, with a ±0.02 m neutral band. `v` = `computed_at` for cache busting. | 1 read; immutable per `v` |
| `GET /surfaces/{surfaceId}/sample?x=&y=` | `sample_bilinear` at one native point: `{x, y, z}`, with `z` null for nodata. Used for the cursor readout (throttled to 150 ms in the client) and for "pick on map". | one read of 2 × 2 cells |
| `GET /volumes/{measurementId}/footprints` | The **same** `footprints.py` code the job uses, returning buffered rings in the surface CRS for display, `truncated` past 5 000 | bbox-bounded query plus transforms |

## 9. Volumes screen (`/p/:projectId/volumes[/:measurementId]`)

The screen copies the MapsScreen work surface. It uses only `frontend/src/ui/` primitives,
DESIGN.md (Contour), and `check-tokens` must pass. Data colours (hillshade, cut/fill) come
server-side as PNG, so no raw colours appear in the TSX. Vector styles use `tokenColour` the way
`labelLayers.ts` does.

**Layout**

- **Left column** (`w-52` / `xl:w-64`):
  - **Surfaces**: name, a kind pill ("From cloud" or "Design"), cell size, survey date (the
    cloud's `captured_on`), status with job progress. A "Build surface" button, and next to it S3's
    "Import design surface" button, which opens S3's dialog (S3 §11; design import has no nav entry
    of its own). Failed rows offer "Build again" and "Delete".
  - **Measurements**: name, headline number and unit, a status pill (Ready ok / Stale warn /
    Calculating / Failed danger). A "New measurement" button, enabled once a ready surface is
    selected.
- **Centre** `SurfaceView` (`frontend/src/volumes/SurfaceView.tsx`). It is `MapView`'s pattern,
  with the surface's `width`, `height` and `tile_grid` fed to the same `makeTileGrid` and
  `olExtent`. Its layers, bottom up:
  - ortho underlay (when the top surface's cloud has a `map_id`; a Switch, "Ortho");
  - hillshade (an opacity slider: 100% with no ortho, 35% with the ortho);
  - cut/fill overlay after results (a Switch);
  - detection footprints (warn outline);
  - exclusions (patch: danger dashed; exclude: danger hatched);
  - stable area (ok dashed);
  - measurement polygon (accent, 2 px).
- **Toolbar**, top-left: Pan `V`, Draw measurement `P`, Stable area `S`, Exclusion `X`, Edit
  vertices `E`. `Del` deletes the selected exclusion and `Esc` cancels a drawing.
  - Drawing and modifying use the `Draw` and `Modify` interactions as in `labelLayers.ts`.
  - Every finished geometry is converted pixel → native with the north-up affine, then POSTed or
    PATCHed immediately. Nothing is held unsaved.
  - "Revert to last calculated inputs" PATCHes back `results.inputs`. It is the one-step undo.
- **Bottom bar:** E and N (native, EPSG), Z of the top, and for a surface base also Z of the base
  and dZ; a scale bar from `cell_size_m`.
- **Right `aside`** (`w-72` / `xl:w-80`), with `Segmented` tabs **Measure | Results**.
  - **Measure:**
    - name;
    - top surface (a Select of ready surfaces **in the same CRS** as the polygon);
    - base, a Select of "Stockpile toe — plane", "Stockpile toe — fitted surface", "Flat level"
      (an Input in metres plus "Pick on map", and the hint "heights as stored in the cloud; this
      site's ground is near −45 m") and "Another surface". The last one offers a Select of
      surfaces sorted by date with a Design pill, "Draw stable area", its statistics after a
      calculation, and a Switch "Correct vertical shift";
    - clutter: a Checkbox per run, grouped by flight, showing map, model, date and count; a
      buffer Input; a class filter Disclosure; the exclusion list with a mode Select and delete;
    - **Calculate** (primary), with a `Progress` bar while the job runs.
  - **Results:**
    - the headline numbers with the labels from §6.1;
    - net and "± U m³ (indicative)";
    - an areas table (polygon, measured, patched, excluded, no data);
    - alignment verdict as an `Alert` whose tone follows the worst warning;
    - base fit;
    - a Disclosure "How sure is this?" listing the uncertainty terms;
    - warnings as `Alert`s;
    - buttons "View in 3D" and "Export…".
  - A stale measurement shows `Alert` warn with "Inputs changed: <stale_reasons> — Recalculate".
- **View in 3D** is enabled when the top is a `cloud_dsm` with a cloud. It navigates with S1's
  canonical deep link (S1 §10), `/p/:projectId/clouds/:cloudId?at=x,y[&fp=…]`, whose coordinates
  are in the **cloud's** native CRS: the polygon centroid as `at`, and the polygon's bbox corners as
  `fp`. The surface CRS equals the cloud's unless the build reprojected a geographic cloud
  (`stats.reprojected_from_epsg`); then the points are converted with proj4 first.
- **Empty states:**
  - no clouds: "Import a point cloud first" with a link to Point clouds;
  - clouds but no surfaces: "Build a surface from a point cloud";
  - a surface but no measurements: "Draw a polygon around a stockpile or a work area".
- **Build dialog** (`Dialog`):
  - cloud Select;
  - name;
  - method Segmented ("Median — recommended", "Mean", "Highest", "Lowest"), with the measured
    bias shown under the choice;
  - cell size Select ("Auto — about 4 points per cell", then the ladder);
  - "Fill gaps up to (m)";
  - an Advanced Disclosure for despike, Z clip, noise classes and "Assume metres" (shown only when
    the cloud has no CRS).
- **Export dialog** (`Dialog`):
  - measurements as a Checkbox list (only ready ones; stale ones disabled with the reason);
  - formats: PDF report, GeoPackage + cut/fill GeoTIFF, CSV, Excel;
  - report title (default: the project name);
  - Export. A job toast then offers "Open folder", as `ExportMapDialog` does.
- **Jobs:**
  - `useOnJobsFinished("surface_build" | "volume_calc", reload)`;
  - `useTrackedJob` for the progress bars;
  - `surfaces.changed` and `volumes.changed` refresh the lists.

## 10. Exports (`volume_export` job)

`POST /volume-exports {measurement_ids, formats, title?}` writes
`exports/<stamp>-volumes-<slug(title)>/`. It goes through `_reserve_partial_folder` / `_promote`
from `app.exports.job`, exactly like `app/maps/jobs_export.py`. Every measurement must be `ready`
(409 otherwise). Progress is reported per file, and cancel is checked between files.

| Format | Files | Contents |
| --- | --- | --- |
| **PDF** | `volumes-report.pdf` | A4 portrait, reportlab, Helvetica, footer "Kestrel AI · <date> · page n/N". **Page 1:** title, project, generated-at, and a summary table (name, base, fill, cut, net, ±, area, status). **One page or more per measurement:** a plan-view image; inputs (top and base surfaces with cloud file name, sha256 prefix, survey date, method, cell size, CRS/EPSG; base kind and parameters; mask runs, buffer, exclusions); results with the §6.1 labels; the areas breakdown (polygon exact and cells, measured, patched, excluded, no data with %); alignment check (n, median, MAD, σ, tilt, verdict, shift applied, unshifted totals); base fit; the uncertainty terms and total; warnings. **Last page: Method.** Prism formula, cell-centre rule, per-cell statistic and its measured bias, hole-fill and despike rule, masking and patching rule, the alignment thresholds, the uncertainty definitions and what is excluded, heights reference, grid versus ground factor, `engine_version`. |
| Plan-view image | inside the PDF | Composed with PIL (`app/volumes/plan_image.py`): the top surface over the polygon bbox plus 10% margin, read once at ≤ 2000 px (an overview read); `grid.hillshade`; the diff overlay at the same `out_shape`; polygon, stable area, exclusions and patch regions drawn from native coordinates; scale bar, north arrow, colour legend ±`diff_scale_m`. |
| **GeoPackage** | `volumes.gpkg`, one file per distinct CRS (`volumes-epsg<code>.gpkg` when more than one) | `app/maps/gpkg.write_gpkg`, unchanged, in the top surface's CRS. Layers: `measurements` (the polygon, with name, base_kind, base_detail, top_surface, base_surface, fill_m3, cut_m3, net_m3, uncertainty_m3, area_m2, measured_area_m2, masked_area_m2, excluded_area_m2, nodata_area_m2, shift_m, cell_size_m, computed_at), `stable_areas`, `exclusions` (mode), `clutter` (buffered footprints and patch parts; one feature per part, **exterior ring only**, because the writer writes single rings, and holes in clutter unions carry no meaning here). |
| Cut/fill raster | `<slug>-cutfill.tif` per measurement, plus `<slug>-cutfill.qml` | A copy of `diff.tif` (float32, NaN, CRS embedded, grid convention). The `.qml` is a QGIS singleband-pseudocolor style with the same red/blue ramp at ±`diff_scale_m`, which QGIS loads automatically. |
| **CSV** | `volumes.csv` | One row per measurement, in the same dialect as `geo_out.write_csv`. Columns: measurement_id, name, status, computed_at, base_kind, base_detail, top_surface, top_surface_date, base_surface, base_surface_date, epsg, cell_size_m, method, fill_m3, cut_m3, net_m3, uncertainty_m3, uncertainty_complete, area_m2, polygon_area_m2, measured_area_m2, masked_area_m2, excluded_area_m2, nodata_area_m2, shift_applied_m, align_median_dz_m, align_mad_m, align_n_cells, align_tilt_mm_per_m, base_fit_rms_m, areal_scale_factor, warnings (codes joined with `;`), centroid_x, centroid_y, centroid_lon, centroid_lat |
| **XLSX** | `volumes.xlsx` | openpyxl in write-only mode. Sheet **Volumes** holds the CSV columns as typed cells (`#,##0.0` for m³ and m², `0.000` for m, a frozen header). Sheet **Method** holds key/value inputs and parameters per measurement. Sheet **Warnings** holds measurement, code, severity and message. |
| `summary.json` | always | The measurements' `results`, plus the export parameters. |

## 11. Contract surface for F0

F0 implements everything in this section verbatim. It writes the contract, stubs every route with a
501 via `app/stubs.py`, and adds every operationId below to `EXPECTED_STUBS`. S2 removes the stubs
as it implements them.

- The path prefix is `/api/v1/projects/{projectId}`.
- New path parameters go in `components/parameters`: `surfaceId`, `measurementId`, and reuse of
  `z`/`x`/`y` as in `getMapTile`. The full cross-spec list, one owner per name, is in F0 (S1 §5
  item 1).
- **Request properties carry no `default:`**; the defaults go in descriptions, per the ADR
  `2026-09-20-gotcha-openapi-default-makes-a-field-required-in-typescript`.

### 11.1 Paths

| # | Method and path | operationId | Request | Response |
| --- | --- | --- | --- | --- |
| 1 | `GET /surfaces` | `listSurfaces` | none | 200 `SurfaceList` |
| 2 | `POST /surfaces` | `createSurface` | `SurfaceBuildRequest` | 202 `SurfaceWithJob`; 422 (`insufficient_disk`, `grid_too_large`, CRS, validation) |
| 3 | `GET /surfaces/{surfaceId}` | `getSurface` | none | 200 `Surface` |
| 4 | `PATCH /surfaces/{surfaceId}` | `patchSurface` | `SurfacePatch` | 200 `Surface` |
| 5 | `DELETE /surfaces/{surfaceId}` | `deleteSurface` | none | 204; 409 when used by a measurement or its job is live |
| 6 | `GET /surfaces/{surfaceId}/tiles/{z}/{x}/{y}` | `getSurfaceTile` | query `tint` (boolean, optional; false when absent) | 200 `image/png`; 204 |
| 7 | `GET /surfaces/{surfaceId}/ortho-tiles/{z}/{x}/{y}` | `getSurfaceOrthoTile` | query `map_id` (string, required) | 200 `image/jpeg` or `image/png`; 204; 422 |
| 8 | `GET /surfaces/{surfaceId}/sample` | `getSurfaceSample` | query `x`, `y` (number, required) | 200 `SurfaceSample` |
| 9 | `GET /volumes` | `listVolumeMeasurements` | none | 200 `VolumeMeasurementList` |
| 10 | `POST /volumes` | `createVolumeMeasurement` | `VolumeMeasurementCreate` | 202 `VolumeMeasurementWithJob` (creates it and queues `volume_calc`) |
| 11 | `GET /volumes/{measurementId}` | `getVolumeMeasurement` | none | 200 `VolumeMeasurement` |
| 12 | `PATCH /volumes/{measurementId}` | `patchVolumeMeasurement` | `VolumeMeasurementPatch` | 200 `VolumeMeasurement`; 409 while calculating |
| 13 | `DELETE /volumes/{measurementId}` | `deleteVolumeMeasurement` | none | 204; 409 while calculating |
| 14 | `POST /volumes/{measurementId}/calculate` | `calculateVolumeMeasurement` | none | 202 `VolumeMeasurementWithJob`; 409 while calculating |
| 15 | `GET /volumes/{measurementId}/diff-tiles/{z}/{x}/{y}` | `getVolumeDiffTile` | query `v` (string, optional) | 200 `image/png`; 204; 409 when there are no results |
| 16 | `GET /volumes/{measurementId}/footprints` | `getVolumeFootprints` | none | 200 `VolumeFootprints` |
| 17 | `POST /volume-exports` | `createVolumeExport` | `VolumeExportRequest` | 202 `JobRef`; 409 when a measurement is not ready |

Tags: `surfaces` (1–8, and every S3 design path in S3 §12) and `volumes` (9–17). S3's
design-import paths are S3's to define (S3 §12). They create `Surface` rows with `kind: design`,
which paths 1–8 serve unchanged, and `createDesignSurface` answers with this spec's
`SurfaceWithJob`.

### 11.2 Schemas

In the tables below, "req" means the property is in `required`, and "null" means it has type
`[T, "null"]`.

- **`SurfaceKind`**: enum `[cloud_dsm, design]`.
- **`SurfaceStatus`**: enum `[building, ready, failed]`.
- **`SurfaceMethod`**: enum `[median, mean, max, min, tin, delaunay, dem_resample, dem_copy]`, the
  full set a stored surface can carry. The first four are S2's cloud statistics; the last four are
  S3's design methods (S3 §3).
- **`SurfaceBuildMethod`**: enum `[median, mean, max, min]`, the request subset for a cloud build.

**`Surface`** (every property is req):

| Property | Type | Notes |
| --- | --- | --- |
| id | string | |
| name | string | |
| kind | `SurfaceKind` | |
| status | `SurfaceStatus` | |
| error | string, null | |
| point_cloud_id | string, null | |
| design_source | `DesignSource`, null | the schema is S3's (S3 §12); null for `cloud_dsm` |
| crs_wkt | string, null | |
| epsg | integer, null | |
| proj4 | string, null | derived from `crs_wkt` at response time; not a column |
| cell_size_m | number, null | null while building |
| width, height | integer, null | |
| geotransform | number[6], null | |
| bounds_native | number[4], null | |
| z_min, z_max | number, null | |
| coverage_fraction | number, null | |
| method | `SurfaceMethod`, null | null while building |
| build_params | `SurfaceBuildParams`, null | null for `design` |
| stats | `SurfaceBuildStats`, null | null for `design` |
| captured_on | string (date), null | read-through from the cloud |
| map_id | string, null | read-through from the cloud: the ortho of the same flight |
| tile_grid | `TileGrid`, null | the existing schema |
| measurement_count | integer | |
| job_id | string, null | |
| created_at | string (date-time) | |

Surface request and response wrappers:

- **`SurfaceList`**: `{items: Surface[]}`, items req.
- **`SurfaceBuildRequest`**: `point_cloud_id` (string, req). Optional:
  - `name` (string);
  - `method` (`SurfaceBuildMethod`; description "median when absent");
  - `cell_size_m` (number, null, 0.01–5; "auto when absent or null");
  - `hole_fill_max_gap_m` (number, 0–10; "1.0 when absent; 0 = off");
  - `despike_m` (number, null, 0.1–100; "1.0 when absent; null = off");
  - `z_clip` (number[2], null);
  - `drop_noise_classes` (boolean; "true when absent");
  - `assume_metres` (boolean; "false when absent").
- **`SurfaceBuildParams`**: the same fields, all req, with the defaults resolved. `cell_size_m`
  is the value actually used, and `auto_cell` is a boolean.
- **`SurfaceBuildStats`** (every property is req; named apart from `grid.py`'s `SurfaceStats`
  dataclass, which is a different thing): points_read, points_used (integer),
  points_dropped `{noise_class, withheld, z_clip}` (integer), density_per_m2, spacing_m (number,
  null), auto_cell (boolean), cells_valid, cells_despiked, cells_filled (integer), z_p02, z_p98
  (number, null), reprojected_from_epsg (integer, null), build_s (number).
- **`SurfacePatch`**: `name` (string, minLength 1), optional.
- **`SurfaceWithJob`**: `{surface: Surface, job: Job}`, both req. S2 owns it; S3's
  `createDesignSurface` returns it too.
- **`SurfaceSample`**: `{x: number, y: number, z: number | null}`, all req.

Measurement enums and building blocks:

- **`VolumeStatus`**: enum `[calculating, ready, failed, stale]`.
- **`VolumeBaseKind`**: enum `[toe_plane, toe_surface, flat, surface]`.
- **`VolumeBase`**: `kind` req; `z` (number, null); `surface_id` (string, null). The description
  says z is required for flat and surface_id for surface, enforced server-side with a 422.
- **`VolumeRing`**: an array of `[number, number]`, minItems 3, maxItems 5000.
- **`ExclusionMode`**: enum `[patch, exclude]`.
- **`ExclusionPolygon`**: `{id: string, ring: VolumeRing, mode: ExclusionMode}`, all req.
  `id` is client-generated (a UUID) so edits can target it.
- **`VolumeMasks`**: detection_run_ids (string[], req), class_ids (string[], null, req),
  buffer_m (number 0–5, req), exclusion_polygons (`ExclusionPolygon[]`, req).
- **`VolumeMasksInput`**: the same four properties, all optional. Defaults in descriptions: `[]`,
  null, 1.0, `[]`.
- **`AlignmentMeasured`**: n_cells (integer), median_dz, mad, sigma, tilt_mm_per_m, span_m
  (number), all req.
- **`VolumeAlignment`**: stable_polygon (`VolumeRing`, null), apply_shift (boolean) and measured
  (`AlignmentMeasured`, null), all req.
- **`VolumeAlignmentInput`**: stable_polygon (`VolumeRing`, null) and apply_shift (boolean), both
  optional; "null / false when absent".
- **`VolumeWarningCode`**: enum `[nodata_high, patch_too_large, patch_failed, edge_coverage_low,
  base_fit_poor, stable_area_small, no_stable_area, alignment_offset, alignment_datum,
  alignment_noisy, alignment_tilt, mask_other_flight]`.
- **`VolumeWarning`**: code (`VolumeWarningCode`), severity (enum `[warn, danger]`) and message
  (string), all req.
- **`VolumeTotals`**: fill_m3, cut_m3 and net_m3 (number), all req.
- **`BaseFit`**: kind (`VolumeBaseKind`), samples (integer), rejected (integer),
  usable_edge_fraction (number), rms_m (number) and plane (number[3], null), all req.
- **`VolumeUncertainty`**: total_m3 (number, null), base_m3, alignment_m3, cell_size_m3,
  nodata_m3, patch_m3 (number, null) and complete (boolean), all req.
- **`SurfaceRef`**: id, name (string), kind (`SurfaceKind`), method (`SurfaceMethod`, null), cell_size_m
  (number), captured_on (date, null), cloud_file (string, null) and cloud_sha256 (string, null),
  all req.

**`VolumeResults`**:

- Required: fill_m3, cut_m3, net_m3, area_m2, polygon_area_m2, measured_area_m2, masked_area_m2,
  excluded_area_m2, nodata_area_m2, cell_size_m, areal_scale_factor, shift_applied_m,
  diff_scale_m, duration_s (all number); footprints_used, patch_regions (integer); unshifted
  (`VolumeTotals`, null); alignment (`AlignmentMeasured`, null); base_fit (`BaseFit`, null);
  uncertainty (`VolumeUncertainty`); warnings (`VolumeWarning[]`); top_surface (`SurfaceRef`);
  base_surface (`SurfaceRef`, null); inputs (object); inputs_fingerprint (string);
  engine_version (integer); computed_at (date-time).
- `VolumeResults` sets `additionalProperties: false`, so drift between the job's dict and the
  contract fails the contract tests. `inputs` stays a free-form object.

Measurement request and response wrappers:

- **`VolumeMeasurement`** (every property is req): id, name (string); status (`VolumeStatus`);
  error (string, null); polygon_native (`VolumeRing`); top_surface_id (string); base (`VolumeBase`);
  masks (`VolumeMasks`); alignment (`VolumeAlignment`); results (`VolumeResults`, null);
  stale_reasons (string[]); job_id (string, null); created_at, updated_at (date-time).
- **`VolumeMeasurementList`**: `{items: VolumeMeasurement[]}`.
- **`VolumeMeasurementCreate`**:
  - required: name (string, minLength 1), polygon_native (`VolumeRing`), top_surface_id (string),
    base (`VolumeBase`);
  - optional: masks (`VolumeMasksInput`), alignment (`VolumeAlignmentInput`).
- **`VolumeMeasurementPatch`**: name, polygon_native, top_surface_id, base,
  masks (`VolumeMasksInput`; fields that are sent replace the stored ones) and alignment
  (`VolumeAlignmentInput`), all optional; `minProperties: 1`.
- **`VolumeMeasurementWithJob`**: `{measurement: VolumeMeasurement, job: Job}`, both req.
- **`VolumeFootprint`**: run_id, detection_id, class_id (string) and ring (`VolumeRing`), all req.
- **`VolumeFootprints`**: items (`VolumeFootprint[]`) and truncated (boolean), both req.
- **`VolumeExportFormat`**: enum `[pdf, gpkg, csv, xlsx]`.
- **`VolumeExportRequest`**:
  - required: measurement_ids (string[], minItems 1, uniqueItems), formats
    (`VolumeExportFormat[]`, minItems 1, uniqueItems);
  - optional: title (string, maxLength 200; "the project name when absent").

### 11.3 Jobs, events, backend scaffolding, frontend scaffolding

**Jobs.** `JobType` gets `surface_build`, `volume_calc` and `volume_export`, alongside S1's and
S3's additions per the brief.

| Job | Params | Result dict |
| --- | --- | --- |
| `surface_build` | `{surface_id: str}`; the settings live in `Surface.build_params` | `{surface_id, cell_size_m, coverage_fraction}` |
| `volume_calc` | `{measurement_id: str}` | `{measurement_id, net_m3}` |
| `volume_export` | `{measurement_ids: [str], formats: [str], title: str}` | `{folder, files: [str]}` |

**Events** (`x-websocket`): `surfaces.changed {surface_ids: string[]}` and
`volumes.changed {measurement_ids: string[]}`.

**Backend scaffolding by F0:**

- Packages `app/surfaces/` and `app/volumes/`.
- Routers `app/surfaces/router.py` and `app/volumes/router.py`, with every path returning 501,
  included in the app.
- Stub job modules `app/surfaces/jobs_build.py`, `app/volumes/jobs_calc.py` and
  `app/volumes/jobs_export.py`. Each registers its type and raises `JobFailure("not implemented")`.
  They are imported wherever the maps job modules are imported.
- `app/surfaces/startup.py::sweep_interrupted(handle, runner)` and
  `app/volumes/startup.py::sweep_interrupted(handle, runner)` as no-ops, called from
  `project_opened()`. F0 wires all four startup steps of S1–S3 at once (S1 §5 item 5); S2 fills
  only these two bodies (V2 and V5), and the surface sweep covers every `kind`.
- `ProjectHandle.surfaces_dir` (`<project>/surfaces`) and `ProjectHandle.volumes_dir`
  (`<project>/volumes`).

**Migration.** F0's single migration holds every table and column of S1–S3; the complete list is
S1 §5 item 3. S2's part is the `surface` and `volume_measurement` tables:

- The brief's columns plus the **(S2)** columns in §3: `surface.error`, `surface.build_params`,
  `surface.stats`, `volume_measurement.error`. `masks.class_ids` and the extra alignment keys live
  inside JSON, so no column is needed.
- The FKs: `surface.point_cloud_id → point_cloud.id ON DELETE SET NULL` and
  `volume_measurement.top_surface_id → surface.id ON DELETE RESTRICT`.
- Indexes on `surface.status` and `volume_measurement.top_surface_id`.

**Frontend scaffolding by F0:**

- The route `/p/:projectId/volumes[/:measurementId]` with an empty `VolumesScreen`.
- The Sidebar entry "Volumes" (the order Maps → Point clouds → Volumes → Surveys is stated once, in
  S1 §5 item 7) and the Header title "Volumes".
- The job labels in the six `Record<Job["type"], …>` maps (listed in S1 §5 item 8):
  `surface_build` "Build surface", `volume_calc` "Calculate volume", `volume_export` "Export
  volumes".
- Client helpers in the generated-client module, next to `mapTileUrl`: `surfaceTileUrl`,
  `surfaceOrthoTileUrl` and `volumeDiffTileUrl`.

**Dependencies:** scipy 1.17.1, shapely 2.1.2, reportlab and openpyxl pinned by F0, as part of
F0's full list (S1 §5 item 6).

## 12. Budget and execution DAG

### 12.1 Budget

- **Background jobs:** `surface_build`, `volume_calc` and `volume_export`. All three report
  progress, can be cancelled and restart cleanly (§3 startup).
  - `surface_build`: at most 1.5 GB RSS for any cloud. Spill is 8 B per point on disk and is
    removed afterwards. Targets are 60 s or less for 21.7 M points and 10 min or less for 195 M
    points from local disk, plus one extra read pass in auto mode.
  - `volume_calc`: windows of at most 2048² over the **polygon's bbox** (and the stable area's
    bbox), about 100 MB per window. Footprints are capped at 20 000. Patch reads are bounded by
    the 400 m² ceiling. The target is 5 s or less for a 1 ha polygon at 0.1 m.
  - `volume_export`: one plan image per measurement from an overview read of at most 2000 px.
    XLSX is written in write-only mode.
- **Synchronous and bounded:**
  - hillshade, ortho and diff tiles: one read each, at most 258²;
  - sample: 2 × 2 cells;
  - footprints: a bbox query, at most 5 000 returned;
  - CRUD and the staleness check: indexed lookups.
- **Never loaded whole:** the cloud, the surface grid, or the diff grid. No full-extent read
  exceeds 2048 per side (overviews).
- **No preview numbers outside a job** (brief).

### 12.2 DAG

**F0 precedes everything.** It lands the contract, migration, job types, routes, stubs and
dependencies in §11.

| Unit | Contents | Depends on |
| --- | --- | --- |
| **V1** | `app/surfaces/grid.py` and `paths.py` exactly as in §4, with tests (lattice, writer alignment errors, NaN overviews, windowed-read guard, `sample_bilinear`, `resample_onto` R1–R3, `convention_problems`, `compute_stats`, `hillshade`). **S3's U4, U6 and U7 depend on V1.** | F0 |
| **V2** | `surface_build`: density pass, bin/reduce/finish, statistics, despike, hole fill, CRS rules, admission; surfaces service and router (1–5); startup sweep | V1 |
| **V3** | Surface tiles (hillshade, ortho warp) and sample (6–8); tile cache | V1 |
| **V4** | `app/volumes/engine.py` (pure): bases, edge sampling, rasterising, patching, alignment, accumulation, 2c sensitivity, uncertainty, warnings; every §7.2 analytic fixture | V1 |
| **V5** | Volumes service and router (9–16), `volume_calc` job, `footprints.py`, fingerprint and stale, diff writer and diff tiles, startup sweep | V2, V3, V4 |
| **V6** | `volume_export`: PDF with plan image, GPKG with cut/fill TIFF and QML, CSV, XLSX, summary; path 17; frozen-bundle check for reportlab, openpyxl and scipy.spatial (`smoke_frozen.ps1` writes a PDF and an XLSX and runs a Delaunay), with an ADR if hidden imports are needed | V5 |
| **V7** | Volumes screen A: surface list, build dialog, `SurfaceView` (hillshade, ortho, readout, scale), drawing layers and tools | V2, V3 |
| **V8** | Volumes screen B: Measure and Results panels, footprints layer, diff overlay, stale handling, export dialog, View in 3D | V5, V6, V7 |
| **V9** | e2e; acceptance on the chimney file and the 195 M cloud; the CloudCompare cross-check (§7.3); `docs/evidence/`; `docs/progress.md`; the usability walkthrough; wrapup | V8 |

- **Parallel batches:** {V1} → {V2, V3, V4} → {V5, V7} → {V6} (V7 may still be running) → {V8} →
  {V9}.
- **Critical path:** F0 → V1 → V4 → V5 → V6 → V8 → V9. V4, the engine and its fixtures, is the
  longest unit in its batch. V2 and V3 have slack against it, and V7 has slack against V5 and V6.
- V1 is small and **merges to `main` early**, ahead of the rest of S2, so S3 can rebase onto it
  and build on the frozen interface. S2 is built in its own worktree after F0 merges, like S1 and
  S3; the cross-spec DAG and all three critical paths are in S1 §15.3.
- S3's U8 mounts its "Import design surface" button in V7's surface list; that is the only S3 edit
  to an S2 file.

## 13. Testing

**Backend (pytest).** Fixtures are generated at test time; nothing binary is committed. Surfaces
are written through `SurfaceWriter` from closed-form functions. Clouds come from laspy through S1's
`tests/pointclouds.py` helper. Maps and runs are inserted as DB rows with a geotransform (no map
raster is needed for masking).

- **grid.py:**
  - `aligned_grid` snaps and includes points exactly on the max and min edges;
  - `same_lattice` for true and near-miss offsets;
  - `write_block` rejects misaligned windows;
  - unwritten blocks read back as NaN;
  - the overview of a block with NaNs equals `nanmean` of 2 × 2;
  - `read` raises past `MAX_READ`, which a spy on the rasterio read confirms;
  - `sample_bilinear` against analytic values and the NaN-neighbour rule;
  - `resample_onto` R1 (bit-identical), R2 and R3 on a tilted plane (§7.2);
  - `.partial` is removed on an exception;
  - `convention_problems`: `[]` for a file `SurfaceWriter` wrote; one named problem each for an
    int16 file, a sentinel nodata, an internal mask, a striped (untiled) file, LZW compression, an
    origin off the lattice, a geographic CRS and missing overviews;
  - `compute_stats` on a copied writer output equals the `SurfaceStats` `finish()` returned, and
    the read-size spy stays within `MAX_READ`;
  - `hillshade`: a plane of known slope and aspect gives the closed-form shade within 1 level, NaN
    cells and their Horn neighbours give 0, and the output dtype is uint8.
- **surface_build:**
  - the median, mean, max and min of hand-made cells (odd and even counts);
  - auto cell for known densities on a regular lattice (25, 100 and 400 pts/m² give 0.5, 0.2
    and 0.1 m);
  - noise classes, withheld and Z clip are counted;
  - a single −50 m point in a sparse cell is despiked, while a real 3 m step backed by many
    points is kept;
  - hole fill closes a 4-cell gap but not a gap wider than the limit, and **never extends the
    outer edge**;
  - a geographic cloud is reprojected to UTM; feet gives 422; no CRS needs `assume_metres`;
  - the admission errors;
  - cancel deletes the row and `.build/`, and failure keeps the row as failed;
  - **bounded memory:** with `BIN_BUFFER_BYTES` = 1 MiB and `REDUCE_MAX_POINTS` = 10 k patched in,
    two clouds whose extents differ by 16× have tracemalloc peaks within 1.3× of each other, and
    the row-band path gives the same grid as the direct path.
- **Volume engine:** every §7.2 fixture at cells of 0.05, 0.1, 0.25 and 0.5, plus:
  - cut/fill labels are sign-correct;
  - `measured = area − nodata`;
  - the exclude mode removes area while the patch mode keeps it;
  - a patch over 400 m² becomes nodata with a warning, and a 1-quadrant ring gives `patch_failed`;
  - a toe edge half over nodata fails, and at 70% it warns;
  - each alignment threshold fires at its edge (below and above);
  - the tilt check fires on a tilted +0.5 mm/m difference over 100 m and not on a pure shift;
  - the uncertainty terms against hand calculations, and `complete = false` without a stable area.
- **API and job:**
  - create → calculate → ready;
  - PATCH makes it stale, and a name-only PATCH does not;
  - deleting a mask run makes it stale on GET, with a reason, and the recalculation fails with a
    message;
  - deleting a surface in use gives 409;
  - 409 while calculating;
  - a restart sweep of a `calculating` row;
  - footprints match what the job masked;
  - a diff tile pixel equals a direct diff read;
  - hillshade tile parity against `grid.hillshade` on a direct windowed read, a tinted tile of a
    design surface (null `stats`), and the read-size spy.
- **Exports:**
  - the PDF writer takes `compress: bool` (true in the job). Tests write it uncompressed and
    assert the `%PDF-` header, the page count (`/Type /Page` occurrences), each measurement name
    and each fill figure as formatted in the report. No PDF-reading dependency is added;
  - the GPKG reads back with sqlite3, with the SRS row equal to the surface EPSG and features per
    layer;
  - the TIFF equals `diff.tif`, and the QML parses;
  - the CSV columns are exact, and the XLSX has 3 sheets with typed numbers;
  - stale measurements give 409.
- **Contract:** Spectral lint; `schema.d.ts` regenerated in the same change; `EXPECTED_STUBS`
  shrinks per unit. External work (none here; no downloads) needs no seam, per ADR
  `2026-09-21-gotcha-contract-jobs-need-offline-seams`.

**Frontend (vitest):**

- pixel ↔ native conversion for the north-up affine;
- base-kind labels (§6.1);
- the uncertainty text, and "incomplete";
- the stale banner reasons;
- the run grouping by flight;
- build-dialog defaults;
- the export dialog disables stale measurements.

**e2e (Playwright), using a fixture cloud built by laspy at global setup:**

1. build a surface, and the hillshade renders;
2. draw a polygon, calculate, and the fill appears;
3. switch to a flat base and it goes stale; recalculate;
4. export all four formats, and the files exist.

**Acceptance** (V9, not the unit gate): the §1 "Done means" list on the real file and the 195 M
cloud, with the §7.3 cross-check recorded in `docs/evidence/`.

All the gates in AGENTS.md §4 apply to every unit.

## 14. Success criteria

1. All §7.2 analytic fixtures pass within their stated tolerances at cell sizes 0.05, 0.1, 0.25 and
   0.5 m.
2. The end-to-end synthetic cloud (100 pts/m², σ 3 cm, 0.1% outliers) → median surface at the auto
   cell → cone volume is within 0.6% of 523.599 m³.
3. The chimney file builds at the auto cell in 60 s or less from local disk, with peak backend RSS
   at or below 2 GB. `stats` records the density, spacing and cell chosen.
4. The 195 M-point cloud builds in 10 min or less, with peak backend RSS at or below 2 GB, and
   `.build/` is gone afterwards.
5. The CloudCompare cross-check (§7.3) agrees within 0.5% on fill, cut and area at steps of 0.1
   and 0.25 m.
6. The +0.100 m copy gives a stable-area `median_dz` of 0.100 ± 0.005 m, fires `alignment_offset`,
   and with the shift applied gives a net within ± `uncertainty.total_m3` of 0.
7. Masking a detection whose footprint covers a known box on the synthetic cone restores the cone
   volume within 0.5%, and `masked_area_m2` equals the rasterised buffered footprint area.
8. No read in the tile, sample or volume code paths exceeds `MAX_READ` per side, as asserted by a
   spy in the tests.
9. Every result shows `nodata_area_m2`. A polygon with 36 known nodata cells reports exactly
   36·A, and a nonzero `nodata_m3`.
10. Editing any input marks a ready measurement stale. Export refuses it until it is recalculated.
11. The four export formats open: the PDF in a viewer, the GPKG and TIFF in QGIS in the surface
    EPSG, and the XLSX in Excel. Their numbers equal the stored results to the displayed precision.
12. `check-tokens`, lint, the build and the e2e all pass. The screen follows the MapsScreen layout
    with a Segmented Measure | Results aside.

## 15. Consequences the operator should know

- **Heights are the cloud's own.** The chimney file uses ellipsoidal heights, so the ground is
  about −45 m. A flat base Z must be typed in that reference; "Pick on map" avoids the mistake. A
  design surface in sea-level heights will trigger `alignment_datum` until the operator fixes its
  reference in S3.
- **The per-cell statistic changes the answer.** Median is the default. "Highest" overstates
  stockpiles by 2–7%, and the dialog says so. The PDF names the statistic.
- **Masked machines are estimates.** The ground under them is interpolated from around them, and
  the report shows how much area was patched and its share of the ±.
- **A shift corrects height only.** If two flights are offset horizontally or tilted, the check
  says so, and the fix is shared ground control, not this app.
- **The ± is indicative.** It is honest about the inputs the app can see. It does not include the
  survey's own georeferencing accuracy.
- **Areas are grid areas.** In UTM they differ from ground areas by at most about 0.1%, and the
  factor is printed.
- **Disk:** a build needs temporary space of about 8 bytes per point (1.6 GB for 195 M points),
  and the surface itself is roughly 1–2 bytes per cell after compression.
- **The cloud file must be reachable to build a surface**, because it is never copied. Once built,
  a surface works even if the cloud is later deleted or the drive is offline.

## 16. Risks

| Risk | Mitigation |
| --- | --- |
| The bin/reduce pipeline misses the 10-minute target at 195 M points (a lexsort per block; spill I/O) | V2 measures early on the spike's 195 M file. Fallbacks, in order: reduce blocks on a `ThreadPoolExecutor(4)` (numpy releases the GIL in sort); raise the buffer cap to 512 MiB. |
| GDAL's overview averaging of NaN nodata differs from what is expected | A test pins it (§13). If it fails, overviews are computed by the writer itself from the blocks it writes (2 × 2 `nanmean` cascades). |
| Frozen bundle: scipy.spatial (qhull), reportlab fonts and openpyxl hidden imports | V6 smoke test in the frozen exe, plus an ADR. reportlab uses only the built-in Type 1 Helvetica, with no font files. |
| Photogrammetry smears the base of walls and under overhangs, so a 2.5D surface cannot represent a vertical face | This is inherent to 2.5D volumes and is stated in the Method page. Structure inspection belongs in S1's 3D viewer. |
| Filled cells are not tracked per cell | They are bounded (enclosed gaps of 1 m or less), counted in `stats.cells_filled`, and shown on the PDF's inputs. A per-cell mask can come later without a format change (a sidecar file). |
| Detection boxes are axis-aligned in wave 1, so rotated machines are masked with slack | The buffer already covers smear. `angle` is honoured when OBB lands (`box_corners`). |
| Operator misreads the cut/fill sign against a design | Labels per base kind (§6.1) in the UI, PDF, CSV and XLSX, with the stored names alongside. |
| Stable areas that aren't stable (a stockpile road that was regraded) | `alignment_noisy` and the tilt check. The PDF prints the stable polygon on the plan image. |

## 17. Out of scope

- ICP or any horizontal co-registration. Only the vertical shift is corrected.
- DWG, which the operator saves as DXF (S3), and design import in general (S3).
- Volume time series beyond two surveys, and trend charts of volumes.
- Cross-sections, profiles and contour export.
- Ground classification (CSF/PMF), and 3D detection of clutter.
- Per-cell filled masks, and multiple polygons per measurement (one measurement per pile; one
  report holds many).
- Undo history beyond "revert to last calculated inputs".
- Feet-based CRSs and vertical datum conversion (geoid models).
- Density or bulking factors (m³ → tonnes). A later, trivial addition to the report.
- Editing surfaces (smoothing, breaklines), and exporting surfaces as DEMs outside a volume export.
