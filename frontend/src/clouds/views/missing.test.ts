import { describe, expect, it } from "vitest";
import type { Finding } from "@/api/findings";
import { exampleFinding } from "@/test/findingFixtures";
import { measurementOf, viewOut } from "@/test/cloudViewFixtures";
import { findingAnchor, missingSubjects } from "./missing";

const cloudFinding = (id: string, cloud = "c1"): Finding => ({
  ...exampleFinding,
  id,
  data_type: "point_cloud",
  data_id: cloud,
  anchor: { kind: "cloud", cloud_id: cloud, x: 1, y: 2, z: 3, uncertainty_m: 0.05 },
});

describe("missing report views", () => {
  it("reads a cloud anchor on this cloud only", () => {
    expect(findingAnchor(cloudFinding("f1"), "c1")).toEqual([1, 2, 3]);
    expect(findingAnchor(cloudFinding("f1", "other"), "c1")).toBeNull();
    expect(findingAnchor(exampleFinding, "c1")).toBeNull();
  });

  it("takes subjects with no view or a stale one, findings first", () => {
    const items = missingSubjects(
      "c1",
      [cloudFinding("f1"), cloudFinding("f2"), cloudFinding("f3"), exampleFinding],
      [
        measurementOf(
          "area",
          [
            [0, 0, 0],
            [1, 0, 0],
            [1, 1, 0],
          ],
          null,
          "m1",
        ),
        measurementOf(
          "distance",
          [
            [0, 0, 0],
            [1, 0, 0],
          ],
          null,
          "m2",
        ),
      ],
      [
        viewOut({ subject_id: "f1" }),
        viewOut({ subject_id: "f2", stale: true }),
        viewOut({ subject_kind: "cloud_measurement", subject_id: "m2" }),
      ],
    );
    expect(items.map((i) => `${i.subject.kind}:${i.subject.id}`)).toEqual([
      "finding:f2",
      "finding:f3",
      "cloud_measurement:m1",
    ]);
    expect(items[0].geometry).toEqual({ kind: "finding", anchor: [1, 2, 3] });
  });
});
