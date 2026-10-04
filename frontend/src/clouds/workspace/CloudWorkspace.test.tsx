import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient, type Job } from "@contract/client";
import { useJobsStore } from "@/store/jobs";
import { CLOUD_ID, exampleCloud } from "@/test/cloudFixtures";
import { baseRoutes, exampleFinding, exampleFindingDetail } from "@/test/findingFixtures";
import { callsTo, emitViewState, resetFake } from "@/test/fakeCloudViewer";
import { exampleGeoMap, fakeClient, fakeFetch, MAP_ID, PROJECT_ID, runningJob } from "@/test/fixtures";
import { LocationProbe, renderWithProviders, TestApiProvider } from "@/test/render";
import { useToastStore } from "@/ui";
import { useViewStore } from "@/clouds/views/viewStore";
import { clipKey } from "./clip";
import { CloudWorkspace } from "./CloudWorkspace";

vi.mock("@/clouds/CloudViewer", async () => ({
  CloudViewer: (await import("@/test/fakeCloudViewer")).FakeCloudViewer,
}));

const routes = (items: object[]) => [
  { method: "GET", path: /\/pointclouds$/, body: { items } },
  { method: "GET", path: /\/maps$/, body: { items: [] } },
  { method: "GET", path: /\/measurements$/, body: { items: [] } }, // the Measurements tab's saved list
  {
    method: "GET",
    path: /\/views$/,
    status: 501,
    body: { error: { code: "not_implemented", message: "n/a", details: {} } },
  },
];

const importInfo = {
  path: "D:\\clouds\\site.las",
  size: 737_902_645,
  compressed: false,
  las_version: "1.2",
  point_format: 3,
  point_count: 21_697_184,
  has_rgb: true,
  header_bounds: [0, 0, 0, 1, 1, 1],
  crs_wkt: "x",
  epsg: 32639,
  captured_on: null,
  admission: {
    ok: true,
    ram_needed_bytes: 1,
    ram_available_bytes: 2,
    disk_needed_bytes: 1,
    disk_available_bytes: 2,
    reason: null,
  },
};

/** While set, the project's cloud-list reads wait for it: a real list reload takes time. */
let listGate: Promise<void> | null = null;

function open(
  items: object[],
  route = `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`,
  extra: Parameters<typeof fakeClient>[0] = [],
) {
  const { fetch: answer, requests } = fakeFetch([...extra, ...routes(items)]);
  const gated = (async (input: Request | string | URL, init?: RequestInit) => {
    const gate = listGate;
    if (
      gate &&
      input instanceof Request &&
      input.method === "GET" &&
      /\/pointclouds$/.test(new URL(input.url).pathname)
    )
      await gate;
    return answer(input, init);
  }) as typeof fetch;
  const api = createApiClient({ baseUrl: "http://fake", token: "t", fetch: gated });
  renderWithProviders(
    <>
      <CloudWorkspace />
      <LocationProbe />
    </>,
    { api, route, path: "/p/:projectId/clouds/:cloudId?" },
  );
  return { api, requests };
}

/** Holds every cloud-list read from now on until the returned release is called. */
function holdListReads(): () => void {
  let release!: () => void;
  listGate = new Promise<void>((r) => {
    release = r;
  });
  return () => {
    listGate = null;
    release();
  };
}

/** Whether `text` was ever put in the DOM from now on, even for one commit (a flash). */
function watchFor(text: string) {
  let seen = false;
  const scan = (records: MutationRecord[]) => {
    for (const r of records) for (const n of r.addedNodes) if (n.textContent?.includes(text)) seen = true;
  };
  const mo = new MutationObserver(scan);
  mo.observe(document.body, { subtree: true, childList: true, characterData: true });
  return () => {
    scan(mo.takeRecords());
    mo.disconnect();
    return seen;
  };
}

const MISSING = "This point cloud is not in the project";

async function deleteFromDetails() {
  await openTopic("Layers");
  await userEvent.click(await screen.findByRole("button", { name: /^Point cloud: / }));
  await userEvent.click(screen.getByRole("button", { name: "Details…" }));
  await userEvent.click(
    within(await screen.findByTestId("cloud-details")).getByRole("button", { name: "Delete" }),
  );
  const confirm = await screen.findByRole("dialog", { name: "Are you sure?" });
  await userEvent.click(within(confirm).getByRole("button", { name: "Yes" }));
}

/** A tool button on the rail or in the open topic panel. */
const tool = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const pressed = (name: string) => tool(name).getAttribute("aria-pressed");
/** Opens a rail topic (a no-op when it is already open: a second click would close it). */
async function openTopic(name: string) {
  const rail = await screen.findByRole("toolbar", { name: "Point cloud" });
  if (screen.queryByRole("region", { name })) return;
  await userEvent.click(within(rail).getByRole("button", { name }));
  await screen.findByRole("region", { name });
}

beforeEach(() => {
  listGate = null;
  window.innerWidth = 1024; // jsdom's default; a test that needs a wide window sets its own
  resetFake();
  localStorage.clear();
});

describe("CloudWorkspace (spec §6)", () => {
  it("invites an import when the project has no clouds", async () => {
    open([], `/p/${PROJECT_ID}/clouds`);
    expect(await screen.findByText("Import a LAS or LAZ point cloud")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Point clouds" })).toBeInTheDocument();
  });

  it("opens the first ready cloud when none is named", async () => {
    const importing = { ...exampleCloud, id: "c-imp", status: "importing" };
    open([importing, exampleCloud], `/p/${PROJECT_ID}/clouds`);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/clouds/${CLOUD_ID}`),
    );
  });

  it("lays out the ready workspace: the rail in Orbit with Findings open, gizmo, readout, minimap", async () => {
    open([exampleCloud]);
    const rail = await screen.findByRole("toolbar", { name: "Point cloud" });
    expect(
      within(rail)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Orbit", "Pan", "Fly", "Layers", "Findings", "Measure", "Clip", "Photos"]);
    expect(pressed("Orbit")).toBe("true");
    expect(screen.getByRole("region", { name: "Findings" })).toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: "Findings" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("toolbar", { name: "Point cloud tools" })).toBeNull();
    expect(tool("Fly")).toBeEnabled();
    // C-P1 Task 10: the pins feature registers its tool
    expect(tool("Pin a finding")).toBeEnabled();
    for (const [topic, names] of [
      ["Measure", ["Point", "Distance", "Height", "Verticality", "Area", "Cross-section"]],
      ["Clip", ["Clipping box"]],
      ["Photos", ["Photo link"]],
    ] as const) {
      await openTopic(topic);
      for (const name of names) expect(tool(name), name).toBeEnabled();
    }
    // Spec §3.2: the inspector shows a selection only; nothing is selected yet.
    expect(screen.queryByTestId("cloud-inspector")).toBeNull();
    await openTopic("Layers");
    for (const id of ["cloud-panel", "cloud-gizmo", "cloud-readout", "cloud-minimap", "cloud-hintbar"])
      expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Point clouds" })).toBeInTheDocument();
    expect(screen.getByTestId("cloud-points-shown")).toHaveTextContent("2.4 M shown");
  });

  it("arms Distance from L, opens the Measure topic, and Esc twice returns to Orbit", async () => {
    open([exampleCloud]);
    await screen.findByRole("toolbar", { name: "Point cloud" });
    await userEvent.keyboard("l");
    expect(screen.getByRole("region", { name: "Measure" })).toBeInTheDocument();
    expect(pressed("Distance")).toBe("true");
    expect(screen.getByTestId("cloud-hintbar")).toHaveTextContent("Click two points to measure a distance");
    expect(screen.getByTestId("cloud-viewer")).toHaveAttribute("data-armed", "true");
    await userEvent.click(screen.getByRole("button", { name: "fake pick" }));
    expect(screen.getByTestId("cloud-readout")).toHaveTextContent("E243500.50");
    await userEvent.keyboard("{Escape}");
    expect(pressed("Distance")).toBe("true");
    await userEvent.keyboard("{Escape}");
    expect(pressed("Orbit")).toBe("true");
  });

  it("a cloud switch puts the tool down and loads that cloud's own clip box", async () => {
    const other = { ...exampleCloud, id: "c-2", name: "Tower" };
    localStorage.setItem(
      clipKey("c-2"),
      JSON.stringify({ centre: [1, 2, 3], size: [4, 5, 6], yaw_deg: 0, mode: "show_inside" }),
    );
    open([exampleCloud, other]);
    await screen.findByRole("toolbar", { name: "Point cloud" });
    await userEvent.keyboard("c");
    await userEvent.click(screen.getByRole("button", { name: "fake pick" }));
    expect(callsTo("setClipBox").at(-1)?.[0]).toMatchObject({ centre: [243500.5, 3178000.25, 12.5] });
    await openTopic("Layers");
    await userEvent.click(screen.getByRole("button", { name: /^Point cloud: / }));
    await userEvent.click(screen.getByRole("link", { name: /Tower/ }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/clouds/c-2"));
    await waitFor(() => expect(pressed("Orbit")).toBe("true"));
    expect(callsTo("setClipBox").at(-1)?.[0]).toMatchObject({ centre: [1, 2, 3] });
  });

  it("drives the engine from the cloud panel: EDL, classes and the budget key", async () => {
    open([{ ...exampleCloud, class_counts: { "2": 10, "6": 5 } }]);
    await openTopic("Layers");
    await userEvent.click(screen.getByRole("switch", { name: "EDL shading" }));
    expect(callsTo("setEdl").at(-1)).toEqual([false]);
    await userEvent.click(screen.getByRole("radio", { name: "Class" }));
    expect(screen.getByTestId("cloud-viewer")).toHaveAttribute("data-colour", "classification");
    await userEvent.click(screen.getByRole("button", { name: /Building/ }));
    expect([...(callsTo("setClassVisibility").at(-1)![0] as Set<number>)]).toEqual([6]);
    const budget = screen.getByRole("slider", { name: "Point budget" });
    budget.focus();
    await userEvent.keyboard("{End}");
    expect(localStorage.getItem("kestrel.clouds.pointBudget")).toBe("8000000");
  });

  it("leaves Space to a focused panel control: the EDL switch toggles and the view never pans", async () => {
    open([exampleCloud]);
    await openTopic("Layers");
    const edl = screen.getByRole("switch", { name: "EDL shading" });
    const before = edl.getAttribute("aria-checked");
    edl.focus();
    await userEvent.keyboard(" ");
    expect(edl.getAttribute("aria-checked")).not.toBe(before);
    expect(callsTo("setNavMode").some(([m]) => m === "pan")).toBe(false);
  });

  it("holds Space to pan from the body or the viewport itself, never from its controls", async () => {
    open([exampleCloud]);
    await screen.findByRole("toolbar", { name: "Point cloud" });
    const pans = () => callsTo("setNavMode").filter(([m]) => m === "pan").length;
    fireEvent.keyDown(document.body, { key: " " });
    expect(pans()).toBe(1);
    fireEvent.keyUp(document.body, { key: " " });
    fireEvent.keyDown(screen.getByTestId("cloud-viewer"), { key: " " });
    expect(pans()).toBe(2);
    fireEvent.keyUp(document.body, { key: " " });
    fireEvent.keyDown(screen.getByRole("button", { name: "fake pick" }), { key: " " });
    expect(pans()).toBe(2);
  });

  it("re-applies the EDL switch whenever the view (re)starts", async () => {
    open([exampleCloud]);
    await openTopic("Layers");
    await userEvent.click(screen.getByRole("switch", { name: "EDL shading" }));
    const before = callsTo("setEdl").length;
    act(() => emitViewState("running")); // a new engine after "Reload view" starts with the global EDL default
    expect(callsTo("setEdl").length).toBeGreaterThan(before);
    expect(callsTo("setEdl").at(-1)).toEqual([false]);
  });

  it("asks the engine for a frame once the panels around the view are laid out", async () => {
    open([exampleCloud]);
    await screen.findByTestId("cloud-gizmo");
    await waitFor(() => expect(callsTo("requestRender").length).toBeGreaterThan(0));
  });

  it("offers Show on map only while a pick is held and the cloud has a linked map", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/maps$/, body: { items: [exampleGeoMap] } },
      ...routes([{ ...exampleCloud, map_id: MAP_ID }]),
    ]);
    // The workspace jump lands outside CloudWorkspace's own route (it's a query-string arrival on
    // the maps route now, not a path segment), so a second Route stands in for it, the way the
    // real router would swap trees; the probe renders either way.
    render(
      <TestApiProvider api={api}>
        <MemoryRouter initialEntries={[`/p/${PROJECT_ID}/clouds/${CLOUD_ID}`]}>
          <Routes>
            <Route
              path="/p/:projectId/clouds/:cloudId?"
              element={
                <>
                  <CloudWorkspace />
                  <LocationProbe />
                </>
              }
            />
            <Route path="/p/:projectId/maps" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </TestApiProvider>,
    );
    await screen.findByRole("toolbar", { name: "Point cloud" });
    expect(screen.queryByRole("button", { name: "Show on map" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "fake pick" }));
    await userEvent.click(await screen.findByRole("button", { name: "Show on map" }));
    expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/maps?map=${MAP_ID}&at=`);
  });

  it("has no Show on map without a linked map, even with a pick", async () => {
    open([exampleCloud]);
    await screen.findByRole("toolbar", { name: "Point cloud" });
    await userEvent.click(screen.getByRole("button", { name: "fake pick" }));
    expect(screen.getByTestId("cloud-readout")).toHaveTextContent("E243500.50");
    expect(screen.queryByRole("button", { name: "Show on map" })).toBeNull();
  });

  it("moves to a jump's spot only after the octree has loaded (its whole-site view would undo it)", async () => {
    resetFake({ availability: null }); // running, but onAttributes (the load) never arrives
    open([exampleCloud], `/p/${PROJECT_ID}/clouds/${CLOUD_ID}?at=243500,3178000`);
    await screen.findByRole("toolbar", { name: "Point cloud" });
    await new Promise((r) => setTimeout(r, 450));
    expect(callsTo("lookAt")).toHaveLength(0);
  });

  it("moves to a jump's spot once the octree has loaded", async () => {
    open([exampleCloud], `/p/${PROJECT_ID}/clouds/${CLOUD_ID}?at=243500,3178000`);
    await screen.findByRole("toolbar", { name: "Point cloud" });
    await waitFor(() => expect(callsTo("lookAt").at(0)?.[0]).toMatchObject({ x: 243500, y: 3178000 }));
  });

  it("without WebGL only the picker renders, in its own panel (no rail, nothing selected)", async () => {
    resetFake({ state: "no-webgl" });
    open([exampleCloud]);
    expect(await screen.findByRole("button", { name: /^Point cloud: / })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Point cloud" })).toBeInTheDocument();
    expect(screen.queryByTestId("cloud-inspector")).toBeNull();
    for (const id of ["cloud-readout", "cloud-minimap", "cloud-gizmo", "cloud-hintbar", "cloud-points-shown"])
      expect(screen.queryByTestId(id)).toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Point cloud" })).toBeNull();
  });

  it("a lost context keeps the tool", async () => {
    resetFake({ state: "lost" });
    open([exampleCloud]);
    await openTopic("Measure");
    await userEvent.click(tool("Distance"));
    expect(pressed("Distance")).toBe("true");
    expect(screen.getByTestId("cloud-readout")).toBeInTheDocument();
  });

  it("opens a cloud without colour in Elevation, with RGB off (ported from S1)", async () => {
    resetFake({ availability: { rgb: false, elevation: true, intensity: false, classification: false } });
    open([{ ...exampleCloud, has_rgb: false }]);
    await openTopic("Layers");
    expect(screen.getByRole("radio", { name: "RGB" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Elevation" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Lowest")).toHaveValue(-44);
    expect(screen.getByLabelText("Highest")).toHaveValue(170);
  });

  it("seeds the render settings afresh when an importing cloud becomes ready (ported from S1)", async () => {
    const importJob: Job = { ...runningJob, id: "j-import-1", type: "pointcloud_import", state: "running" };
    useJobsStore.getState().upsert(importJob);
    const importing = {
      ...exampleCloud,
      status: "importing",
      has_rgb: null,
      z_stats: null,
      bounds_native: null,
      point_count: null,
      job_id: importJob.id,
    };
    let lists = 0;
    open([], `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`, [
      {
        method: "GET",
        path: /\/pointclouds$/,
        body: () => ({ items: [lists++ === 0 ? importing : exampleCloud] }),
      },
      { method: "GET", path: /\/jobs\/j-import-1$/, body: { ...importJob, state: "succeeded", progress: 1 } },
    ]);
    // The importing card is shown until the poll answers the import finished and the list reloads.
    expect(
      await screen.findByRole("toolbar", { name: "Point cloud" }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(lists).toBeGreaterThanOrEqual(2);
    await openTopic("Layers");
    expect(screen.getByRole("radio", { name: "RGB" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("radio", { name: "Elevation" }));
    expect(screen.getByLabelText("Lowest")).toHaveValue(-44);
  }, 10_000);

  it("says what an importing cloud is doing, with the picker still there", async () => {
    open([{ ...exampleCloud, status: "importing", z_stats: null, has_rgb: null }]);
    expect(await screen.findByTestId("cloud-importing")).toHaveTextContent("Building the 3D view copy…");
    expect(screen.queryByRole("toolbar", { name: "Point cloud" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Point cloud: / })).toBeInTheDocument();
  });

  it("says why a failed cloud could not be imported, with the picker still there", async () => {
    open([{ ...exampleCloud, status: "failed", error: "the file has no points" }]);
    const card = await screen.findByTestId("cloud-failed");
    expect(card).toHaveTextContent(`${exampleCloud.name} could not be imported`);
    expect(card).toHaveTextContent("the file has no points");
    expect(screen.queryByRole("toolbar", { name: "Point cloud" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Point cloud: / })).toBeInTheDocument();
  });

  it("deleting the open cloud from Details lands on the other ready cloud, never on the deleted one", async () => {
    const other = { ...exampleCloud, id: "c-2", name: "Tower" };
    let deleted = false;
    open([], `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`, [
      {
        method: "DELETE",
        path: new RegExp(`/pointclouds/${CLOUD_ID}$`),
        status: 204,
        body: () => ((deleted = true), null),
      },
      {
        method: "GET",
        path: /\/pointclouds$/,
        body: () => ({ items: deleted ? [other] : [exampleCloud, other] }),
      },
    ]);
    await screen.findByRole("toolbar", { name: "Point cloud" });
    const missingSeen = watchFor(MISSING);
    const release = holdListReads(); // the reload after the delete has not answered yet
    await deleteFromDetails();
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/clouds/c-2`),
    );
    await screen.findByRole("toolbar", { name: "Point cloud" });
    act(() => release());
    await new Promise((r) => setTimeout(r, 50)); // the list reload lands
    expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/clouds/c-2`);
    expect(missingSeen()).toBe(false);
  });

  it("deleting a different cloud from the picker stays on the open one", async () => {
    const tower = { ...exampleCloud, id: "c-2", name: "Tower" };
    const west = { ...exampleCloud, id: "c-3", name: "West" };
    let deleted = false;
    const { requests } = open([], `/p/${PROJECT_ID}/clouds/c-2`, [
      {
        method: "DELETE",
        path: new RegExp(`/pointclouds/c-3$`),
        status: 204,
        body: () => ((deleted = true), null),
      },
      {
        method: "GET",
        path: /\/pointclouds$/,
        body: () => ({ items: deleted ? [exampleCloud, tower] : [exampleCloud, tower, west] }),
      },
    ]);
    await screen.findByRole("toolbar", { name: "Point cloud" });
    await openTopic("Layers");
    await userEvent.click(await screen.findByRole("button", { name: /^Point cloud: / }));
    await userEvent.click(screen.getByRole("button", { name: "Delete West" }));
    const confirm = await screen.findByRole("dialog", { name: "Are you sure?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Yes" }));
    await waitFor(() =>
      expect(requests.some((r) => r.method === "DELETE" && r.url.includes("/pointclouds/c-3"))).toBe(true),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/clouds/c-2`);
  });

  it("deleting the last cloud lands on the page-layout empty state at /clouds", async () => {
    let deleted = false;
    open([], `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`, [
      {
        method: "DELETE",
        path: new RegExp(`/pointclouds/${CLOUD_ID}$`),
        status: 204,
        body: () => ((deleted = true), null),
      },
      { method: "GET", path: /\/pointclouds$/, body: () => ({ items: deleted ? [] : [exampleCloud] }) },
    ]);
    await screen.findByRole("toolbar", { name: "Point cloud" });
    const missingSeen = watchFor(MISSING);
    const release = holdListReads();
    await deleteFromDetails();
    expect(await screen.findByText("Import a LAS or LAZ point cloud")).toBeInTheDocument();
    act(() => release());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId("location").textContent).toMatch(new RegExp(`/p/${PROJECT_ID}/clouds$`));
    expect(missingSeen()).toBe(false);
  });

  it("a cloud id in an empty project goes to /clouds (the page layout, tabs reachable)", async () => {
    open([], `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`);
    expect(await screen.findByText("Import a LAS or LAZ point cloud")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toMatch(new RegExp(`/p/${PROJECT_ID}/clouds$`)),
    );
  });

  it("starting an import opens the new cloud without a not-in-the-project flash", async () => {
    const fresh = {
      ...exampleCloud,
      id: "c-new",
      name: "Chimney",
      status: "importing",
      z_stats: null,
      has_rgb: null,
    };
    const importJob: Job = { ...runningJob, id: "j-import-5", type: "pointcloud_import", state: "running" };
    let started = false;
    open([], `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`, [
      { method: "POST", path: /\/pointclouds\/inspect$/, body: importInfo },
      {
        method: "POST",
        path: /\/pointclouds$/,
        status: 202,
        body: () => ((started = true), { cloud: fresh, job: importJob }),
      },
      {
        method: "GET",
        path: /\/pointclouds$/,
        body: () => ({ items: started ? [exampleCloud, fresh] : [exampleCloud] }),
      },
      { method: "GET", path: /\/jobs\/j-import-5$/, body: importJob },
    ]);
    await openTopic("Layers");
    await userEvent.click(await screen.findByRole("button", { name: /^Point cloud: / }));
    await userEvent.click(screen.getByRole("button", { name: "Import point cloud…" }));
    const missingSeen = watchFor(MISSING);
    await userEvent.type(screen.getByLabelText("LAS or LAZ file"), "D:\\clouds\\site.las");
    await screen.findByText("21.7 M points");
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Import point cloud" })).getByRole("button", {
        name: "Import",
      }),
    );
    expect(await screen.findByTestId("cloud-importing")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/clouds/c-new`);
    expect(missingSeen()).toBe(false);
  });

  it("names a cloud that is not in the project", async () => {
    open([exampleCloud], `/p/${PROJECT_ID}/clouds/nope`);
    expect(await screen.findByText("This point cloud is not in the project")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: `Open ${exampleCloud.name}` }));
    expect(screen.getByTestId("location")).toHaveTextContent(`/clouds/${CLOUD_ID}`);
  });

  it("Import again keeps the failed cloud's map link and capture date", async () => {
    const failed = {
      ...exampleCloud,
      status: "failed",
      error: "interrupted",
      map_id: "m-1",
      captured_on: "2026-05-04",
    };
    const fresh = { ...exampleCloud, id: "c-new", status: "importing", map_id: "m-1", captured_on: null };
    const importJob: Job = { ...runningJob, id: "j-import-9", type: "pointcloud_import", state: "queued" };
    const { requests } = open([failed], `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`, [
      { method: "POST", path: /\/pointclouds$/, status: 202, body: { cloud: fresh, job: importJob } },
      { method: "PATCH", path: /\/pointclouds\/c-new$/, body: { ...fresh, captured_on: "2026-05-04" } },
      { method: "DELETE", path: new RegExp(`/pointclouds/${CLOUD_ID}$`), status: 204 },
      { method: "GET", path: /\/jobs\/j-import-9$/, body: importJob },
    ]);
    expect(await screen.findByTestId("cloud-failed")).toHaveTextContent("interrupted");
    await userEvent.click(screen.getByRole("button", { name: "Import again" }));
    await waitFor(() => expect(requests.some((r) => r.method === "DELETE")).toBe(true));
    expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/clouds/c-new`);
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({
      path: failed.source_path,
      name: failed.name,
      map_id: "m-1",
    });
    expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({ captured_on: "2026-05-04" });
  });

  it("toasts a finished LAZ export after the Details dialog closed", async () => {
    const exportJob: Job = { ...runningJob, id: "j-export-1", type: "pointcloud_export", state: "queued" };
    let done = false;
    const { requests } = open([exampleCloud], `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`, [
      { method: "POST", path: /\/exports$/, status: 202, body: { job: exportJob } },
      {
        method: "GET",
        path: /\/jobs\/j-export-1$/,
        body: () =>
          done
            ? { ...exportJob, state: "succeeded", progress: 1, result: { folder: "exports/x" } }
            : { ...exportJob, state: "running" },
      },
    ]);
    useToastStore.getState().clear();
    await openTopic("Layers");
    await userEvent.click(await screen.findByRole("button", { name: /^Point cloud: / }));
    await userEvent.click(screen.getByRole("button", { name: "Details…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Export LAZ" }));
    await waitFor(() => expect(requests.some((r) => r.url.endsWith("/jobs/j-export-1"))).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    done = true;
    await waitFor(
      () =>
        expect(
          useToastStore.getState().toasts.find((t) => t.text === "LAZ export finished")?.action?.label,
        ).toBe("Show folder"),
      { timeout: 5000 },
    );
  }, 10_000);

  it("keeps following a LAZ export that was running before the workspace opened", async () => {
    const exportJob: Job = {
      ...runningJob,
      id: "j-export-2",
      type: "pointcloud_export",
      state: "running",
      project_id: PROJECT_ID,
      params: { cloud_id: CLOUD_ID },
    };
    useJobsStore.getState().upsert(exportJob);
    useToastStore.getState().clear();
    let done = false;
    open([exampleCloud], `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`, [
      {
        method: "GET",
        path: /\/jobs\/j-export-2$/,
        body: () =>
          done
            ? { ...exportJob, state: "succeeded", progress: 1, result: { folder: "exports/y" } }
            : exportJob,
      },
    ]);
    // Details knows the seeded export is still running: no second export can start.
    await openTopic("Layers");
    await userEvent.click(await screen.findByRole("button", { name: /^Point cloud: / }));
    await userEvent.click(screen.getByRole("button", { name: "Details…" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Export LAZ" })).toHaveAttribute("aria-busy", "true"),
    );
    done = true;
    await waitFor(
      () =>
        expect(useToastStore.getState().toasts.find((t) => t.text === "LAZ export finished")).toBeDefined(),
      { timeout: 5000 },
    );
  }, 10_000);

  it("shows R1's Capture missing views item and the Saving views progress (C-R1)", async () => {
    open([exampleCloud]);
    const findings = await screen.findByRole("region", { name: "Findings" });
    await userEvent.click(within(findings).getByRole("button", { name: "Findings actions" }));
    expect(await screen.findByRole("menuitem", { name: "Capture missing views" })).toBeInTheDocument();
    act(() => useViewStore.getState().setBulk({ done: 1, total: 3 }));
    expect(await screen.findByText("Saving views 1 / 3")).toBeInTheDocument();
  });
  it("the Layers topic holds the colour mode, the render rows and Show camera positions", async () => {
    open([exampleCloud]);
    await openTopic("Layers");
    const layers = screen.getByRole("region", { name: "Layers" });
    expect(within(layers).getByRole("button", { name: /^Point cloud: / })).toBeInTheDocument();
    expect(within(layers).getByRole("radiogroup", { name: "Colour by" })).toBeInTheDocument();
    expect(within(layers).getByRole("switch", { name: "EDL shading" })).toBeInTheDocument();
    expect(await within(layers).findByRole("switch", { name: "Show camera positions" })).toBeInTheDocument();
  });

  it("selecting a pin shows the finding in the inspector while the Findings list stays in the rail", async () => {
    const saved = {
      ...exampleFinding,
      id: "f-a",
      number: 217,
      anchor: { kind: "cloud", cloud_id: CLOUD_ID, x: 243500, y: 3178000, z: 12, uncertainty_m: 0.05 },
      data_type: "point_cloud",
      data_id: CLOUD_ID,
    };
    open(
      [exampleCloud],
      undefined,
      baseRoutes([
        { method: "GET", path: /\/findings$/, body: { items: [saved], next_cursor: null } },
        { method: "GET", path: /\/findings\/f-a$/, body: { ...exampleFindingDetail, ...saved } },
        { method: "GET", path: /\/findings\/f-a\/attachments$/, body: { items: [] } },
        { method: "GET", path: /\/findings\/f-a\/comments/, body: { items: [], next_cursor: null } },
        { method: "GET", path: /\/activity/, body: { items: [], next_cursor: null } },
      ]),
    );
    // A wide window: below 1200 px the inspector takes the panel's room (spec §4 "Narrow windows").
    window.innerWidth = 1600;
    const findings = await screen.findByRole("region", { name: "Findings" });
    expect(within(findings).getByRole("heading", { name: "Findings" })).toBeInTheDocument();
    const list = await within(findings).findByRole("list", { name: "Findings on this cloud" });
    await userEvent.click(within(list).getByRole("button", { name: /F-0217/ }));
    const inspector = await screen.findByRole("complementary", { name: "Inspector" });
    expect(await within(inspector).findByRole("button", { name: "Move pin" })).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
    // The list stays in the rail panel, not in the inspector.
    expect(within(inspector).queryByRole("list", { name: "Findings on this cloud" })).toBeNull();
    expect(
      within(screen.getByRole("region", { name: "Findings" })).getByRole("list", {
        name: "Findings on this cloud",
      }),
    ).toBeInTheDocument();
  });
});
