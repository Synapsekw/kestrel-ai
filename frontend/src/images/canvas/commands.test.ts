import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Box } from "@contract/client";
import { errorBody, exampleClasses, fakeClient, IMAGE_ID, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { gatedClient, makeDetail, makeMeasurement, makeShape, makeWritten } from "./testing";
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
  FINDING_HAS_CONTENT_MESSAGE,
  type CommandContext,
} from "./commands";

let counter = 0;
const finding = (over: object) => ({
  id: "f1",
  number: 1,
  note: "",
  attachment_count: 0,
  comment_count: 0,
  ...over,
});
const defect = { ...exampleClasses[0], id: "defect", kind: "defect" as const };
const object = { ...exampleClasses[0], id: "object", kind: "object" as const };
const st = () => useImagesWorkspace.getState();

function ctxWith(extra: FakeRoute[] = []) {
  // m3: local to this call, so each test (or each ctxWith() call within a test) starts at 0 —
  // a module-level counter would drift across tests that create more than one measurement.
  let measurementCounter = 0;
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
    // A finding with no content: the undo guard (I4) lets the undo through.
    { method: "GET", path: /\/findings\/[^/]+$/, body: finding({}) },
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

  it("pushes an undo entry for ids already retyped before a later one is refused (I2)", async () => {
    const { ctx } = ctxWith([
      {
        method: "PATCH",
        path: /\/boxes\/p1$/,
        status: 200,
        body: (req) => ({ ...polygon, ...(req.body as object) }),
      },
      {
        method: "PATCH",
        path: /\/boxes\/s1$/,
        status: 409,
        body: errorBody("finding_would_be_deleted", "would delete F-0002"),
      },
    ]);
    expect(await cmdSetType(ctx, ["p1", "s1"], "object")).toBe("needs-confirm");
    expect(st().boxes.p1.class_id).toBe("object");
    expect(st().boxes.s1.class_id).toBe(proposal.class_id);
    expect(st().history.canUndo()).toBe(true);
    await cmdUndo(ctx);
    expect(st().boxes.p1.class_id).toBe(polygon.class_id);
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
    // I1: one fake client whose review route toggles from success (the accept) to a 409 refusal
    // (the undo) — not two separate CommandContexts, which commands.ts never mixes in practice.
    let refuse = false;
    const { ctx } = ctxWith([
      {
        method: "POST",
        path: /\/boxes\/review$/,
        status: () => (refuse ? 409 : 200),
        body: () =>
          refuse
            ? errorBody("finding_has_content", "has a note")
            : { updated: 1, finding_ids_created: ["f9"], finding_ids_deleted: [] },
      },
    ]);
    await cmdReview(ctx, ["s1"], "accept");
    refuse = true;
    await cmdUndo(ctx);
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

  it("drops the finding link of a rejected proposal and re-links it on undo (m4)", async () => {
    const { ctx } = ctxWith();
    st().patchStates(["s1"], "accepted"); // an accepted proposal, not just unreviewed
    st().linkFindings({ s1: "f-s1" });
    await cmdDeleteShapes(ctx, ["s1"]);
    expect(st().boxes.s1.review_state).toBe("rejected");
    expect(st().findingOf.s1).toBeUndefined();
    await cmdUndo(ctx);
    expect(st().boxes.s1.review_state).toBe("accepted");
    expect(st().findingOf.s1).toBe("f9"); // the default review route's finding_ids_created
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

describe("serialisation (I1)", () => {
  const ctxOf = (api: CommandContext["api"]): CommandContext => ({
    api,
    projectId: PROJECT_ID,
    store: useImagesWorkspace,
    history: st().history,
  });
  const patchRoute: FakeRoute = {
    method: "PATCH",
    path: /\/boxes\/[^/]+$/,
    body: (req) => ({ ...st().boxes.p1, ...(req.body as object) }),
  };
  const shifted = (dx: number) => (b: Box) => ({
    kind: "points" as const,
    points: (b.points ?? []).map(([x, y]) => ({ x: x + dx, y })),
  });

  it("runs a second relative edit on the box the first one left, after the first PATCH resolves", async () => {
    const { api, requests, gate } = gatedClient([patchRoute]);
    const ctx = ctxOf(api);
    const first = cmdUpdateShape(ctx, "p1", shifted(1));
    const second = cmdUpdateShape(ctx, "p1", shifted(1));
    await waitFor(() => expect(gate.arrived).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(gate.arrived).toBe(1); // the second PATCH waits for the first
    gate.release();
    await waitFor(() => expect(gate.arrived).toBe(2));
    gate.release();
    await Promise.all([first, second]);
    expect(requests.map((r) => (r.body as { points: number[][] }).points[0][0])).toEqual([11, 12]);
    expect(st().boxes.p1.points?.[0]).toEqual([12, 10]);
  });

  it("an undo asked for while a save is in flight applies after it", async () => {
    const { api, requests, gate } = gatedClient([patchRoute]);
    const ctx = ctxOf(api);
    const save = cmdUpdateShape(ctx, "p1", shifted(5));
    const undo = cmdUndo(ctx);
    await waitFor(() => expect(gate.arrived).toBe(1));
    gate.release();
    await waitFor(() => expect(gate.arrived).toBe(2));
    gate.release();
    await Promise.all([save, undo]);
    expect(requests.map((r) => (r.body as { points: number[][] }).points[0][0])).toEqual([15, 10]);
    expect(st().boxes.p1.points?.[0]).toEqual([10, 10]);
    expect(st().history.canUndo()).toBe(false);
  });
});

describe("cmdSetType finding links (I3)", () => {
  it("links the finding an object -> defect change creates, and drops it on defect -> object", async () => {
    const { ctx } = ctxWith([
      {
        method: "PATCH",
        path: /\/boxes\/p1$/,
        body: (req) => {
          const classId = (req.body as { class_id: string }).class_id;
          return makeWritten({
            ...st().boxes.p1,
            class_id: classId,
            finding_id: classId === "defect" ? "f-made" : null,
          });
        },
      },
    ]);
    expect(await cmdSetType(ctx, ["p1"], "defect")).toBe("done");
    expect(st().findingOf.p1).toBe("f-made");
    expect(await cmdSetType(ctx, ["p1"], "object", { confirmFindingDelete: true })).toBe("done");
    expect(st().findingOf.p1).toBeUndefined();
  });
});

describe("undo refuses to delete a finding with content (I4)", () => {
  it("keeps a drawn shape whose finding got a note, and its history entry", async () => {
    const { ctx, requests } = ctxWith([
      { method: "GET", path: /\/findings\/f-new$/, body: finding({ id: "f-new", note: "crack" }) },
    ]);
    const box = await cmdCreateShape(ctx, IMAGE_ID, { class_id: "c", shape: "box", x: 1, y: 1, w: 9, h: 9 });
    await cmdUndo(ctx);
    expect(st().boxes[box!.id]).toBeDefined();
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
    expect(st().history.canUndo()).toBe(true);
    expect(st().failure?.message).toBe(FINDING_HAS_CONTENT_MESSAGE);
  });

  it("keeps an object -> defect retype whose finding got a photo", async () => {
    useImagesWorkspace.setState({ types: [defect, object] });
    st().upsertBox({ ...st().boxes.p1, class_id: "object" });
    const { ctx, requests } = ctxWith([
      {
        method: "PATCH",
        path: /\/boxes\/p1$/,
        body: (req) => makeWritten({ ...st().boxes.p1, ...(req.body as object), finding_id: "f-made" }),
      },
      { method: "GET", path: /\/findings\/f-made$/, body: finding({ id: "f-made", attachment_count: 1 }) },
    ]);
    await cmdSetType(ctx, ["p1"], "defect");
    const patches = requests.filter((r) => r.method === "PATCH").length;
    await cmdUndo(ctx);
    expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(patches);
    expect(st().boxes.p1.class_id).toBe("defect");
    expect(st().history.canUndo()).toBe(true);
    expect(st().failure?.message).toBe(FINDING_HAS_CONTENT_MESSAGE);
  });
});
