import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeClient, IMAGE_ID, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { gatedClient, makeDetail, makeShape } from "./testing";
import {
  confirmDelete,
  confirmRetype,
  deleteSelection,
  findingHasContent,
  nudgeSelection,
  retypeSelection,
  rotateSelection,
} from "./actions";
import type { CommandContext } from "./commands";

const st = () => useImagesWorkspace.getState();
const finding = (over: object) => ({
  id: "f1",
  number: 217,
  note: "",
  attachment_count: 0,
  comment_count: 0,
  ...over,
});

function ctxWith(routes: FakeRoute[]) {
  const { api, requests } = fakeClient([
    ...routes,
    { method: "DELETE", path: /\/boxes\/[^/]+$/, status: 204, body: null },
    {
      method: "PATCH",
      path: /\/boxes\/[^/]+$/,
      body: (req) => ({ ...st().boxes.b1, ...(req.body as object) }),
    },
  ]);
  const ctx: CommandContext = {
    api,
    projectId: PROJECT_ID,
    store: useImagesWorkspace,
    history: st().history,
  };
  return { ctx, requests };
}

beforeEach(() => {
  st().reset();
  st().loadImage(
    makeDetail(),
    [makeShape({ id: "b1", image_id: IMAGE_ID, x: 100, y: 100, w: 50, h: 40, angle: 0 })],
    [],
  );
  st().linkFindings({ b1: "f1" });
  st().select(["b1"]);
});

describe("findingHasContent", () => {
  it("is true for a note, a photo or a comment", () => {
    expect(findingHasContent(finding({}) as never)).toBe(false);
    expect(findingHasContent(finding({ note: "  x " }) as never)).toBe(true);
    expect(findingHasContent(finding({ attachment_count: 1 }) as never)).toBe(true);
    expect(findingHasContent(finding({ comment_count: 2 }) as never)).toBe(true);
  });
});

describe("delete", () => {
  it("deletes at once when the finding is untouched", async () => {
    const { ctx } = ctxWith([{ method: "GET", path: /\/findings\/f1$/, body: finding({}) }]);
    await deleteSelection(ctx);
    expect(st().confirm).toBeNull();
    expect(st().boxes.b1).toBeUndefined();
  });

  it("asks first when the finding has content, then deletes on confirm", async () => {
    const { ctx } = ctxWith([{ method: "GET", path: /\/findings\/f1$/, body: finding({ note: "crack" }) }]);
    await deleteSelection(ctx);
    expect(st().confirm).toMatchObject({ kind: "delete", ids: ["b1"] });
    expect(st().boxes.b1).toBeDefined();
    await confirmDelete(ctx);
    expect(st().boxes.b1).toBeUndefined();
    expect(st().confirm).toBeNull();
  });
});

describe("retype", () => {
  it("opens the retype confirmation on finding_would_be_deleted", async () => {
    const { ctx } = ctxWith([
      {
        method: "PATCH",
        path: /\/boxes\/b1$/,
        status: (req) => (req.url.includes("confirm_finding_delete=true") ? 200 : 409),
        body: (req) =>
          req.url.includes("confirm_finding_delete=true")
            ? { ...st().boxes.b1, class_id: "obj" }
            : { error: { code: "finding_would_be_deleted", message: "x", details: {} } },
      },
    ]);
    await retypeSelection(ctx, "obj");
    expect(st().confirm).toEqual({ kind: "retype", ids: ["b1"], typeId: "obj", findings: [] });
    await confirmRetype(ctx);
    expect(st().boxes.b1.class_id).toBe("obj");
  });
});

describe("retype confirmation names the findings (m5)", () => {
  it("reads the linked finding so the dialog can name it", async () => {
    const { ctx } = ctxWith([
      { method: "GET", path: /\/findings\/f1$/, body: finding({ number: 12 }) },
      {
        method: "PATCH",
        path: /\/boxes\/b1$/,
        status: 409,
        body: { error: { code: "finding_would_be_deleted", message: "x", details: {} } },
      },
    ]);
    await retypeSelection(ctx, "obj");
    expect(st().confirm).toMatchObject({ kind: "retype", findings: [{ number: 12 }] });
  });
});

describe("nudge and rotate", () => {
  it("two quick nudges add up, the second PATCH sent after the first resolves (I1)", async () => {
    const { api, requests, gate } = gatedClient([
      {
        method: "PATCH",
        path: /\/boxes\/b1$/,
        body: (req) => ({ ...st().boxes.b1, ...(req.body as object) }),
      },
    ]);
    const ctx: CommandContext = {
      api,
      projectId: PROJECT_ID,
      store: useImagesWorkspace,
      history: st().history,
    };
    const first = nudgeSelection(ctx, 1, 0);
    const second = nudgeSelection(ctx, 1, 0);
    await waitFor(() => expect(gate.arrived).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(gate.arrived).toBe(1);
    gate.release();
    await waitFor(() => expect(gate.arrived).toBe(2));
    gate.release();
    await Promise.all([first, second]);
    expect(requests.map((r) => (r.body as { x: number }).x)).toEqual([101, 102]);
    expect(st().boxes.b1.x).toBe(102);
  });

  it("nudges the single selection and rotates a box into an rbox angle", async () => {
    const { ctx, requests } = ctxWith([]);
    await nudgeSelection(ctx, 10, 0);
    expect(requests.at(-1)?.body).toMatchObject({ x: 110, y: 100 });
    await rotateSelection(ctx, 1);
    expect(requests.at(-1)?.body).toMatchObject({ angle: 1 });
  });

  it("does nothing with two shapes selected", async () => {
    st().upsertBox(makeShape({ id: "b2", image_id: IMAGE_ID }));
    st().select(["b1", "b2"]);
    const { ctx, requests } = ctxWith([]);
    await nudgeSelection(ctx, 1, 0);
    expect(requests).toHaveLength(0);
  });
});
