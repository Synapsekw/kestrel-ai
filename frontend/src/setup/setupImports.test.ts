import { createApiClient } from "@contract/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChangesStore } from "@/store/changes";
import { useJobsStore } from "@/store/jobs";
import {
  BUILD_JOB,
  DRAWING_ID,
  INSPECT_JOB,
  bigPdfInspection,
  drawingJob,
} from "@/mapws/drawings/testFixtures";
import {
  errorBody,
  exampleGeoMap,
  exampleSource,
  fakeClient,
  fakeFetch,
  PROJECT_ID,
  runningJob,
} from "@/test/fixtures";
import { bucket, draft, heldClient, PHOTOS, slot } from "@/test/setupDispatchFixtures";
import { planImports } from "./importPlan";
import { drawingWait } from "./drawingSetup";
import { DRAWING_CONCURRENCY, slotImports, useSetupImports } from "./setupImports";

const MAP_JOB = { ...runningJob, id: "j-map", type: "map_import" as const };
const short = (url: string) => url.replace(`/api/v1/projects/${PROJECT_ID}`, "");
const states = () => slotImports(useSetupImports.getState().byProject[PROJECT_ID]).map((s) => s.state);

const PLAN = planImports(
  draft({
    slots: [
      slot("visual", "Visual photos", "images"),
      slot("thermal", "Thermal photos", "images", { thermal: true }),
      slot("ortho", "Orthomosaic", "map", { raster: "ortho" }),
    ],
    buckets: [
      bucket({ route: "images", match: { thermal: false }, slot_key: "visual" }),
      bucket({ route: "images", match: { thermal: true }, slot_key: "thermal" }),
      bucket({
        route: "map",
        slot_key: "ortho",
        folder: "E:\\Delivery\\ortho",
        files: ["E:\\Delivery\\ortho\\north.tif", "E:\\Delivery\\ortho\\south.tif"],
      }),
    ],
  }),
);

beforeEach(() => {
  useSetupImports.setState({ byProject: {} });
  useJobsStore.setState({ jobs: {} });
});

describe("useSetupImports", () => {
  it("keeps the other imports when one fails, and Retry re-runs only the failed one", async () => {
    let sourceCalls = 0;
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/sources$/,
        status: () => (++sourceCalls === 1 ? 409 : 202),
        body: () =>
          sourceCalls === 1
            ? errorBody("job_running", "an import of this folder is already running")
            : { source: exampleSource, job: runningJob },
      },
      { method: "POST", path: /\/maps$/, status: 202, body: { map: exampleGeoMap, job: MAP_JOB } },
    ]);

    await useSetupImports.getState().start(api, PROJECT_ID, PLAN);
    expect(slotImports(useSetupImports.getState().byProject[PROJECT_ID])).toEqual([
      {
        slotKey: "visual",
        label: "Visual photos",
        state: "failed",
        error: "an import of this folder is already running",
        failed: 1,
      },
      {
        slotKey: "thermal",
        label: "Thermal photos",
        state: "failed",
        error: "an import of this folder is already running",
        failed: 1,
      },
      { slotKey: "ortho", label: "Orthomosaic", state: "started", error: undefined, failed: 0 },
    ]);
    expect(requests.map((r) => short(r.url))).toEqual(["/sources", "/maps", "/maps"]);
    expect(requests[0].body).toEqual({ folder: PHOTOS });
    expect(useJobsStore.getState().jobs["j-map"]).toBeDefined();

    await useSetupImports.getState().retry(api, PROJECT_ID, "thermal");
    expect(requests.map((r) => short(r.url))).toEqual(["/sources", "/maps", "/maps", "/sources"]);
    expect(states()).toEqual(["started", "started", "started"]);
    expect(useJobsStore.getState().jobs[runningJob.id]).toBeDefined();
  });

  it("sends each route's importer its defaults", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/elevations$/,
        status: 202,
        body: { surface: { id: "s1" }, job: { ...runningJob, id: "j-dem", type: "elevation_import" } },
      },
      {
        method: "POST",
        path: /\/pointclouds$/,
        status: 202,
        body: { cloud: { id: "c1" }, job: { ...runningJob, id: "j-cloud", type: "pointcloud_import" } },
      },
    ]);
    const plan = planImports(
      draft({
        slots: [slot("dsm", "Elevation DSM/DTM", "elevation"), slot("cloud", "3D point cloud", "pointcloud")],
        buckets: [
          bucket({ route: "elevation", slot_key: "dsm", folder: "E:\\D", files: ["E:\\D\\north-dsm.tif"] }),
          bucket({ route: "pointcloud", slot_key: "cloud", folder: "E:\\D", files: ["E:\\D\\tower.laz"] }),
        ],
      }),
    );
    await useSetupImports.getState().start(api, PROJECT_ID, plan);
    expect(requests.map((r) => [short(r.url), r.body])).toEqual([
      ["/elevations", { path: "E:\\D\\north-dsm.tif", name: "north-dsm", role: "dsm" }],
      ["/pointclouds", { path: "E:\\D\\tower.laz" }],
    ]);
    expect(states()).toEqual(["started", "started"]);
  });

  it("marks every unit pending before the first request answers, and tells the data views once", async () => {
    const { api, release } = heldClient(
      [{ method: "POST", path: /\/sources$/, status: 202, body: { source: exampleSource, job: runningJob } }],
      /\/sources$/,
    );
    const before = useChangesStore.getState().dataRevision;
    const done = useSetupImports.getState().start(api, PROJECT_ID, PLAN);
    expect(states()).toEqual(["pending", "pending", "pending"]);
    release();
    await done;
    expect(useChangesStore.getState().dataRevision).toBe(before + 1);
  });

  it("forgets a dismissed project, even when a request answers afterwards", async () => {
    const { api, release } = heldClient(
      [{ method: "POST", path: /\/sources$/, status: 202, body: { source: exampleSource, job: runningJob } }],
      /\/sources$/,
    );
    const done = useSetupImports.getState().start(api, PROJECT_ID, PLAN);
    useSetupImports.getState().dismiss(PROJECT_ID);
    release();
    await done;
    expect(useSetupImports.getState().byProject).toEqual({});
  });

  it("records a blocked photo folder as failed without a request, and Retry sends it", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/sources$/, status: 202, body: { source: exampleSource, job: runningJob } },
      { method: "POST", path: /\/maps$/, status: 202, body: { map: exampleGeoMap, job: MAP_JOB } },
    ]);
    const plan = planImports(
      draft({
        slots: [
          slot("visual", "Visual photos", "images"),
          slot("ortho", "Orthomosaic", "map", { raster: "ortho" }),
        ],
        buckets: [
          bucket({ route: "images", slot_key: "visual", folder: "E:\\D\\flight" }),
          bucket({
            route: "map",
            slot_key: "ortho",
            folder: "E:\\D\\flight\\products",
            files: ["E:\\D\\flight\\products\\o.tif"],
          }),
        ],
      }),
    );
    await useSetupImports.getState().start(api, PROJECT_ID, plan);
    expect(requests.map((r) => short(r.url))).toEqual(["/maps"]);
    expect(slotImports(useSetupImports.getState().byProject[PROJECT_ID])).toEqual([
      expect.objectContaining({
        slotKey: "visual",
        state: "failed",
        error: expect.stringContaining("also holds GeoTIFFs"),
      }),
      expect.objectContaining({ slotKey: "ortho", state: "started" }),
    ]);

    await useSetupImports.getState().retry(api, PROJECT_ID, "visual");
    expect(requests.map((r) => [short(r.url), r.body])).toEqual([
      ["/maps", { path: "E:\\D\\flight\\products\\o.tif" }],
      ["/sources", { folder: "E:\\D\\flight" }],
    ]);
    expect(states()).toEqual(["started", "started"]);
  });

  it("does nothing on Retry when the slot has no failed import", async () => {
    const { api, requests } = fakeClient([]);
    const spy = vi.spyOn(useChangesStore.getState(), "bumpData");
    await useSetupImports.getState().retry(api, PROJECT_ID, "visual");
    expect(requests).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("keeps at most DRAWING_CONCURRENCY drawings in flight at once", async () => {
    const saved = { ...drawingWait };
    Object.assign(drawingWait, { sleep: async () => {} });
    const { fetch: inner } = fakeFetch([
      {
        method: "POST",
        path: /\/drawing-inspections$/,
        status: 202,
        body: { inspection: bigPdfInspection, job: drawingJob(INSPECT_JOB, "running") },
      },
      { method: "GET", path: /\/drawing-inspections\/[^/]+$/, body: bigPdfInspection },
      {
        method: "POST",
        path: /\/drawings$/,
        status: 202,
        body: { drawing: { id: DRAWING_ID }, job: drawingJob(BUILD_JOB, "queued") },
      },
    ]);
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    let inFlight = 0;
    let peak = 0;
    const counting = (async (input: Request | string | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const first = /\/drawing-inspections$/.test(url.pathname);
      const last = /\/drawings$/.test(url.pathname);
      if (first) {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await gate;
      }
      try {
        return await inner(input, init);
      } finally {
        if (last) inFlight -= 1;
      }
    }) as typeof fetch;
    const api = createApiClient({ baseUrl: "http://fake", token: "t", fetch: counting });
    const plan = planImports(
      draft({
        slots: [slot("drawings", "Asset drawings", "drawing")],
        buckets: [
          bucket({
            route: "drawing",
            slot_key: "drawings",
            folder: "D:\\plans",
            files: Array.from({ length: 6 }, (_, i) => `D:\\plans\\p${i}.pdf`),
            count: 6,
          }),
        ],
      }),
    );
    expect(plan.units).toHaveLength(6);
    try {
      const done = useSetupImports.getState().start(api, PROJECT_ID, plan);
      await vi.waitFor(() => expect(inFlight).toBe(DRAWING_CONCURRENCY));
      await new Promise((r) => setTimeout(r, 20)); // a fifth would have started by now
      expect(peak).toBe(DRAWING_CONCURRENCY);
      open();
      await done;
      expect(peak).toBe(DRAWING_CONCURRENCY);
      expect(states()).toEqual(["started"]);
      expect(useSetupImports.getState().byProject[PROJECT_ID].units.map((u) => u.state)).toEqual(
        Array(6).fill("started"),
      );
    } finally {
      Object.assign(drawingWait, saved);
    }
  });
});
