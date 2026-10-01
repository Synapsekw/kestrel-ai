import { describe, expect, it } from "vitest";
import { composeOverview, ROWS_FULL, ROWS_NO_BOTTOM, type OverviewFacts } from "./compose";

const everything: OverviewFacts = {
  heroKind: "map",
  dataTotal: 1290,
  hasCloud: true,
  hasImages: true,
  hasSite: true,
  findingsTotal: 38,
  runningJobs: false,
};
const ids = (f: OverviewFacts) => composeOverview(f).panes.map((p) => p.id);
const pane = (f: OverviewFacts, id: string) => composeOverview(f).panes.find((p) => p.id === id);

describe("composeOverview", () => {
  it("everything: hero on 8 columns, cloud over location, three panes below", () => {
    const c = composeOverview(everything);
    expect(c.rows).toBe(ROWS_FULL);
    expect(ids(everything)).toEqual(["header", "hero", "cloud", "location", "findings", "imagery", "status"]);
    expect(pane(everything, "hero")).toEqual({ id: "hero", col: "1 / span 8", row: "2 / span 2" });
    expect(pane(everything, "cloud")).toEqual({ id: "cloud", col: "9 / -1", row: "2" });
    expect(pane(everything, "location")).toEqual({ id: "location", col: "9 / -1", row: "3" });
    expect(pane(everything, "findings")?.col).toBe("1 / span 5");
    expect(pane(everything, "imagery")?.col).toBe("6 / span 4");
    expect(pane(everything, "status")?.col).toBe("10 / span 3");
  });

  it("no ortho: the cloud is the hero, so there is no cloud tile and location fills the column", () => {
    const f = { ...everything, heroKind: "point_cloud" as const };
    expect(ids(f)).not.toContain("cloud");
    expect(pane(f, "location")).toEqual({ id: "location", col: "9 / -1", row: "2 / span 2" });
  });

  it("images only: the mosaic is the hero, so there is no imagery pane; findings and status share the row", () => {
    const f = { ...everything, heroKind: "images" as const, hasCloud: false };
    expect(ids(f)).toEqual(["header", "hero", "location", "findings", "status"]);
    expect(pane(f, "findings")?.col).toBe("1 / span 8");
    expect(pane(f, "status")?.col).toBe("9 / span 4");
  });

  it("no location and no cloud: the hero takes the full width", () => {
    const f = { ...everything, hasCloud: false, hasSite: false };
    expect(pane(f, "hero")?.col).toBe("1 / -1");
  });

  it("an empty project is the first-data screen only", () => {
    const f: OverviewFacts = {
      ...everything,
      heroKind: null,
      dataTotal: 0,
      hasCloud: false,
      hasImages: false,
      hasSite: false,
      findingsTotal: 0,
    };
    expect(composeOverview(f).panes).toEqual([{ id: "firstData", col: "1 / -1", row: "1 / -1" }]);
  });

  it("findings on a cloud with no images: findings and status fill the row, no imagery", () => {
    const f = { ...everything, heroKind: "point_cloud" as const, hasImages: false };
    expect(ids(f)).toEqual(["header", "hero", "location", "findings", "status"]);
    const cols = composeOverview(f)
      .panes.filter((p) => p.row === "4")
      .map((p) => p.col);
    expect(cols).toEqual(["1 / span 8", "9 / span 4"]);
  });

  it("images but no findings: a findings call to action, no status", () => {
    const f = { ...everything, findingsTotal: 0 };
    expect(ids(f)).toEqual(["header", "hero", "cloud", "location", "findings", "imagery"]);
    expect(pane(f, "findings")?.col).toBe("1 / span 7");
  });

  it("a drawing only: no bottom row and no empty track", () => {
    const f: OverviewFacts = {
      ...everything,
      heroKind: "drawing",
      dataTotal: 1,
      hasCloud: false,
      hasImages: false,
      hasSite: false,
      findingsTotal: 0,
    };
    const c = composeOverview(f);
    expect(c.panes.map((p) => p.id)).toEqual(["header", "hero"]);
    expect(c.rows).toBe(ROWS_NO_BOTTOM);
  });

  it("a running job alone brings the status pane", () => {
    const f = {
      ...everything,
      findingsTotal: 0,
      hasImages: false,
      heroKind: "point_cloud" as const,
      runningJobs: true,
    };
    expect(ids(f)).toContain("status");
  });

  it("every bottom row fills exactly 12 columns", () => {
    for (const findingsTotal of [0, 5])
      for (const hasImages of [true, false])
        for (const runningJobs of [true, false]) {
          const c = composeOverview({ ...everything, findingsTotal, hasImages, runningJobs });
          const spans = c.panes.filter((p) => p.row === "4").map((p) => Number(p.col.split("span ")[1]));
          if (spans.length) expect(spans.reduce((a, b) => a + b, 0)).toBe(12);
        }
  });
});
