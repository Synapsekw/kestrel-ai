import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act } from "@testing-library/react";
import { errorBody, exampleJob, fakeClient, type FakeRoute, type RecordedRequest } from "@/test/fixtures";
import { useJobsStore } from "@/store/jobs";
import { SMART_TOOL, useImagesWorkspace, wsGet } from "../bridge";
import { renderAi, resetAll, seedWorkspace } from "../testing";
import { useSamStore, useSmartPolygon, VIEW_SETTLE_MS, type SmartPolygon } from "./useSmartPolygon";

const crop = { x: 0, y: 0, w: 1024, h: 768 };
const ready = {
  key: "sam2.1_t",
  name: "SAM 2.1 tiny",
  description: "",
  size_mb: 78,
  sha256: "0".repeat(64),
  state: "ready",
  reason: null,
  job_id: null,
};
const prepareRoute: FakeRoute = {
  method: "POST",
  path: /\/segment\/prepare$/,
  body: { crop, device: "cpu", encode_ms: 2000, cached: false },
};
const base = (extra: FakeRoute[] = [], assist: object = ready): FakeRoute[] => [
  { method: "GET", path: /\/library\/assist-models$/, body: { items: [assist], next_cursor: null } },
  prepareRoute,
  ...extra,
];
let hook: SmartPolygon;
function Harness() {
  const h = useSmartPolygon(wsGet().projectId!);
  useEffect(() => {
    hook = h;
  });
  return null;
}
const flush = () => act(async () => {});
const choose = () => act(() => wsGet().setTool(SMART_TOOL)); // the registry's activateTool is T10's
const sam = () => useSamStore.getState().state;
const prepares = (requests: RecordedRequest[]) => requests.filter((r) => r.url.endsWith("/segment/prepare"));
const decodes = (requests: RecordedRequest[]) => requests.filter((r) => r.url.endsWith("/segment"));
/** G3: a setTimeout(0) prepare plus a fetch round trip; wait for it rather than counting flushes. */
const prepared = () => vi.waitFor(() => expect(sam().status).toBe("ready"));

beforeEach(() => {
  resetAll();
  seedWorkspace([]);
  useImagesWorkspace.setState({
    view: { scale: 0.25, x: 0, y: 0 },
    viewport: { width: 1000, height: 700 },
    activeTypeId: wsGet().types[0].id,
  });
});

describe("useSmartPolygon", () => {
  it("prepares on tool select, segments each click with every point, commits with assist sam", async () => {
    const { api, requests } = fakeClient(
      base([
        {
          method: "POST",
          path: /\/segment$/,
          body: {
            crop,
            polygon: [
              [10, 10],
              [60, 10],
              [35, 50],
            ],
            score: 0.9,
            device: "cpu",
            encode_ms: 0,
            decode_ms: 200,
          },
        },
        {
          method: "POST",
          path: /\/images\/[^/]+\/boxes$/,
          status: 201,
          body: { id: "new", finding_id: null, repaired: false },
        },
      ]),
    );
    renderAi(<Harness />, api);
    choose();
    await prepared();
    expect(prepares(requests)).toHaveLength(1);
    expect(sam().device).toBe("cpu");
    act(() => hook.click({ x: 30, y: 30 }, true));
    expect(wsGet().draft).toMatchObject({ kind: "custom", tool: SMART_TOOL });
    act(() => hook.click({ x: 40, y: 20 }, false));
    await vi.waitFor(() => expect(decodes(requests)).toHaveLength(2));
    await vi.waitFor(() => expect(sam().busy).toBe(false));
    // The first click went alone; the second carried both points and the server's crop.
    expect(decodes(requests)[0].body).toEqual({ crop, points: [{ x: 30, y: 30, positive: true }] });
    expect(decodes(requests)[1].body).toEqual({
      crop,
      points: [
        { x: 30, y: 30, positive: true },
        { x: 40, y: 20, positive: false },
      ],
    });
    expect(sam().polygon).toHaveLength(3);
    let handled = false;
    act(() => {
      handled = hook.commit();
    });
    expect(handled).toBe(true);
    await vi.waitFor(() => expect(wsGet().draft).toBeNull());
    const create = requests.find((r) => r.url.endsWith("/boxes"));
    expect(create?.body).toMatchObject({
      shape: "polygon",
      assist: "sam",
      points: [
        [10, 10],
        [60, 10],
        [35, 50],
      ],
    });
    expect(sam().points).toEqual([]);
  });

  it("sends only the newest click while one segment is in flight", async () => {
    let answer: (() => void) | null = null;
    const gate = () => new Promise<void>((r) => (answer = r));
    const { api, requests } = fakeClient(
      base([
        {
          method: "POST",
          path: /\/segment$/,
          body: { crop, polygon: null, score: 0, device: "cuda", encode_ms: 0, decode_ms: 8 },
        },
      ]),
    );
    // Hold the first decode open by gating the client's POST.
    type Post = (path: string, init: unknown) => Promise<unknown>;
    const post = api.POST.bind(api) as unknown as Post;
    let held = false;
    const gated: Post = (path, init) => {
      if (!held && path.endsWith("/segment")) {
        held = true;
        return gate().then(() => post(path, init));
      }
      return post(path, init);
    };
    api.POST = gated as unknown as typeof api.POST;
    renderAi(<Harness />, api);
    choose();
    await prepared();
    act(() => hook.click({ x: 1, y: 1 }, true));
    act(() => hook.click({ x: 2, y: 2 }, true));
    act(() => hook.click({ x: 3, y: 3 }, false));
    expect(sam().points).toHaveLength(3);
    await act(async () => answer?.());
    await vi.waitFor(() => expect(decodes(requests)).toHaveLength(2));
    await vi.waitFor(() => expect(sam().busy).toBe(false));
    expect((decodes(requests)[0].body as { points: unknown[] }).points).toHaveLength(1);
    expect((decodes(requests)[1].body as { points: unknown[] }).points).toHaveLength(3);
  });

  it("marks S unavailable on 409 assist_model_missing and needs no segment call", async () => {
    const { api, requests } = fakeClient(
      base().map((r) =>
        r.path.source.includes("prepare")
          ? {
              ...r,
              status: 409,
              body: errorBody("assist_model_missing", "missing", { key: "sam2.1_t", state: "invalid" }),
            }
          : r,
      ),
    );
    renderAi(<Harness />, api);
    choose();
    await vi.waitFor(() => expect(sam().status).toBe("unavailable"));
    expect(sam().reason).toBe("invalid");
    act(() => hook.click({ x: 1, y: 1 }, true));
    expect(decodes(requests)).toHaveLength(0);
  });

  it("does not prepare when the model is missing", async () => {
    const { api, requests } = fakeClient(base([], { ...ready, state: "missing" }));
    renderAi(<Harness />, api);
    choose();
    await vi.waitFor(() => expect(sam().reason).toBe("missing"));
    await flush();
    expect(prepares(requests)).toHaveLength(0);
  });

  it("still tries to prepare when the list says unavailable (the server retries the load)", async () => {
    const { api, requests } = fakeClient(
      base([], { ...ready, state: "unavailable", reason: "SAM failed to load" }),
    );
    renderAi(<Harness />, api);
    choose();
    await prepared();
    expect(prepares(requests)).toHaveLength(1);
  });

  it("treats a 404 on the assist list (no assist routes in this build) as absent and never prepares", async () => {
    const { api, requests } = fakeClient([prepareRoute]);
    renderAi(<Harness />, api);
    choose();
    await vi.waitFor(() => expect(hook.availability).toBe("absent"));
    await flush();
    expect(sam().status).toBe("unavailable");
    expect(sam().reason).toBe("absent");
    expect(prepares(requests)).toHaveLength(0);
  });

  it("retry() after a 409 unavailable prepares again and can succeed", async () => {
    let calls = 0;
    const { api, requests } = fakeClient(
      base().map((r) =>
        r.path.source.includes("prepare")
          ? {
              ...r,
              status: () => (++calls === 1 ? 409 : 200),
              body: () =>
                calls === 1
                  ? errorBody("assist_model_missing", "SAM failed to load", {
                      key: "sam2.1_t",
                      state: "unavailable",
                    })
                  : { crop, device: "cuda", encode_ms: 100, cached: false },
            }
          : r,
      ),
    );
    renderAi(<Harness />, api);
    choose();
    await vi.waitFor(() => expect(sam().status).toBe("unavailable"));
    expect(sam().reason).toBe("unavailable");
    // Parked until the operator asks: neither a re-render nor a pan re-prepares on its own.
    await flush();
    act(() => useImagesWorkspace.setState({ view: { scale: 1, x: -2500, y: -1500 } }));
    await act(() => new Promise((r) => setTimeout(r, VIEW_SETTLE_MS + 100)));
    expect(prepares(requests)).toHaveLength(1);
    act(() => hook.retry());
    await prepared();
    expect(prepares(requests)).toHaveLength(2);
    expect(sam().device).toBe("cuda");
  });

  it("retry() recovers from a failed assist list (not a 404)", async () => {
    let listCalls = 0;
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/library\/assist-models$/,
        status: () => (++listCalls === 1 ? 503 : 200),
        body: () =>
          listCalls === 1
            ? errorBody("library_unavailable", "no library")
            : { items: [ready], next_cursor: null },
      },
      prepareRoute,
    ]);
    renderAi(<Harness />, api);
    await vi.waitFor(() => expect(hook.availability).toBe("unavailable"));
    act(() => hook.retry());
    await vi.waitFor(() => expect(hook.availability).toBe("ready"));
  });

  it("prepares once the acquire job ends and the list reads ready", async () => {
    let listCalls = 0;
    const job = { ...exampleJob, type: "assist_acquire", state: "running" } as typeof exampleJob;
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/library\/assist-models$/,
        body: () => ({
          items: [++listCalls === 1 ? { ...ready, state: "missing", job_id: job.id } : ready],
          next_cursor: null,
        }),
      },
      prepareRoute,
    ]);
    act(() => useJobsStore.getState().upsert(job));
    renderAi(<Harness />, api);
    choose();
    await vi.waitFor(() => expect(sam().reason).toBe("missing"));
    expect(prepares(requests)).toHaveLength(0);
    act(() => useJobsStore.getState().upsert({ ...job, state: "succeeded", progress: 1 }));
    await prepared();
    expect(listCalls).toBe(2);
    expect(prepares(requests)).toHaveLength(1);
  });

  it("flags an empty mask for a null polygon", async () => {
    const { api } = fakeClient(
      base([
        {
          method: "POST",
          path: /\/segment$/,
          body: { crop, polygon: null, score: 0, device: "cuda", encode_ms: 0, decode_ms: 30 },
        },
      ]),
    );
    renderAi(<Harness />, api);
    choose();
    await prepared();
    act(() => hook.click({ x: 30, y: 30 }, true));
    await vi.waitFor(() => expect(sam().empty).toBe(true));
  });

  it("refuses a click outside the prepared crop without a request", async () => {
    const { api, requests } = fakeClient(base());
    renderAi(<Harness />, api);
    choose();
    await prepared();
    act(() => hook.click({ x: 3000, y: 2000 }, true));
    expect(sam().outside).toBe(true);
    expect(decodes(requests)).toHaveLength(0);
  });

  it("after a point, panning keeps the crop; a click outside it sends nothing and shows the hint (focus 4)", async () => {
    const { api, requests } = fakeClient(
      base([
        {
          method: "POST",
          path: /\/segment$/,
          body: { crop, polygon: null, score: 0, device: "cuda", encode_ms: 0, decode_ms: 8 },
        },
      ]),
    );
    renderAi(<Harness />, api);
    choose();
    await prepared();
    act(() => hook.click({ x: 100, y: 100 }, true));
    await vi.waitFor(() => expect(decodes(requests)).toHaveLength(1));
    // Pan far right: the view no longer shows the prepared crop.
    act(() => useImagesWorkspace.setState({ view: { scale: 1, x: -2500, y: -1500 } }));
    await act(() => new Promise((r) => setTimeout(r, VIEW_SETTLE_MS + 100)));
    expect(prepares(requests)).toHaveLength(1);
    expect(sam().crop).toEqual(crop);
    act(() => hook.click({ x: 2800, y: 1800 }, true));
    expect(sam().outside).toBe(true);
    expect(sam().points).toHaveLength(1);
    await flush();
    expect(decodes(requests)).toHaveLength(1);
  });

  it("with no active type, commit opens FC's type picker and creates nothing (R-FA9)", async () => {
    const { api, requests } = fakeClient(
      base([
        {
          method: "POST",
          path: /\/segment$/,
          body: {
            crop,
            polygon: [
              [1, 1],
              [9, 1],
              [5, 8],
            ],
            score: 1,
            device: "cuda",
            encode_ms: 0,
            decode_ms: 30,
          },
        },
      ]),
    );
    renderAi(<Harness />, api);
    choose();
    await prepared();
    useImagesWorkspace.setState({ activeTypeId: null });
    act(() => hook.click({ x: 3, y: 3 }, true));
    await vi.waitFor(() => expect(sam().polygon).not.toBeNull());
    act(() => void hook.commit());
    await flush();
    expect(requests.some((r) => r.url.endsWith("/boxes"))).toBe(false);
    expect(wsGet().picker?.purpose).toBe("active");
    expect(sam().polygon).not.toBeNull(); // the outline is kept
  });

  it("cancel and removeLast report whether they did anything (FC falls through otherwise)", async () => {
    const { api } = fakeClient(
      base([
        {
          method: "POST",
          path: /\/segment$/,
          body: { crop, polygon: null, score: 0, device: "cuda", encode_ms: 0, decode_ms: 1 },
        },
      ]),
    );
    renderAi(<Harness />, api);
    choose();
    await prepared();
    let r = true;
    act(() => {
      r = hook.cancel();
    });
    expect(r).toBe(false);
    act(() => {
      r = hook.removeLast();
    });
    expect(r).toBe(false);
    act(() => hook.click({ x: 3, y: 3 }, true));
    act(() => {
      r = hook.removeLast();
    });
    expect(r).toBe(true);
    expect(wsGet().draft).toBeNull();
    act(() => hook.click({ x: 3, y: 3 }, true));
    act(() => {
      r = hook.cancel();
    });
    expect(r).toBe(true);
    expect(sam().points).toEqual([]);
    expect(wsGet().draft).toBeNull();
    await flush();
  });
});
