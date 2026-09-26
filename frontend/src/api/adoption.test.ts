import { describe, expect, it } from "vitest";
import { fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { fetchAdoption, retryAdoption } from "./adoption";

describe("adoption api", () => {
  it("reads the adoption status and retries it", async () => {
    const status = { pending: 1, adopted: 2, missing: [], job_id: null };
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/adoption$/, body: status },
      { method: "POST", path: /\/adoption\/retry$/, status: 202, body: { job: runningJob } },
    ]);
    expect(await fetchAdoption(api, PROJECT_ID)).toEqual(status);
    expect(await retryAdoption(api, PROJECT_ID)).toEqual(runningJob);
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `GET /api/v1/projects/${PROJECT_ID}/adoption`,
      `POST /api/v1/projects/${PROJECT_ID}/adoption/retry`,
    ]);
  });
});
