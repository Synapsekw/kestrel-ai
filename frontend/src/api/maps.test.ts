import { describe, expect, it } from "vitest";
import {
  exampleGeoMap,
  exampleLabel,
  exampleMapRun,
  exampleMapScore,
  fakeClient,
  MAP_ID,
  MAP_RUN_ID,
  PROJECT_ID,
  runningJob,
} from "@/test/fixtures";
import {
  createLabel,
  createMap,
  createMapExport,
  fetchDetections,
  fetchScore,
  listMapRuns,
  listMaps,
  seedLabels,
  updateLabel,
} from "./maps";

describe("maps api", () => {
  it("lists, imports, and reads runs, detections and scores", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/maps$/, body: { items: [exampleGeoMap] } },
      { method: "POST", path: /\/maps$/, status: 202, body: { map: exampleGeoMap, job: runningJob } },
      { method: "GET", path: /\/runs$/, body: { items: [exampleMapRun] } },
      { method: "GET", path: /\/detections$/, body: { items: [], truncated: true } },
      { method: "GET", path: /\/score$/, body: exampleMapScore },
    ]);
    expect(await listMaps(api, PROJECT_ID)).toEqual([exampleGeoMap]);
    await createMap(api, PROJECT_ID, { path: "D:/o.tif" });
    expect(requests[1]).toMatchObject({
      url: `/api/v1/projects/${PROJECT_ID}/maps`,
      body: { path: "D:/o.tif" },
    });
    expect(await listMapRuns(api, PROJECT_ID, MAP_ID)).toEqual([exampleMapRun]);
    expect((await fetchDetections(api, PROJECT_ID, MAP_RUN_ID, "0,0,10,10", 0.3)).truncated).toBe(true);
    expect(requests[3].url).toContain("bbox=0%2C0%2C10%2C10");
    expect(requests[3].url).toContain("min_conf=0.3");
    expect((await fetchScore(api, PROJECT_ID, MAP_RUN_ID)).overall.tp).toBe(18);
  });

  it("creates, edits and seeds labels, and starts an export", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/labels\/seed$/, body: { created: 12 } },
      { method: "POST", path: /\/labels$/, status: 201, body: exampleLabel },
      { method: "PATCH", path: /\/labels\/[^/]+$/, body: { ...exampleLabel, w: 180 } },
      { method: "POST", path: /\/map-exports$/, status: 202, body: { job: runningJob } },
    ]);
    expect(
      await seedLabels(api, PROJECT_ID, MAP_ID, { run_id: MAP_RUN_ID, zone_id: "z", min_conf: 0.25 }),
    ).toBe(12);
    await createLabel(api, PROJECT_ID, MAP_ID, { class_id: "c", x: 1, y: 2, w: 3, h: 4 });
    expect((await updateLabel(api, PROJECT_ID, MAP_ID, exampleLabel.id, { w: 180 })).w).toBe(180);
    const job = await createMapExport(api, PROJECT_ID, {
      map_id: MAP_ID,
      content: "labels",
      formats: ["csv"],
    });
    expect(job.id).toBe(runningJob.id);
    expect(requests.map((r) => r.method)).toEqual(["POST", "POST", "PATCH", "POST"]);
  });
});
