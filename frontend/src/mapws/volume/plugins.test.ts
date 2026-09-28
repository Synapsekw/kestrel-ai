import { beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_KEYS, useToastStore } from "@/ui";
import type { WorkspaceLayer } from "@/mapws/w4host";
import { errorBody, fakeClient, runningJob } from "@/test/fixtures";
import { PROJECT_ID, exampleMeasurement } from "@/test/volumeFixtures";
import volumeInspector from "../inspect/volume.inspector";
import volumesLayer from "../layers/volumes.layer";
import volumeTool from "../tools/volume.tool";
import { createFromRing } from "./createFromRing";

const dsm = {
  kind: "surface",
  id: "s-top",
  status: "ready",
  in_frame: true,
  date: "2026-04-02",
  surface_kind: "cloud_dsm",
  elevation_role: null,
} as WorkspaceLayer;
const ctx = (layers: WorkspaceLayer[], r: string | null) => ({
  frame: {} as never,
  selection: null,
  surveys: [],
  layers,
  r,
});

describe("volume plugins", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it("the Volume tool is U, a polygon, and disabled with the spec's hint without a DSM", () => {
    expect(WORKSPACE_KEYS.maps.find((e) => e.action === volumeTool.action)?.keys).toEqual(["U"]);
    expect(volumeTool).toMatchObject({
      id: "volume",
      action: "volume",
      group: "measure",
      order: 3,
      draw: { shape: "polygon", min: 3 },
    });
    expect(volumeTool.disabledReason?.(ctx([], "2026-04-02"))).toBe(
      "No DSM for 2 Apr 2026 — import one or build it from a point cloud",
    );
    expect(volumeTool.disabledReason?.(ctx([dsm], "2026-04-02"))).toBeNull();
    expect(volumeTool.Overlay).toBeDefined();
  });

  it("registers the Volumes row and the volume inspector (own pane, Del deletes)", () => {
    expect(volumesLayer).toMatchObject({ id: "volumes", group: "annotations" });
    expect(volumesLayer.Mount).toBeDefined();
    expect(
      volumesLayer.rows({
        projectId: PROJECT_ID,
        frame: {} as never,
        layers: [],
        surveys: [],
      }),
    ).toEqual([
      expect.objectContaining({
        key: "volumes:volumes",
        kind: "volumes",
        id: "volumes",
        name: "Volumes",
        date: null,
      }),
    ]);
    expect(volumeInspector).toMatchObject({ id: "volume", framed: false });
    const confirm = volumeInspector.remove?.confirm({ kind: "volume", id: "v" });
    expect(confirm).toMatch(/results and exports/);
    // W1's dialog title already asks "Delete this volume measurement?" (ruling T9-1).
    expect(confirm).not.toMatch(/Delete this/);
  });

  it("deletes through DELETE /volumes/{id}", async () => {
    const { api, requests } = fakeClient([{ method: "DELETE", path: /\/volumes\/v1$/, status: 204 }]);
    await volumeInspector.remove?.run({ kind: "volume", id: "v1" }, { api, projectId: PROJECT_ID });
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("DELETE");
  });

  it("creates the measurement from site coordinates on the r date's DSM", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/volumes$/, body: { items: [] } },
      {
        method: "POST",
        path: /\/volumes$/,
        status: 202,
        body: { measurement: exampleMeasurement, job: runningJob },
      },
    ]);
    const ring = [
      [1, 2],
      [3, 2],
      [3, 4],
    ];
    expect(await createFromRing(api, PROJECT_ID, [dsm], "2026-04-02", ring)).toBe(exampleMeasurement.id);
    expect(requests[1].body).toEqual({
      name: "Pile 1",
      polygon_site: ring,
      top_surface_id: "s-top",
      base: { kind: "toe_plane" },
    });
  });

  it("refuses without a DSM for r and sends nothing", async () => {
    const { api, requests } = fakeClient([]);
    expect(
      await createFromRing(api, PROJECT_ID, [], "2026-04-02", [
        [0, 0],
        [1, 0],
        [1, 1],
      ]),
    ).toBeNull();
    expect(requests).toHaveLength(0);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("says why when the create fails and returns null", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/volumes$/, body: { items: [] } },
      { method: "POST", path: /\/volumes$/, status: 500, body: errorBody("internal", "boom") },
    ]);
    expect(
      await createFromRing(api, PROJECT_ID, [dsm], "2026-04-02", [
        [0, 0],
        [1, 0],
        [1, 1],
      ]),
    ).toBeNull();
    expect(useToastStore.getState().toasts).toEqual([expect.objectContaining({ tone: "danger" })]);
  });
});
