import { describe, expect, it } from "vitest";
import { errorBody, fakeClient, MODEL_ID, PROJECT_ID, SOURCE_ID, runningJob } from "@/test/fixtures";
import { createRuns, fetchRuns, pinRun, recountRun, saveModelClassMap, unmappedClasses } from "./runs";

describe("runs api", () => {
  it("lists a page, filtered by source and continued by cursor", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/runs$/, body: { items: [], next_cursor: null } },
    ]);
    await fetchRuns(api, PROJECT_ID, { sourceId: SOURCE_ID, cursor: "abc" });
    expect(requests[0].url).toBe(
      `/api/v1/projects/${PROJECT_ID}/runs?limit=50&source_id=${SOURCE_ID}&cursor=abc`,
    );
  });

  it("reads the unmapped classes from a 422", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/runs$/,
        status: 422,
        body: errorBody("unmapped_classes", "2 unmapped", { model_id: MODEL_ID, unmapped: ["crane", "car"] }),
      },
    ]);
    const err = await createRuns(api, PROJECT_ID, {
      source_ids: [SOURCE_ID],
      model_id: MODEL_ID,
      conf: 0.25,
    }).catch((e: unknown) => e);
    expect(unmappedClasses(err)).toEqual({ modelId: MODEL_ID, unmapped: ["crane", "car"] });
    expect(unmappedClasses(new Error("x"))).toBeNull();
  });

  it("pins, recounts and saves a class map", async () => {
    const { api, requests } = fakeClient([
      { method: "PATCH", path: /\/runs\/r1$/, body: { id: "r1" } },
      { method: "POST", path: /\/runs\/r1\/recount$/, status: 202, body: { job: runningJob } },
      {
        method: "PUT",
        path: /\/model-class-maps\//,
        body: { model_id: MODEL_ID, model_classes: [], mapping: {}, unmapped: [] },
      },
    ]);
    await pinRun(api, PROJECT_ID, "r1", true);
    expect(await recountRun(api, PROJECT_ID, "r1")).toEqual(runningJob);
    await saveModelClassMap(api, PROJECT_ID, MODEL_ID, { mapping: { car: null }, new_classes: ["crane"] });
    expect(requests.map((r) => r.body)).toEqual([
      { pinned: true },
      null,
      { mapping: { car: null }, new_classes: ["crane"] },
    ]);
  });
});
