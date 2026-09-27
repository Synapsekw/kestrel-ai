import type { ApiClient, Box, BoxCreate, BoxUpdate, ClassDef } from "@contract/client";
import type { ImageMeasurement } from "@/api/shapes";
import { exampleClasses, fakeClient, type FakeRoute } from "@/test/fixtures";
import { polygonArea } from "@/images/tools/measure";
import { envelopeOf, normaliseAngle, toPoints } from "../geometry";
import { makeDetail, makeShape } from "../testing";

export const LAB_PROJECT_ID = "1ab00000-0000-4000-8000-000000000001";
export const LAB_IMAGE_ID = "1ab00000-0000-4000-8000-000000000002";

/** Two defects and one object, so the point tool, the retype dialog and object shapes can be tried. */
export const LAB_TYPES: ClassDef[] = [
  {
    ...exampleClasses[7],
    id: "lab-crack",
    name: "Crack",
    kind: "defect",
    hotkey: "1",
    default_severity: 2,
    group: "Concrete defects",
  },
  {
    ...exampleClasses[4],
    id: "lab-spall",
    name: "Spalling",
    kind: "defect",
    hotkey: "2",
    default_severity: 3,
    group: "Concrete defects",
  },
  {
    ...exampleClasses[3],
    id: "lab-truck",
    name: "Truck",
    kind: "object",
    hotkey: "3",
    default_severity: null,
    group: null,
  },
];

function withGeometry(box: Box): Box {
  if (box.shape === "polygon") {
    const pts = toPoints(box.points ?? []);
    const env = envelopeOf(pts);
    return { ...box, ...env, angle: 0, area_px: polygonArea(pts) };
  }
  if (box.shape === "point") return { ...box, w: 0, h: 0, angle: 0, area_px: 0 };
  const angle = normaliseAngle(box.angle);
  return { ...box, angle, shape: angle === 0 ? "box" : "rbox", area_px: box.w * box.h };
}

/** 60 % polygons of 40 vertices, the rest boxes, spread over a 4000 × 3000 frame. */
export function seedShapes(n: number, imageId: string): Box[] {
  const out: Box[] = [];
  const polygons = Math.round(n * 0.6);
  for (let i = 0; i < n; i++) {
    const cx = 150 + ((i * 397) % 3700);
    const cy = 150 + ((i * 211) % 2700);
    const type = LAB_TYPES[i % LAB_TYPES.length];
    const base = makeShape({
      id: `lab-${i}`,
      image_id: imageId,
      class_id: type.id,
      created_at: new Date(Date.UTC(2026, 8, 27, 10, 0, i)).toISOString(),
    });
    if (i < polygons) {
      const r = 40 + (i % 5) * 12;
      const points = Array.from({ length: 40 }, (_, k) => {
        const a = (2 * Math.PI * k) / 40;
        const wobble = 1 + 0.15 * Math.sin(a * 5 + i);
        return [
          Math.round((cx + r * wobble * Math.cos(a)) * 10) / 10,
          Math.round((cy + r * wobble * Math.sin(a)) * 10) / 10,
        ];
      });
      out.push(withGeometry({ ...base, shape: "polygon", points }));
    } else {
      out.push(
        withGeometry({
          ...base,
          shape: "box",
          x: cx - 50,
          y: cy - 30,
          w: 100,
          h: 60,
          angle: 0,
          points: null,
        }),
      );
    }
  }
  return out;
}

/** The seeded shapes' finding links (what FW would read from GET /findings?image_id=). */
export function seedFindingLinks(n: number): Record<string, string> {
  const links: Record<string, string> = {};
  for (let i = 0; i < n; i++)
    if (LAB_TYPES[i % LAB_TYPES.length].kind === "defect") links[`lab-${i}`] = `lab-f-${i}`;
  return links;
}

/** An in-memory backend for the lab page: the routes the canvas calls, nothing else. */
export function createLabApi(opts: { shapes: number; types: ClassDef[] }): { api: ApiClient } {
  const boxes = new Map(seedShapes(opts.shapes, LAB_IMAGE_ID).map((b) => [b.id, b]));
  const measurements = new Map<string, ImageMeasurement>();
  let seq = 0;
  const id = (prefix: string) => `${prefix}-${++seq}`;
  const kindOf = (typeId: string) => opts.types.find((t) => t.id === typeId)?.kind;
  const lastSegment = (url: string) => url.split("?")[0].split("/").pop() ?? "";
  const wouldDeleteFinding = (req: { url: string; body: unknown }) => {
    const box = boxes.get(lastSegment(req.url));
    const next = (req.body as BoxUpdate | null)?.class_id;
    return (
      !!box &&
      !!next &&
      kindOf(box.class_id) === "defect" &&
      kindOf(next) === "object" &&
      !req.url.includes("confirm_finding_delete=true")
    );
  };
  const routes: FakeRoute[] = [
    {
      method: "GET",
      path: new RegExp(`/images/${LAB_IMAGE_ID}$`),
      body: makeDetail({ id: LAB_IMAGE_ID, file_name: "LAB_0001.JPG" }),
    },
    { method: "GET", path: /\/images\/[^/]+\/boxes$/, body: () => ({ items: [...boxes.values()] }) },
    {
      method: "POST",
      path: /\/images\/[^/]+\/boxes$/,
      status: 201,
      body: (req) => {
        const body = req.body as BoxCreate;
        const made = withGeometry(
          makeShape({
            ...(body as Partial<Box>),
            id: id("lab-new"),
            image_id: LAB_IMAGE_ID,
            shape: body.shape ?? "box",
            points: body.points ?? null,
            assist: body.assist ?? null,
            created_at: new Date().toISOString(),
          }),
        );
        boxes.set(made.id, made);
        return {
          ...made,
          repaired: false,
          finding_id: kindOf(body.class_id) === "defect" ? id("lab-f") : null,
        };
      },
    },
    {
      method: "PATCH",
      path: /\/boxes\/[^/]+$/,
      // F's rule: a defect → object retype without the confirm flag answers 409 (FC-R5's dialog).
      status: (req) => (wouldDeleteFinding(req) ? 409 : 200),
      body: (req) => {
        if (wouldDeleteFinding(req)) {
          return {
            error: {
              code: "finding_would_be_deleted",
              message: "Retyping to an object deletes the finding.",
              details: {},
            },
          };
        }
        const box = boxes.get(lastSegment(req.url));
        if (!box) return { error: { code: "not_found", message: "No such shape", details: {} } };
        const next = withGeometry({ ...box, ...(req.body as BoxUpdate) } as Box);
        boxes.set(next.id, next);
        return { ...next, repaired: false, finding_id: null };
      },
    },
    {
      method: "DELETE",
      path: /\/boxes\/[^/]+$/,
      status: 204,
      body: (req) => {
        boxes.delete(lastSegment(req.url));
        return null;
      },
    },
    {
      method: "POST",
      path: /\/boxes\/review$/,
      body: (req) => {
        const { box_ids, action } = req.body as { box_ids: string[]; action: string };
        const state = action === "accept" ? "accepted" : action === "reject" ? "rejected" : "unreviewed";
        for (const bid of box_ids) {
          const b = boxes.get(bid);
          if (b) boxes.set(bid, { ...b, review_state: state as Box["review_state"] });
        }
        return { updated: box_ids.length, finding_ids_created: [], finding_ids_deleted: [] };
      },
    },
    { method: "GET", path: /\/measurements$/, body: () => ({ items: [...measurements.values()] }) },
    {
      method: "POST",
      path: /\/measurements$/,
      status: 201,
      body: (req) => {
        const b = req.body as { x1: number; y1: number; x2: number; y2: number };
        const m = {
          id: id("lab-m"),
          image_id: LAB_IMAGE_ID,
          ...b,
          label: "",
          length_px: Math.hypot(b.x2 - b.x1, b.y2 - b.y1),
          length_mm: null,
          sigma_mm: null,
          created_at: new Date().toISOString(),
        } as ImageMeasurement;
        measurements.set(m.id, m);
        return m;
      },
    },
    {
      method: "DELETE",
      path: /\/image-measurements\/[^/]+$/,
      status: 204,
      body: (req) => {
        measurements.delete(lastSegment(req.url));
        return null;
      },
    },
    {
      // The first seeded finding has a note, so Del on shape lab-0 shows the confirmation (FC-R4).
      method: "GET",
      path: /\/findings\/[^/]+$/,
      body: (req) => {
        const fid = lastSegment(req.url);
        return {
          id: fid,
          number: Number(fid.replace(/\D/g, "")) || 1,
          note: fid === "lab-f-0" ? "Seeded note" : "",
          attachment_count: 0,
          comment_count: 0,
        };
      },
    },
  ];
  return { api: fakeClient(routes).api };
}
