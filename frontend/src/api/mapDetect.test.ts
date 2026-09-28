import { describe, expect, it } from "vitest";
import { MAP_RUN_ID, PROJECT_ID, fakeClient } from "@/test/fixtures";
import { ApiFailure } from "./errors";
import {
  fetchSiteDensity,
  fetchSiteDetections,
  findingIdsToDelete,
  nextUnreviewedSite,
  reviewDetections,
  siteBbox,
} from "./mapDetect";

describe("site-frame detection api", () => {
  it("asks for site coordinates", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/detections$/,
        body: { items: [], truncated: false },
      },
      { method: "GET", path: /\/density$/, body: { cell_size: 1, cells: [] } },
      {
        method: "GET",
        path: /\/next-unreviewed$/,
        body: { detection: null, remaining: 0 },
      },
    ]);
    await fetchSiteDetections(api, PROJECT_ID, MAP_RUN_ID, siteBbox([1, 2, 3.5, 4]));
    await fetchSiteDensity(api, PROJECT_ID, MAP_RUN_ID);
    await nextUnreviewedSite(api, PROJECT_ID, MAP_RUN_ID, "d1");
    expect(requests[0].url).toContain("frame=site");
    expect(decodeURIComponent(requests[0].url)).toContain("bbox=1.000,2.000,3.500,4.000");
    expect(requests[1].url).toContain("frame=site");
    expect(requests[1].url).toContain("cells=64");
    expect(requests[2].url).toContain("after_id=d1");
    expect(requests[2].url).toContain("frame=site");
  });

  it("sends the confirm only when asked", async () => {
    const { api, requests } = fakeClient([{ method: "POST", path: /\/review$/, body: { updated: 1 } }]);
    await reviewDetections(api, PROJECT_ID, MAP_RUN_ID, {
      detection_ids: ["d1"],
      action: "reject",
    });
    await reviewDetections(api, PROJECT_ID, MAP_RUN_ID, { detection_ids: ["d1"], action: "reject" }, true);
    expect(requests[0].url).not.toContain("confirm_finding_delete");
    expect(requests[1].url).toContain("confirm_finding_delete=true");
  });

  it("reads the findings a 409 would delete", () => {
    const one = new ApiFailure("finding_would_be_deleted", "x", 409, {
      finding_id: "f1",
      finding_ids: ["f1"],
      count: 1,
    });
    expect(findingIdsToDelete(one)).toEqual(["f1"]);
    expect(
      findingIdsToDelete(
        new ApiFailure("finding_would_be_deleted", "x", 409, {
          finding_id: "f1",
        }),
      ),
    ).toEqual(["f1"]);
    expect(findingIdsToDelete(new ApiFailure("conflict", "x", 409))).toBeNull();
  });
});
