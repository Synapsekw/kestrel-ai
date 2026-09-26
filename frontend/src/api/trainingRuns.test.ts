import { describe, expect, it } from "vitest";
import { fakeClient, runningJob } from "@/test/fixtures";
import { exampleTrainingRun, TRAIN_PARAMS, TRAINING_RUN_ID } from "@/test/appSectionFixtures";
import { fetchTrainingRun, fetchTrainingRuns, startTrainingRun } from "./trainingRuns";

describe("training runs API (F §12.3)", () => {
  it("lists, reads and starts runs", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/library\/training-runs$/,
        body: { items: [exampleTrainingRun], next_cursor: null },
      },
      { method: "GET", path: /\/library\/training-runs\/[^/]+$/, body: exampleTrainingRun },
      {
        method: "POST",
        path: /\/library\/training-runs$/,
        status: 202,
        body: {
          training_run: { ...exampleTrainingRun, state: "queued" },
          job: { ...runningJob, type: "train" },
        },
      },
    ]);
    expect((await fetchTrainingRuns(api)).items).toHaveLength(1);
    expect((await fetchTrainingRun(api, TRAINING_RUN_ID)).id).toBe(TRAINING_RUN_ID);
    const started = await startTrainingRun(api, TRAIN_PARAMS);
    expect(started.training_run.state).toBe("queued");
    expect(started.job.type).toBe("train");
    expect(requests[2].body).toEqual(TRAIN_PARAMS);
  });
});
