import { StrictMode } from "react";
import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { VolumeMeasurement } from "@contract/client";
import { fakeClient, runningJob, type FakeRoute } from "@/test/fixtures";
import { MEASUREMENT_ID, exampleMeasurement, exampleSurface } from "@/test/volumeFixtures";
import { useToastStore } from "@/ui";
import { useTools, type MapTool, type SiteFrame } from "@/mapws/w4host";
import { makeStores, renderInWorkspace } from "../test/harness";
import { UTM33, layer } from "../test/fixtures";
import volumeTool from "../tools/volume.tool";
import { VolumeDrawOverlay } from "./VolumeDrawOverlay";
import { useVolumeStore } from "./volumeStore";

/** The frame of exampleSurface (UTM 39N), so masks may be drawn in it. */
const UTM39: SiteFrame = {
  kind: "crs",
  crs_wkt: exampleSurface.crs_wkt,
  epsg: 32639,
  name: "WGS 84 / UTM zone 39N",
  proj4: exampleSurface.proj4,
};
const R = "2026-09-14";
const TOOLS: Record<string, MapTool> = {
  volume: volumeTool,
  select: { ...volumeTool, id: "select", draw: { shape: "none" }, Overlay: undefined },
};
const RING: [number, number][] = [
  [10, 20],
  [30, 20],
  [30, 40],
];

/** Mounts the Overlay only while the Volume tool is active, as MapWorkspace does. */
function Host({ frame }: { frame: SiteFrame }) {
  const active = useTools((s) => s.active);
  return active === "volume" ? <VolumeDrawOverlay projectId="p" frame={frame} /> : null;
}

function setup(routes: FakeRoute[], frame: SiteFrame = UTM33, strict = false) {
  const stores = makeStores({ frame, lookup: (id) => TOOLS[id] });
  stores.workspace
    .getState()
    .setLayers([layer("surface", "s-top", { date: R, surface_kind: "cloud_dsm" })], false);
  const client = fakeClient(routes);
  const ui = <Host frame={frame} />;
  const view = renderInWorkspace(strict ? <StrictMode>{ui}</StrictMode> : ui, { stores, api: client.api });
  return { ...view, requests: client.requests };
}

function complete(stores: ReturnType<typeof makeStores>) {
  act(() => {
    stores.tools.setState({
      completed: {
        toolId: "volume",
        geometry: { type: "Polygon", coordinates: [[...RING, RING[0]]] },
      },
    });
  });
}

const maskRoutes = (m: VolumeMeasurement = exampleMeasurement): FakeRoute[] => [
  { method: "GET", path: /\/volumes\/[^/]+$/, body: m },
  { method: "GET", path: /\/surfaces$/, body: { items: [exampleSurface] } },
  { method: "PATCH", path: /\/volumes\/[^/]+$/, body: { ...m, status: "stale" } },
  {
    method: "POST",
    path: /\/calculate$/,
    status: 202,
    body: {
      measurement: { ...m, status: "calculating", job_id: runningJob.id },
      job: { ...runningJob, type: "volume_calc" },
    },
  },
];

describe("VolumeDrawOverlay", () => {
  beforeEach(() => {
    localStorage.clear();
    useVolumeStore.setState({ autoRecalc: true, heatmap: true, drawing: null });
    useToastStore.setState({ toasts: [] });
  });

  it("creates a volume from the finished polygon, opens it and goes back to Select", async () => {
    const created = { ...exampleMeasurement, id: "v-new" };
    const { stores, requests } = setup([
      { method: "GET", path: /\/volumes$/, body: { items: [] } },
      {
        method: "POST",
        path: /\/volumes$/,
        status: 202,
        body: { measurement: created, job: runningJob },
      },
    ]);
    act(() => stores.tools.getState().activate("volume"));
    complete(stores);
    await waitFor(() =>
      expect(stores.workspace.getState().selection).toEqual({ kind: "volume", id: "v-new" }),
    );
    expect(stores.tools.getState().active).toBe("select");
    expect(stores.tools.getState().completed).toBeNull();
    const post = requests.find((q) => q.method === "POST");
    expect(post?.body).toEqual({
      name: "Pile 1",
      polygon_site: RING,
      top_surface_id: "s-top",
      base: { kind: "toe_plane" },
    });
  });

  it("draws an exclusion on the selected volume instead of creating one", async () => {
    const { stores, requests } = setup(maskRoutes(), UTM39);
    act(() => {
      stores.workspace.getState().select({ kind: "volume", id: MEASUREMENT_ID });
      useVolumeStore.getState().setDrawing("exclusion");
      stores.tools.getState().activate("volume");
    });
    complete(stores);
    await waitFor(() => expect(requests.some((q) => q.url.endsWith("/calculate"))).toBe(true));
    const patch = requests.find((q) => q.method === "PATCH");
    expect(patch?.body).toEqual({
      masks: {
        exclusion_polygons: [{ id: expect.any(String), ring: RING, mode: "patch" }],
      },
    });
    expect(requests.some((q) => q.method === "POST" && /\/volumes$/.test(q.url))).toBe(false);
    expect(useVolumeStore.getState().drawing).toBeNull();
    expect(stores.tools.getState().active).toBe("select");
    expect(stores.workspace.getState().selection).toEqual({ kind: "volume", id: MEASUREMENT_ID });
  });

  it("draws the stable area as the alignment polygon", async () => {
    const { stores, requests } = setup(maskRoutes(), UTM39);
    act(() => {
      stores.workspace.getState().select({ kind: "volume", id: MEASUREMENT_ID });
      useVolumeStore.getState().setDrawing("stable");
      stores.tools.getState().activate("volume");
    });
    complete(stores);
    await waitFor(() => expect(requests.some((q) => q.method === "PATCH")).toBe(true));
    expect(requests.find((q) => q.method === "PATCH")?.body).toEqual({
      alignment: { stable_polygon: RING },
    });
    await waitFor(() => expect(stores.tools.getState().active).toBe("select"));
  });

  it("refuses a mask when the top surface is in another CRS than the map and writes nothing", async () => {
    const { stores, requests } = setup(maskRoutes(), UTM33);
    act(() => {
      stores.workspace.getState().select({ kind: "volume", id: MEASUREMENT_ID });
      useVolumeStore.getState().setDrawing("exclusion");
      stores.tools.getState().activate("volume");
    });
    complete(stores);
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    expect(useToastStore.getState().toasts[0].text).toMatch(/another CRS/);
    expect(requests.filter((q) => q.method !== "GET")).toEqual([]);
    expect(useVolumeStore.getState().drawing).toBeNull();
    expect(stores.tools.getState().active).toBe("select");
  });

  it("toasts a failed mask save and leaves the drawing mode", async () => {
    const routes = maskRoutes().filter((r) => r.method !== "PATCH");
    const { stores } = setup(routes, UTM39);
    act(() => {
      stores.workspace.getState().select({ kind: "volume", id: MEASUREMENT_ID });
      useVolumeStore.getState().setDrawing("exclusion");
      stores.tools.getState().activate("volume");
    });
    complete(stores);
    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual([expect.objectContaining({ tone: "danger" })]),
    );
    expect(useVolumeStore.getState().drawing).toBeNull();
  });

  it("clears the mask drawing when another tool is chosen, but not on StrictMode's re-mount", () => {
    const { stores } = setup([], UTM39, true);
    act(() => {
      stores.workspace.getState().select({ kind: "volume", id: MEASUREMENT_ID });
      useVolumeStore.getState().setDrawing("stable");
      stores.tools.getState().activate("volume");
    });
    expect(useVolumeStore.getState().drawing).toBe("stable");
    act(() => stores.tools.getState().activate("select"));
    expect(useVolumeStore.getState().drawing).toBeNull();
  });

  it("clears the mask drawing when the volume is deselected (Esc)", () => {
    const { stores } = setup([], UTM39);
    act(() => {
      stores.workspace.getState().select({ kind: "volume", id: MEASUREMENT_ID });
      useVolumeStore.getState().setDrawing("exclusion");
      stores.tools.getState().activate("volume");
    });
    expect(useVolumeStore.getState().drawing).toBe("exclusion");
    act(() => stores.workspace.getState().select(null));
    expect(useVolumeStore.getState().drawing).toBeNull();
  });
});
