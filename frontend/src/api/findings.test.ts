import { describe, expect, it } from "vitest";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { exampleFinding, FINDING_ID } from "@/test/findingFixtures";
import {
  bulkUpdateFindings,
  findingThumbnailUrl,
  listActivity,
  listFindings,
  patchFinding,
} from "./findings";

describe("findings API", () => {
  it("sends repeated filter params, the sort and the cursor", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/findings$/, body: { items: [exampleFinding], next_cursor: null } },
    ]);
    const page = await listFindings(api, PROJECT_ID, {
      status: ["open", "reviewed"],
      severity: ["4", "none"],
      sort: "-severity",
      limit: 200,
      cursor: "c1",
    });
    expect(page.items[0].number).toBe(217);
    const params = new URL(requests[0].url, "http://fake").searchParams;
    expect(params.getAll("status")).toEqual(["open", "reviewed"]);
    expect(params.getAll("severity")).toEqual(["4", "none"]);
    expect(params.get("sort")).toBe("-severity");
    expect(params.get("cursor")).toBe("c1");
  });

  it("patches one finding and posts a bulk change", async () => {
    const { api, requests } = fakeClient([
      {
        method: "PATCH",
        path: /\/findings\/[^/]+$/,
        body: { ...exampleFinding, severity: 2, attachment_count: 0, comment_count: 0 },
      },
      { method: "POST", path: /\/findings\/bulk$/, body: { updated: 1, skipped: [] } },
    ]);
    const saved = await patchFinding(api, PROJECT_ID, FINDING_ID, { severity: 2 });
    expect(saved.severity).toBe(2);
    const result = await bulkUpdateFindings(api, PROJECT_ID, [FINDING_ID], { status: "closed" });
    expect(result.updated).toBe(1);
    expect(requests[1].body).toEqual({ ids: [FINDING_ID], set: { status: "closed" } });
  });

  it("filters the activity feed by subject", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/activity$/, body: { items: [], next_cursor: null } },
    ]);
    await listActivity(api, PROJECT_ID, { subject_id: FINDING_ID, limit: 20 });
    const params = new URL(requests[0].url, "http://fake").searchParams;
    expect(params.get("subject_id")).toBe(FINDING_ID);
    expect(params.get("limit")).toBe("20");
  });

  it("puts the token in the thumbnail query, escaped", () => {
    expect(findingThumbnailUrl("http://h:1/", "a b", PROJECT_ID, FINDING_ID)).toBe(
      `http://h:1/api/v1/projects/${PROJECT_ID}/findings/${FINDING_ID}/thumbnail?token=a%20b`,
    );
  });
});
