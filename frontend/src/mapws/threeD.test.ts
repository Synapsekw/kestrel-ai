import { describe, expect, it } from "vitest";
import { CLOUD_ID, exampleCloud } from "@/test/cloudFixtures";
import { MAP_ID, PROJECT_ID } from "@/test/fixtures";
import { LOCAL, survey } from "./test/fixtures";
import { openIn3dHref } from "./threeD";
import type { SiteFrame } from "./types";

// exampleCloud is in UTM 39N; a site frame in the same CRS keeps the numbers readable.
const UTM39: SiteFrame = {
  kind: "crs",
  crs_wkt: "x",
  epsg: 32639,
  proj4: exampleCloud.proj4,
  name: "WGS 84 / UTM zone 39N",
};
const cloud = { ...exampleCloud, map_id: MAP_ID };
const surveys = [
  survey("2026-09-14", {
    maps: [{ id: MAP_ID, name: "Ortho", gsd_cm: 3, basis_run_id: null }],
  }),
];
const ctx = { frame: UTM39, surveys, clouds: [cloud] };

describe("Open this spot in 3D (today's jump contract, spec 2026-09-23-point-clouds §10)", () => {
  it("opens the survey's linked cloud at the spot, in the cloud's CRS", () => {
    expect(openIn3dHref(PROJECT_ID, 243500, 3178200, "2026-09-14", ctx)).toEqual({
      href: `/p/${PROJECT_ID}/clouds/${CLOUD_ID}?at=243500.000,3178200.000`,
      cloud,
    });
  });

  it("carries a detection's footprint as `fp`, in the cloud's CRS, as the old map viewer's jump did", () => {
    const corners = [
      [243495, 3178205],
      [243505, 3178205],
      [243505, 3178195],
      [243495, 3178195],
    ];
    expect(openIn3dHref(PROJECT_ID, 243500, 3178200, "2026-09-14", ctx, corners)).toEqual({
      href:
        `/p/${PROJECT_ID}/clouds/${CLOUD_ID}?at=243500.000,3178200.000` +
        "&fp=243495.000,3178205.000;243505.000,3178205.000;243505.000,3178195.000;243495.000,3178195.000",
      cloud,
    });
  });

  it("explains why it cannot", () => {
    expect(openIn3dHref(PROJECT_ID, 1, 1, "2026-09-14", ctx)).toEqual({
      href: null,
      reason: "No point cloud of the 2026-09-14 survey covers this spot.",
    });
    expect(openIn3dHref(PROJECT_ID, 243500, 3178200, "2026-08-14", ctx)).toEqual({
      href: null,
      reason: "No point cloud is linked to the 2026-08-14 survey.",
    });
    expect(openIn3dHref(PROJECT_ID, 243500, 3178200, null, ctx)).toMatchObject({
      href: null,
    });
    expect(
      openIn3dHref(PROJECT_ID, 243500, 3178200, "2026-09-14", {
        ...ctx,
        frame: LOCAL,
      }),
    ).toEqual({
      href: null,
      reason: "This site has no coordinates, so its spots cannot be opened in 3D.",
    });
  });
});
