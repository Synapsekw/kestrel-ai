import { readFileSync } from "node:fs";
import type { Page, Request, Route } from "@playwright/test";
import { CATALOGUE_PAGE, SEVERITY } from "../fixtures/appSections";
import { fromMock, jsonReply } from "../mock";

/**
 * A small stateful backend for the Images workspace (plan 2026-09-27-images-e, rulings E1, E2).
 * Anything not handled here falls through to the Prism mock. Every write is logged in
 * `world.requests`, so a flow can assert exactly what the app sent.
 */

export type Json = Record<string, unknown>;

export const P = "7f1c2e3a-1111-4000-8000-0000000000e1";
export const SOURCE = "50000000-3333-4000-8000-0000000000e1";
export const MODEL = "m0000000-2222-4000-8000-0000000000e1";
export const T = "2026-09-27T09:00:00Z";
export const CRACK = CATALOGUE_PAGE.items.find((t) => t.name === "Crack")!;
export const EXCAVATOR = CATALOGUE_PAGE.items.find((t) => t.name === "Excavator")!;
const TYPES = [CRACK, EXCAVATOR];
const IMPORT_JOB = "j0000000-4444-4000-8000-0000000000e1";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaGhgAAAChACB8f3CzwAAAABJRU5ErkJggg==",
  "base64",
);

export interface Frame {
  id: string;
  file_name: string;
  width: number;
  height: number;
  lat: number | null;
  lon: number | null;
  capture_time: string | null;
  camera: Json;
  footprint: Json | null;
  footprint_kind: string;
}

export interface WorldOptions {
  frames: Frame[];
  /** Boxes already on an image (accepted or unreviewed), by image id. */
  boxes?: Record<string, Json[]>;
  /** The fake provider: the suggestions `detectImage` answers for a frame. */
  detect?: (frame: Frame) => Json[];
  /** false: the project starts empty and the frames appear after "Start import" (flow 1). */
  imported?: boolean;
  /** Delay before a thumbnail answers, so concurrency is observable (flow 7). */
  thumbDelayMs?: number;
}

export interface World {
  frames: Frame[];
  boxes: Map<string, Json[]>;
  findings: Json[];
  measurements: Map<string, Json[]>;
  requests: { method: string; path: string; body: unknown; at: number }[];
  imported: boolean;
  thumbsInFlight: number;
  maxThumbsInFlight: number;
  maxIdsPerList: number;
}

const NO_CAMERA: Json = {
  rel_alt: null,
  gimbal_pitch: null,
  gimbal_yaw: null,
  focal_mm: null,
  focal_px: null,
  sensor_w_mm: null,
  lrf_distance_m: null,
  subject_distance_m: null,
  distance_m: null,
  distance_sigma_m: null,
  distance_source: "none",
  gsd_mm: null,
  camera_model: null,
};

/** The three DJI frames the real backend produced (Task 2; backend/tests/test_images_e2e_fixture.py). */
export function djiFrames(): Frame[] {
  const raw = readFileSync(new URL("../fixtures/dji-flight.json", import.meta.url), "utf8");
  return (JSON.parse(raw) as { frames: Frame[] }).frames;
}

/** `n` plain 4000x3000 frames on a lat/lon grid, no camera data (flows 6, 7). */
export function syntheticFrames(n: number): Frame[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    file_name: `F_${String(i + 1).padStart(5, "0")}.jpg`,
    width: 4000,
    height: 3000,
    lat: 25.2 + Math.floor(i / 200) * 0.0002,
    lon: 55.2 + (i % 200) * 0.0002,
    capture_time: new Date(Date.UTC(2026, 8, 14, 6) + i * 2000).toISOString(),
    camera: NO_CAMERA,
    footprint: null,
    footprint_kind: "none",
  }));
}

function person(imageId: string, id: string, typeId: string, geom: Json): Json {
  return {
    id,
    image_id: imageId,
    class_id: typeId,
    angle: 0,
    confidence: null,
    provenance: { kind: "person", model_id: null, provider: null, model_name: null, query_run_id: null },
    review_state: "accepted",
    reviewed_at: T,
    created_at: T,
    updated_at: T,
    assist: null,
    points: null,
    ...geom,
  };
}

/** Spec §17 flow 6: 300 polygons of 40 vertices and 200 boxes, spread over a 4000x3000 frame. */
export function heavyAnnotations(imageId: string): Json[] {
  const out: Json[] = [];
  for (let i = 0; i < 300; i++) {
    const cx = 100 + (i % 20) * 190;
    const cy = 100 + Math.floor(i / 20) * 180;
    const points = Array.from({ length: 40 }, (_, k) => {
      const a = (2 * Math.PI * k) / 40;
      const r = 50 + 12 * Math.sin(5 * a);
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    });
    out.push(
      person(imageId, `p${String(i).padStart(4, "0")}`, CRACK.id, {
        shape: "polygon",
        points,
        x: cx - 62,
        y: cy - 62,
        w: 124,
        h: 124,
        area_px: 7800,
      }),
    );
  }
  for (let i = 0; i < 200; i++) {
    const x = 40 + (i % 20) * 195;
    const y = 2750 - Math.floor(i / 20) * 120;
    out.push(
      person(imageId, `x${String(i).padStart(4, "0")}`, EXCAVATOR.id, {
        shape: "box",
        x,
        y,
        w: 150,
        h: 90,
        area_px: 13500,
      }),
    );
  }
  return out;
}

/** A model suggestion, as `detectImage` returns it. */
export function suggestion(imageId: string, id: string, typeId: string, conf: number, geom: Json): Json {
  return {
    ...person(imageId, id, typeId, geom),
    confidence: conf,
    provenance: {
      kind: "local_model",
      model_id: MODEL,
      provider: null,
      model_name: "Crack-seg v4",
      query_run_id: null,
    },
    review_state: "unreviewed",
    reviewed_at: null,
  };
}

function envelope(points: number[][]) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function shoelace(points: number[][]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

/** A 24-vertex disc of radius 40 px around (x, y): the fake SAM answer (I-BS's FakeDiscBackend shape). */
export function disc(x: number, y: number, r = 40): number[][] {
  return Array.from({ length: 24 }, (_, k) => {
    const a = (2 * Math.PI * k) / 24;
    return [Math.round((x + r * Math.cos(a)) * 10) / 10, Math.round((y + r * Math.sin(a)) * 10) / 10];
  });
}

export async function serveImages(page: Page, opts: WorldOptions): Promise<World> {
  const exampleProject = await fromMock(page, `/api/v1/projects/${P}`);
  const imageExample = (await fromMock<{ items: Json[] }>(page, `/api/v1/projects/${P}/images`)).items[0];
  const sourceExample = (await fromMock<{ items: Json[] }>(page, `/api/v1/projects/${P}/sources`)).items[0];
  const jobExample = (await fromMock<{ items: Json[] }>(page, `/api/v1/projects/${P}/jobs`)).items[0];
  const modelExample = (await fromMock<{ items: Json[] }>(page, `/api/v1/library/models`)).items[0];

  const world: World = {
    frames: opts.frames,
    boxes: new Map(opts.frames.map((f) => [f.id, [...(opts.boxes?.[f.id] ?? [])]])),
    findings: [],
    measurements: new Map(),
    requests: [],
    imported: opts.imported ?? true,
    thumbsInFlight: 0,
    maxThumbsInFlight: 0,
    maxIdsPerList: 0,
  };
  const byId = new Map(opts.frames.map((f, i) => [f.id, { f, i }]));
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}0000000-7777-4000-8000-${String(++seq).padStart(12, "0")}`;
  const frames = () => (world.imported ? world.frames : []);
  const typeOf = (id: unknown) => TYPES.find((t) => t.id === id);

  // `world.thumbsInFlight` counts the loader's real concurrency (spec §15: at most 8 thumbnail
  // fetches in flight), not raw HTTP dispatches, for two reasons verified against `thumbs.ts`'s
  // `ThumbLoader` (flow 7, 20k images):
  //  1. React StrictMode (dev only, `main.tsx`) double-invokes every effect mount, so each new
  //     batch of visible tiles asks for the *same* thumbnail URL twice a few ms apart; the first
  //     copy's fetch is aborted client-side almost immediately as the second starts. The loader
  //     itself dedupes same-URL asks (`ThumbLoader.pending`), so this is one logical fetch, not
  //     two — we key in-flight tracking by URL, not by request, so a StrictMode duplicate doesn't
  //     double-count.
  //  2. A scrolled-out tile aborts its fetch: the browser rejects it immediately, well before our
  //     simulated `thumbDelayMs` elapses. Without an early signal, a request we already counted
  //     stays counted for the rest of its delay even though the app gave up on it, so a fast
  //     repeated scroll can make the peak read higher than the loader's real 8-slot cap (`pump()`
  //     never starts a fetch once `active === maxInFlight`, so the app itself cannot exceed 8). We
  //     settle a URL as soon as the page reports the request failed (aborted), not only when our
  //     own handler's delay finishes.
  // Both are world/measurement artefacts of testing against `vite dev` + Playwright's CDP timing,
  // not production bugs — a packaged build never double-invokes effects, and the loader's own
  // admission control is a hard, structural bound.
  const thumbFlight = new Map<string, number>(); // url -> outstanding mock-side requests
  const settled = new WeakSet<Request>();
  const bumpThumb = (url: string, delta: 1 | -1) => {
    const next = (thumbFlight.get(url) ?? 0) + delta;
    if (next <= 0) thumbFlight.delete(url);
    else thumbFlight.set(url, next);
    world.thumbsInFlight = thumbFlight.size;
    world.maxThumbsInFlight = Math.max(world.maxThumbsInFlight, world.thumbsInFlight);
  };
  const settleThumb = (req: Request) => {
    if (settled.has(req)) return;
    settled.add(req);
    bumpThumb(req.url(), -1);
  };
  page.on("requestfailed", (req) => {
    if (req.url().includes("/thumbnail")) settleThumb(req);
  });

  // --- derived image state (C0 rulings 4, 5)
  const openFindings = (imageId: string) =>
    world.findings.filter((f) => (f.anchor as Json).image_id === imageId && f.status !== "closed");
  const stateOf = (f: Frame) => {
    const boxes = world.boxes.get(f.id) ?? [];
    const pending = boxes.filter((b) => b.review_state === "unreviewed");
    const accepted = boxes.filter((b) => b.review_state === "accepted" || b.review_state === "edited");
    const fs = openFindings(f.id);
    const worst = fs.reduce((m, x) => Math.max(m, (x.severity as number | null) ?? 0), 0);
    const reviewed = pending.length === 0 && accepted.length > 0;
    const flags = (reviewed ? 1 : 0) | (pending.length ? 2 : 0) | (f.lat !== null ? 4 : 0);
    return { boxes, pending, accepted, count: fs.length, worst, reviewed, flags };
  };
  const imageOf = (f: Frame): Json => {
    const s = stateOf(f);
    return {
      ...imageExample,
      id: f.id,
      path: `images/flight/${f.file_name}`,
      file_name: f.file_name,
      width: f.width,
      height: f.height,
      source_id: SOURCE,
      group_key: "",
      capture_time: f.capture_time,
      lat: f.lat,
      lon: f.lon,
      box_count: s.boxes.length,
      pending_count: s.pending.length,
      max_pending_confidence: s.pending.length
        ? Math.max(...s.pending.map((b) => b.confidence as number))
        : null,
      labeled: s.accepted.length > 0,
      marked_empty: false,
      created_at: T,
      finding_count: s.count,
      worst_severity: s.count ? s.worst : null,
      reviewed: s.reviewed,
    };
  };
  const detailOf = (f: Frame): Json => ({
    ...imageOf(f),
    camera: f.camera,
    footprint: f.footprint,
    footprint_kind: f.footprint_kind,
  });
  // One index for the unfiltered order, rebuilt only when asked (the 20k world asks a few times).
  const index = (q: URLSearchParams): Json => {
    let list = frames();
    if (q.get("has_suggestions") === "true") list = list.filter((f) => stateOf(f).pending.length > 0);
    if (q.get("has_findings") === "true") list = list.filter((f) => stateOf(f).count > 0);
    const states = list.map(stateOf);
    const body: Json = {
      total: list.length,
      ids: list.map((f) => f.id),
      sev: states.map((s) => s.worst),
      count: states.map((s) => s.count),
      flags: states.map((s) => s.flags),
    };
    if (q.get("fields") === "geo") {
      body.lon = list.map((f) => f.lon);
      body.lat = list.map((f) => f.lat);
    }
    return body;
  };
  const project = (): Json => ({
    ...exampleProject,
    id: P,
    name: "Tower Q3",
    classes: TYPES.map(({ id, name, colour, kind, default_severity, hotkey, group }, order) => ({
      id,
      name,
      colour,
      hotkey,
      order,
      kind,
      default_severity,
      group,
    })),
  });

  // --- findings (F's invariant: a defect annotation is a finding)
  const newFinding = (box: Json, createdBy: string): Json => {
    const f = byId.get(box.image_id as string)!.f;
    const finding: Json = {
      id: nextId("f"),
      number: world.findings.length + 1,
      type_id: box.class_id,
      severity: typeOf(box.class_id)?.default_severity ?? null,
      status: "open",
      note: "",
      created_by: createdBy,
      confidence: box.confidence ?? null,
      anchor: { kind: "image", image_id: box.image_id, annotation_id: box.id },
      lon: f.lon,
      lat: f.lat,
      data_type: "image_set",
      data_id: SOURCE,
      created_at: T,
      updated_at: T,
      reviewed_at: null,
      closed_at: null,
    };
    world.findings.push(finding);
    return finding;
  };
  const findingOf = (boxId: string) => world.findings.find((x) => (x.anchor as Json).annotation_id === boxId);

  const createBox = (imageId: string, b: Json): Json => {
    const shape = (b.shape as string) ?? "box";
    let geom: Json;
    if (shape === "polygon") {
      const pts = b.points as number[][];
      geom = { ...envelope(pts), angle: 0, points: pts, area_px: shoelace(pts) };
    } else if (shape === "point") {
      geom = { x: b.x, y: b.y, w: 0, h: 0, angle: 0, points: null, area_px: 0 };
    } else {
      geom = {
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        angle: b.angle ?? 0,
        points: null,
        area_px: (b.w as number) * (b.h as number),
      };
    }
    const box = person(imageId, nextId("b"), b.class_id as string, {
      shape,
      assist: b.assist ?? null,
      ...geom,
    });
    world.boxes.get(imageId)!.push(box);
    const finding = typeOf(b.class_id)?.kind === "defect" ? newFinding(box, "human") : null;
    return { ...box, repaired: false, finding_id: finding ? finding.id : null };
  };

  const measure = (imageId: string, b: Json): Json => {
    const f = byId.get(imageId)!.f;
    const lengthPx = Math.hypot((b.x2 as number) - (b.x1 as number), (b.y2 as number) - (b.y1 as number));
    const gsd = f.camera.gsd_mm as number | null;
    const d = f.camera.distance_m as number | null;
    const sd = f.camera.distance_sigma_m as number | null;
    const lengthMm = gsd === null ? null : lengthPx * gsd;
    const sigma =
      lengthMm === null || !d || sd === null ? null : (lengthMm * sd) / d + Math.SQRT2 * (gsd as number);
    const m = {
      id: nextId("e"),
      image_id: imageId,
      x1: b.x1,
      y1: b.y1,
      x2: b.x2,
      y2: b.y2,
      label: b.label ?? "",
      created_at: T,
      length_px: lengthPx,
      length_mm: lengthMm,
      sigma_mm: sigma,
    };
    world.measurements.set(imageId, [...(world.measurements.get(imageId) ?? []), m]);
    return m;
  };

  const summary = () => {
    const open = world.findings.filter((f) => f.status === "open");
    const bySeverity: Record<string, number> = {};
    for (const s of SEVERITY) bySeverity[String(s.level)] = open.filter((f) => f.severity === s.level).length;
    return {
      by_status: {
        open: open.length,
        reviewed: world.findings.filter((f) => f.status === "reviewed").length,
        closed: world.findings.filter((f) => f.status === "closed").length,
      },
      open_by_severity: bySeverity,
      open_no_severity: open.filter((f) => f.severity === null).length,
      by_type: open.length ? [{ type_id: CRACK.id, n: open.length }] : [],
      trend: [],
    };
  };

  const handle = async (route: Route): Promise<void> => {
    const req = route.request();
    const method = req.method();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const q = url.searchParams;
    const reply = (body: unknown, status = 200) => route.fulfill(jsonReply(body, status));
    const body = () => (req.postDataJSON() ?? {}) as Json;
    if (method !== "GET" && method !== "OPTIONS")
      world.requests.push({ method, path, body: req.postDataJSON(), at: Date.now() });

    // --- library: the fake provider's model, and the SAM weights (ready)
    if (path === "/library/models" && method === "GET")
      return reply({
        items: [
          {
            ...modelExample,
            id: MODEL,
            name: "Crack-seg v4",
            task: "segment",
            state: "ready",
            class_names: ["crack", "excavator"],
            class_map: { crack: CRACK.id, excavator: EXCAVATOR.id },
          },
        ],
        next_cursor: null,
      });
    if (path === "/library/assist-models" && method === "GET")
      return reply({
        items: [
          {
            key: "sam2.1_t",
            name: "SAM 2.1 tiny",
            description: "Smart polygon: click an object and get its outline.",
            size_mb: 148.7,
            sha256: "0".repeat(64),
            state: "ready",
            reason: null,
            job_id: null,
          },
        ],
        next_cursor: null,
      });
    if (path === "/catalogue/types") return reply({ ...CATALOGUE_PAGE, needs_classification: false });
    if (path === "/catalogue/severity") return reply({ levels: SEVERITY });
    if (path === "/projects" && method === "GET") return reply({ items: [project()], next_cursor: null });
    if (!path.startsWith(`/projects/${P}`)) return route.fallback();
    const sub = path.slice(`/projects/${P}`.length);

    if (sub === "" && method === "GET") return reply(project());

    // --- import (flow 1)
    const importJob = {
      ...jobExample,
      id: IMPORT_JOB,
      project_id: P,
      type: "import",
      state: "succeeded",
      progress: 1,
      message: `${world.frames.length} / ${world.frames.length} images`,
      params: { folder: "E:\\Flights\\DJI" },
      result: null,
      error: null,
      created_at: T,
      started_at: T,
      finished_at: T,
    };
    const source = {
      ...sourceExample,
      id: SOURCE,
      label: "DJI flight 14 Sep",
      folder: "E:\\Flights\\DJI",
      image_count: frames().length,
      duplicate_count: 0,
      job_id: IMPORT_JOB,
      imported_at: world.imported ? T : null,
      created_at: T,
    };
    if (sub === "/sources" && method === "POST") {
      world.imported = true;
      return reply({ source: { ...source, image_count: world.frames.length }, job: importJob }, 202);
    }
    if (sub === "/sources" && method === "GET")
      return reply({ items: world.imported ? [source] : [], next_cursor: null });
    if (sub === "/jobs" && method === "GET")
      return reply({ items: world.imported ? [importJob] : [], next_cursor: null });
    if (sub === `/jobs/${IMPORT_JOB}`) return reply(importJob);

    // --- the browser: index, cell details, thumbnails, files
    if (sub === "/images/index" && method === "GET") return reply(index(q));
    if (sub === "/images" && method === "GET") {
      const ids = q
        .getAll("ids")
        .flatMap((s) => s.split(","))
        .filter(Boolean);
      if (ids.length) {
        world.maxIdsPerList = Math.max(world.maxIdsPerList, ids.length);
        const items = ids
          .map((id) => byId.get(id))
          .filter((x) => x !== undefined)
          .map((x) => imageOf(x.f));
        return reply({ items, next_cursor: null, total: items.length });
      }
      const limit = Number(q.get("limit") ?? 50);
      const from = Number(q.get("cursor") ?? 0);
      const all = frames();
      const items = all.slice(from, from + limit).map(imageOf);
      return reply({
        items,
        next_cursor: from + limit < all.length ? String(from + limit) : null,
        total: all.length,
      });
    }
    const img = /^\/images\/([^/]+)(\/.*)?$/.exec(sub);
    if (img && img[1] !== "index" && img[1] !== "detect-batch" && img[1] !== "metadata-refresh") {
      const hit = byId.get(img[1]);
      if (!hit || !world.imported)
        return reply({ error: { code: "not_found", message: "no such image" } }, 404);
      const tail = img[2] ?? "";
      if (tail === "/thumbnail") {
        const thumbReq = route.request();
        bumpThumb(thumbReq.url(), 1);
        if (opts.thumbDelayMs) await new Promise((r) => setTimeout(r, opts.thumbDelayMs));
        return route
          .fulfill({
            status: 200,
            contentType: "image/png",
            headers: { "Access-Control-Allow-Origin": "*" },
            body: PNG,
          })
          .catch(() => undefined) // the page aborted the fetch (a row scrolled out)
          .finally(() => settleThumb(thumbReq));
      }
      if (tail === "/file")
        return route.fulfill({
          status: 200,
          contentType: "image/png",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: PNG,
        });
      if (tail === "" && method === "GET") return reply(detailOf(hit.f));
      if (tail === "" && method === "PATCH") {
        Object.assign(hit.f.camera, { subject_distance_m: body().subject_distance_m ?? null });
        return reply(detailOf(hit.f));
      }
      if (tail === "/boxes" && method === "GET") return reply({ items: world.boxes.get(hit.f.id) });
      if (tail === "/boxes" && method === "POST") return reply(createBox(hit.f.id, body()), 201);
      if (tail === "/measurements" && method === "GET")
        return reply({ items: world.measurements.get(hit.f.id) ?? [] });
      if (tail === "/measurements" && method === "POST") return reply(measure(hit.f.id, body()), 201);
      if (tail === "/detect" && method === "POST") {
        const fresh = (opts.detect?.(hit.f) ?? []).map((s) => ({ ...s, image_id: hit.f.id }));
        const kept = world.boxes
          .get(hit.f.id)!
          .filter((b) => !(b.review_state === "unreviewed" && (b.provenance as Json).model_id === MODEL));
        world.boxes.set(hit.f.id, [...kept, ...fresh]);
        return reply({
          model_id: MODEL,
          suggestions: fresh,
          new: fresh.length,
          already_covered: 0,
          device: "cuda",
          elapsed_ms: 120,
        });
      }
      if (tail === "/segment/prepare" && method === "POST")
        return reply({ crop: body().crop, device: "cuda", encode_ms: 12, cached: false });
      if (tail === "/segment" && method === "POST") {
        const b = body();
        const first = (b.points as Json[]).find((p) => p.positive) as Json | undefined;
        const polygon = first ? disc(first.x as number, first.y as number) : null;
        return reply({ polygon, score: 0.93, device: "cuda", encode_ms: 0, decode_ms: 9, crop: b.crop });
      }
      return route.fallback();
    }

    // --- annotations by id, review, measurements by id
    const boxPath = /^\/boxes\/([^/]+)$/.exec(sub);
    if (boxPath && boxPath[1] !== "review") {
      for (const list of world.boxes.values()) {
        const i = list.findIndex((b) => b.id === boxPath[1]);
        if (i < 0) continue;
        if (method === "DELETE") {
          const f = findingOf(list[i].id as string);
          if (f) world.findings.splice(world.findings.indexOf(f), 1);
          list.splice(i, 1);
          return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
        }
        if (method === "PATCH") {
          list[i] = { ...list[i], ...body(), updated_at: T };
          return reply({
            ...list[i],
            repaired: false,
            finding_id: findingOf(list[i].id as string)?.id ?? null,
          });
        }
      }
      return reply({ error: { code: "not_found", message: "no such annotation" } }, 404);
    }
    if (sub === "/boxes/review" && method === "POST") {
      const b = body();
      const created: string[] = [];
      let updated = 0;
      for (const list of world.boxes.values())
        for (const box of list) {
          if (!(b.box_ids as string[]).includes(box.id as string) || box.review_state === "accepted")
            continue;
          updated++;
          box.review_state =
            b.action === "accept" ? "accepted" : b.action === "reject" ? "rejected" : "unreviewed";
          box.reviewed_at = b.action === "unreview" ? null : T;
          if (b.action === "accept" && typeOf(box.class_id)?.kind === "defect")
            created.push(newFinding(box, `model:${MODEL}`).id as string);
        }
      return reply({ updated, finding_ids_created: created, finding_ids_deleted: [] });
    }
    const meas = /^\/image-measurements\/([^/]+)$/.exec(sub);
    if (meas && method === "DELETE") {
      for (const [k, list] of world.measurements)
        world.measurements.set(
          k,
          list.filter((m) => m.id !== meas[1]),
        );
      return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
    }

    // --- findings (the inspector and the Findings tab)
    if (sub === "/findings/summary") return reply(summary());
    if (sub === "/findings" && method === "GET") {
      const imageId = q.get("image_id");
      const status = q.getAll("status");
      const items = world.findings
        .filter((f) => !imageId || (f.anchor as Json).image_id === imageId)
        .filter((f) => status.length === 0 || status.includes(f.status as string))
        .sort((a, b) => (b.number as number) - (a.number as number));
      return reply({ items, next_cursor: null });
    }
    const fnd = /^\/findings\/([^/]+)(\/.*)?$/.exec(sub);
    if (fnd) {
      const f = world.findings.find((x) => x.id === fnd[1]);
      if (!f) return reply({ error: { code: "not_found", message: "no such finding" } }, 404);
      if (fnd[2] && method === "GET" && !fnd[2].endsWith("/thumbnail"))
        return reply({ items: [], next_cursor: null });
      if (!fnd[2] && method === "PATCH") Object.assign(f, body(), { updated_at: T });
      if (!fnd[2]) return reply({ ...f, attachment_count: 0, comment_count: 0 });
      return route.fallback();
    }
    if (sub === "/activity") return reply({ items: [], next_cursor: null });
    return route.fallback();
  };

  await page.route((u) => u.pathname.startsWith("/api/v1/"), handle);
  return world;
}
