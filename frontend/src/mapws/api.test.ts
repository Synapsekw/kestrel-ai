import { describe, expect, it } from "vitest";
import { PROJECT_ID, fakeClient } from "@/test/fixtures";
import { fetchWorkspace, listWorkspaceLayers, listWorkspaceSurveys, putWorkspaceState } from "./api";
import { UTM33, layer, survey } from "./test/fixtures";

const WS = {
  frame: UTM33,
  state: { v: 1, mode: "swipe" },
  planned_surveys: [],
  frame_items: { crs: 1, local: 0 },
  updated_at: "2026-09-27T10:00:00Z",
};

describe("map workspace reads (R-W1-3)", () => {
  it("reads the site frame and the persisted state", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/map-workspace$/, body: WS }]);
    const ws = await fetchWorkspace(api, PROJECT_ID);
    expect(ws.frame).toEqual(UTM33);
    expect(ws.state).toEqual({ v: 1, mode: "swipe" });
    expect(requests[0].url).toBe(`/api/v1/projects/${PROJECT_ID}/map-workspace`);
  });

  it("unwraps the layer and survey lists", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/map-workspace\/layers$/,
        body: { frame: UTM33, items: [layer("map", "m1")] },
      },
      {
        method: "GET",
        path: /\/map-workspace\/surveys$/,
        body: {
          items: [survey("2026-08-14"), survey("2026-10-14", { planned: true })],
        },
      },
    ]);
    expect((await listWorkspaceLayers(api, PROJECT_ID)).map((l) => l.id)).toEqual(["m1"]);
    expect((await listWorkspaceSurveys(api, PROJECT_ID)).map((s) => [s.date, s.planned])).toEqual([
      ["2026-08-14", false],
      ["2026-10-14", true],
    ]);
  });

  it("puts the state", async () => {
    const { api, requests } = fakeClient([{ method: "PUT", path: /\/map-workspace$/, body: WS }]);
    await putWorkspaceState(api, PROJECT_ID, { v: 1 });
    // RecordedRequest.body is the parsed JSON body (test/fixtures.ts fakeFetch).
    expect(requests[0].body).toEqual({ state: { v: 1 } });
  });
});
