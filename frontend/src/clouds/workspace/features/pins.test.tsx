import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { CloudPick } from "@/clouds/CloudViewer";
import type { Finding } from "@/api/findings";
import type { NavMode } from "@/clouds/viewer/types";
import { at } from "@/clouds/pins/testCamera";
import { LAST_TYPE_KEY } from "@/clouds/pins/usePinTool";
import { DEFAULT_SEAMS, WorkspaceSeamsContext } from "@/clouds/workspace/seams";
import { useChangesStore } from "@/store/changes";
import { fakeClient, PROJECT_ID, type RecordedRequest } from "@/test/fixtures";
import { baseRoutes, exampleFinding, exampleFindingDetail, TYPE_SPALLING } from "@/test/findingFixtures";
import { CLOUD_ID, exampleCloud } from "@/test/cloudFixtures";
import { TestApiProvider } from "@/test/render";
import type { FeatureContext } from "../types";
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
      <button type="button" onClick={() => tool.onCommit!()}>
        commit
      </button>
      <button type="button" onClick={() => setCancelled(String(tool.onCancel!()))}>
        esc
      </button>
      <span data-testid="cancelled">{cancelled}</span>
      <span data-testid="tool">{`${tool.id} picks=${tool.picks} canCommit=${tool.canCommit}`}</span>
      <span data-testid="count">{f.findingsTab!.count}</span>
      <span data-testid="dots">{f.minimap!.length}</span>
      <div>{f.layer}</div>
      <div>{f.floating}</div>
      <div>{f.findingsTab!.body}</div>
    </div>
  );
}

function mount(over: Partial<FeatureContext> = {}) {
  const { api, requests } = fakeClient(
    baseRoutes([
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
    showTab: vi.fn(),
    restoreClipBox: vi.fn(),
    ...over,
  };
  render(
    <TestApiProvider api={api}>
      <MemoryRouter>
        <WorkspaceSeamsContext.Provider value={DEFAULT_SEAMS}>
          <Harness ctx={ctx} />
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
    await userEvent.click(screen.getByRole("button", { name: "pick" }));
    expect(await screen.findByTestId("pin-callout-create")).toBeInTheDocument();
    expect(screen.getByTestId("tool")).toHaveTextContent("canCommit=true");
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

  it("selecting a finding opens the Findings tab; Delete asks, then deletes", async () => {
    const { requests, ctx } = mount({ activeTool: "orbit" });
    await userEvent.click(await findRow());
    expect(ctx.showTab).toHaveBeenCalledWith("findings");
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
});
