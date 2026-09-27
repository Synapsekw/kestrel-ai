import { beforeEach, describe, expect, it } from "vitest";
import { errorBody, fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { useToastStore } from "@/ui";
import { useChangesStore } from "@/store/changes";
import { useAiStore } from "./aiStore";
import { useImagesWorkspace, wsGet, type CommandContext } from "./bridge";
import { cmdReviewSuggestions, setFindingSeverity } from "./review";
import { accepted, resetAll, seedWorkspace, suggestion } from "./testing";

const finding = { id: "f1", number: 231 };
function ctxFor(routes: FakeRoute[]) {
  const { api, requests } = fakeClient(routes);
  const ctx: CommandContext = {
    api,
    projectId: PROJECT_ID,
    store: useImagesWorkspace,
    history: wsGet().history,
  };
  return { ctx, requests };
}
const texts = () => useToastStore.getState().toasts.map((t) => t.text);
const review = (body: object): FakeRoute => ({ method: "POST", path: /\/boxes\/review$/, body });

beforeEach(() => {
  resetAll();
  seedWorkspace([suggestion("s1", 0.9), suggestion("s2", 0.6)]);
});

describe("cmdReviewSuggestions", () => {
  it("accepts one: state, FC finding link, selection, toast with the number, findings bumped", async () => {
    const { ctx } = ctxFor([
      review({ updated: 1, finding_ids_created: ["f1"], finding_ids_deleted: [] }),
      { method: "GET", path: /\/findings\/f1$/, body: finding },
    ]);
    wsGet().focusSuggestion("s1");
    await cmdReviewSuggestions(ctx, ["s1"], "accept");
    expect(wsGet().boxes.s1.review_state).toBe("accepted");
    expect(wsGet().findingOf).toEqual({ s1: "f1" });
    expect(wsGet().selectedIds).toEqual(["s1"]);
    expect(wsGet().focusedSuggestionId).toBeNull();
    expect(useAiStore.getState().leaving.s1.kind).toBe("accept");
    expect(useChangesStore.getState().findingsRevision).toBeGreaterThan(0);
    await expect.poll(texts).toContain("✓ Accepted as finding F-0231");
    expect(useAiStore.getState().inFlight.size).toBe(0);
  });

  it("accepts an object: no link, no findings bump", async () => {
    const { ctx } = ctxFor([review({ updated: 1, finding_ids_created: [], finding_ids_deleted: [] })]);
    await cmdReviewSuggestions(ctx, ["s1"], "accept");
    expect(wsGet().findingOf).toEqual({});
    expect(useChangesStore.getState().findingsRevision).toBe(0);
    expect(texts()).toContain("✓ Accepted as an object");
  });

  it("rejects one and focuses the next target", async () => {
    const { ctx } = ctxFor([review({ updated: 1, finding_ids_created: [], finding_ids_deleted: [] })]);
    await cmdReviewSuggestions(ctx, ["s1"], "reject");
    expect(wsGet().boxes.s1.review_state).toBe("rejected");
    expect(wsGet().focusedSuggestionId).toBe("s2");
    expect(texts()).toContain("✕ Rejected · kept as a training negative");
  });

  it("accepts several: one request, the findings list re-reads (FW links them)", async () => {
    const { ctx, requests } = ctxFor([
      review({ updated: 2, finding_ids_created: ["f1", "f2"], finding_ids_deleted: [] }),
    ]);
    await cmdReviewSuggestions(ctx, ["s1", "s2"], "accept");
    expect(requests.filter((r) => r.url.endsWith("/boxes/review"))).toHaveLength(1);
    expect(wsGet().findingOf).toEqual({});
    expect(useChangesStore.getState().findingsRevision).toBe(1);
    expect(texts()).toContain("✓ Accepted 2 suggestions · 2 findings");
  });

  it("an undone accept forgets its finding link (FC's one-line change in cmdReview's undo)", async () => {
    const { ctx } = ctxFor([
      {
        method: "POST",
        path: /\/boxes\/review$/,
        body: (r) =>
          (r.body as { action: string }).action === "accept"
            ? { updated: 1, finding_ids_created: ["f1"], finding_ids_deleted: [] }
            : { updated: 1, finding_ids_created: [], finding_ids_deleted: ["f1"] },
      },
      { method: "GET", path: /\/findings\/f1$/, body: finding },
    ]);
    await cmdReviewSuggestions(ctx, ["s1"], "accept");
    await wsGet().history.undo();
    expect(wsGet().boxes.s1.review_state).toBe("unreviewed");
    expect(wsGet().findingOf).toEqual({});
  });

  it("holds the outline while the request is out, then starts the accept fade on the answer", async () => {
    const { ctx } = ctxFor([review({ updated: 1, finding_ids_created: [], finding_ids_deleted: [] })]);
    const pending = cmdReviewSuggestions(ctx, ["s1"], "accept");
    expect(useAiStore.getState().inFlight.has("s1")).toBe(true);
    expect(useAiStore.getState().leaving.s1.kind).toBe("held");
    await pending;
    expect(useAiStore.getState().leaving.s1.kind).toBe("accept");
  });

  it("an answer after the operator moved to another image only toasts and bumps (I1)", async () => {
    const { ctx } = ctxFor([
      review({ updated: 1, finding_ids_created: ["f1"], finding_ids_deleted: [] }),
      { method: "GET", path: /\/findings\/f1$/, body: finding },
    ]);
    seedWorkspace([suggestion("s1", 0.9)]); // the last suggestion on this image
    const pending = cmdReviewSuggestions(ctx, ["s1"], "accept");
    const other = { ...wsGet().image!, id: "other-image" };
    seedWorkspace([suggestion("o1", 0.8), accepted("p1")], other);
    wsGet().select(["p1"]);
    await pending;
    const s = wsGet();
    expect(s.imageId).toBe("other-image");
    expect(s.findingOf).toEqual({});
    expect(s.selectedIds).toEqual(["p1"]);
    expect(s.focusedSuggestionId).toBeNull();
    expect(useAiStore.getState().leaving).toEqual({});
    expect(useAiStore.getState().inFlight.size).toBe(0);
    expect(useChangesStore.getState().findingsRevision).toBe(1);
    await expect.poll(texts).toContain("✓ Accepted as finding F-0231");
  });

  it("a reject answered on another image does not move the focus there (I1)", async () => {
    const { ctx } = ctxFor([review({ updated: 1, finding_ids_created: [], finding_ids_deleted: [] })]);
    const pending = cmdReviewSuggestions(ctx, ["s1"], "reject");
    seedWorkspace([suggestion("o1", 0.8)], { ...wsGet().image!, id: "other-image" });
    await pending;
    expect(wsGet().focusedSuggestionId).toBeNull();
    expect(texts()).toContain("✕ Rejected · kept as a training negative");
  });

  it("leaves the store as it was when the request fails (FC records the failure)", async () => {
    const { ctx } = ctxFor([
      { method: "POST", path: /\/boxes\/review$/, status: 500, body: errorBody("internal", "boom") },
    ]);
    const r = await cmdReviewSuggestions(ctx, ["s1"], "accept");
    expect(r).toBeUndefined();
    expect(wsGet().boxes.s1.review_state).toBe("unreviewed");
    expect(useAiStore.getState().inFlight.size).toBe(0);
    expect(useAiStore.getState().leaving).toEqual({});
  });
});

describe("setFindingSeverity", () => {
  it("patches the severity and bumps the findings revision", async () => {
    const { api, requests } = fakeClient([
      { method: "PATCH", path: /\/findings\/f1$/, body: { ...finding, severity: 3 } },
    ]);
    await setFindingSeverity(api, PROJECT_ID, "f1", 3);
    expect(requests[0].body).toEqual({ severity: 3 });
    expect(useChangesStore.getState().findingsRevision).toBe(1);
  });
});
