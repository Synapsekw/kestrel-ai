import { describe, expect, it } from "vitest";
import { parseEntry } from "./entryParams";

const q = (s: string) => new URLSearchParams(s);

describe("parseEntry", () => {
  it("reads the review and label redirects", () => {
    expect(parseEntry(q("filter=suggestions"))).toEqual({ preset: "suggestions", batch: false });
    expect(parseEntry(q("filter=unlabeled"))).toEqual({ preset: "unlabeled", batch: false });
  });
  it("reads the query redirect", () =>
    expect(parseEntry(q("batch=1"))).toEqual({ preset: null, batch: true }));
  it("treats an unknown filter as the defaults and a stray ids as present", () => {
    expect(parseEntry(q("filter=zzz"))).toEqual({ preset: "default", batch: false });
    expect(parseEntry(q("ids=a,b"))).toEqual({ preset: null, batch: false });
  });
  it("is null without entry keys", () => expect(parseEntry(q("at=1,2"))).toBeNull());
});
