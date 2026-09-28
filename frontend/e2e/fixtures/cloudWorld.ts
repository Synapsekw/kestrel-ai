import { createHash } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import { CATALOGUE_PAGE } from "./appSections";
import { emptyCameras } from "./cameras";
import { CLOUD, cloudJson } from "./clouds";
import { buildOctree, redGreenGrid, routeOctree, type OctreeFiles } from "./potreeOctree";
import { fromMock, jsonReply } from "../mock";
import { API, P } from "./cloudWorkspace";

// A small stateful backend for the point-cloud workspace (C-G): every step reads what the step
// before it wrote. Anything not faked here comes from the Prism mock. Field names were checked
// against `contract/client/schema.d.ts` (Task 1 Step 5 audit): CloudMeasurementOut, CloudViewOut,
// CloudCameraSet, Finding/FindingDetail and FindingCloudAnchor all match the shapes below exactly,
// so no field-name adaptation was needed.

type Json = Record<string, unknown>;
const T = "2026-09-27T09:00:00Z";
export const CRACK = CATALOGUE_PAGE.items.find((t) => t.name === "Crack")!;
export const IMAGE = "10000000-5555-4000-8000-0000000000c1";
export const SOURCE = "50000000-3333-4000-8000-0000000000c1";
const JOB = "j0000000-c10d-4000-8000-000000000001";

const RESULT_KEYS = [
  "lon",
  "lat",
  "dx",
  "dy",
  "dz",
  "distance_3d",
  "distance_horizontal",
  "distance_vertical",
  "height_difference",
  "lean_offset_m",
  "lean_angle_deg",
  "lean_azimuth_deg",
  "lean_mm_per_m",
  "uncertainty_m",
  "angle_uncertainty_deg",
  "area_m2",
  "area_surface_m2",
  "area_plan_m2",
  "perimeter_m",
  "plane_rms_m",
  "plane_tilt_deg",
  "plane_azimuth_deg",
  "uncertainty_m2",
  "ring_radius_lower_m",
  "ring_radius_upper_m",
  "ring_rms_lower_m",
  "ring_rms_upper_m",
  "profile_length_m",
  "profile_z_min",
  "profile_z_max",
  "profile_width_max_m",
  "profile_point_count",
] as const;
type ResultKey = (typeof RESULT_KEYS)[number];

/** A full `CloudMeasurementResults`: every key, null unless set. */
export function results(set: Partial<Record<ResultKey, number>>): Json {
  return Object.fromEntries(RESULT_KEYS.map((k) => [k, set[k] ?? null]));
}

const RESULTS: Record<string, Json> = {
  point: results({ uncertainty_m: 0.04 }),
  distance: results({
    distance_3d: 12.5,
    distance_horizontal: 12.4,
    distance_vertical: 1.6,
    uncertainty_m: 0.04,
  }),
  height: results({ height_difference: 1.6, uncertainty_m: 0.04 }),
  vertical: results({
    lean_angle_deg: 1.0,
    lean_azimuth_deg: 90,
    lean_offset_m: 0.35,
    lean_mm_per_m: 17.5,
    uncertainty_m: 0.04,
  }),
  area: results({
    area_m2: 1250,
    area_surface_m2: 1250,
    area_plan_m2: 1249.8,
    perimeter_m: 141.4,
    plane_rms_m: 0.01,
    plane_tilt_deg: 1.1,
    uncertainty_m2: 5.7,
  }),
  profile: results({ profile_length_m: 20 }),
};
const KIND_LABEL: Record<string, string> = {
  point: "Point",
  distance: "Distance",
  height: "Height",
  vertical: "Verticality",
  area: "Area",
  profile: "Cross-section",
};

/** A cloud finding on the red/green grid's surface (z = 0.02 · (x − 243500)). */
export function cloudFinding(i: number, at: [number, number, number], over: Json = {}): Json {
  return {
    id: `f0000000-c10d-4000-8000-${String(i).padStart(12, "0")}`,
    number: i + 1,
    type_id: CRACK.id,
    severity: 2,
    status: "open",
    note: "",
    created_by: "human",
    confidence: null,
    anchor: { kind: "cloud", cloud_id: CLOUD, x: at[0], y: at[1], z: at[2], uncertainty_m: 0.05 },
    lon: null,
    lat: null,
    data_type: "point_cloud",
    data_id: CLOUD,
    created_at: T,
    updated_at: T,
    reviewed_at: null,
    closed_at: null,
    ...over,
  };
}

/** `n` findings on a 20-column grid inside the fixture's 100 m square. */
export function gridPins(n: number): Json[] {
  return Array.from({ length: n }, (_, i) => {
    const x = 243505 + (i % 20) * 4.5;
    const y = 3178005 + Math.floor(i / 20) * 9;
    return cloudFinding(i, [x, y, 0.02 * (x - 243500)]);
  });
}

/** One posed nadir camera 60 m over the fixture's centre (a `CloudCameraSet`). */
export function nadirCamera(posed = true): Json {
  return {
    image_id: [IMAGE],
    source_idx: [0],
    x: [243550],
    y: [3178050],
    z: [60],
    yaw: [posed ? 0 : null],
    pitch: [posed ? -90 : null],
    roll: [posed ? 0 : null],
    hfov: [73.7],
    vfov: [53.1],
    fov_assumed: [false],
    width: [4000],
    height: [3000],
    sigma_m: [3],
    sources: [{ id: SOURCE, label: "Flight 1", count: 1, height_offset_m: 0, posed_count: posed ? 1 : 0 }],
    truncated: false,
    z_p1: 0.02,
    z_p99: 1.98,
    without_gps: 0,
  };
}

/** The named parts of a multipart body (a report-view PUT: `image` and `meta`). */
export function parseMultipart(body: Buffer, contentType: string): Record<string, Buffer> {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (!m) throw new Error(`not multipart: ${contentType}`);
  const boundary = Buffer.from(`--${m[1] ?? m[2]}`);
  const parts: Record<string, Buffer> = {};
  let at = body.indexOf(boundary);
  while (at >= 0) {
    const next = body.indexOf(boundary, at + boundary.length);
    if (next < 0) break;
    const part = body.subarray(at + boundary.length + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    const name = /name="([^"]+)"/.exec(part.subarray(0, split).toString())?.[1];
    if (name) parts[name] = part.subarray(split + 4);
    at = next;
  }
  return parts;
}

/** A PNG's pixel size from its IHDR, or null for anything else. */
export function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Decodes `png` in the page and samples a 40 × 25 grid: the distinct colours (quantised to 5 bits
 * per channel) and the share of samples that differ from the corner pixel (the backdrop). A blank
 * render-target read-back gives 1 colour and share 0.
 */
export async function decodedColours(
  page: Page,
  png: Buffer,
): Promise<{ distinct: number; nonBackground: number }> {
  return page.evaluate(async (b64) => {
    // a Blob, not fetch("data:…"): the packaged app's CSP may refuse data: in connect-src
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext("2d")!;
    g.drawImage(bmp, 0, 0);
    const q = (x: number, y: number) => {
      const d = g.getImageData(x, y, 1, 1).data;
      return ((d[0] >> 3) << 10) | ((d[1] >> 3) << 5) | (d[2] >> 3);
    };
    const back = q(0, 0);
    const seen = new Set<number>();
    let other = 0;
    for (let i = 0; i < 40; i++)
      for (let j = 0; j < 25; j++) {
        const v = q(Math.floor(((i + 0.5) * bmp.width) / 40), Math.floor(((j + 0.5) * bmp.height) / 25));
        seen.add(v);
        if (v !== back) other++;
      }
    return { distinct: seen.size, nonBackground: other / 1000 };
  }, png.toString("base64"));
}

export interface ViewPut {
  kind: "finding" | "cloud_measurement";
  id: string;
  meta: Json;
  image: Buffer;
  width: number;
  height: number;
  at: number;
}

export interface CloudWorld {
  measurements: Json[];
  findings: Json[];
  views: Map<string, Json>;
  measurementPosts: Json[];
  measurementPatches: Json[];
  findingPosts: Json[];
  findingPatches: Json[];
  viewPuts: ViewPut[];
  /** Completes the profile job of measurement `id`: the next job read says succeeded. */
  finishProfile(id: string): void;
}

export interface WorldOptions {
  octree?: OctreeFiles;
  cloud?: Json;
  /** Findings present before the page loads (see `gridPins`, `cloudFinding`). */
  findings?: Json[];
  /** Report views present before the page loads, keyed `finding:<id>` / `cloud_measurement:<id>`. */
  views?: Record<string, Json>;
  cameras?: Json;
}

const viewOut = (
  kind: string,
  id: string,
  meta: Json,
  image: Buffer,
  size: { width: number; height: number },
) => ({
  subject_kind: kind,
  subject_id: id,
  pose: meta.pose,
  render: meta.render,
  anchor_normal: (meta.anchor_normal as number[] | undefined) ?? null,
  sha256: createHash("sha256").update(image).digest("hex"),
  bytes: image.length,
  width: size.width,
  height: size.height,
  captured_at: T,
  stale: false,
});

export async function serveCloudWorld(page: Page, o: WorldOptions = {}): Promise<CloudWorld> {
  const project = await fromMock(page, API);
  const cloud = cloudJson(o.cloud ?? {});
  const done = new Set<string>();
  const world: CloudWorld = {
    measurements: [],
    findings: [...(o.findings ?? [])],
    views: new Map(Object.entries(o.views ?? {})),
    measurementPosts: [],
    measurementPatches: [],
    findingPosts: [],
    findingPatches: [],
    viewPuts: [],
    finishProfile: (id) => void done.add(id),
  };
  const detail = (f: Json) => ({ ...f, attachment_count: 0, comment_count: 0 });
  const get = (route: Route) => route.request().method() === "GET";

  await page.route(
    (u) => u.pathname === API,
    (route) =>
      get(route)
        ? route.fulfill(
            jsonReply({
              ...project,
              classes: [
                {
                  id: CRACK.id,
                  name: CRACK.name,
                  colour: CRACK.colour,
                  hotkey: CRACK.hotkey,
                  order: 0,
                  kind: CRACK.kind,
                  default_severity: CRACK.default_severity,
                  group: CRACK.group,
                },
              ],
            }),
          )
        : route.fallback(),
  );
  await page.route(
    (u) => u.pathname === "/api/v1/catalogue/types",
    (route) => (get(route) ? route.fulfill(jsonReply(CATALOGUE_PAGE)) : route.fallback()),
  );
  await page.route(
    (u) => u.pathname === `${API}/pointclouds`,
    (route) => (get(route) ? route.fulfill(jsonReply({ items: [cloud] })) : route.fallback()),
  );
  await page.route(
    (u) => u.pathname === `${API}/pointclouds/${CLOUD}`,
    (route) => (get(route) ? route.fulfill(jsonReply(cloud)) : route.fallback()),
  );
  await routeOctree(
    page,
    CLOUD,
    o.octree ?? buildOctree(redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 1 })),
  );
  // C-L1's `emptyCameras()` (frontend/e2e/fixtures/cameras.ts) instead of an inline empty object: its
  // Prism-served example cameras otherwise wake the render loop (a stray frame / drawn point) for
  // every spec that opens a cloud without caring about cameras.
  await page.route(
    (u) => u.pathname === `${API}/pointclouds/${CLOUD}/cameras`,
    (route) => route.fulfill(jsonReply(o.cameras ?? emptyCameras())),
  );
  await page.route(
    (u) => u.pathname === `${API}/pointclouds/${CLOUD}/views`,
    (route) => route.fulfill(jsonReply({ items: [...world.views.values()] })),
  );

  // measurements: list, create (201, or 202 for a profile), patch, delete, profile, view3d
  await page.route(
    (u) => u.pathname.startsWith(`${API}/pointclouds/${CLOUD}/measurements`),
    async (route) => {
      const req = route.request();
      const parts = new URL(req.url()).pathname.split("/");
      const i = parts.indexOf("measurements");
      const id = parts[i + 1];
      const sub = parts[i + 2];
      if (!id && req.method() === "GET") {
        const items = world.measurements.map((m) =>
          m.kind === "profile" && m.status === "computing" && done.has(m.id as string)
            ? Object.assign(m, {
                status: "ready",
                results: results({
                  profile_length_m: 20,
                  profile_point_count: 1234,
                  profile_z_min: 0.2,
                  profile_z_max: 1.4,
                  profile_width_max_m: 0.3,
                }),
              })
            : m,
        );
        return route.fulfill(jsonReply({ items }));
      }
      if (!id && req.method() === "POST") {
        const body = req.postDataJSON() as Json;
        world.measurementPosts.push(body);
        const n = world.measurements.length + 1;
        const kind = body.kind as string;
        const m: Json = {
          id: `m0000000-c10d-4000-8000-${String(n).padStart(12, "0")}`,
          point_cloud_id: CLOUD,
          kind,
          name: `${KIND_LABEL[kind] ?? kind} ${n}`,
          note: null,
          points: body.points,
          results: RESULTS[kind] ?? results({}),
          params: body.params ?? null,
          status: kind === "profile" ? "computing" : "ready",
          error: null,
          job_id: kind === "profile" ? JOB : null,
          finding_id: null,
          view: null,
          created_at: T,
          updated_at: T,
        };
        world.measurements.push(m);
        if (kind !== "profile") return route.fulfill(jsonReply(m, 201));
        const job = {
          id: JOB,
          project_id: P,
          type: "pointcloud_profile",
          state: "queued",
          progress: 0,
          message: "",
          log_path: "",
          params: {},
          result: null,
          error: null,
          created_at: T,
          started_at: null,
          finished_at: null,
        };
        return route.fulfill(jsonReply({ measurement: m, job }, 202));
      }
      const m = world.measurements.find((x) => x.id === id);
      if (!m)
        return route.fulfill(
          jsonReply({ error: { code: "not_found", message: "not found", details: {} } }, 404),
        );
      if (sub === "view3d") {
        if (req.method() === "PUT") {
          const bodyParts = parseMultipart(req.postDataBuffer()!, req.headers()["content-type"]);
          const meta = JSON.parse(bodyParts.meta.toString()) as Json;
          const size = pngSize(bodyParts.image) ?? { width: 0, height: 0 };
          world.viewPuts.push({
            kind: "cloud_measurement",
            id,
            meta,
            image: bodyParts.image,
            ...size,
            at: Date.now(),
          });
          const out = viewOut("cloud_measurement", id, meta, bodyParts.image, size);
          world.views.set(`cloud_measurement:${id}`, out);
          return route.fulfill(jsonReply(out));
        }
        const put = [...world.viewPuts].reverse().find((v) => v.id === id);
        return put
          ? route.fulfill({
              status: 200,
              contentType: "image/png",
              headers: { "Access-Control-Allow-Origin": "*" },
              body: put.image,
            })
          : route.fulfill(jsonReply({ error: { code: "no_view", message: "no view", details: {} } }, 404));
      }
      if (sub === "profile") {
        return route.fulfill(
          jsonReply({
            s: [0, 10, 20],
            z: [0.2, 0.8, 1.4],
            rgb: [220, 20, 20, 20, 200, 20, 20, 200, 20],
            count: 3,
            thickness_m: 0.2,
            length_m: 20,
          }),
        );
      }
      if (req.method() === "PATCH") {
        const patch = req.postDataJSON() as Json;
        world.measurementPatches.push({ id, ...patch });
        Object.assign(m, patch);
        return route.fulfill(jsonReply(m));
      }
      if (req.method() === "DELETE") {
        world.measurements.splice(world.measurements.indexOf(m), 1);
        return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
      }
      return route.fulfill(jsonReply(m));
    },
  );
  await page.route(
    (u) => u.pathname === `${API}/jobs/${JOB}`,
    (route) => {
      const m = world.measurements.find((x) => x.job_id === JOB);
      const ok = m ? done.has(m.id as string) : false;
      return route.fulfill(
        jsonReply({
          id: JOB,
          project_id: P,
          type: "pointcloud_profile",
          state: ok ? "succeeded" : "running",
          progress: ok ? 1 : 0.5,
          message: "",
          log_path: "",
          params: {},
          result: null,
          error: null,
          created_at: T,
          started_at: T,
          finished_at: ok ? T : null,
        }),
      );
    },
  );

  // findings: F's paged list, create, detail, patch, view3d
  await page.route(
    (u) => u.pathname.startsWith(`${API}/findings`),
    async (route) => {
      const req = route.request();
      const rest = new URL(req.url()).pathname.slice(`${API}/findings`.length).split("/").filter(Boolean);
      if (rest.length === 0 && req.method() === "GET")
        return route.fulfill(jsonReply({ items: world.findings, next_cursor: null }));
      if (rest.length === 0 && req.method() === "POST") {
        const body = req.postDataJSON() as Json;
        world.findingPosts.push(body);
        const i = world.findings.length;
        const a = body.anchor as { x: number; y: number; z: number };
        const f = cloudFinding(i + 1000, [a.x, a.y, a.z], {
          number: i + 1,
          type_id: body.type_id,
          severity: body.severity ?? CRACK.default_severity,
          anchor: body.anchor,
          note: body.note ?? "",
        });
        world.findings.push(f);
        return route.fulfill(jsonReply(detail(f), 201));
      }
      const [id, sub] = rest;
      if (id === "summary" || id === "bulk") return route.fallback();
      const f = world.findings.find((x) => x.id === id);
      if (!f) return route.fallback();
      if (sub === "view3d") {
        if (req.method() === "PUT") {
          const bodyParts = parseMultipart(req.postDataBuffer()!, req.headers()["content-type"]);
          const meta = JSON.parse(bodyParts.meta.toString()) as Json;
          const size = pngSize(bodyParts.image) ?? { width: 0, height: 0 };
          world.viewPuts.push({ kind: "finding", id, meta, image: bodyParts.image, ...size, at: Date.now() });
          const out = viewOut("finding", id, meta, bodyParts.image, size);
          world.views.set(`finding:${id}`, out);
          return route.fulfill(jsonReply(out));
        }
        const put = [...world.viewPuts].reverse().find((v) => v.id === id);
        return put
          ? route.fulfill({
              status: 200,
              contentType: "image/png",
              headers: { "Access-Control-Allow-Origin": "*" },
              body: put.image,
            })
          : route.fulfill(jsonReply({ error: { code: "no_view", message: "no view", details: {} } }, 404));
      }
      if (sub) return route.fallback(); // attachments, comments, activity: Prism
      if (req.method() === "PATCH") {
        const patch = req.postDataJSON() as Json;
        world.findingPatches.push({ id, ...patch });
        Object.assign(f, patch, { updated_at: T });
        return route.fulfill(jsonReply(detail(f)));
      }
      return route.fulfill(jsonReply(detail(f)));
    },
  );
  return world;
}
