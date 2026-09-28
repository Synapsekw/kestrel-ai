import { describe, expect, it } from "vitest";
import { parseEntry } from "./entryParams";

const q = (s: string) => new URLSearchParams(s);

describe("parseEntry", () => {
  it("reads the review and label redirects", () => {
    expect(parseEntry(q("filter=suggestions"))).toEqual({
      preset: "suggestions",
      batch: false,
      sourceId: null,
    });
    expect(parseEntry(q("filter=unlabeled"))).toEqual({ preset: "unlabeled", batch: false, sourceId: null });
  });
  it("reads the query redirect", () =>
    expect(parseEntry(q("batch=1"))).toEqual({ preset: null, batch: true, sourceId: null }));
  it("treats an unknown filter as the defaults and a stray ids as present", () => {
    expect(parseEntry(q("filter=zzz"))).toEqual({ preset: "default", batch: false, sourceId: null });
    expect(parseEntry(q("ids=a,b"))).toEqual({ preset: null, batch: false, sourceId: null });
  });
  it("reads the old /query?source= as the flight filter (m2)", () => {
    expect(parseEntry(q("source=s1&batch=1"))).toEqual({ preset: null, batch: true, sourceId: "s1" });
    expect(parseEntry(q("source="))).toEqual({ preset: null, batch: false, sourceId: null });
  });
  it("is null without entry keys", () => expect(parseEntry(q("at=1,2"))).toBeNull());
});
