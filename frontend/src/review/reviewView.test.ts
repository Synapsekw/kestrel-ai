import { describe, expect, it } from "vitest";
import { reviewView } from "./reviewView";

const v = (q: string) => reviewView(new URLSearchParams(q));

describe("reviewView", () => {
  it("defaults to image suggestions", () => expect(v("")).toBe("suggestions"));
  it("follows ?view=", () => {
    expect(v("view=runs")).toBe("runs");
    expect(v("view=suggestions")).toBe("suggestions");
  });
  it("shows runs for a ?source= link", () => expect(v("source=s1")).toBe("runs"));
  it("always shows suggestions for a run's ?ids= link", () =>
    expect(v("ids=a,b&view=runs")).toBe("suggestions"));
});
