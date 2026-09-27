import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@contract/client";
import { useJobsStore } from "@/store/jobs";
import { CLOUD_ID, exampleCloud } from "@/test/cloudFixtures";
import { callsTo, emitViewState, resetFake } from "@/test/fakeCloudViewer";
import { exampleGeoMap, fakeClient, MAP_ID, PROJECT_ID, runningJob } from "@/test/fixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { useToastStore } from "@/ui";
import { clipKey } from "./clip";
import { CloudWorkspace } from "./CloudWorkspace";

vi.mock("@/clouds/CloudViewer", async () => ({
  CloudViewer: (await import("@/test/fakeCloudViewer")).FakeCloudViewer,
}));

const routes = (items: object[]) => [
  { method: "GET", path: /\/pointclouds$/, body: { items } },
  { method: "GET", path: /\/maps$/, body: { items: [] } },
  { method: "GET", path: /\/measurements$/, body: { items: [] } }, // S1's MeasurePanel in the Measurements tab
  {
    method: "GET",
    path: /\/views$/,
    status: 501,
    body: { error: { code: "not_implemented", message: "n/a", details: {} } },
  },
];

function open(
  items: object[],
  route = `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`,
  extra: Parameters<typeof fakeClient>[0] = [],
) {
  const client = fakeClient([...extra, ...routes(items)]);
  renderWithProviders(
    <>
      <CloudWorkspace />
      <LocationProbe />
    </>,
    { api: client.api, route, path: "/p/:projectId/clouds/:cloudId?" },
  );
  return client;
}

const toolbar = () => screen.getByRole("toolbar", { name: "Point cloud tools" });
const pressed = (name: string) =>
  toolbar().querySelector(`[aria-label="${name}"]`)!.getAttribute("aria-pressed");

beforeEach(() => {
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

  it("lays out the ready workspace: palette in Orbit, panel, inspector, gizmo, readout, minimap", async () => {
    open([exampleCloud]);
    expect(await screen.findByRole("toolbar", { name: "Point cloud tools" })).toBeInTheDocument();
    expect(pressed("Orbit")).toBe("true");
    for (const [name, enabled] of [
      ["Fly", true],
      ["Distance", true],
      ["Clipping box", true],
      ["Area", false],
      ["Cross-section", false],
      ["Pin a finding", false],
      ["Photo link", false],
    ] as const)
      expect(toolbar().querySelector(`[aria-label="${name}"]`)!.hasAttribute("disabled"), name).toBe(
        !enabled,
      );
    for (const id of [
      "cloud-panel",
      "cloud-inspector",
      "cloud-gizmo",
      "cloud-readout",
      "cloud-minimap",
      "cloud-hintbar",
    ])
      expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Point clouds" })).toBeInTheDocument();
    expect(screen.getByTestId("cloud-points-shown")).toHaveTextContent("2.4 M shown");
  });

  it("arms Distance from L, opens the Measurements tab, and Esc twice returns to Orbit", async () => {
    open([exampleCloud]);
    await screen.findByRole("toolbar", { name: "Point cloud tools" });
    await userEvent.keyboard("l");
    expect(pressed("Distance")).toBe("true");
    expect(screen.getByTestId("cloud-hintbar")).toHaveTextContent("Click two points to measure a distance");
    expect(screen.getByRole("tab", { name: /Measurements/ })).toHaveAttribute("aria-selected", "true");
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
    await screen.findByRole("toolbar", { name: "Point cloud tools" });
    await userEvent.keyboard("c");
    await userEvent.click(screen.getByRole("button", { name: "fake pick" }));
    expect(callsTo("setClipBox").at(-1)?.[0]).toMatchObject({ centre: [243500.5, 3178000.25, 12.5] });
    await userEvent.click(screen.getByRole("button", { name: /^Point cloud: / }));
    await userEvent.click(screen.getByRole("link", { name: /Tower/ }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/clouds/c-2"));
    await waitFor(() => expect(pressed("Orbit")).toBe("true"));
    expect(callsTo("setClipBox").at(-1)?.[0]).toMatchObject({ centre: [1, 2, 3] });
  });

  it("drives the engine from the cloud panel: EDL, classes and the budget key", async () => {
    open([{ ...exampleCloud, class_counts: { "2": 10, "6": 5 } }]);
    await screen.findByRole("toolbar", { name: "Point cloud tools" });
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

  it("re-applies the EDL switch whenever the view (re)starts", async () => {
    open([exampleCloud]);
    await screen.findByRole("toolbar", { name: "Point cloud tools" });
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
    // A path that also matches the maps route, so the probe is still there after the jump.
    renderWithProviders(
      <>
        <CloudWorkspace />
        <LocationProbe />
      </>,
      { api, route: `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`, path: "/p/:projectId/:section/:cloudId?" },
    );
    await screen.findByRole("toolbar", { name: "Point cloud tools" });
    expect(screen.queryByRole("button", { name: "Show on map" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "fake pick" }));
    await userEvent.click(await screen.findByRole("button", { name: "Show on map" }));
    expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/maps/${MAP_ID}?at=`);
  });

  it("has no Show on map without a linked map, even with a pick", async () => {
    open([exampleCloud]);
    await screen.findByRole("toolbar", { name: "Point cloud tools" });
    await userEvent.click(screen.getByRole("button", { name: "fake pick" }));
    expect(screen.getByTestId("cloud-readout")).toHaveTextContent("E243500.50");
    expect(screen.queryByRole("button", { name: "Show on map" })).toBeNull();
  });

  it("moves to a jump's spot only after the octree has loaded (its whole-site view would undo it)", async () => {
    resetFake({ availability: null }); // running, but onAttributes (the load) never arrives
    open([exampleCloud], `/p/${PROJECT_ID}/clouds/${CLOUD_ID}?at=243500,3178000`);
    await screen.findByRole("toolbar", { name: "Point cloud tools" });
    await new Promise((r) => setTimeout(r, 450));
    expect(callsTo("lookAt")).toHaveLength(0);
  });

  it("moves to a jump's spot once the octree has loaded", async () => {
    open([exampleCloud], `/p/${PROJECT_ID}/clouds/${CLOUD_ID}?at=243500,3178000`);
    await screen.findByRole("toolbar", { name: "Point cloud tools" });
    await waitFor(() => expect(callsTo("lookAt").at(0)?.[0]).toMatchObject({ x: 243500, y: 3178000 }));
  });

  it("without WebGL only the picker and the inspector render", async () => {
    resetFake({ state: "no-webgl" });
    open([exampleCloud]);
    expect(await screen.findByTestId("cloud-inspector")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Point cloud: / })).toBeInTheDocument();
    for (const id of ["cloud-readout", "cloud-minimap", "cloud-gizmo", "cloud-hintbar", "cloud-points-shown"])
      expect(screen.queryByTestId(id)).toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Point cloud tools" })).toBeNull();
  });

  it("a lost context keeps the tool", async () => {
    resetFake({ state: "lost" });
    open([exampleCloud]);
    await screen.findByRole("toolbar", { name: "Point cloud tools" });
    await userEvent.click(toolbar().querySelector('[aria-label="Distance"]')!);
    expect(pressed("Distance")).toBe("true");
    expect(screen.getByTestId("cloud-readout")).toBeInTheDocument();
  });

  it("opens a cloud without colour in Elevation, with RGB off (ported from S1)", async () => {
    resetFake({ availability: { rgb: false, elevation: true, intensity: false, classification: false } });
    open([{ ...exampleCloud, has_rgb: false }]);
    await screen.findByRole("toolbar", { name: "Point cloud tools" });
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
      await screen.findByRole("toolbar", { name: "Point cloud tools" }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(lists).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("radio", { name: "RGB" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("radio", { name: "Elevation" }));
    expect(screen.getByLabelText("Lowest")).toHaveValue(-44);
  }, 10_000);

  it("says what an importing or a failed cloud is doing, with the picker still there", async () => {
    open([{ ...exampleCloud, status: "importing", z_stats: null, has_rgb: null }]);
    expect(await screen.findByTestId("cloud-importing")).toHaveTextContent("Building the 3D view copy…");
    expect(screen.queryByRole("toolbar", { name: "Point cloud tools" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Point cloud: / })).toBeInTheDocument();
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
    open([exampleCloud], `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`, [
      {
        method: "GET",
        path: /\/jobs\/j-export-2$/,
        body: { ...exportJob, state: "succeeded", progress: 1, result: { folder: "exports/y" } },
      },
    ]);
    await waitFor(
      () =>
        expect(useToastStore.getState().toasts.find((t) => t.text === "LAZ export finished")).toBeDefined(),
      { timeout: 5000 },
    );
  }, 10_000);
});
