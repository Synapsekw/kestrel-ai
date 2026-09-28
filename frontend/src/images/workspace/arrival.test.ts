import { describe, expect, it } from "vitest";
import {
  DEFAULT_ARRIVAL_R,
  hasArrivalKeys,
  imageArrivalHref,
  parseArrival,
  stripKeys,
  withinImage,
} from "./arrival";

const q = (s: string) => new URLSearchParams(s);

describe("parseArrival", () => {
  it("reads a finding", () => {
    expect(parseArrival(q("finding=f0000000-9999-4000-8000-000000000217"))).toEqual({
      kind: "finding",
      findingId: "f0000000-9999-4000-8000-000000000217",
    });
  });

  it("reads a cloud arrival with every part", () => {
    expect(parseArrival(q("at=1200.5,800&r=40&from=cloud:c0000000-8888-4000-8000-000000000001"))).toEqual({
      kind: "point",
      px: 1200.5,
      py: 800,
      r: 40,
      cloudId: "c0000000-8888-4000-8000-000000000001",
    });
  });

  it("defaults r and allows no from", () => {
    expect(parseArrival(q("at=10,20"))).toEqual({
      kind: "point",
      px: 10,
      py: 20,
      r: DEFAULT_ARRIVAL_R,
      cloudId: null,
    });
  });

  it.each(["r=0", "r=-3", "r=abc", "r="])("falls back to r=24 for %s", (r) => {
    expect(parseArrival(q(`at=10,20&${r}`))).toMatchObject({ r: 24 });
  });

  it.each(["at=10", "at=10,20,30", "at=a,b", "at=1e3,2", "at=,", "at=-1,5", "at=10;20"])(
    "ignores a malformed %s",
    (s) => {
      expect(parseArrival(q(s))).toBeNull();
    },
  );

  it.each(["from=map:m1", "from=cloud:", "from=cloud:a/b", "from=cloud"])("gives no chip for %s", (f) => {
    expect(parseArrival(q(`at=1,2&${f}`))).toMatchObject({ cloudId: null });
  });

  it("prefers the finding when both are present", () => {
    expect(parseArrival(q("finding=f1&at=1,2"))).toEqual({ kind: "finding", findingId: "f1" });
  });

  it("falls through to at when the finding id is malformed", () => {
    expect(parseArrival(q("finding=../x&at=1,2"))).toMatchObject({ kind: "point" });
  });

  it("is null without parameters", () => {
    expect(parseArrival(q("filter=unlabeled"))).toBeNull();
  });

  it("gives a back arrival for a valid from with no at", () => {
    expect(parseArrival(q("from=cloud:c1"))).toEqual({ kind: "back", cloudId: "c1" });
  });

  it("gives a back arrival for a valid from with a malformed at", () => {
    expect(parseArrival(q("at=x,1&from=cloud:c1"))).toEqual({ kind: "back", cloudId: "c1" });
  });
});

describe("helpers", () => {
  it("knows when arrival keys are present, malformed or not", () => {
    expect(hasArrivalKeys(q("at=garbage"))).toBe(true);
    expect(hasArrivalKeys(q("filter=unlabeled"))).toBe(false);
  });

  it("strips only the named keys", () => {
    expect(stripKeys(q("at=1,2&r=3&from=cloud:c&filter=x"), ["at", "r", "from", "finding"]).toString()).toBe(
      "filter=x",
    );
  });

  it("keeps an arrival inside the frame, edges included", () => {
    expect(withinImage({ px: 0, py: 0 }, 4000, 2667)).toBe(true);
    expect(withinImage({ px: 4000, py: 2667 }, 4000, 2667)).toBe(true);
    expect(withinImage({ px: 4000.5, py: 10 }, 4000, 2667)).toBe(false);
  });

  it("builds C's link", () => {
    expect(imageArrivalHref("p1", "i1", { px: 12.34567, py: 8, r: 30, cloudId: "c1" })).toBe(
      "/p/p1/images/i1?at=12.346,8.000&r=30&from=cloud:c1",
    );
    expect(imageArrivalHref("p1", "i1", { px: 1, py: 2 })).toBe("/p/p1/images/i1?at=1.000,2.000");
  });
});
