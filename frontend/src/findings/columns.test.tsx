import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  exampleAssetFinding,
  exampleAssetModel,
  exampleUnplacedAssetFinding,
} from "@/test/assetFindingFixtures";
import { exampleFinding, projectTypes } from "@/test/findingFixtures";
import { PROJECT_ID } from "@/test/fixtures";
import { assetZoneLabels } from "./assetLookups";
import { findingColumns, type ColumnContext } from "./columns";

const ctx = (asset: boolean): ColumnContext => ({
  projectId: PROJECT_ID,
  types: new Map(projectTypes.map((t) => [t.id, t])),
  labels: new Map(),
  nowMs: Date.parse("2026-10-03T09:00:00Z"),
  asset,
  zoneLabels: assetZoneLabels([exampleAssetModel]),
});

const cell = (c: ColumnContext, key: string, f: typeof exampleFinding) => {
  const col = findingColumns(c).find((x) => x.key === key);
  if (!col) return null;
  const { container } = render(<>{col.render(f, 0)}</>);
  return container.textContent;
};

describe("findingColumns", () => {
  it("keeps today's columns when no asset finding is in view", () => {
    expect(findingColumns(ctx(false)).map((c) => c.key)).toEqual([
      "thumb",
      "number",
      "type",
      "severity",
      "location",
      "status",
      "updated",
    ]);
  });

  it("adds height, side, zone, component and sightings after location", () => {
    expect(findingColumns(ctx(true)).map((c) => c.key)).toEqual([
      "thumb",
      "number",
      "type",
      "severity",
      "location",
      "height",
      "side",
      "zone",
      "component",
      "sightings",
      "status",
      "updated",
    ]);
  });

  it("renders an asset finding's facts", () => {
    const c = ctx(true);
    expect(cell(c, "height", exampleAssetFinding)).toBe("42.5 m");
    expect(cell(c, "side", exampleAssetFinding)).toBe("E");
    expect(cell(c, "zone", exampleAssetFinding)).toBe("Shaft");
    expect(cell(c, "component", exampleAssetFinding)).toBe("Shell");
    expect(cell(c, "sightings", exampleAssetFinding)).toBe("3");
  });

  it("says Unplaced without a height, and leaves image rows empty", () => {
    const c = ctx(true);
    expect(cell(c, "height", exampleUnplacedAssetFinding)).toBe("Unplaced");
    expect(cell(c, "zone", exampleUnplacedAssetFinding)).toBe("");
    for (const key of ["height", "side", "zone", "component", "sightings"])
      expect(cell(c, key, exampleFinding)).toBe("");
  });
});
