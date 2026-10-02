import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { createApiClient } from "@contract/client";
import type { CloudPick } from "@/clouds/CloudViewer";
import type { Finding } from "@/api/findings";
import type { NavMode } from "@/clouds/viewer/types";
import { at } from "@/clouds/pins/testCamera";
import { LAST_TYPE_KEY } from "@/clouds/pins/usePinTool";
import { DEFAULT_SEAMS, WorkspaceSeamsContext } from "@/clouds/workspace/seams";
import { useChangesStore } from "@/store/changes";
import { errorBody, fakeFetch, PROJECT_ID, type FakeRoute, type RecordedRequest } from "@/test/fixtures";
import { baseRoutes, exampleFinding, exampleFindingDetail, TYPE_SPALLING } from "@/test/findingFixtures";
import { CLOUD_ID, exampleCloud } from "@/test/cloudFixtures";
import { TestApiProvider } from "@/test/render";
import type { CloudToolId } from "../tools";
import type { FeatureContext } from "../types";
import { useWorkspaceTool } from "../useWorkspaceTool";
import { usePinsFeature } from "./pins";

const saved: Finding = {
  ...exampleFinding,
  id: "f-a",
  number: 217,
  anchor: {
    kind: "cloud",
    cloud_id: CLOUD_ID,
    x: at(0, 0, 0)[0],
    y: at(0, 0, 0)[1],
    z: at(0, 0, 0)[2],
    uncertainty_m: 0.05,
  },
  data_type: "point_cloud",
  data_id: CLOUD_ID,
};
const PICK: CloudPick = {
  x: at(0, 0, 0)[0],
  y: at(0, 0, 0)[1],
  z: at(0, 0, 0)[2],
  level: 3,
  uncertainty_m: 0.01,
};
const PICK_ELSEWHERE: CloudPick = { ...PICK, x: at(3, 0, 0)[0], y: at(3, 0, 0)[1] };

/** Holds `GET …/findings` (the pins list) while closed, so a test can look before the refetch answers. */
function listGate() {
  let open = true;
  const waiting: (() => void)[] = [];
  return {
    close: () => {
      open = false;
    },
    release: () => {
      open = true;
      waiting.splice(0).forEach((go) => go());
    },
    wait: () => (open ? Promise.resolve() : new Promise<void>((r) => waiting.push(r))),
  };
}
type Gate = ReturnType<typeof listGate>;

let nav: NavMode = "orbit";
const viewer = () =>
  ({
    current: {
      onFrame: () => () => {},
      onSettle: () => () => {},
      occlusion: () => null,
      project: () => ({ x: 400, y: 250 }),
      pickWithNormal: () => ({ point: at(0, 0, 0), u: 0.01, normal: [0, 0, 1] }),
      stats: () => ({ numVisiblePoints: 0 }),
      navMode: () => nav,
      setNavMode: vi.fn(),
      setView: vi.fn(),
      goToPose: vi.fn(),
      lookAt: vi.fn(),
      requestRender: vi.fn(),
    },
  }) as unknown as FeatureContext["viewer"];

function Harness({ ctx }: { ctx: FeatureContext }) {
  const f = usePinsFeature(ctx);
  const tool = f.tools![0];
  const [cancelled, setCancelled] = useState("");
  return (
    <div>
      <button type="button" onClick={() => tool.onPick!(PICK)}>
        pick
      </button>
      <button type="button" onClick={() => tool.onPick!(PICK_ELSEWHERE)}>
        pick elsewhere
      </button>
      <button type="button" onClick={() => tool.onCommit!()}>
        commit
      </button>
      <button type="button" onClick={() => setCancelled(String(tool.onCancel!()))}>
        esc
      </button>
      <span data-testid="cancelled">{cancelled}</span>
      <span data-testid="tool">{`${tool.id} picks=${tool.picks} canCommit=${tool.canCommit}`}</span>
      <span data-testid="hint-actions">{String(tool.hintActions !== false)}</span>
      <span data-testid="count">{f.findings!.count}</span>
      <span data-testid="dots">{f.minimap!.length}</span>
      <span data-testid="marks">
        {JSON.stringify(f.minimap!.map((m) => (m.kind === "dot" ? [m.label, m.x, m.y] : null)))}
      </span>
      <div>{f.layer}</div>
      <div>{f.floating}</div>
      <div>{f.findings!.list}</div>
      <div>{f.findings!.detail}</div>
    </div>
  );
}

/** The pins feature under W1's real key routing (`useWorkspaceTool`), as CloudWorkspace wires it. */
function RoutedHarness({ ctx }: { ctx: FeatureContext }) {
  const [active, setActive] = useState<CloudToolId>(ctx.activeTool);
  const f = usePinsFeature({ ...ctx, activeTool: active });
  useWorkspaceTool({
    active,
    setActive,
    tools: f.tools!,
    viewer: ctx.viewer,
    enabled: true,
    isAvailable: () => true,
  });
  return (
    <div>
      <button type="button" onClick={() => f.tools![0].onPick!(PICK)}>
        pick
      </button>
      <div>{f.layer}</div>
      <div>{f.floating}</div>
    </div>
  );
}

function mount(
  over: Partial<FeatureContext> = {},
  opts: { gate?: Gate; routed?: boolean; routes?: FakeRoute[] } = {},
) {
  const { fetch: answer, requests } = fakeFetch(
    baseRoutes([
      ...(opts.routes ?? []),
      // fakeFetch matches the pathname only (no query string).
      { method: "GET", path: /\/findings$/, body: { items: [saved], next_cursor: null } },
      { method: "GET", path: /\/pointclouds\/[^/]+\/views$/, body: { items: [] } },
      { method: "GET", path: /\/findings\/f-a$/, body: { ...exampleFindingDetail, ...saved } },
      { method: "GET", path: /\/findings\/f-a\/attachments$/, body: { items: [] } },
      { method: "GET", path: /\/findings\/f-a\/comments/, body: { items: [], next_cursor: null } },
      { method: "GET", path: /\/activity/, body: { items: [], next_cursor: null } },
      { method: "GET", path: /\/pointclouds\/[^/]+\/measurements$/, body: { items: [] } },
      {
        method: "POST",
        path: /\/findings$/,
        status: 201,
        body: { ...exampleFindingDetail, id: "f-new", number: 300 },
      },
      { method: "PATCH", path: /\/findings\/f-a$/, body: { ...exampleFindingDetail, ...saved } },
      { method: "DELETE", path: /\/findings\/f-a$/, status: 204, body: null },
    ]),
  );
  const fetchImpl = (async (input: Request | string | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    if (opts.gate && req.method === "GET" && new URL(req.url).pathname.endsWith("/findings"))
      await opts.gate.wait();
    return answer(req);
  }) as typeof fetch;
  const api = createApiClient({ baseUrl: "http://fake", token: "t", fetch: fetchImpl });
  const ctx: FeatureContext = {
    projectId: PROJECT_ID,
    cloud: exampleCloud,
    maps: [],
    viewer: viewer(),
    viewState: "running",
    activeTool: "pin",
    search: "",
    seams: DEFAULT_SEAMS,
    render: { colour: "rgb", elevationRange: [0, 1], pointSize: 1, budget: 3_000_000, edl: true },
    clipBox: null,
    arm: vi.fn(),
    showTopic: vi.fn(),
    restoreClipBox: vi.fn(),
    ...over,
  };
  render(
    <TestApiProvider api={api}>
      <MemoryRouter>
        <WorkspaceSeamsContext.Provider value={DEFAULT_SEAMS}>
          {opts.routed ? <RoutedHarness ctx={ctx} /> : <Harness ctx={ctx} />}
        </WorkspaceSeamsContext.Provider>
      </MemoryRouter>
    </TestApiProvider>,
  );
  return { requests, ctx };
}

const count = (r: RecordedRequest[], method: string) => r.filter((x) => x.method === method).length;
/** The Findings tab's row (the pin head in the layer carries the same name). */
const findRow = async () =>
  within(await screen.findByRole("list", { name: "Findings on this cloud" })).getByRole("button", {
    name: /F-0217/,
  });
const blur = () => act(() => (document.activeElement as HTMLElement | null)?.blur());

describe("usePinsFeature", () => {
  beforeEach(() => {
    nav = "orbit";
    localStorage.clear();
    useChangesStore.setState({ findingsRevision: 0, pointcloudsRevision: 0 });
  });

  it("registers the pin tool, the Findings tab with its count and a minimap dot per pin", async () => {
    mount();
    expect(screen.getByTestId("tool")).toHaveTextContent("pin picks=true canCommit=false");
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
    expect(screen.getByTestId("dots")).toHaveTextContent("1");
    expect(await findRow()).toBeInTheDocument();
    // the layer draws the same finding as a pin head
    expect(
      within(screen.getByTestId("cloud-pins")).getByRole("button", { name: /F-0217/ }),
    ).toBeInTheDocument();
  });

  it("a pick opens the draft; commit creates it once; cancel drops a draft", async () => {
    localStorage.setItem(LAST_TYPE_KEY, TYPE_SPALLING);
    const { requests } = mount();
    expect(screen.getByTestId("hint-actions")).toHaveTextContent("true"); // no draft: the hint bar's Cancel
    await userEvent.click(screen.getByRole("button", { name: "pick" }));
    expect(await screen.findByTestId("pin-callout-create")).toBeInTheDocument();
    expect(screen.getByTestId("tool")).toHaveTextContent("canCommit=true");
    // A5: the callout owns Create/Cancel for a draft; the hint bar does not repeat them.
    expect(screen.getByTestId("hint-actions")).toHaveTextContent("false");
    await userEvent.click(screen.getByRole("button", { name: "commit" }));
    await waitFor(() => expect(count(requests, "POST")).toBe(1));
    await waitFor(() => expect(screen.queryByTestId("pin-callout-create")).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "pick" }));
    await screen.findByTestId("pin-callout-create");
    await userEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(screen.queryByTestId("pin-callout-create")).toBeNull();
    expect(count(requests, "POST")).toBe(1);
  });

  it("Move pin arms the pin tool, the next pick moves the anchor and returns to Orbit", async () => {
    const { requests, ctx } = mount({ activeTool: "orbit" });
    await userEvent.click(await findRow());
    await userEvent.click(await screen.findByRole("button", { name: "Move pin" }));
    expect(ctx.arm).toHaveBeenLastCalledWith("pin");
    await userEvent.click(screen.getByRole("button", { name: "pick" }));
    await waitFor(() => expect(count(requests, "PATCH")).toBe(1));
    expect(requests.find((r) => r.method === "PATCH")!.body).toEqual({
      anchor: { x: PICK.x, y: PICK.y, z: PICK.z, uncertainty_m: 0.01 },
    });
    expect(ctx.arm).toHaveBeenLastCalledWith("orbit");
  });

  it("selecting a finding leaves the open panel alone (R12); Delete asks, then deletes", async () => {
    const { requests, ctx } = mount({ activeTool: "orbit" });
    await userEvent.click(await findRow());
    expect(ctx.showTopic).not.toHaveBeenCalled();
    blur();
    await userEvent.keyboard("{Delete}");
    await userEvent.click(await screen.findByRole("button", { name: "Delete F-0217" }));
    await waitFor(() => expect(count(requests, "DELETE")).toBe(1));
  });

  it("a severity key patches the selected finding, except in fly mode", async () => {
    const { requests } = mount({ activeTool: "orbit" });
    await userEvent.click(await findRow());
    blur();
    await userEvent.keyboard("3");
    await waitFor(() => expect(count(requests, "PATCH")).toBe(1));
    expect(requests.find((r) => r.method === "PATCH")!.body).toEqual({ severity: 3 });
    nav = "fly";
    await userEvent.keyboard("2");
    await new Promise((r) => setTimeout(r, 50));
    expect(count(requests, "PATCH")).toBe(1);
  });

  it("Esc in Orbit deselects and keeps the event from the workspace", async () => {
    const after = vi.fn();
    window.addEventListener("keydown", after);
    mount({ activeTool: "orbit" });
    const row = await findRow();
    await userEvent.click(row);
    expect(row).toHaveAttribute("aria-pressed", "true");
    blur();
    await userEvent.keyboard("{Escape}");
    expect(row).toHaveAttribute("aria-pressed", "false");
    expect(after).not.toHaveBeenCalledWith(expect.objectContaining({ key: "Escape" }));
    window.removeEventListener("keydown", after);
  });

  it("Esc during a pending Move pin cancels it and returns to Orbit; the next pick opens a draft", async () => {
    const { requests } = mount({ activeTool: "orbit" });
    await userEvent.click(await findRow());
    await userEvent.click(await screen.findByRole("button", { name: "Move pin" }));
    await userEvent.click(screen.getByRole("button", { name: "esc" }));
    expect(screen.getByTestId("cancelled")).toHaveTextContent("false");
    await userEvent.click(screen.getByRole("button", { name: "pick" }));
    expect(await screen.findByTestId("pin-callout-create")).toBeInTheDocument();
    expect(count(requests, "PATCH")).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "esc" }));
    expect(screen.getByTestId("cancelled")).toHaveTextContent("true");
    expect(screen.queryByTestId("pin-callout-create")).toBeNull();
  });

  it("after Create the new pin and its callout show, selected, before the refetch answers", async () => {
    localStorage.setItem(LAST_TYPE_KEY, TYPE_SPALLING);
    const gate = listGate();
    const { requests } = mount({}, { gate });
    await findRow();
    await userEvent.click(screen.getByRole("button", { name: "pick" }));
    await screen.findByTestId("pin-callout-create");
    gate.close();
    await userEvent.click(screen.getByRole("button", { name: "commit" }));
    await waitFor(() => expect(count(requests, "POST")).toBe(1));
    const head = await within(screen.getByTestId("cloud-pins")).findByRole("button", { name: /F-0300/ });
    expect(head.closest("[data-selected]")).not.toBeNull();
    expect(screen.getByRole("dialog", { name: "Finding F-0300" })).toBeInTheDocument();
    expect(screen.queryByTestId("pin-callout-create")).toBeNull();
    // the refetch the create started is still held: what shows is the optimistic pin
    const posted = requests.findIndex((r) => r.method === "POST");
    expect(requests.slice(posted).some((r) => r.method === "GET" && /\/findings\?/.test(r.url))).toBe(false);
    await act(async () => gate.release());
  });

  it("after Move pin the pin shows at its new spot before the refetch answers", async () => {
    const gate = listGate();
    const { requests } = mount({ activeTool: "orbit" }, { gate });
    await userEvent.click(await findRow());
    await userEvent.click(await screen.findByRole("button", { name: "Move pin" }));
    gate.close();
    await userEvent.click(screen.getByRole("button", { name: "pick elsewhere" }));
    await waitFor(() => expect(count(requests, "PATCH")).toBe(1));
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId("marks").textContent!)).toEqual([
        ["F-0217", PICK_ELSEWHERE.x, PICK_ELSEWHERE.y],
      ]),
    );
    const patched = requests.findIndex((r) => r.method === "PATCH");
    expect(requests.slice(patched).some((r) => r.method === "GET" && /\/findings\?/.test(r.url))).toBe(false);
    await act(async () => gate.release());
  });

  describe("a ?finding= arrival outside the loaded pins (PIN_CAP)", () => {
    const far: Finding = {
      ...saved,
      id: "f-far",
      number: 901,
      anchor: { ...(saved.anchor as Extract<Finding["anchor"], { kind: "cloud" }>), x: at(2, 0, 0)[0] },
    };
    /** The server's copy of f-far: PATCH writes it, DELETE removes it, GET reads it (404 once gone). */
    function farServer() {
      const state = { f: { ...exampleFindingDetail, ...far } as Record<string, unknown> | null };
      const routes: FakeRoute[] = [
        {
          method: "GET",
          path: /\/findings\/f-far$/,
          status: () => (state.f ? 200 : 404),
          body: () => state.f ?? errorBody("not_found", "Finding not found"),
        },
        {
          method: "PATCH",
          path: /\/findings\/f-far$/,
          body: (r) => {
            const patch = r.body as Record<string, unknown>;
            const anchor = patch.anchor
              ? { ...(state.f!.anchor as object), ...(patch.anchor as object) }
              : state.f!.anchor;
            state.f = { ...state.f!, ...patch, anchor };
            return state.f;
          },
        },
        {
          method: "DELETE",
          path: /\/findings\/f-far$/,
          status: 204,
          body: () => {
            state.f = null;
            return null;
          },
        },
        { method: "GET", path: /\/findings\/f-far\/attachments$/, body: { items: [] } },
        { method: "GET", path: /\/findings\/f-far\/comments/, body: { items: [], next_cursor: null } },
      ];
      return { state, routes };
    }
    const farHead = () => within(screen.getByTestId("cloud-pins")).queryByRole("button", { name: /F-0901/ });
    const marks = () => JSON.parse(screen.getByTestId("marks").textContent!) as [string, number, number][];

    it("adds its pin and opens its callout; a severity key updates it", async () => {
      const server = farServer();
      mount({ search: "?finding=f-far" }, { routes: server.routes });
      await findRow(); // the loaded list (f-a only) has answered
      await waitFor(() => expect(farHead()).not.toBeNull());
      expect(farHead()!.closest("[data-selected]")).not.toBeNull();
      expect(await screen.findByRole("dialog", { name: "Finding F-0901" })).toBeInTheDocument();
      // the count stays the list's (the server's total), not the list plus the arrival
      expect(screen.getByTestId("count")).toHaveTextContent("1");
      blur();
      await userEvent.keyboard("3");
      await waitFor(() =>
        expect(
          within(screen.getByRole("dialog", { name: "Finding F-0901" })).getByText(/./, {
            selector: "[data-level]",
          }),
        ).toHaveAttribute("data-level", "3"),
      );
    });

    it("an edit made elsewhere (the inspector, another window) reaches the added pin", async () => {
      const server = farServer();
      mount({ search: "?finding=f-far" }, { routes: server.routes });
      await waitFor(() => expect(farHead()).not.toBeNull());
      server.state.f = { ...server.state.f!, severity: 2 };
      act(() => useChangesStore.getState().bumpFindings());
      await waitFor(() =>
        expect(
          within(screen.getByRole("dialog", { name: "Finding F-0901" })).getByText(/./, {
            selector: "[data-level]",
          }),
        ).toHaveAttribute("data-level", "2"),
      );
    });

    it("a delete from the inspector removes the added pin", async () => {
      const server = farServer();
      const { requests } = mount({ search: "?finding=f-far" }, { routes: server.routes });
      await waitFor(() => expect(farHead()).not.toBeNull());
      await userEvent.click(await screen.findByRole("button", { name: "Finding actions" }));
      await userEvent.click(await screen.findByRole("menuitem", { name: /Delete/ }));
      await userEvent.click(await screen.findByRole("button", { name: "Delete F-0901" }));
      await waitFor(() => expect(count(requests, "DELETE")).toBe(1));
      await waitFor(() => expect(farHead()).toBeNull());
      expect(marks().map((m) => m[0])).toEqual(["F-0217"]);
    });

    it("Move pin moves the added pin, not back to its old spot", async () => {
      const server = farServer();
      const { requests } = mount(
        { search: "?finding=f-far", activeTool: "orbit" },
        { routes: server.routes },
      );
      await waitFor(() => expect(farHead()).not.toBeNull());
      await userEvent.click(await screen.findByRole("button", { name: "Move pin" }));
      await userEvent.click(screen.getByRole("button", { name: "pick elsewhere" }));
      await waitFor(() => expect(count(requests, "PATCH")).toBe(1));
      await waitFor(() =>
        expect(marks().find((m) => m[0] === "F-0901")).toEqual([
          "F-0901",
          PICK_ELSEWHERE.x,
          PICK_ELSEWHERE.y,
        ]),
      );
    });
  });

  it("an in-cap ?finding= arrival leaves no ghost pin once the finding is deleted elsewhere", async () => {
    let gone = false;
    mount(
      { search: "?finding=f-a" },
      {
        routes: [
          {
            method: "GET",
            path: /\/findings$/,
            body: () => ({ items: gone ? [] : [saved], next_cursor: null }),
          },
          {
            method: "GET",
            path: /\/findings\/f-a$/,
            status: () => (gone ? 404 : 200),
            body: () =>
              gone ? errorBody("not_found", "Finding not found") : { ...exampleFindingDetail, ...saved },
          },
        ],
      },
    );
    const head = () => within(screen.getByTestId("cloud-pins")).queryByRole("button", { name: /F-0217/ });
    await waitFor(() => expect(head()!.closest("[data-selected]")).not.toBeNull()); // arrived and selected
    gone = true;
    act(() => useChangesStore.getState().bumpFindings());
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("0"));
    expect(head()).toBeNull();
    expect(screen.getByTestId("marks")).toHaveTextContent("[]");
  });

  it("a real Enter with focus outside the form creates exactly once, through W1's routing", async () => {
    localStorage.setItem(LAST_TYPE_KEY, TYPE_SPALLING);
    const { requests } = mount({}, { routed: true });
    await userEvent.click(screen.getByRole("button", { name: "pick" }));
    await screen.findByTestId("pin-callout-create");
    blur();
    expect(document.activeElement).toBe(document.body);
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(count(requests, "POST")).toBe(1));
    await waitFor(() => expect(screen.queryByTestId("pin-callout-create")).toBeNull());
    await new Promise((r) => setTimeout(r, 50));
    expect(count(requests, "POST")).toBe(1);
  });

  it("a real Enter on a severity segment creates exactly once (the form's Enter; W1 stands aside)", async () => {
    localStorage.setItem(LAST_TYPE_KEY, TYPE_SPALLING);
    const { requests } = mount({}, { routed: true });
    await userEvent.click(screen.getByRole("button", { name: "pick" }));
    await screen.findByTestId("pin-callout-create");
    await userEvent.click(
      within(screen.getByRole("radiogroup", { name: "Severity" })).getAllByRole("radio")[0],
    );
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(count(requests, "POST")).toBe(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(count(requests, "POST")).toBe(1);
  });
});
