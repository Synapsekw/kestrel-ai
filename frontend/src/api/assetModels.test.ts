import { describe, expect, it } from "vitest";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { createVersion, listAssetModels, restoreVersion, startRun } from "./assetModels";

const model = {
  id: "m1",
  name: "Tank",
  asset_type: null,
  tag: null,
  status: "empty",
  current_version: null,
  live_run_id: null,
  captured_on: null,
  created_at: "2026-10-02T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
};

describe("asset model api", () => {
  it("lists models", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/asset-models$/, body: { items: [model] } }]);
    expect(await listAssetModels(api, PROJECT_ID)).toEqual([model]);
  });

  it("posts a spec as a new version", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/asset-models\/m1\/versions$/,
        status: 201,
        body: { version: { version: 2 }, job: { id: "j" } },
      },
    ]);
    const out = await createVersion(api, PROJECT_ID, "m1", { parts: [] } as never, "edit");
    expect(out.version.version).toBe(2);
    expect(requests[0].body).toEqual({ spec: { parts: [] }, note: "edit" });
  });

  it("restores and starts runs on the right paths", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/versions\/1\/restore$/,
        status: 201,
        body: { version: { version: 3 }, job: { id: "j" } },
      },
      {
        method: "POST",
        path: /\/asset-models\/m1\/runs$/,
        status: 202,
        body: { run: { id: "r" }, job: { id: "j" } },
      },
    ]);
    await restoreVersion(api, PROJECT_ID, "m1", 1);
    await startRun(api, PROJECT_ID, "m1", {
      mode: "build",
      provider: "anthropic",
      sources: [{ type: "drawing", id: "d" }],
    } as never);
    expect(requests.map((r) => r.url)).toEqual([
      expect.stringMatching(/versions\/1\/restore$/),
      expect.stringMatching(/asset-models\/m1\/runs$/),
    ]);
  });
});
