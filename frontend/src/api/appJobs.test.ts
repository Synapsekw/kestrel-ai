import { describe, expect, it } from "vitest";
import { fakeClient } from "@/test/fixtures";
import { exampleAppJobs } from "@/test/appSectionFixtures";
import { fetchAppJobs } from "./appJobs";

describe("fetchAppJobs", () => {
  it("asks for one page with exploded states and a project filter", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/api\/v1\/jobs$/, body: { items: exampleAppJobs, next_cursor: "c2" } },
    ]);
    const page = await fetchAppJobs(api, { state: ["succeeded", "cancelled"], project_id: "library" });
    expect(page.items).toHaveLength(3);
    expect(page.next_cursor).toBe("c2");
    expect(requests[0].url).toContain("state=succeeded&state=cancelled");
    expect(requests[0].url).toContain("project_id=library");
    expect(requests[0].url).toContain("limit=50");
  });
});
