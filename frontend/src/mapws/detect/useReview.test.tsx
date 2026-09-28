import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MAP_RUN_ID, PROJECT_ID, fakeClient } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { collectDiagnostics } from "@/app/diagnostics";
import { useToastStore } from "@/ui";
import { useChangesStore } from "@/store/changes";
import { EMPTY_LEDGER } from "@/store/changesEcho";
import { useDetectStore } from "./detectStore";
import { useReview } from "./useReview";

const h = vi.hoisted(() => ({ select: vi.fn(), fit: vi.fn() }));
vi.mock("@/mapws/w4host", () => ({
  useWorkspace: (sel: (s: unknown) => unknown) => sel({ select: h.select, viewApi: { fit: h.fit } }),
}));

const corners = [
  [0, 0],
  [2, 0],
  [2, 2],
  [0, 2],
];
const pending = {
  id: "d1",
  class_id: "defect-t",
  confidence: 0.9,
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  angle: null,
  review_state: "unreviewed" as const,
  provenance_kind: "local_model" as const,
  corners_site: corners,
};
const next = { ...pending, id: "d2" };
const kindOf = (t: string) => (t === "defect-t" ? ("defect" as const) : ("object" as const));
const wrap = (api: ReturnType<typeof fakeClient>["api"]) =>
  function W({ children }: { children: ReactNode }) {
    return <TestApiProvider api={api}>{children}</TestApiProvider>;
  };
const emitFindings = (ids: string[]) =>
  useChangesStore.getState().applyEvent({
    type: "findings.changed",
    project_id: "p",
    payload: { ids },
  } as never);

describe("useReview", () => {
  beforeEach(() => {
    h.select.mockReset();
    h.fit.mockReset();
    useChangesStore.setState({ openProjectId: null, lastFindingIds: [], findingEchoes: EMPTY_LEDGER });
    useDetectStore.setState({ history: [], inView: {} });
    useToastStore.getState().clear();
  });
  afterEach(() => vi.useRealTimers());

  it("accepting a defect opens the finding named by the findings.changed event", async () => {
    const { api, requests } = fakeClient([{ method: "POST", path: /\/review$/, body: { updated: 1 } }]);
    const { result } = renderHook(() => useReview(PROJECT_ID), { wrapper: wrap(api) });
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = result.current.decide(MAP_RUN_ID, pending, "accept", undefined, kindOf);
    });
    await waitFor(() => expect(requests).toHaveLength(1));
    act(() => emitFindings(["f7"]));
    await act(() => done);
    expect(requests[0].body).toEqual({ detection_ids: ["d1"], action: "accept" });
    expect(h.select).toHaveBeenCalledWith({ kind: "finding", id: "f7" });
  });

  it("without the event, accepting a defect advances after the wait and says so", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api } = fakeClient([
      { method: "POST", path: /\/review$/, body: { updated: 1 } },
      { method: "GET", path: /\/next-unreviewed$/, body: { detection: next, remaining: 2 } },
    ]);
    const { result } = renderHook(() => useReview(PROJECT_ID), { wrapper: wrap(api) });
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = result.current.decide(MAP_RUN_ID, pending, "accept", undefined, kindOf);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
      await done;
    });
    expect(h.select).toHaveBeenCalledWith({ kind: "detection", id: `${MAP_RUN_ID}.d2` });
    expect(useToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({
        tone: "info",
        text: "The finding was created; open it from the Findings layer.",
      }),
    );
  });

  it("a failed move after a saved decision says the decision was saved", async () => {
    const { api } = fakeClient([
      { method: "POST", path: /\/review$/, body: { updated: 1 } },
      {
        method: "GET",
        path: /\/next-unreviewed$/,
        status: 500,
        body: { error: { code: "internal", message: "boom", details: {} } },
      },
    ]);
    const { result } = renderHook(() => useReview(PROJECT_ID), { wrapper: wrap(api) });
    await act(() =>
      result.current.decide(MAP_RUN_ID, { ...pending, class_id: "obj" }, "accept", undefined, kindOf),
    );
    const texts = useToastStore.getState().toasts.map((t) => t.text);
    expect(texts).toEqual([
      "The decision was saved, but moving to the next detection failed (boom). Press Tab to try again.",
    ]);
    expect(collectDiagnostics()).toContain("move to the next detection failed: boom");
  });

  it("next() reports a failed next-unreviewed with a toast and the log", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/next-unreviewed$/,
        status: 500,
        body: { error: { code: "internal", message: "next broke", details: {} } },
      },
    ]);
    const { result } = renderHook(() => useReview(PROJECT_ID), { wrapper: wrap(api) });
    await act(() => result.current.next(MAP_RUN_ID, "d1"));
    expect(useToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({ tone: "danger", text: "next broke" }),
    );
    expect(collectDiagnostics()).toContain("open the next detection failed: next broke");
  });

  it("next() does nothing while a decision is in flight", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/review$/, body: { updated: 1 } },
      { method: "GET", path: /\/next-unreviewed$/, body: { detection: null, remaining: 0 } },
    ]);
    const post = api.POST as unknown as (...a: unknown[]) => Promise<unknown>;
    const slow = {
      ...api,
      POST: (async (...a: unknown[]) => {
        await gate;
        return post(...a);
      }) as unknown as typeof api.POST,
    };
    const { result } = renderHook(() => useReview(PROJECT_ID), { wrapper: wrap(slow) });
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.decide(MAP_RUN_ID, { ...pending, class_id: "obj" }, "accept", undefined, kindOf);
    });
    await act(() => result.current.next(MAP_RUN_ID, "d1"));
    expect(requests.filter((r) => r.method === "GET")).toHaveLength(0);
    release();
    await act(() => first);
  });

  it("accepting an object advances to the next pending detection and pans to it", async () => {
    const { api } = fakeClient([
      { method: "POST", path: /\/review$/, body: { updated: 1 } },
      { method: "GET", path: /\/next-unreviewed$/, body: { detection: next, remaining: 3 } },
    ]);
    const { result } = renderHook(() => useReview(PROJECT_ID), { wrapper: wrap(api) });
    await act(() =>
      result.current.decide(MAP_RUN_ID, { ...pending, class_id: "obj" }, "accept", undefined, kindOf),
    );
    expect(h.select).toHaveBeenCalledWith({ kind: "detection", id: `${MAP_RUN_ID}.d2` });
    expect(h.fit).toHaveBeenCalledWith([0, 0, 2, 2]);
  });

  it("a 409 asks before deleting a finding; Cancel sends nothing more, Confirm retries with the flag", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/review$/,
        status: (req) => (req.url.includes("confirm_finding_delete=true") ? 200 : 409),
        body: (req) =>
          req.url.includes("confirm_finding_delete=true")
            ? { updated: 1 }
            : {
                error: {
                  code: "finding_would_be_deleted",
                  message: "would delete",
                  details: { finding_id: "f7", finding_ids: ["f7"], count: 1 },
                },
              },
      },
      { method: "GET", path: /\/next-unreviewed$/, body: { detection: null, remaining: 0 } },
    ]);
    const accepted = { ...pending, review_state: "accepted" as const };
    const { result } = renderHook(() => useReview(PROJECT_ID), { wrapper: wrap(api) });
    await act(() => result.current.decide(MAP_RUN_ID, accepted, "reject", undefined, kindOf));
    expect(result.current.confirm).toMatchObject({ findingIds: ["f7"], action: "reject" });
    act(() => result.current.cancelConfirm());
    expect(result.current.confirm).toBeNull();
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
    await act(() => result.current.decide(MAP_RUN_ID, accepted, "reject", undefined, kindOf));
    await act(() => result.current.confirmDelete());
    const posts = requests.filter((r) => r.method === "POST");
    expect(posts).toHaveLength(3);
    expect(posts.at(-1)!.url).toContain("confirm_finding_delete=true");
    expect(posts.at(-1)!.body).toEqual({ detection_ids: ["d1"], action: "reject" });
    expect(result.current.confirm).toBeNull();
  });

  it("a second decision while one is in flight sends nothing", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/review$/, body: { updated: 1 } },
      { method: "GET", path: /\/next-unreviewed$/, body: { detection: null, remaining: 0 } },
    ]);
    // `api.POST` is generic over the path, so `Parameters<>` of it is `never`; wrap it untyped.
    const post = api.POST as unknown as (...a: unknown[]) => Promise<unknown>;
    const slow = {
      ...api,
      POST: (async (...a: unknown[]) => {
        await gate;
        return post(...a);
      }) as unknown as typeof api.POST,
    };
    const { result } = renderHook(() => useReview(PROJECT_ID), { wrapper: wrap(slow) });
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.decide(MAP_RUN_ID, { ...pending, class_id: "obj" }, "accept", undefined, kindOf);
    });
    await act(() =>
      result.current.decide(MAP_RUN_ID, { ...pending, class_id: "obj" }, "accept", undefined, kindOf),
    );
    release();
    await act(() => first);
    await waitFor(() => expect(requests.filter((r) => r.method === "POST")).toHaveLength(1));
  });

  it("Shift+A accepts the pending detections in view, one request per run", async () => {
    useDetectStore.setState({ inView: { r1: ["a", "b"], r2: ["c"] } });
    const { api, requests } = fakeClient([{ method: "POST", path: /\/review$/, body: { updated: 2 } }]);
    const { result } = renderHook(() => useReview(PROJECT_ID), { wrapper: wrap(api) });
    await act(() => result.current.decideMany("accept"));
    expect(requests.map((r) => [r.url.split("/map-runs/")[1]?.split("?")[0], r.body])).toEqual([
      ["r1/review", { detection_ids: ["a", "b"], action: "accept" }],
      ["r2/review", { detection_ids: ["c"], action: "accept" }],
    ]);
  });

  it("Shift+A clears what it sent from the view, so a quick Shift+X does not resend it", async () => {
    useDetectStore.setState({ inView: { r1: ["a", "b"], r2: ["c"] } });
    const { api, requests } = fakeClient([{ method: "POST", path: /\/review$/, body: { updated: 2 } }]);
    const { result } = renderHook(() => useReview(PROJECT_ID), { wrapper: wrap(api) });
    await act(() => result.current.decideMany("accept"));
    expect(useDetectStore.getState().inView).toEqual({ r1: [], r2: [] });
    await act(() => result.current.decideMany("reject"));
    expect(requests).toHaveLength(2);
  });

  it("a partly failed Shift+A still refreshes what was saved and keeps only the unsent ids", async () => {
    useDetectStore.setState({ inView: { r1: ["a"], r2: ["c"] } });
    const rev = useDetectStore.getState().revision;
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/review$/,
        status: (req) => (req.url.includes("/r2/") ? 500 : 200),
        body: (req) =>
          req.url.includes("/r2/")
            ? { error: { code: "internal", message: "boom", details: {} } }
            : { updated: 1 },
      },
    ]);
    const { result } = renderHook(() => useReview(PROJECT_ID), { wrapper: wrap(api) });
    await act(() => result.current.decideMany("accept"));
    expect(useDetectStore.getState().revision).toBeGreaterThan(rev);
    expect(useDetectStore.getState().inView).toEqual({ r1: [], r2: ["c"] });
  });

  it("a bulk reject refused for findings says to reject them one by one", async () => {
    useDetectStore.setState({ inView: { r1: ["a"] } });
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/review$/,
        status: 409,
        body: {
          error: {
            code: "finding_would_be_deleted",
            message: "would delete",
            details: { finding_ids: ["f1"], count: 1 },
          },
        },
      },
    ]);
    const { result } = renderHook(() => useReview(PROJECT_ID), { wrapper: wrap(api) });
    await act(() => result.current.decideMany("reject"));
    expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual([
      "Some of these detections have findings; reject them one by one to confirm.",
    ]);
    expect(result.current.confirm).toBeNull();
  });
});
