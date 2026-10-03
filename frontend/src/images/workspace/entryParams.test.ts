import { describe, expect, it } from "vitest";
import { parseEntry } from "./entryParams";

const q = (s: string) => new URLSearchParams(s);

describe("parseEntry", () => {
  it("reads the review and label redirects", () => {
    expect(parseEntry(q("filter=suggestions"))).toEqual({
      preset: "suggestions",
      batch: false,
      sourceId: null,
      review: null,
    });
    expect(parseEntry(q("filter=unlabeled"))).toEqual({
      preset: "unlabeled",
      batch: false,
      sourceId: null,
      review: null,
    });
  });
  it("reads the query redirect", () =>
    expect(parseEntry(q("batch=1"))).toEqual({ preset: null, batch: true, sourceId: null, review: null }));
  it("treats an unknown filter as the defaults and a stray ids as present", () => {
    expect(parseEntry(q("filter=zzz"))).toEqual({
      preset: "default",
      batch: false,
      sourceId: null,
      review: null,
    });
    expect(parseEntry(q("ids=a,b"))).toEqual({ preset: null, batch: false, sourceId: null, review: null });
  });
  it("reads the old /query?source= as the flight filter (m2)", () => {
    expect(parseEntry(q("source=s1&batch=1"))).toEqual({
      preset: null,
      batch: true,
      sourceId: "s1",
      review: null,
    });
    expect(parseEntry(q("source="))).toEqual({ preset: null, batch: false, sourceId: null, review: null });
  });
  it("reads the photo review entry from the register's outcome chips", () => {
    expect(parseEntry(q("review=uncertain"))).toEqual({
      preset: null,
      batch: false,
      sourceId: null,
      review: "uncertain",
    });
    expect(parseEntry(q("review=all"))).toEqual({
      preset: null,
      batch: false,
      sourceId: null,
      review: "all",
    });
    expect(parseEntry(q("review=bogus"))).toEqual({
      preset: null,
      batch: false,
      sourceId: null,
      review: null,
    });
  });
  it("is null without entry keys", () => expect(parseEntry(q("at=1,2"))).toBeNull());
});
