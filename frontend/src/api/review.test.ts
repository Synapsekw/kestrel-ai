import { describe, expect, it } from "vitest";
import { fakeClient, PROJECT_ID, CLASS_ID } from "@/test/fixtures";
import {
  acceptRunAbove,
  addMapDetection,
  chosenRun,
  listSourceRuns,
  nextUnreviewed,
  reviewMapDetections,
  type RunSummary,
} from "./review";

const detection = {
  id: "d1",
  class_id: CLASS_ID(1),
  confidence: 0.9,
  x: 1,
  y: 2,
  w: 3,
  h: 4,
  angle: null,
  review_state: "unreviewed" as const,
  provenance_kind: "local_model" as const,
};

describe("review api", () => {
  it("reviews, draws, walks and accepts through the contract paths", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/map-runs\/r1\/review$/, body: { updated: 2 } },
      { method: "POST", path: /\/map-runs\/r1\/detections$/, status: 201, body: detection },
      { method: "GET", path: /\/map-runs\/r1\/next-unreviewed/, body: { detection, remaining: 7 } },
      {
        method: "POST",
        path: /\/runs\/r1\/accept-above$/,
        status: 202,
        body: { job: { id: "j1", type: "accept_above" } },
      },
    ]);
    expect(await reviewMapDetections(api, PROJECT_ID, "r1", ["a", "b"], "reclass", CLASS_ID(2))).toBe(2);
    expect(
      (await addMapDetection(api, PROJECT_ID, "r1", { class_id: CLASS_ID(1), x: 1, y: 2, w: 3, h: 4 })).id,
    ).toBe("d1");
    expect(await nextUnreviewed(api, PROJECT_ID, "r1", "d0")).toEqual({ detection, remaining: 7 });
    expect((await acceptRunAbove(api, PROJECT_ID, "r1", 0.8)).id).toBe("j1");

    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `POST /api/v1/projects/${PROJECT_ID}/map-runs/r1/review`,
      `POST /api/v1/projects/${PROJECT_ID}/map-runs/r1/detections`,
      `GET /api/v1/projects/${PROJECT_ID}/map-runs/r1/next-unreviewed?after_id=d0`,
      `POST /api/v1/projects/${PROJECT_ID}/runs/r1/accept-above`,
    ]);
    expect(requests[0].body).toEqual({ detection_ids: ["a", "b"], action: "reclass", class_id: CLASS_ID(2) });
    expect(requests[3].body).toEqual({ min_confidence: 0.8 });
  });

  it("omits after_id to start from the top, and lists one source's runs", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/next-unreviewed/, body: { detection: null, remaining: 0 } },
      { method: "GET", path: /\/runs$/, body: { items: [], next_cursor: null } },
    ]);
    await nextUnreviewed(api, PROJECT_ID, "r1", null);
    await listSourceRuns(api, PROJECT_ID, "s1");
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/map-runs/r1/next-unreviewed`);
    expect(requests[1].url).toBe(`/api/v1/projects/${PROJECT_ID}/runs?source_id=s1&limit=50`);
  });
});

describe("chosenRun", () => {
  const run = (id: string, pinned: boolean, created_at: string): RunSummary => ({
    id,
    kind: "map",
    source_id: "s1",
    source_label: "May",
    model_id: null,
    model_name: null,
    conf: 0.25,
    job_state: "succeeded",
    pinned,
    counts: {},
    verified_counts: {},
    review: { total: 0, reviewed: 0 },
    created_at,
  });

  it("prefers the pinned run, else the newest", () => {
    const older = run("a", false, "2026-01-01T00:00:00Z");
    const newer = run("b", false, "2026-02-01T00:00:00Z");
    expect(chosenRun([older, newer])?.id).toBe("b");
    expect(chosenRun([{ ...older, pinned: true }, newer])?.id).toBe("a");
    expect(chosenRun([])).toBeNull();
  });
});
