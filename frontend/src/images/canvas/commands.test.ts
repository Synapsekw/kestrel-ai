import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Box } from "@contract/client";
import { errorBody, fakeClient, IMAGE_ID, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { makeDetail, makeMeasurement, makeShape, makeWritten } from "./testing";
import {
  cmdCreateMeasurement,
  cmdCreateShape,
  cmdDeleteMeasurement,
  cmdDeleteShapes,
  cmdRedo,
  cmdReview,
  cmdSetType,
  cmdUndo,
  cmdUpdateShape,
  type CommandContext,
} from "./commands";

let counter = 0;
let measurementCounter = 0;
const st = () => useImagesWorkspace.getState();

function ctxWith(extra: FakeRoute[] = []) {
  const routes: FakeRoute[] = [
    ...extra,
    {
      method: "POST",
      path: /\/images\/[^/]+\/boxes$/,
      status: 201,
      body: (req) =>
        makeWritten({ ...(req.body as Partial<Box>), id: `new-${++counter}`, finding_id: "f-new" }),
    },
    {
      method: "PATCH",
      path: /\/boxes\/[^/]+$/,
      body: (req) => ({ ...st().boxes[req.url.split("/boxes/")[1].split("?")[0]], ...(req.body as object) }),
    },
    { method: "DELETE", path: /\/boxes\/[^/]+$/, status: 204, body: null },
    {
      method: "POST",
      path: /\/boxes\/review$/,
      body: { updated: 1, finding_ids_created: ["f9"], finding_ids_deleted: [] },
    },
    {
      method: "POST",
      path: /\/measurements$/,
      status: 201,
      // The first measurement created in a test is "m-new" (asserted by id below); a later
      // re-create (e.g. undo of a delete) must get a distinct id, or it collides in the store.
      body: () =>
        makeMeasurement({ id: measurementCounter++ === 0 ? "m-new" : `m-restored-${measurementCounter}` }),
    },
    { method: "DELETE", path: /\/image-measurements\/[^/]+$/, status: 204, body: null },
  ];
  const { api, requests } = fakeClient(routes);
  const ctx: CommandContext = {
    api,
    projectId: PROJECT_ID,
    store: useImagesWorkspace,
    history: st().history,
  };
  return { ctx, requests };
}

const polygon = makeShape({
  id: "p1",
  shape: "polygon",
  points: [
    [10, 10],
    [60, 10],
    [60, 50],
  ],
  x: 10,
  y: 10,
  w: 50,
  h: 40,
});
const proposal = makeShape({
  id: "s1",
  review_state: "unreviewed",
  confidence: 0.8,
  provenance: { kind: "local_model", model_id: "m", provider: null, model_name: "M", query_run_id: null },
});

beforeEach(() => {
  st().reset();
  st().loadImage(makeDetail(), [polygon, proposal], [makeMeasurement({ id: "m1" })]);
});

describe("cmdCreateShape", () => {
  it("creates, selects, and undoes by deleting", async () => {
    const { ctx, requests } = ctxWith();
    const box = await cmdCreateShape(ctx, IMAGE_ID, {
      class_id: "c",
      shape: "polygon",
      points: [
        [0, 0],
        [9, 0],
        [0, 9],
      ],
    });
    expect(box?.shape).toBe("polygon");
    expect(st().selectedIds).toEqual([box!.id]);
    expect(st().findingOf[box!.id]).toBe("f-new"); // FC-R16
    await cmdUndo(ctx);
    expect(st().boxes[box!.id]).toBeUndefined();
    expect(requests.at(-1)?.method).toBe("DELETE");
    await cmdRedo(ctx);
    expect(Object.values(st().boxes).some((b) => b.shape === "polygon" && b.id !== "p1")).toBe(true);
  });

  it("toasts a repaired polygon", async () => {
    const { ctx } = ctxWith([
      {
        method: "POST",
        path: /\/images\/[^/]+\/boxes$/,
        status: 201,
        body: makeWritten({
          id: "rp",
          shape: "polygon",
          points: [
            [0, 0],
            [9, 0],
            [0, 9],
          ],
          repaired: true,
        }),
      },
    ]);
    const { useToastStore } = await import("@/ui/toastStore");
    await cmdCreateShape(ctx, IMAGE_ID, {
      class_id: "c",
      shape: "polygon",
      points: [
        [0, 0],
        [9, 0],
        [9, 9],
        [0, 9],
      ],
    });
    expect(useToastStore.getState().toasts.at(-1)?.text).toMatch(/repaired/i);
  });

  it("records a failure with a retry that lands the shape", async () => {
    let fail = true;
    const { ctx } = ctxWith([
      {
        method: "POST",
        path: /\/images\/[^/]+\/boxes$/,
        status: () => (fail ? 500 : 201),
        body: () => {
          if (fail) {
            fail = false;
            return errorBody("internal", "boom");
          }
          return makeWritten({ id: "late" });
        },
      },
    ]);
    expect(
      await cmdCreateShape(ctx, IMAGE_ID, { class_id: "c", shape: "box", x: 1, y: 1, w: 9, h: 9 }),
    ).toBeUndefined();
    expect(st().failure?.message).toMatch(/draw shape failed/);
    st().failure!.retry!();
    await waitFor(() => expect(st().boxes.late).toBeDefined());
    expect(st().failure).toBeNull();
  });
});

describe("cmdUpdateShape", () => {
  it("patches polygon points and undoes to the old points", async () => {
    const { ctx, requests } = ctxWith();
    await cmdUpdateShape(ctx, "p1", {
      kind: "points",
      points: [
        { x: 20, y: 20 },
        { x: 70, y: 20 },
        { x: 70, y: 60 },
      ],
    });
    expect(requests.at(-1)?.body).toEqual({
      points: [
        [20, 20],
        [70, 20],
        [70, 60],
      ],
    });
    await cmdUndo(ctx);
    expect(requests.at(-1)?.body).toEqual({
      points: [
        [10, 10],
        [60, 10],
        [60, 50],
      ],
    });
  });

  it("does nothing when the geometry did not change", async () => {
    const { ctx, requests } = ctxWith();
    await cmdUpdateShape(ctx, "p1", {
      kind: "points",
      points: [
        { x: 10, y: 10 },
        { x: 60, y: 10 },
        { x: 60, y: 50 },
      ],
    });
    expect(requests).toHaveLength(0);
  });
});

describe("cmdSetType", () => {
  it("asks for confirmation on finding_would_be_deleted and retries with confirm", async () => {
    const { ctx, requests } = ctxWith([
      {
        method: "PATCH",
        path: /\/boxes\/p1$/,
        status: (req) => (req.url.includes("confirm_finding_delete=true") ? 200 : 409),
        body: (req) =>
          req.url.includes("confirm_finding_delete=true")
            ? { ...polygon, class_id: "object" }
            : errorBody("finding_would_be_deleted", "would delete F-0001"),
      },
    ]);
    expect(await cmdSetType(ctx, ["p1"], "object")).toBe("needs-confirm");
    expect(st().boxes.p1.class_id).toBe(polygon.class_id);
    expect(await cmdSetType(ctx, ["p1"], "object", { confirmFindingDelete: true })).toBe("done");
    expect(requests.at(-1)?.url).toContain("confirm_finding_delete=true");
  });
});

describe("cmdReview", () => {
  it("accepts, returns the created finding ids, and undoes with unreview", async () => {
    const { ctx, requests } = ctxWith();
    const r = await cmdReview(ctx, ["s1"], "accept");
    expect(r?.finding_ids_created).toEqual(["f9"]);
    expect(st().boxes.s1.review_state).toBe("accepted");
    await cmdUndo(ctx);
    expect((requests.at(-1)?.body as { action: string }).action).toBe("unreview");
    expect(st().boxes.s1.review_state).toBe("unreviewed");
  });

  it("undo of an accept refused with finding_has_content keeps the entry", async () => {
    const { ctx } = ctxWith();
    await cmdReview(ctx, ["s1"], "accept");
    const refusing = ctxWith([
      {
        method: "POST",
        path: /\/boxes\/review$/,
        status: 409,
        body: errorBody("finding_has_content", "has a note"),
      },
    ]).ctx;
    await cmdUndo(refusing);
    expect(st().boxes.s1.review_state).toBe("accepted");
    expect(st().history.canUndo()).toBe(true);
    expect(st().failure?.message).toBe("This finding has a note or photos; delete it from the inspector.");
  });

  it("redo of an accept re-links the finding it re-creates (F10)", async () => {
    const { ctx } = ctxWith();
    await cmdReview(ctx, ["s1"], "accept");
    await cmdUndo(ctx);
    expect(st().findingOf.s1).toBeUndefined();
    await cmdRedo(ctx);
    expect(st().findingOf.s1).toBe("f9");
  });
});

describe("cmdDeleteShapes", () => {
  it("deletes person shapes, rejects proposals, and undo re-creates the polygon with its points", async () => {
    const { ctx, requests } = ctxWith();
    await cmdDeleteShapes(ctx, ["p1", "s1"]);
    expect(st().boxes.p1).toBeUndefined();
    expect(st().boxes.s1.review_state).toBe("rejected");
    await cmdUndo(ctx);
    const create = requests.find((r) => r.method === "POST" && /\/boxes$/.test(r.url));
    expect(create?.body).toMatchObject({
      shape: "polygon",
      points: [
        [10, 10],
        [60, 10],
        [60, 50],
      ],
    });
    expect(st().boxes.s1.review_state).toBe("unreviewed");
  });

  it("drops the finding link of a deleted shape (F11)", async () => {
    const { ctx } = ctxWith();
    st().linkFindings({ p1: "f-p1" });
    await cmdDeleteShapes(ctx, ["p1"]);
    expect(st().findingOf.p1).toBeUndefined();
  });
});

describe("measurements", () => {
  it("creates and deletes with undo", async () => {
    const { ctx } = ctxWith();
    await cmdCreateMeasurement(ctx, IMAGE_ID, { x: 0, y: 0 }, { x: 30, y: 40 });
    expect(st().measurements["m-new"]).toBeDefined();
    await cmdDeleteMeasurement(ctx, "m1");
    expect(st().measurements.m1).toBeUndefined();
    await cmdUndo(ctx);
    expect(Object.keys(st().measurements)).toHaveLength(2);
  });
});
