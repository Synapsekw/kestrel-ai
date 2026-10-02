import { deflateSync } from "node:zlib";
import { errors, expect, type Locator, type Page, type Route, type WebSocketRoute } from "@playwright/test";
import proj4 from "proj4";
import { maxZoomFor, SITE_MAX_Z } from "../../src/mapws/view/siteGrid";
import { fromMock, jsonReply } from "../mock";

/** The contract's Project example, which the Prism mock serves for every project id. */
export const P = "7f1c2e3a-1111-4000-8000-000000000001";
/** Sep = the contract's GeoMap example id, so Prism's run/detection examples belong to it. */
export const MAP_SEP = "a0000000-6666-4000-8000-000000000001";
export const MAP_AUG = "a0000000-6666-4000-8000-0000000000a8";
export const MAP_FLAT = "a0000000-6666-4000-8000-0000000000f1";
export const DSM_AUG = "e0000000-8888-4000-8000-0000000000a8";
export const DSM_SEP = "e0000000-8888-4000-8000-0000000000e9";
export const DESIGN = "e0000000-8888-4000-8000-0000000000d1";
/** The contract's MapRun example id (its `map_id` is MAP_SEP); the Sep survey's basis run. */
export const RUN = "r0000000-7777-4000-8000-000000000001";
export const CRACK_ID = "t-crack-e2e";
export const AUG = "2026-08-14";
export const SEP = "2026-09-14";

/** A world's site frame: the CRS every site coordinate is in, and the box every fake layer covers. */
export interface SiteSpec {
  epsg: number;
  proj4: string;
  /** Defaults to `EPSG:<epsg>`. */
  name?: string;
  /** Defaults to `PROJCRS["<name>"]`. */
  crs_wkt?: string;
  /** [minE, minN, maxE, maxN] in that CRS. */
  bounds: [number, number, number, number];
}

export interface Site {
  epsg: number;
  proj4: string;
  name: string;
  crs_wkt: string;
  minE: number;
  minN: number;
  maxE: number;
  maxN: number;
  cE: number;
  cN: number;
}

export function siteOf(spec: SiteSpec): Site {
  const [minE, minN, maxE, maxN] = spec.bounds;
  const name = spec.name ?? `EPSG:${spec.epsg}`;
  return {
    epsg: spec.epsg,
    proj4: spec.proj4,
    name,
    crs_wkt: spec.crs_wkt ?? `PROJCRS["${name}"]`,
    minE,
    minN,
    maxE,
    maxN,
    cE: (minE + maxE) / 2,
    cN: (minN + maxN) / 2,
  };
}

/**
 * The default world's site frame: a 240 × 180 m box in EPSG:32633 (UTM 33N) at the north-west corner
 * of the contract GeoMap example's footprint (bounds_native [500000, 4981200, 502400, 4983000]). Every
 * fake map's `bounds_native` and every fake layer's `footprint_site` is this box, so a site coordinate
 * inside it is on every layer.
 */
export const SITE: Site = siteOf({
  epsg: 32633,
  proj4: "+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs",
  name: "WGS 84 / UTM zone 33N",
  bounds: [500000, 4982820, 500240, 4983000],
});

const API = `/api/v1/projects/${P}`;
const T = "2026-09-27T09:00:00Z";
/** Ground sample distance of the fake orthos, metres. */
const GSD_M = 0.03;

type Json = Record<string, unknown>;

export interface WorldOptions {
  /** Surveys in the world: two (Aug, Sep: the default) or one (Sep only; §14 compare disabled). */
  surveys?: 1 | 2;
  /** Adds a map without coordinates (listed greyed, §14). */
  flatMap?: boolean;
  /** Another site frame (e.g. a 32639 world); default `SITE`. Every body is built in it. */
  site?: SiteSpec;
}

/** What the fake backend holds, and every request it answered, for the tests' assertions. */
export interface MapWorld {
  /** The site frame this world is built in (`SITE` unless `WorldOptions.site`). */
  site: Site;
  calls: { method: string; path: string; body: unknown }[];
  /** `kind/id/z/x/y` of every site tile requested. */
  tiles: string[];
  maps: Json[];
  surfaces: Json[];
  drawings: Json[];
  inspections: Record<string, Json>;
  measurements: Json[];
  volumes: Json[];
  siteAreas: Json[];
  findings: Json[];
  detections: Json[];
  /** Every job the fake started, by id; `GET /jobs/:id` answers them `succeeded`. */
  jobs: Record<string, Json>;
  workspaceState: Json;
  /**
   * Pushes one event down the routed `/api/v1/events` websocket (queued until the page connects).
   * `findings.changed` carries `{ ids }` (store/changes.ts); the fake already sends it on an accept,
   * `drawings.changed` on a drawing write, and `job.state` succeeded for each job it started.
   */
  sendEvent: (type: string, payload?: Json, extra?: Json) => void;
}

// ---- tiles --------------------------------------------------------------------------------------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** A 256 × 256 RGBA tile of seeded noise: a real decode and composite per tile (frame scenario). */
export function png256(seed: number): Buffer {
  const stride = 1 + 256 * 4;
  const raw = Buffer.alloc(256 * stride);
  let s = seed >>> 0 || 1;
  for (let y = 0; y < 256; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < 256; x++) {
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      const o = y * stride + 1 + x * 4;
      raw[o] = 60 + (s & 0x7f);
      raw[o + 1] = 70 + ((s >>> 8) & 0x7f);
      raw[o + 2] = 50 + ((s >>> 16) & 0x5f);
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(256, 0);
  ihdr.writeUInt32BE(256, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const TILES = [png256(1), png256(2), png256(3), png256(4)];

// ---- site clicks --------------------------------------------------------------------------------

/** The workspace's e2e hook (W1) is installed only with diagnostics on, as the cloud viewer's is. */
export async function enableDiagnostics(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("kestrel.diagnostics", "1");
    } catch {
      // storage blocked: the hook stays off and the test fails where it needs it
    }
  });
}

/** Page pixel of site coordinate (e, n) in the viewport `testId` (default the right/only map). */
export async function sitePixel(
  page: Page,
  e: number,
  n: number,
  testId = "site-map",
): Promise<{ x: number; y: number }> {
  const timeoutOnly =
    <T>(onTimeout: () => T) =>
    (err: unknown) => {
      if (err instanceof errors.TimeoutError) return onTimeout();
      throw err; // page closed, evaluation error: not a placement problem
    };
  await page
    .waitForFunction(() => !!window.__kestrelSiteMap, undefined, { timeout: 10_000 })
    .catch(
      timeoutOnly(() => {
        throw new Error("window.__kestrelSiteMap never appeared: call enableDiagnostics(page) before goto");
      }),
    );
  // A fresh settle count per call: a stale one would return the pixel from before a pan started.
  await page.evaluate(() => {
    delete (window as Window & { __kestrelSitePixel?: unknown }).__kestrelSitePixel;
  });
  // The hook lands with the view, before the workspace fits the site (and a fit or centre animates),
  // so wait until the point is inside the pane and has not moved for three frames.
  const settled = await page
    .waitForFunction(
      ([e, n, testId]) => {
        const w = window as Window & { __kestrelSitePixel?: { key: string; frames: number } };
        const p = window.__kestrelSiteMap?.pixelOf(e, n);
        const pane = document.querySelector(`[data-testid="${testId}"]`)?.getBoundingClientRect();
        if (!p || !pane || p[0] < 0 || p[1] < 0 || p[0] > pane.width || p[1] > pane.height) {
          w.__kestrelSitePixel = undefined;
          return false;
        }
        const key = `${p[0]},${p[1]}`;
        const last = w.__kestrelSitePixel;
        w.__kestrelSitePixel = { key, frames: last?.key === key ? last.frames + 1 : 0 };
        return w.__kestrelSitePixel.frames >= 3 ? p : false;
      },
      [e, n, testId] as const,
      { polling: "raf", timeout: 10_000 },
    )
    .catch(timeoutOnly(() => null));
  const p = (await settled?.jsonValue()) as [number, number] | null | undefined;
  if (!p) throw new Error(`site ${e}, ${n} is not on screen in ${testId}`);
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`${testId} is not on screen`);
  return { x: box.x + p[0], y: box.y + p[1] };
}

export async function clickSite(
  page: Page,
  e: number,
  n: number,
  opts: { testId?: string; button?: "left" | "right" } = {},
): Promise<void> {
  const { x, y } = await sitePixel(page, e, n, opts.testId);
  await page.mouse.click(x, y, { button: opts.button ?? "left" });
}

/**
 * Waits until a click at site (e, n) would select the feature whose selection id is `id` (as last
 * drawn), so a click does not land before its layer has loaded: clickSite waits for the view only,
 * and on the CI runner a run's detections have answered after the click (runs 36462189068,
 * 36590111632).
 */
export async function untilSelectable(page: Page, e: number, n: number, id: string): Promise<void> {
  await expect
    .poll(() => page.evaluate(([e, n]) => window.__kestrelSiteMap?.selectionAt(e, n)?.id ?? null, [e, n]), {
      timeout: 20_000,
    })
    .toBe(id);
}

/** Longer than OpenLayers' 250 ms double-click window (see `drawSite`). */
const VERTEX_PACE_MS = 300;

/** Presses `key` until `button` reads pressed; a re-press keeps a tool active (no toggle). */
async function pressUntilPressed(page: Page, key: string, button: Locator): Promise<void> {
  await expect(async () => {
    await page.keyboard.press(key);
    await expect(button).toHaveAttribute("aria-pressed", "true", { timeout: 500 });
  }).toPass();
}

/**
 * Opens the map rail's topic `name` (workspace rail spec §2) unless its panel already shows: a
 * click on the open topic's button would close it. Layer rows live in the Layers topic, which is
 * not the default when the project has data (Findings is).
 */
export async function openMapTopic(page: Page, name: string): Promise<void> {
  const rail = page.getByRole("toolbar", { name: "Map" });
  await expect(rail).toBeVisible();
  const shown = page.locator(`[data-testid="rail-panel"][data-topic="${name.toLowerCase()}"]`);
  if ((await shown.count()) === 0) await rail.getByRole("button", { name, exact: true }).click();
  await expect(shown).toBeVisible();
}

/**
 * Arms the map tool `name` with its `key`, pressing until its button reads pressed. A key
 * pressed in the first moments after the workspace appears is not always bound yet, so a single
 * press can be lost.
 */
export async function armTool(page: Page, name: string, key: string): Promise<void> {
  await pressUntilPressed(page, key, page.getByRole("button", { name, exact: true }));
}

/**
 * Arms the tool bound to `key` (as `armTool`, found by its rail or topic button's `aria-keyshortcuts`),
 * clicks each vertex and finishes with Enter (spec §5.1). Vertices are clicked 300 ms apart:
 * OpenLayers turns any second click within 250 ms into a `dblclick`, wherever it lands, and a
 * double-click finishes the draft, so back-to-back clicks (~60 ms) would end a line early. Tool keys
 * are window-level (`site-map` is not focusable), so nothing is focused first; a control that holds
 * focus (e.g. the Blend slider) must be blurred by the caller.
 */
export async function drawSite(page: Page, key: string, pts: [number, number][]): Promise<void> {
  // The rail's nav buttons, or the tool row of the topic panel the armed tool opens (spec §4).
  const button = page
    .getByTestId("map-workspace")
    .locator(`button[aria-keyshortcuts="${key.toUpperCase()}"]`);
  await pressUntilPressed(page, key, button);
  for (const [i, [e, n]] of pts.entries()) {
    if (i > 0) await page.waitForTimeout(VERTEX_PACE_MS);
    await clickSite(page, e, n);
  }
  await page.keyboard.press("Enter");
}

// ---- geometry -----------------------------------------------------------------------------------

type XY = [number, number];

const toLonLat = (site: Site, p: readonly number[]): XY => proj4(site.proj4, "WGS84", [p[0], p[1]]) as XY;
const toSite = (site: Site, p: readonly number[]): XY => proj4("WGS84", site.proj4, [p[0], p[1]]) as XY;

const length = (pts: number[][]) =>
  pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
const shoelace = (pts: number[][]) =>
  Math.abs(
    pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0),
  ) / 2;

/** Least-squares similarity src → dst as [a, b, c, d, e, f] (E = a·x + b·y + c, N = d·x + e·y + f). */
function similarityFit(pairs: { src: number[]; dst: number[] }[]) {
  const n = pairs.length;
  const mean = (k: "src" | "dst", i: number) => pairs.reduce((s, p) => s + p[k][i], 0) / n;
  const [sx, sy, dx, dy] = [mean("src", 0), mean("src", 1), mean("dst", 0), mean("dst", 1)];
  let A = 0;
  let B = 0;
  let S = 0;
  for (const p of pairs) {
    const [x, y] = [p.src[0] - sx, p.src[1] - sy];
    const [X, Y] = [p.dst[0] - dx, p.dst[1] - dy];
    A += x * X + y * Y;
    B += x * Y - y * X;
    S += x * x + y * y;
  }
  const a = S ? A / S : 1;
  const b = S ? B / S : 0;
  const transform = [a, -b, dx - a * sx + b * sy, b, a, dy - b * sx - a * sy];
  const residuals_m = pairs.map((p) =>
    Math.hypot(
      transform[0] * p.src[0] + transform[1] * p.src[1] + transform[2] - p.dst[0],
      transform[3] * p.src[0] + transform[4] * p.src[1] + transform[5] - p.dst[1],
    ),
  );
  const rmse_m = Math.sqrt(residuals_m.reduce((s, r) => s + r * r, 0) / Math.max(n, 1));
  return {
    transform,
    residuals_m,
    rmse_m,
    scale: Math.hypot(a, b),
    rotation_deg: (Math.atan2(b, a) * 180) / Math.PI,
  };
}

// ---- bodies (contract/openapi.yaml; task-1-inventory.md "Contract field map") -------------------

const frameOf = (site: Site): Json => ({
  kind: "crs",
  crs_wkt: site.crs_wkt,
  epsg: site.epsg,
  proj4: site.proj4,
  name: site.name,
});
const footprint = (site: Site) => [site.minE, site.minN, site.maxE, site.maxN];
/** The drawings' linework and default placement: the site box inset by 10 m. */
const inset = (site: Site) => [site.minE + 10, site.minN + 10, site.maxE - 10, site.maxN - 10];

/** A raster's own tile pyramid depth (backend/app/maps/tiles.py max_zoom). */
const ownMaxZoom = (w: number, h: number) =>
  Math.max(w, h) > 256 ? Math.ceil(Math.log2(Math.max(w, h) / 256)) : 0;

const jobBody = (type: string, id: string, params: Json = {}): Json => ({
  id,
  project_id: P,
  type,
  state: "queued",
  progress: 0,
  message: "",
  log_path: `runs/${id}/job.log`,
  params,
  result: null,
  error: null,
  created_at: T,
  started_at: null,
  finished_at: null,
});

/** GeoMap over the Prism example: in the site frame at 3 cm, or without coordinates (`flat`). */
function mapBody(tpl: Json, site: Site, id: string, name: string, date: string | null, flat = false): Json {
  const width = Math.round((site.maxE - site.minE) / GSD_M);
  const height = Math.round((site.maxN - site.minN) / GSD_M);
  const sw = toLonLat(site, [site.minE, site.minN]);
  const ne = toLonLat(site, [site.maxE, site.maxN]);
  return {
    ...tpl,
    id,
    name,
    status: "ready",
    error: null,
    captured_on: date,
    width,
    height,
    tile_grid: { tile_size: 256, max_zoom: ownMaxZoom(width, height) },
    job_id: null,
    ...(flat
      ? {
          crs_wkt: null,
          epsg: null,
          proj4: null,
          geotransform: null,
          bounds_native: null,
          bounds_wgs84: null,
          gsd_cm: null,
        }
      : {
          crs_wkt: site.crs_wkt,
          epsg: site.epsg,
          proj4: site.proj4,
          geotransform: [site.minE, GSD_M, 0, site.maxN, 0, -GSD_M],
          bounds_native: footprint(site),
          bounds_wgs84: [sw[0], sw[1], ne[0], ne[1]],
          gsd_cm: GSD_M * 100,
        }),
  };
}

/** Surface (contract `Surface`), in the site frame. `kind: "dem"` DSMs and one `design` surface. */
function surfaceBody(
  site: Site,
  id: string,
  name: string,
  kind: "dem" | "design",
  date: string | null,
): Json {
  const cell = 0.1;
  return {
    id,
    name,
    kind,
    status: "ready",
    error: null,
    point_cloud_id: null,
    design_source:
      kind === "design"
        ? {
            path: "D:/design/site-plan-rev-c.tif",
            format: "geotiff",
            units: "metre",
            vertical_units: "metre",
            sha256: null,
            candidates: [],
            source_crs_wkt: site.crs_wkt,
            source_epsg: site.epsg,
            swap_xy: false,
            max_edge_m: null,
            aligned_to_surface_id: null,
            accepted_warnings: [],
          }
        : null,
    crs_wkt: site.crs_wkt,
    epsg: site.epsg,
    proj4: site.proj4,
    cell_size_m: cell,
    width: Math.round((site.maxE - site.minE) / cell),
    height: Math.round((site.maxN - site.minN) / cell),
    geotransform: [site.minE, cell, 0, site.maxN, 0, -cell],
    bounds_native: footprint(site),
    z_min: 598.1,
    z_max: 624.8,
    coverage_fraction: 1,
    method: null,
    build_params: null,
    stats: null,
    captured_on: date,
    elevation_role: kind === "dem" ? "dsm" : null,
    map_id: null,
    tile_grid: {
      tile_size: 256,
      max_zoom: ownMaxZoom((site.maxE - site.minE) / cell, (site.maxN - site.minN) / cell),
    },
    measurement_count: 0,
    job_id: null,
    created_at: T,
  };
}

/**
 * A contract `Drawing` from what a test knows about it: the rest is defaulted, so a flow can push
 * `drawingBody({ id, name, format: "dxf", georef: {...} })` into `world.drawings`. A DXF is a vector
 * drawing; anything else a raster page (PDF, image).
 */
export function drawingBody(d: Json, site: Site = SITE): Json {
  const vector = d.format === "dxf" || d.format === "landxml";
  const placed = d.georef != null;
  return {
    kind: vector ? "vector" : "raster",
    status: "ready",
    error: null,
    job_id: null,
    source_path: `D:/drawings/${d.name}.${d.format}`,
    source_size: 245_760,
    page: vector ? null : 1,
    units: vector ? "metre" : null,
    width: vector ? null : 3308,
    height: vector ? null : 2339,
    dpi: vector ? null : 200,
    extent_src: vector ? [0, 0, 220, 160] : null,
    layers: [],
    georef: null,
    georef_version: 0,
    bounds_site: placed ? inset(site) : null,
    layer_state: { hidden_layers: [], knockout_white: false },
    captured_on: null,
    created_at: T,
    updated_at: T,
    ...d,
  };
}

/** Every `WorkspaceLayer` field; `kind`-specific ones via `extra`. */
const layerBody = (l: {
  kind: "map" | "surface" | "drawing";
  id: string;
  name: string;
  version: string;
  date: string | null;
  meta: string;
  footprint: number[] | null;
  /** The layer's native metres per pixel (null: a vector drawing, drawn to the grid's last zoom). */
  nativeRes: number | null;
  extra?: Json;
}): Json => ({
  kind: l.kind,
  id: l.id,
  name: l.name,
  group: l.kind === "map" ? "base" : l.kind === "surface" ? "elevation" : "drawing",
  status: "ready",
  in_frame: l.footprint !== null,
  tile_kind: l.footprint === null ? null : l.kind,
  vector: false,
  version: l.version,
  date: l.date,
  date_is_import_date: false,
  footprint_site: l.footprint,
  // As backend/app/workspace/layers.py: grid.max_zoom_for(native), Z_MAX for vector drawings.
  max_zoom: l.footprint === null ? null : l.nativeRes ? maxZoomFor(l.nativeRes) : SITE_MAX_Z,
  meta: l.meta,
  surface_kind: null,
  elevation_role: null,
  drawing_format: null,
  placed: null,
  ...l.extra,
});

/** A raster drawing's metres per pixel: sqrt(|det|) of its georef transform (the backend's rule). */
function nativeResOf(d: Json): number | null {
  const t = (d.georef as { transform?: number[] } | null)?.transform;
  if (!t || t.length < 6) return null;
  return Math.sqrt(Math.abs(t[0] * t[4] - t[1] * t[3])) || null;
}

function drawingLayer(d: Json, site: Site): Json {
  const vector = d.format === "dxf" || d.format === "landxml";
  const placed = d.georef != null;
  return layerBody({
    kind: "drawing",
    id: String(d.id),
    name: String(d.name),
    // The overlay re-tiles when the version moves; it moves with every georef save.
    version: String(d.georef_version ?? 0),
    date: (d.captured_on as string | null) ?? null,
    meta: placed ? "placed" : "not placed",
    footprint: placed ? ((d.bounds_site as number[] | null) ?? inset(site)) : null,
    nativeRes: vector ? null : nativeResOf(d),
    extra: {
      status: d.status ?? "ready",
      tile_kind: vector || !placed ? null : "drawing_raster",
      vector,
      drawing_format: d.format,
      placed,
    },
  });
}

// ---- the fake ------------------------------------------------------------------------------------

type Handler = (route: Route, m: RegExpMatchArray, body: unknown, url: URL) => Promise<void>;

/**
 * A small stateful backend for the map workspace (spec M §12) on top of the Prism mock: every
 * write is remembered and read back, so a flow proves the app follows the server's answers. Routes
 * not listed here fall through to Prism. Playwright runs the last-registered matching route first,
 * so a test can still override one path with its own `page.route` after calling this. Also routes
 * the events websocket (`world.sendEvent`); a test that routes it itself replaces that.
 *
 * Budget: every list answer is a small fixed set (one detection, the findings the flow accepted,
 * the few layers it made); every tile is one of four in-memory 256 × 256 PNGs.
 */
export async function serveMapWorkspace(page: Page, opts: WorldOptions = {}): Promise<MapWorld> {
  const surveys = opts.surveys ?? 2;
  const site = opts.site ? siteOf(opts.site) : SITE;
  const project = await fromMock<Json>(page, API);
  const geoMap = await fromMock<Json>(page, `${API}/maps/${MAP_SEP}`);
  const volumeTpl = await fromMock<Json>(page, `${API}/volumes/v-template`);

  // The events socket: the page sees a connected server that only speaks when the fake does.
  let socket: WebSocketRoute | null = null;
  const pending: string[] = [];
  await page.routeWebSocket(/\/api\/v1\/events/, (ws) => {
    socket = ws;
    for (const m of pending.splice(0)) ws.send(m);
  });
  const sendEvent = (type: string, payload: Json = {}, extra: Json = {}) => {
    const msg = JSON.stringify({
      type,
      project_id: P,
      job_id: null,
      progress: 0,
      message: "",
      payload,
      ...extra,
    });
    if (!socket) return void pending.push(msg);
    try {
      socket.send(msg);
    } catch {
      // the page is gone (the test ended)
    }
  };
  /** After the reply that caused it has reached the page, as a real backend's event would. */
  const later = (fn: () => void) => setTimeout(fn, 150);

  const world: MapWorld = {
    site,
    calls: [],
    tiles: [],
    maps: [
      mapBody(geoMap, site, MAP_SEP, "Ortho 14 Sep", SEP),
      ...(surveys === 2 ? [mapBody(geoMap, site, MAP_AUG, "Ortho 14 Aug", AUG)] : []),
      ...(opts.flatMap ? [mapBody(geoMap, site, MAP_FLAT, "Scanned site photo", null, true)] : []),
    ],
    surfaces: [
      surfaceBody(site, DSM_SEP, "DSM 14 Sep", "dem", SEP),
      ...(surveys === 2 ? [surfaceBody(site, DSM_AUG, "DSM 14 Aug", "dem", AUG)] : []),
      surfaceBody(site, DESIGN, "Site plan rev C", "design", null),
    ],
    drawings: [],
    inspections: {},
    measurements: [],
    volumes: [],
    siteAreas: [],
    findings: [],
    detections: [
      {
        id: "d0000000-1111-4000-8000-0000000000c1",
        class_id: CRACK_ID,
        confidence: 0.93,
        x: 3000,
        y: 2400,
        w: 170,
        h: 110,
        angle: null,
        review_state: "unreviewed",
        provenance_kind: "local_model",
        corners_site: [
          [site.cE - 3, site.cN + 2],
          [site.cE + 3, site.cN + 2],
          [site.cE + 3, site.cN - 2],
          [site.cE - 3, site.cN - 2],
        ],
      },
    ],
    jobs: {},
    workspaceState: {},
    sendEvent,
  };
  let plannedSurveys: Json[] = [];
  const crack = {
    id: CRACK_ID,
    name: "Crack",
    colour: "#ef4444",
    hotkey: null,
    order: 99,
    kind: "defect",
    default_severity: 3,
    group: null,
  };

  const reply = (route: Route, body: unknown, status = 200) => route.fulfill(jsonReply(body, status));
  const png = (route: Route, body: Buffer) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "immutable" },
      body,
    });
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}0000000-9999-4000-8000-${String(++seq).padStart(12, "0")}`;
  /** A queued job the fake "runs": `job.state` succeeded follows on the socket, and on `GET /jobs/:id`. */
  const startJob = (type: string, params: Json = {}): Json => {
    const job = jobBody(type, nextId("j"), params);
    world.jobs[String(job.id)] = job;
    later(() => sendEvent("job.state", { state: "succeeded" }, { job_id: job.id, progress: 1 }));
    return job;
  };

  const workspaceBody = (): Json => {
    const inFrame =
      world.maps.filter((x) => x.crs_wkt).length +
      world.surfaces.length +
      world.drawings.filter((d) => d.georef != null).length;
    return {
      frame: frameOf(site),
      state: world.workspaceState,
      planned_surveys: plannedSurveys,
      frame_items: { crs: inFrame, local: 0 },
      updated_at: T,
    };
  };
  const surveyBody = (date: string): Json => ({
    date,
    date_is_import_date: false,
    planned: false,
    note: null,
    maps: world.maps
      .filter((x) => x.captured_on === date && x.crs_wkt)
      .map((x) => ({
        id: x.id,
        name: x.name,
        gsd_cm: x.gsd_cm,
        // The AI detections row shows the basis runs of the selected surveys (flow 5, clouds.spec).
        basis_run_id: x.id === MAP_SEP ? RUN : null,
      })),
    surfaces: world.surfaces
      .filter((s) => s.captured_on === date)
      .map((s) => ({ id: s.id, name: s.name, kind: s.kind, elevation_role: s.elevation_role })),
  });
  const pin = (f: Json): Json => ({
    id: f.id,
    number: f.number,
    type_id: f.type_id,
    severity: f.severity,
    status: f.status,
    created_by: f.created_by,
    map_id: (f.anchor as Json).map_id,
    geometry_site: f.geometry_site,
  });
  const mapMeasurementResults = (kind: string, pts: number[][], surfaceIds: string[]): Json => {
    const grid = kind === "area" ? shoelace(pts) : length(pts);
    if (kind === "area") {
      const perimeter = length([...pts, pts[0]]);
      return {
        area_m2: grid * 1.0008,
        perimeter_m: perimeter * 1.0004,
        grid_area_m2: grid,
        grid_perimeter_m: perimeter,
        areal_scale_factor: 0.9992,
      };
    }
    if (kind === "profile") {
      // One series per surface sent (unknown ids are skipped); each later survey peaks 2.5 m higher.
      const series = surfaceIds.flatMap((id, i) => {
        const s = world.surfaces.find((x) => x.id === id);
        if (!s) return [];
        const date = (s.captured_on as string | null) ?? null;
        return [{ surface_id: id, label: String(s.name), date, z: [600.1, 606.4 + 2.5 * i, 600.2] }];
      });
      const zs = series.flatMap((x) => x.z);
      return {
        length_m: grid * 1.0004,
        grid_length_m: grid,
        stations_m: [0, grid / 2, grid],
        series,
        z_min: zs.length ? Math.min(...zs) : null,
        z_max: zs.length ? Math.max(...zs) : null,
        cut_area_m2: 0,
        fill_area_m2: 12.5,
        nodata_fraction: 0,
      };
    }
    return {
      length_m: grid * 1.0004,
      grid_length_m: grid,
      scale_factor: 0.9996,
      length_3d_m: null,
      nodata_fraction: null,
      dsm_surface_id: surfaceIds[0] ?? null,
    };
  };
  const measurementRow = (mm: Json): Json => {
    const r = mm.results as Json;
    const [headline, unit] =
      mm.kind === "area" ? [r.area_m2, "m2"] : mm.kind === "distance" ? [r.length_m, "m"] : [r.length_m, "m"];
    return {
      kind: "map",
      sub_kind: mm.kind,
      id: mm.id,
      name: mm.name,
      headline,
      unit,
      data_type: "map",
      data_id: mm.map_id,
      status: "ready",
      created_at: mm.created_at,
      updated_at: mm.updated_at,
    };
  };
  const volumeRow = (v: Json): Json => ({
    kind: "volume",
    sub_kind: "volume",
    id: v.id,
    name: v.name,
    headline: v.results ? (v.results as Json).net_m3 : null,
    unit: "m3",
    data_type: "elevation",
    data_id: v.top_surface_id,
    status: v.status === "calculating" ? "computing" : v.status,
    created_at: v.created_at,
    updated_at: v.updated_at,
  });
  const volumeResults = (v: Json, net: number): Json => {
    const top = world.surfaces.find((s) => s.id === v.top_surface_id);
    return {
      ...(volumeTpl.results as Json),
      net_m3: net,
      fill_m3: net + 12.3,
      cut_m3: 12.3,
      unshifted: null,
      alignment: null,
      base_fit: null,
      warnings: [],
      top_surface: {
        id: v.top_surface_id,
        name: top?.name ?? "DSM",
        kind: top?.kind ?? "dem",
        method: null,
        cell_size_m: 0.1,
        captured_on: top?.captured_on ?? null,
        cloud_file: null,
        cloud_sha256: null,
      },
      base_surface: null,
      computed_at: T,
    };
  };

  const table: [string, RegExp, Handler][] = [
    ["GET", /^$/, (r) => reply(r, { ...project, classes: [...(project.classes as Json[]), crack] })],
    [
      "GET",
      /^\/jobs\/([^/]+)$/,
      (r, m) => {
        const job = world.jobs[m[1]];
        return job
          ? reply(r, { ...job, state: "succeeded", progress: 1, started_at: T, finished_at: T })
          : r.fallback();
      },
    ],
    ["GET", /^\/maps$/, (r) => reply(r, { items: world.maps })],
    [
      "GET",
      /^\/maps\/([^/]+)$/,
      (r, m) => {
        const map = world.maps.find((x) => x.id === m[1]);
        // An unknown id is a gone map, never another map (it would hide "map gone" and no-CRS arrivals).
        return map
          ? reply(r, map)
          : reply(r, { error: { code: "not_found", message: "Map not found" } }, 404);
      },
    ],
    ["GET", /^\/surfaces$/, (r) => reply(r, { items: world.surfaces })],
    [
      "GET",
      /^\/surfaces\/([^/]+)$/,
      (r, m) => {
        const s = world.surfaces.find((x) => x.id === m[1]);
        return s ? reply(r, s) : r.fallback();
      },
    ],
    ["GET", /^\/map-workspace$/, (r) => reply(r, workspaceBody())],
    [
      "PUT",
      /^\/map-workspace$/,
      (r, _m, body) => {
        const b = (body ?? {}) as Json;
        world.workspaceState = (b.state as Json) ?? {};
        if (Array.isArray(b.planned_surveys)) plannedSurveys = b.planned_surveys as Json[];
        return reply(r, workspaceBody());
      },
    ],
    [
      "GET",
      /^\/map-workspace\/surveys$/,
      (r) => reply(r, { items: [...(surveys === 2 ? [surveyBody(AUG)] : []), surveyBody(SEP)] }),
    ],
    [
      "GET",
      /^\/map-workspace\/layers$/,
      (r) =>
        reply(r, {
          frame: frameOf(site),
          items: [
            ...world.maps.map((x) =>
              layerBody({
                kind: "map",
                id: String(x.id),
                name: x.crs_wkt
                  ? `Orthomosaic · ${x.captured_on === AUG ? "14 Aug 2026" : "14 Sep 2026"}`
                  : String(x.name),
                version: String(x.id),
                date: (x.captured_on as string | null) ?? null,
                meta: x.crs_wkt ? "3.0 cm · 3.2 GB" : "no coordinates",
                footprint: x.crs_wkt ? footprint(site) : null,
                nativeRes: GSD_M,
              }),
            ),
            ...world.surfaces.map((s) =>
              layerBody({
                kind: "surface",
                id: String(s.id),
                name: String(s.name),
                version: T,
                date: (s.captured_on as string | null) ?? null,
                meta: s.kind === "design" ? "from Site plan rev C" : "598.1 – 624.8 m",
                footprint: footprint(site),
                nativeRes: Number(s.cell_size_m ?? 0.1),
                extra: { surface_kind: s.kind, elevation_role: s.elevation_role },
              }),
            ),
            ...world.drawings.map((d) => drawingLayer(d, site)),
          ],
        }),
    ],
    // Query parameters (`v`, `t`, `frame_key`, `style`, ...) never affect matching: pathname only.
    [
      "GET",
      /^\/site-tiles\/([^/]+)\/([^/]+)\/(\d+)\/(-?\d+)\/(-?\d+)$/,
      (r, m) => {
        world.tiles.push(`${m[1]}/${m[2]}/${m[3]}/${m[4]}/${m[5]}`);
        return png(r, TILES[(Number(m[4]) + Number(m[5])) & 3]);
      },
    ],
    [
      "POST",
      /^\/map-workspace\/sample$/,
      (r, _m, body) => {
        const b = body as { x: number; y: number; surface_ids: string[] };
        return reply(r, {
          x: b.x,
          y: b.y,
          samples: b.surface_ids.map((id) => ({ surface_id: id, z: 612.34 })),
        });
      },
    ],
    [
      "POST",
      /^\/map-workspace\/anchor$/,
      (r, _m, body) => {
        const b = body as { map_id: string; geometry_site: { coordinates: unknown } };
        const flat = JSON.stringify(b.geometry_site.coordinates)
          .match(/-?[\d.]+(e-?\d+)?/g)!
          .map(Number);
        const [lon, lat] = toLonLat(site, [flat[0], flat[1]]);
        return reply(r, { map_id: b.map_id, geometry: b.geometry_site, lon, lat });
      },
    ],
    [
      "GET",
      /^\/map-workspace\/findings$/,
      (r) => reply(r, { items: world.findings.map(pin), truncated: false }),
    ],
    // Findings (F's API): the one the accepted detection became.
    [
      "GET",
      /^\/findings\/([^/]+)$/,
      (r, m) => {
        const f = world.findings.find((x) => x.id === m[1]);
        return f ? reply(r, { ...f, attachment_count: 0, comment_count: 0 }) : r.fallback();
      },
    ],
    // Detections of the run, in the site frame (spec §9.3).
    [
      "GET",
      /^\/map-runs\/([^/]+)\/detections$/,
      (r) =>
        reply(r, { items: world.detections.filter((d) => d.review_state !== "accepted"), truncated: false }),
    ],
    [
      "GET",
      /^\/map-runs\/([^/]+)\/next-unreviewed$/,
      (r) => {
        const left = world.detections.filter((x) => x.review_state === "unreviewed");
        return reply(r, { detection: left[0] ?? null, remaining: left.length });
      },
    ],
    [
      "POST",
      /^\/map-runs\/([^/]+)\/review$/,
      async (r, _m, body) => {
        const b = body as { detection_ids: string[]; action: string };
        const created: string[] = [];
        for (const id of b.detection_ids) {
          const d = world.detections.find((x) => x.id === id);
          if (!d) continue;
          d.review_state =
            b.action === "accept" ? "accepted" : b.action === "reject" ? "rejected" : d.review_state;
          if (b.action === "accept" && d.class_id === CRACK_ID) {
            const fid = "f0000000-1212-4000-8000-0000000000c1";
            if (world.findings.some((f) => f.id === fid)) continue;
            const corners = d.corners_site as number[][];
            const ring = [...corners, corners[0]];
            const [lon, lat] = toLonLat(site, [site.cE, site.cN]);
            world.findings.push({
              id: fid,
              number: 42,
              type_id: CRACK_ID,
              severity: 3,
              status: "reviewed",
              note: "",
              created_by: "model:m0000000-2222-4000-8000-000000000001",
              confidence: d.confidence,
              anchor: { kind: "map", map_id: MAP_SEP, geometry: { type: "Polygon", coordinates: [ring] } },
              geometry_site: { type: "Polygon", coordinates: [ring] },
              lon,
              lat,
              data_type: "map",
              data_id: MAP_SEP,
              created_at: T,
              updated_at: T,
              reviewed_at: T,
              closed_at: null,
            });
            created.push(fid);
          }
        }
        await reply(r, { updated: b.detection_ids.length });
        // W4 learns the new finding's id only from this event (useReview → waitForFindingIds).
        if (created.length) later(() => sendEvent("findings.changed", { ids: created }));
      },
    ],
    // Drawings (spec §8).
    [
      "POST",
      /^\/drawing-inspections$/,
      (r, _m, body) => {
        const path = String((body as Json).path);
        const id = nextId("i");
        const format = path.toLowerCase().endsWith(".pdf") ? "pdf" : "dxf";
        const job = startJob("drawing_import", { inspection_id: id });
        world.inspections[id] = {
          id,
          state: "ready",
          error: null,
          job_id: job.id,
          path,
          format,
          file_size: 245_760,
          sha256: null,
          units: format === "dxf" ? "metre" : null,
          units_source: format === "dxf" ? "header" : null,
          crs_hint: null,
          extent_src: format === "dxf" ? [0, 0, 220, 160] : null,
          layers:
            format === "dxf"
              ? [{ name: "SITE", colour: "#22d3ee", entity_count: 120, visible_default: true }]
              : [],
          page_count: format === "pdf" ? 1 : null,
          pages: format === "pdf" ? [{ page: 1, width_pt: 1190.55, height_pt: 841.89 }] : [],
          width: null,
          height: null,
          embedded: null,
          warnings: [],
          created_at: T,
        };
        return reply(r, { inspection: world.inspections[id], job }, 202);
      },
    ],
    [
      "GET",
      /^\/drawing-inspections\/([^/]+)$/,
      (r, m) => (world.inspections[m[1]] ? reply(r, world.inspections[m[1]]) : r.fallback()),
    ],
    ["GET", /^\/drawing-inspections\/([^/]+)\/pages\/(\d+)\/thumbnail$/, (r) => png(r, TILES[0])],
    ["GET", /^\/drawings$/, (r) => reply(r, { items: world.drawings.map((d) => drawingBody(d, site)) })],
    [
      "POST",
      /^\/drawings$/,
      async (r, _m, body) => {
        const b = body as Json;
        const insp = world.inspections[String(b.inspection_id)];
        if (!insp) return r.fallback();
        const placement = (b.placement ?? { method: "none" }) as Json;
        const id = nextId("d");
        const job = startJob("drawing_import", { drawing_id: id });
        // DrawingPlacementInput: `{ method: "crs", crs: "EPSG:<code>" | WKT }`.
        const epsg = /^EPSG:(\d+)$/i.exec(String(placement.crs ?? ""))?.[1];
        const d = drawingBody(
          {
            id,
            name: String(b.name),
            format: String(insp.format),
            job_id: job.id,
            source_path: insp.path,
            extent_src: insp.extent_src,
            layers: insp.layers,
            captured_on: b.captured_on ?? null,
            georef:
              placement.method === "crs"
                ? {
                    method: "crs",
                    crs_wkt: epsg ? null : placement.crs,
                    epsg: epsg ? Number(epsg) : null,
                    model: null,
                    points: [],
                    dst_crs_wkt: site.crs_wkt,
                    transform: [1, 0, 0, 0, 1, 0],
                    rmse_m: null,
                    residuals_m: [],
                    warnings: [],
                  }
                : null,
          },
          site,
        );
        world.drawings.push(d);
        await reply(r, { drawing: d, job }, 202);
        later(() => sendEvent("drawings.changed", { ids: [id] }));
      },
    ],
    [
      "POST",
      /^\/drawings\/georef-fit$/,
      (r, _m, body) => {
        const b = body as { model: string; points: { src: number[]; dst: number[] }[] };
        // A similarity fit even for `model: "affine"`: enough for a fake (the model is only echoed).
        const fit = similarityFit(b.points);
        return reply(r, { model: b.model, warnings: [], ...fit });
      },
    ],
    [
      "GET",
      /^\/drawings\/([^/]+)$/,
      (r, m) => {
        const d = world.drawings.find((x) => x.id === m[1]);
        return d ? reply(r, drawingBody(d, site)) : r.fallback();
      },
    ],
    [
      "PUT",
      /^\/drawings\/([^/]+)\/georef$/,
      async (r, m, body) => {
        const d = world.drawings.find((x) => x.id === m[1]);
        if (!d) return r.fallback();
        const b = body as { model: string; points: { id?: string; src: number[]; dst: number[] }[] };
        // A similarity fit even for `model: "affine"`: enough for a fake (the model is only echoed).
        const fit = similarityFit(b.points);
        const full = drawingBody(d, site);
        // Raster drawings use src = (col, −row); vector ones their own units.
        const src =
          full.kind === "raster"
            ? [0, -Number(full.height), Number(full.width), 0]
            : ((full.extent_src as number[] | null) ?? [0, 0, 220, 160]);
        const t = fit.transform;
        const corners = [
          [src[0], src[1]],
          [src[2], src[1]],
          [src[0], src[3]],
          [src[2], src[3]],
        ].map(([x, y]) => [t[0] * x + t[1] * y + t[2], t[3] * x + t[4] * y + t[5]]);
        Object.assign(d, {
          georef: {
            method: "control_points",
            crs_wkt: null,
            epsg: null,
            model: b.model,
            points: b.points.map((p, i) => ({ id: p.id ?? `p${i + 1}`, src: p.src, dst: p.dst })),
            dst_crs_wkt: site.crs_wkt,
            transform: t,
            rmse_m: fit.rmse_m,
            residuals_m: fit.residuals_m,
            warnings: [],
          },
          georef_version: Number(d.georef_version ?? 0) + 1,
          bounds_site: [
            Math.min(...corners.map((c) => c[0])),
            Math.min(...corners.map((c) => c[1])),
            Math.max(...corners.map((c) => c[0])),
            Math.max(...corners.map((c) => c[1])),
          ],
          updated_at: T,
        });
        await reply(r, drawingBody(d, site));
        later(() => sendEvent("drawings.changed", { ids: [d.id] }));
      },
    ],
    [
      "GET",
      /^\/drawings\/([^/]+)\/vtiles\/(\d+)\/(-?\d+)\/(-?\d+)$/,
      (r) => {
        const [x0, y0, x1, y1] = inset(site);
        return reply(r, {
          layers: [{ name: "SITE", colour: "#22d3ee", lines: [[x0, y0, x1, y0, x1, y1]] }],
          labels: [],
          truncated: false,
        });
      },
    ],
    // Map measurements and the union (spec §9.1, §12). Body `MapMeasurementCreate`: flat `vertices`.
    [
      "POST",
      /^\/map-measurements$/,
      (r, _m, body) => {
        const b = body as Json;
        const pts = (b.vertices as number[][]) ?? [];
        const kind = String(b.kind);
        const surfaceIds = (b.surface_ids as string[] | undefined) ?? [];
        const n = world.measurements.length + 1;
        const mm: Json = {
          id: nextId("m"),
          name: b.name ?? `${kind[0].toUpperCase()}${kind.slice(1)} ${n}`,
          note: b.note ?? "",
          kind,
          crs_wkt: site.crs_wkt,
          epsg: site.epsg,
          vertices: pts,
          vertices_site: pts,
          surface_ids: surfaceIds,
          map_id: b.map_id ?? MAP_SEP,
          results: mapMeasurementResults(kind, pts, surfaceIds),
          created_at: T,
          updated_at: T,
        };
        world.measurements.push(mm);
        return reply(r, mm, 201);
      },
    ],
    ["GET", /^\/map-measurements$/, (r) => reply(r, { items: world.measurements, next_cursor: null })],
    [
      "GET",
      /^\/map-measurements\/([^/]+)$/,
      (r, m) => {
        const mm = world.measurements.find((x) => x.id === m[1]);
        return mm ? reply(r, mm) : r.fallback();
      },
    ],
    [
      "GET",
      /^\/measurements$/,
      (r) =>
        reply(r, {
          items: [...world.measurements.map(measurementRow), ...world.volumes.map(volumeRow)],
          next_cursor: null,
        }),
    ],
    // Volumes (existing S2 API + spec §10 `polygon_site`, `toe_lowest`).
    [
      "POST",
      /^\/volumes$/,
      (r, _m, body) => {
        const b = body as Json;
        const id = nextId("v");
        const job = startJob("volume_calc", { measurement_id: id });
        const ring = (b.polygon_site ?? b.polygon_native ?? []) as number[][];
        const v: Json = {
          id,
          name: b.name ?? "Stockpile 1",
          status: "calculating",
          error: null,
          polygon_native: ring,
          polygon_site: ring,
          top_surface_id: b.top_surface_id,
          base: b.base,
          masks: { detection_run_ids: [], class_ids: null, buffer_m: 0.5, exclusion_polygons: [] },
          alignment: { stable_polygon: null, apply_shift: false, measured: null },
          material: null,
          results: null,
          stale_reasons: [],
          job_id: job.id,
          created_at: T,
          updated_at: T,
        };
        world.volumes.push(v);
        return reply(r, { measurement: v, job }, 202);
      },
    ],
    ["GET", /^\/volumes$/, (r) => reply(r, { items: world.volumes })],
    [
      "GET",
      /^\/volumes\/([^/]+)$/,
      (r, m) => {
        const v = world.volumes.find((x) => x.id === m[1]);
        if (!v) return r.fallback();
        // The job "finishes" on the first read after a calculate: numbers depend on the base.
        if (v.status === "calculating") {
          const kind = (v.base as Json).kind;
          const net = kind === "toe_lowest" ? 1412.6 : kind === "toe_plane" ? 1234.5 : 1101.2;
          v.status = "ready";
          v.results = volumeResults(v, net);
        }
        return reply(r, v);
      },
    ],
    [
      "PATCH",
      /^\/volumes\/([^/]+)$/,
      (r, m, body) => {
        const v = world.volumes.find((x) => x.id === m[1]);
        if (!v) return r.fallback();
        Object.assign(v, body as Json, { updated_at: T });
        return reply(r, v);
      },
    ],
    [
      "POST",
      /^\/volumes\/([^/]+)\/calculate$/,
      (r, m) => {
        const v = world.volumes.find((x) => x.id === m[1]);
        if (!v) return r.fallback();
        const job = startJob("volume_calc", { measurement_id: v.id });
        Object.assign(v, { status: "calculating", job_id: job.id });
        return reply(r, { measurement: v, job }, 202);
      },
    ],
    // Site areas with a category (spec §9.4). The client sends WGS84; `frame=site` reads get
    // `polygon_site` back, which ZonesLayer draws.
    ["GET", /^\/site-areas$/, (r) => reply(r, { items: world.siteAreas })],
    [
      "POST",
      /^\/site-areas$/,
      (r, _m, body) => {
        const b = body as Json;
        const wgs = (b.polygon_wgs84 as number[][] | undefined) ?? [];
        const a: Json = {
          id: nextId("5"),
          category: "general",
          created_at: T,
          ...b,
          polygon_wgs84: wgs,
          // The workspace always sends polygon_wgs84; the map_id + polygon_px variant is not faked.
          polygon_site: wgs.map((p) => toSite(site, p)),
        };
        world.siteAreas.push(a);
        return reply(r, a, 201);
      },
    ],
  ];

  await page.route(
    (u) => u.pathname === API || u.pathname.startsWith(`${API}/`),
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname.slice(API.length);
      const text = req.postData();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      for (const [method, re, handler] of table) {
        const m = path.match(re);
        if (m && req.method() === method) {
          world.calls.push({ method, path, body });
          return handler(route, m, body, url);
        }
      }
      return route.fallback();
    },
  );
  return world;
}

/** Site tiles both layers were fetched on: the same grid square for both is "aligned" (spec M6). */
export function sharedTiles(world: MapWorld, a: string, b: string): string[] {
  const of = (id: string) =>
    new Set(world.tiles.filter((t) => t.split("/")[1] === id).map((t) => t.split("/").slice(2).join("/")));
  const sa = of(a);
  return [...of(b)].filter((t) => sa.has(t));
}
