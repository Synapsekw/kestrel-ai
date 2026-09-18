import { describe, it, expect, beforeEach } from "vitest";
import {
  exampleImage,
  fakeClient,
  personBox,
  proposalBox,
  PROJECT_ID,
  CLASS_ID,
  errorBody,
  type FakeRoute,
} from "@/test/fixtures";
import { useEditorStore } from "@/store/editor";
import {
  cmdCreateBox,
  cmdDelete,
  cmdDuplicate,
  cmdRedo,
  cmdReview,
  cmdSetClass,
  cmdUndo,
  cmdUpdateRect,
  type CommandContext,
} from "./commands";
import { History } from "./history";

let counter = 0;
const routes: FakeRoute[] = [
  {
    method: "POST",
    path: /\/images\/[^/]+\/boxes$/,
    status: 201,
    body: (req) => ({ ...personBox, ...(req.body as object), id: `new-${++counter}` }),
  },
  {
    method: "PATCH",
    path: /\/boxes\/[^/]+$/,
    body: (req) => ({ ...proposalBox, ...(req.body as object), review_state: "edited" }),
  },
  { method: "DELETE", path: /\/boxes\/[^/]+$/, status: 204 },
  { method: "POST", path: /\/boxes\/review$/, body: { updated: 1 } },
];

const REVIEW_URL = `/api/v1/projects/${PROJECT_ID}/boxes/review`;

function ctx(): CommandContext & { requests: ReturnType<typeof fakeClient>["requests"] } {
  const { api, requests } = fakeClient(routes);
  return { api, projectId: PROJECT_ID, store: useEditorStore, history: new History(), requests };
}

describe("editor commands", () => {
  beforeEach(() => {
    counter = 0;
    useEditorStore.getState().reset();
    useEditorStore.getState().loadImage(exampleImage, [personBox, proposalBox]);
  });

  it("creates a box, undoes with DELETE and redoes with a fresh POST", async () => {
    const c = ctx();
    const created = await cmdCreateBox(c, exampleImage.id, {
      class_id: CLASS_ID(2),
      x: 10,
      y: 20,
      w: 30,
      h: 40,
    });
    expect(created?.id).toBe("new-1");
    expect(useEditorStore.getState().selectedId).toBe("new-1");
    expect(useEditorStore.getState().order).toContain("new-1");
    await cmdUndo(c);
    expect(c.requests.at(-1)).toMatchObject({
      method: "DELETE",
      url: `/api/v1/projects/${PROJECT_ID}/boxes/new-1`,
    });
    expect(useEditorStore.getState().order).not.toContain("new-1");
    await cmdRedo(c);
    expect(c.requests.at(-1)).toMatchObject({
      method: "POST",
      body: { class_id: CLASS_ID(2), x: 10, y: 20, w: 30, h: 40 },
    });
    expect(useEditorStore.getState().order).toContain("new-2");
    await cmdUndo(c);
    expect(c.requests.at(-1)).toMatchObject({
      method: "DELETE",
      url: `/api/v1/projects/${PROJECT_ID}/boxes/new-2`,
    });
    expect(useEditorStore.getState().pending).toBe(0);
  });

  it("patches a proposal's rect (it becomes edited) and undoes by patching back and unreviewing", async () => {
    const c = ctx();
    const before = { x: 1210.5, y: 802, w: 96, h: 61 };
    const after = { x: 1300, y: 810, w: 96, h: 61 };
    await cmdUpdateRect(c, proposalBox.id, before, after);
    expect(c.requests[0]).toMatchObject({ method: "PATCH", body: after });
    expect(useEditorStore.getState().boxes[proposalBox.id]).toMatchObject({
      x: 1300,
      review_state: "edited",
    });
    await cmdUndo(c);
    expect(c.requests[1]).toMatchObject({ method: "PATCH", body: before });
    expect(c.requests[2]).toMatchObject({
      method: "POST",
      url: REVIEW_URL,
      body: { box_ids: [proposalBox.id], action: "unreview" },
    });
    expect(useEditorStore.getState().boxes[proposalBox.id]).toMatchObject({
      x: 1210.5,
      review_state: "unreviewed",
      reviewed_at: null,
    });
    await cmdRedo(c);
    expect(c.requests[3]).toMatchObject({ method: "PATCH", body: after });
    expect(useEditorStore.getState().boxes[proposalBox.id].review_state).toBe("edited");
    await cmdUpdateRect(c, proposalBox.id, before, before);
    expect(c.requests).toHaveLength(4);
  });

  it("patches a person box's rect and undoes with a single PATCH", async () => {
    const c = ctx();
    const before = { x: 512, y: 300, w: 140, h: 90 };
    const after = { x: 520, y: 305, w: 140, h: 90 };
    await cmdUpdateRect(c, personBox.id, before, after);
    await cmdUndo(c);
    expect(c.requests.map((r) => r.method)).toEqual(["PATCH", "PATCH"]);
    expect(c.requests[1].body).toEqual(before);
  });

  it("reclassifies with PATCH class_id and undoes", async () => {
    const c = ctx();
    await cmdSetClass(c, personBox.id, CLASS_ID(3));
    expect(c.requests[0]).toMatchObject({ method: "PATCH", body: { class_id: CLASS_ID(3) } });
    await cmdUndo(c);
    expect(c.requests[1]).toMatchObject({ method: "PATCH", body: { class_id: CLASS_ID(1) } });
    expect(c.requests).toHaveLength(2);
  });

  it("reclassifying a proposal undoes by patching back and unreviewing", async () => {
    const c = ctx();
    await cmdSetClass(c, proposalBox.id, CLASS_ID(3));
    await cmdUndo(c);
    expect(c.requests[1]).toMatchObject({ method: "PATCH", body: { class_id: CLASS_ID(4) } });
    expect(c.requests[2]).toMatchObject({ body: { box_ids: [proposalBox.id], action: "unreview" } });
    expect(useEditorStore.getState().boxes[proposalBox.id].review_state).toBe("unreviewed");
  });

  it("deletes a person box and undoes by re-creating it with the same geometry", async () => {
    const c = ctx();
    useEditorStore.getState().select(personBox.id);
    await cmdDelete(c, personBox.id);
    expect(c.requests[0]).toMatchObject({
      method: "DELETE",
      url: `/api/v1/projects/${PROJECT_ID}/boxes/${personBox.id}`,
    });
    expect(useEditorStore.getState().selectedId).toBeNull();
    await cmdUndo(c);
    expect(c.requests[1]).toMatchObject({
      method: "POST",
      body: { class_id: CLASS_ID(1), x: 512, y: 300, w: 140, h: 90 },
    });
    expect(useEditorStore.getState().order).toContain("new-1");
    await cmdRedo(c);
    expect(c.requests[2]).toMatchObject({
      method: "DELETE",
      url: `/api/v1/projects/${PROJECT_ID}/boxes/new-1`,
    });
  });

  it("deleting a proposal rejects it instead and undoes with unreview", async () => {
    const c = ctx();
    useEditorStore.getState().select(proposalBox.id);
    await cmdDelete(c, proposalBox.id);
    expect(c.requests[0]).toMatchObject({
      method: "POST",
      url: REVIEW_URL,
      body: { box_ids: [proposalBox.id], action: "reject" },
    });
    expect(useEditorStore.getState().boxes[proposalBox.id].review_state).toBe("rejected");
    expect(useEditorStore.getState().selectedId).toBeNull();
    await cmdUndo(c);
    expect(c.requests[1]).toMatchObject({ body: { box_ids: [proposalBox.id], action: "unreview" } });
    expect(useEditorStore.getState().boxes[proposalBox.id].review_state).toBe("unreviewed");
    await cmdRedo(c);
    expect(c.requests[2]).toMatchObject({ body: { box_ids: [proposalBox.id], action: "reject" } });
    expect(c.requests.every((r) => r.method !== "DELETE")).toBe(true);
  });

  it("deleting an accepted proposal rejects it and undo re-accepts it", async () => {
    const c = ctx();
    useEditorStore.getState().patchStates([proposalBox.id], "accepted");
    await cmdDelete(c, proposalBox.id);
    expect(c.requests[0]).toMatchObject({ body: { box_ids: [proposalBox.id], action: "reject" } });
    await cmdUndo(c);
    expect(c.requests[1]).toMatchObject({ body: { box_ids: [proposalBox.id], action: "accept" } });
    expect(useEditorStore.getState().boxes[proposalBox.id].review_state).toBe("accepted");
  });

  it("duplicates with an offset", async () => {
    const c = ctx();
    const dup = await cmdDuplicate(c, personBox.id);
    expect(dup?.id).toBe("new-1");
    expect(c.requests[0]).toMatchObject({
      method: "POST",
      body: { class_id: CLASS_ID(1), x: 524, y: 312, w: 140, h: 90 },
    });
    expect(useEditorStore.getState().selectedId).toBe("new-1");
  });

  it("reviews proposals and undoes with unreview", async () => {
    const c = ctx();
    await cmdReview(c, [proposalBox.id], "accept");
    expect(c.requests[0]).toMatchObject({
      method: "POST",
      url: REVIEW_URL,
      body: { box_ids: [proposalBox.id], action: "accept" },
    });
    expect(useEditorStore.getState().boxes[proposalBox.id].review_state).toBe("accepted");
    await cmdUndo(c);
    expect(c.requests[1]).toMatchObject({ body: { box_ids: [proposalBox.id], action: "unreview" } });
    expect(useEditorStore.getState().boxes[proposalBox.id]).toMatchObject({
      review_state: "unreviewed",
      reviewed_at: null,
    });
    await cmdRedo(c);
    expect(c.requests[2]).toMatchObject({ body: { box_ids: [proposalBox.id], action: "accept" } });
    await cmdReview(c, [], "accept");
    expect(c.requests).toHaveLength(3);
  });

  it("records the error envelope and pushes nothing on failure", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/boxes$/, status: 500, body: errorBody("internal_error", "disk full") },
    ]);
    const c: CommandContext = { api, projectId: PROJECT_ID, store: useEditorStore, history: new History() };
    const created = await cmdCreateBox(c, exampleImage.id, { class_id: CLASS_ID(1), x: 1, y: 1, w: 5, h: 5 });
    expect(created).toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(useEditorStore.getState().error).toBe("draw box failed: disk full");
    expect(useEditorStore.getState().pending).toBe(0);
    expect(c.history.canUndo()).toBe(false);
  });
});
