import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { errorBody, exampleJob, fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { ensureBuiltInTools } from "@/images/tools"; // I-FC
import { useToastStore } from "@/ui";
import {
  getTool,
  SMART_TOOL,
  useCanvasKeyHandlers,
  useCommandContext,
  useImagesKeymap,
  useImagesWorkspace,
  wsGet,
} from "./bridge";
import { ensureAiRegistered } from "./register";
import { useSamStore } from "./sam/useSmartPolygon";
import { SamWarmEdge } from "./SamWarmEdge";
import { SmartPolygonPanel } from "./SmartPolygonPanel";
import { accepted, renderAi, resetAll, seedWorkspace } from "./testing";
import { useAiWorkspace } from "./useAiWorkspace";

const model = (state: string, reason: string | null = null) => ({
  key: "sam2.1_t",
  name: "SAM 2.1 tiny",
  description: "",
  size_mb: 78,
  sha256: "0".repeat(64),
  state,
  reason,
  job_id: null,
});
const crop = { x: 0, y: 0, w: 1024, h: 768 };
const routes = (state: string, extra: FakeRoute[] = [], reason: string | null = null): FakeRoute[] => [
  ...extra,
  {
    method: "GET",
    path: /\/library\/assist-models$/,
    body: { items: [model(state, reason)], next_cursor: null },
  },
  { method: "POST", path: /\/assist-models\/sam2\.1_t\/acquire$/, status: 202, body: { job: exampleJob } },
  {
    method: "POST",
    path: /\/segment\/prepare$/,
    body: { crop, device: "cpu", encode_ms: 2000, cached: false },
  },
];
/** The server's 409 for a SAM that fails to load (I-BS: it retries the load on every prepare). */
const prepareUnavailable = (reason: string): FakeRoute => ({
  method: "POST",
  path: /\/segment\/prepare$/,
  status: 409,
  body: errorBody("assist_model_missing", reason, { key: "sam2.1_t", state: "unavailable" }),
});
function Workspace() {
  const ctx = useCommandContext(PROJECT_ID);
  const ai = useAiWorkspace({ projectId: PROJECT_ID, index: null, onOpenImage: vi.fn() });
  useImagesKeymap([ai.keyHandlers, useCanvasKeyHandlers(ctx)]);
  return (
    <>
      <SamWarmEdge />
      <SmartPolygonPanel />
    </>
  );
}
const flush = () => act(async () => {});
const press = (key: string, o: Partial<KeyboardEventInit> = {}) =>
  act(() => {
    fireEvent.keyDown(window, { key, ...o });
  });
const point = (x: number, y: number) => act(() => useSamStore.getState().handle?.click({ x, y }, true));
const sam = () => useSamStore.getState().state;
/** G3: a setTimeout(0) prepare plus a fetch round trip; wait for it rather than counting flushes. */
const prepared = () => vi.waitFor(() => expect(sam().status).toBe("ready"));

beforeEach(() => {
  resetAll();
  ensureBuiltInTools();
  ensureAiRegistered();
  seedWorkspace([accepted("p1")]);
  useImagesWorkspace.setState({
    view: { scale: 0.25, x: 0, y: 0 },
    viewport: { width: 1000, height: 700 },
    activeTypeId: wsGet().types[0].id,
  });
});

describe("the S tool", () => {
  it("is registered through FC's registry, always selectable (R-FA7)", () => {
    const def = getTool(SMART_TOOL);
    expect(def).toMatchObject({
      id: "smart",
      action: "smart-polygon",
      order: 55,
      icon: "sparkle",
      drawsShapes: true,
    });
    expect(def?.available).toBeUndefined();
  });

  it("S chooses the tool (data-tool `smart`) even when the model is missing, and offers Get model", async () => {
    const { api, requests } = fakeClient(routes("missing"));
    renderAi(<Workspace />, api);
    await flush();
    press("s");
    await flush();
    expect(wsGet().tool).toBe(SMART_TOOL);
    expect(await screen.findByText("Get smart polygon model (≈78 MB)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import file…" })).toBeTruthy();
    expect(requests.some((r) => r.url.endsWith("/segment/prepare"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Get model" }));
    await flush();
    expect(requests.some((r) => r.url.endsWith("/acquire"))).toBe(true);
  });

  it("explains a failed check, with Get model", async () => {
    const { api } = fakeClient(routes("invalid"));
    renderAi(<Workspace />, api);
    press("s");
    expect(await screen.findByText("The smart polygon model failed its check. Get it again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Get model" })).toBeTruthy();
  });

  it("shows the reason and Try again (no Get model) when SAM is unavailable, and draws nothing", async () => {
    const reason = "The SAM modules are missing from this build.";
    const { api, requests } = fakeClient(routes("unavailable", [prepareUnavailable(reason)], reason));
    renderAi(<Workspace />, api);
    press("s");
    expect(await screen.findByText(/The SAM modules are missing from this build\./)).toBeTruthy();
    expect(sam().reason).toBe("unavailable");
    expect(screen.queryByRole("button", { name: "Get model" })).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    point(10, 10);
    await flush();
    expect(requests.some((r) => /\/segment$/.test(r.url))).toBe(false);
    expect(wsGet().draft).toBeNull();
  });

  it("Try again prepares again and recovers when the server loads SAM this time", async () => {
    let calls = 0;
    const { api, requests } = fakeClient(
      routes("unavailable", [
        {
          method: "POST",
          path: /\/segment\/prepare$/,
          status: () => (++calls === 1 ? 409 : 200),
          body: () =>
            calls === 1
              ? errorBody("assist_model_missing", "SAM failed to load", {
                  key: "sam2.1_t",
                  state: "unavailable",
                })
              : { crop, device: "cuda", encode_ms: 100, cached: false },
        },
      ]),
    );
    renderAi(<Workspace />, api);
    press("s");
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await prepared();
    expect(requests.filter((r) => r.url.endsWith("/segment/prepare"))).toHaveLength(2);
    expect(await screen.findByText("Click the defect · Shift+click to exclude")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("says S is not in this build when the assist list is absent (404), with no button", async () => {
    const { api, requests } = fakeClient([]);
    renderAi(<Workspace />, api);
    press("s");
    expect(await screen.findByText("Smart polygon is not available in this build")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(requests.some((r) => r.url.endsWith("/segment/prepare"))).toBe(false);
  });

  it("follows the running download on 409 job_running", async () => {
    const { api } = fakeClient(
      routes("missing").map((r) =>
        r.path.source.includes("acquire")
          ? { ...r, status: 409, body: errorBody("job_running", "running", { job_id: "j-running" }) }
          : r,
      ),
    );
    renderAi(<Workspace />, api);
    press("s");
    fireEvent.click(await screen.findByRole("button", { name: "Get model" }));
    await flush();
    expect(useToastStore.getState().toasts.some((t) => t.text.startsWith("Could not start"))).toBe(false);
  });

  it("runs the warm-up edge only while prepare is open, then shows the CPU chip and the empty-mask message", async () => {
    let answer: (() => void) | null = null;
    const gate = new Promise<void>((r) => (answer = r));
    const { api } = fakeClient(
      routes("ready", [
        {
          method: "POST",
          path: /\/segment$/,
          body: { crop, polygon: null, score: 0, device: "cpu", encode_ms: 0, decode_ms: 200 },
        },
      ]),
    );
    // Hold the prepare open by gating the client's POST (the fake fetch answers synchronously).
    type Post = (path: string, init: unknown) => Promise<unknown>;
    const post = api.POST.bind(api) as unknown as Post;
    const gated: Post = (path, init) =>
      path.endsWith("/segment/prepare") ? gate.then(() => post(path, init)) : post(path, init);
    api.POST = gated as unknown as typeof api.POST;
    renderAi(<Workspace />, api);
    press("s");
    expect(await screen.findByTestId("sam-warm-edge")).toBeTruthy();
    expect(screen.getByText("Preparing this view…")).toBeTruthy();
    await act(async () => answer?.());
    await prepared();
    expect(screen.queryByTestId("sam-warm-edge")).toBeNull();
    expect(screen.getByText("CPU")).toBeTruthy();
    expect(screen.getByText("Click the defect · Shift+click to exclude")).toBeTruthy();
    point(30, 30);
    expect(await screen.findByText("Nothing found here, try another point")).toBeTruthy();
  });

  it("Enter creates exactly one polygon with assist sam; Esc with no points reaches FC", async () => {
    const { api, requests } = fakeClient(
      routes("ready", [
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
            device: "cpu",
            encode_ms: 0,
            decode_ms: 1,
          },
        },
        {
          method: "POST",
          path: /\/images\/[^/]+\/boxes$/,
          status: 201,
          body: { ...wsGet().boxes.p1, id: "n", shape: "polygon", finding_id: null, repaired: false },
        },
      ]),
    );
    renderAi(<Workspace />, api);
    press("s");
    await prepared();
    point(3, 3);
    await vi.waitFor(() => expect(sam().polygon).not.toBeNull());
    expect(wsGet().draft).toMatchObject({ kind: "custom", tool: SMART_TOOL });
    press("Enter");
    await vi.waitFor(() => expect(wsGet().draft).toBeNull());
    await flush();
    const creates = requests.filter((r) => /\/boxes$/.test(r.url) && r.method === "POST");
    expect(creates).toHaveLength(1);
    expect(creates[0].body).toMatchObject({ shape: "polygon", assist: "sam" });
    expect(sam().points).toEqual([]);
    act(() => wsGet().select(["p1"]));
    press("Escape");
    expect(wsGet().selectedIds).toEqual([]);
    expect(wsGet().tool).toBe(SMART_TOOL);
  });

  it("Backspace removes the last point; Esc clears the points and keeps the selection", async () => {
    const { api } = fakeClient(
      routes("ready", [
        {
          method: "POST",
          path: /\/segment$/,
          body: { crop, polygon: null, score: 0, device: "cuda", encode_ms: 0, decode_ms: 1 },
        },
      ]),
    );
    renderAi(<Workspace />, api);
    press("s");
    await prepared();
    point(3, 3);
    point(6, 6);
    press("Backspace");
    expect(sam().points).toHaveLength(1);
    act(() => wsGet().select(["p1"]));
    press("Escape");
    expect(sam().points).toEqual([]);
    expect(wsGet().draft).toBeNull();
    expect(wsGet().selectedIds).toEqual(["p1"]);
  });
});
