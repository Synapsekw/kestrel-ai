import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAP_ID, PROJECT_ID, fakeClient } from "@/test/fixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { MapWorkspace } from "./MapWorkspace";
import { registerInspector } from "./inspect/inspectorRegistry";
import { UTM33, layer } from "./test/fixtures";
import { WS, fakeView, workspaceRoutes } from "./test/workspaceScreen";

vi.mock("./view/SiteMap", async () => ({
  SiteMap: (await import("./test/workspaceScreen")).FakeSiteMap,
}));

const LAYER = layer("map", MAP_ID, {
  name: "Orthomosaic · 15 Apr 2026",
  date: "2026-04-15",
  meta: "3.0 cm",
});
const LAYERS = { frame: UTM33, items: [LAYER] };

function renderWorkspace(
  api = fakeClient(workspaceRoutes({ layers: LAYERS })).api,
  route = `/p/${PROJECT_ID}/maps`,
) {
  return renderWithProviders(
    <>
      <MapWorkspace />
      <LocationProbe />
    </>,
    { api, route, path: "/p/:projectId/maps" },
  );
}

const location = () => screen.getByTestId("location");

beforeEach(() => fakeView.fit.mockClear());
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("MapWorkspace", () => {
  it("renders the stage and the chrome, and fits the site once", async () => {
    renderWorkspace();
    expect(await screen.findByTestId("site-map")).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "Map" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Findings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /EPSG:32633/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(fakeView.fit).toHaveBeenCalledWith([500000, 4981200, 502400, 4983000]));
    expect(fakeView.fit).toHaveBeenCalledTimes(1);
    expect(location()).toHaveTextContent("r=2026-05-20");
  });

  it("L arms Distance from any topic and the open panel follows to Measure (spec §4)", async () => {
    renderWorkspace();
    await screen.findByTestId("site-map");
    expect(screen.getByRole("region", { name: "Findings" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "l" });
    expect(await screen.findByRole("region", { name: "Measure" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Findings" })).toBeNull();
    expect(screen.getByRole("button", { name: /Measure distance/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("reaches Run on the whole map from the AI topic", async () => {
    renderWorkspace();
    await screen.findByTestId("site-map");
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    const ai = await screen.findByRole("region", { name: "AI" });
    expect(within(ai).getByRole("button", { name: "Run on the whole map" })).toBeInTheDocument();
  });

  it("teaches the empty project (spec §14)", async () => {
    renderWorkspace(fakeClient(workspaceRoutes()).api);
    expect(await screen.findByText("No georeferenced data yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import an orthomosaic" })).toBeInTheDocument();
  });

  it("refuses a CRS frame it cannot read (R-W1-4) and retries", async () => {
    let reads = 0;
    const { api } = fakeClient(
      workspaceRoutes({
        layers: LAYERS,
        ws: () => (++reads === 1 ? { ...WS, frame: { ...UTM33, proj4: null } } : WS),
      }),
    );
    renderWorkspace(api);
    expect(await screen.findByText("The site coordinate system could not be read.")).toBeInTheDocument();
    expect(screen.queryByTestId("site-map")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("site-map")).toBeInTheDocument();
    expect(reads).toBe(2);
  });

  it("shows the error with Retry when the workspace cannot load", async () => {
    let fail = true;
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/map-workspace$/,
        status: () => (fail ? 500 : 200),
        body: WS,
      },
      ...workspaceRoutes({ layers: LAYERS }).slice(1),
    ]);
    renderWorkspace(api);
    const retry = await screen.findByRole("button", { name: "Retry" });
    fail = false;
    fireEvent.click(retry);
    expect(await screen.findByTestId("site-map")).toBeInTheDocument();
  });

  it("steps the survey with [ and ], cycles the compare mode with C, and ignores keys typed in a field", async () => {
    renderWorkspace();
    await screen.findByTestId("site-map");
    // The URL write proves the workspace has read the surveys and its keys are live.
    await waitFor(() => expect(location()).toHaveTextContent("r=2026-05-20"));
    fireEvent.keyDown(window, { key: "[" });
    await waitFor(() => expect(location()).toHaveTextContent("r=2026-04-15"));
    fireEvent.keyDown(window, { key: "c" });
    await waitFor(() => expect(screen.getByTestId("site-map")).toHaveAttribute("data-mode", "swipe"));
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "]" });
    input.remove();
    expect(location()).toHaveTextContent("r=2026-04-15");
  });

  it("plays through the surveys with P, 900 ms a step, and stops at the newest", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderWorkspace();
    const stage = await screen.findByTestId("site-map");
    fireEvent.keyDown(window, { key: "p" }); // r is the newest, so play restarts from the oldest
    await waitFor(() => expect(location()).toHaveTextContent("r=2026-03-01"));
    expect(stage).toHaveAttribute("data-playing", "true");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(location()).toHaveTextContent("r=2026-04-15");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(location()).toHaveTextContent("r=2026-05-20");
    expect(stage).toHaveAttribute("data-playing", "true");
    // One more step: there is no newer survey, so play stops where it is.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(location()).toHaveTextContent("r=2026-05-20");
    expect(stage).toHaveAttribute("data-playing", "false");
  });

  it("saves the view state once, 1 s after the last change", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api, requests } = fakeClient(workspaceRoutes({ layers: LAYERS }));
    renderWorkspace(api);
    await screen.findByTestId("site-map");
    fireEvent.keyDown(window, { key: "c" });
    fireEvent.keyDown(window, { key: "c" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    const puts = requests.filter((r) => r.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].body).toMatchObject({ state: { v: 1, mode: "side" } });
  });

  it("clears the selection on Esc when nothing is being drawn", async () => {
    renderWorkspace(undefined, `/p/${PROJECT_ID}/maps?sel=zone:z1`);
    await screen.findByTestId("site-map");
    // The route has the raw `sel=zone:z1`; the workspace's own (encoded) write proves it took the
    // selection from the URL, so Esc has something to clear.
    await waitFor(() => expect(location()).toHaveTextContent("sel=zone%3Az1"));
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(location()).not.toHaveTextContent("sel="));
  });

  it("asks before deleting the selection, naming its kind (Del)", async () => {
    const run = vi.fn(() => Promise.resolve());
    const unregister = registerInspector({
      id: "zone",
      label: "Zone",
      framed: true,
      Body: () => <p>zone body</p>,
      remove: { confirm: () => "It goes for good.", run },
    });
    try {
      renderWorkspace(undefined, `/p/${PROJECT_ID}/maps?sel=zone:z1`);
      await screen.findByTestId("site-map");
      fireEvent.keyDown(window, { key: "Delete" });
      const dialog = await screen.findByRole("dialog", { name: "Delete this zone?" });
      expect(dialog).toHaveTextContent("It goes for good.");
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(location()).not.toHaveTextContent("sel="));
    } finally {
      unregister();
    }
  });

  it("publishes the loaded layers to plugins and marks its frame", async () => {
    renderWorkspace();
    await screen.findByTestId("site-map");
    expect(screen.getByTestId("map-workspace")).toHaveAttribute("data-frame", "crs");
    expect(screen.getByTestId("coord-readout")).toHaveTextContent("EPSG:32633");
    expect(screen.getByTestId("tool-hint")).toHaveTextContent("Select");
  });
});
