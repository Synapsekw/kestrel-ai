import { describe, expect, it } from "vitest";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { exampleSite } from "@/test/findingFixtures";
import { fetchLatestImages, fetchOverviewSite } from "./overview";

describe("overview reads", () => {
  it("reads the site", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /\/overview\/site$/, body: exampleSite }]);
    await expect(fetchOverviewSite(api, PROJECT_ID)).resolves.toEqual(exampleSite);
    expect(requests[0].url).toContain(`/projects/${PROJECT_ID}/overview/site`);
  });

  it("reads the newest frames by capture time, bounded", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/images$/, body: { items: [], next_cursor: null } },
    ]);
    await fetchLatestImages(api, PROJECT_ID, 8);
    const url = new URL(requests[0].url, "http://x");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      sort: "capture_time",
      order: "desc",
      limit: "8",
    });
  });
});
