import { describe, expect, it } from "vitest";
import type { Block, BlockPage, OutlineSection } from "@/api/reports";
import { flipDeltas } from "./flip";
import { paginate } from "./paginate";
import { entryOf, sectionsReducer, type SectionEntry } from "./sectionBlocks";

const sec = (etag: string, block_count = 3): OutlineSection =>
  ({ key: "summary", title: "Summary", block_count, etag, estimated_pages: 1 }) as OutlineSection;
const page = (items: Block[], next_cursor: string | null) => ({ items, next_cursor }) as BlockPage;
const para = (text: string): Block => ({ kind: "para", text, style: "body" }) as Block;

// Built directly against the merged schema (contract/client/schema.d.ts) rather than Task 4's
// fixtures.ts, which this worktree does not yet have.
const finding = (finding_id: string, number: number): Block =>
  ({
    kind: "finding",
    finding_id,
    number,
    head: {
      type_name: "Crack",
      type_colour: "#FF5A4F",
      severity_level: 3,
      severity_name: "Major",
      severity_colour: "#FF9C3A",
      status: "open",
    },
    figures: [],
    kv: [],
    note: "",
    photos: [],
    comments: [],
  }) as Block;

const appendixBlocks: Block[] = [
  { kind: "heading", level: 2, text: "Method" } as Block,
  { kind: "para", text: "Snapshots are rendered from the source data.", style: "small" } as Block,
  { kind: "page_break" } as Block,
  { kind: "para", text: "Model provenance: yolo11s (0.87).", style: "note" } as Block,
];

const findingPageBlocks: Block[] = [finding("f42", 42), finding("f43", 43)];

const coverBlock: Block = {
  kind: "cover",
  title: "North yard inspection",
  subtitle: "Site inspection report",
  rows: [
    ["Site", "North yard"],
    ["Client", "Acme Build"],
  ],
  logo: null,
  locator: null,
} as Block;

describe("paginate", () => {
  it("splits at page breaks, drops the break, and gives each finding its own sheet", () => {
    const appendix = paginate("appendix", appendixBlocks);
    expect(appendix.map((s) => [s.kind, s.blocks.length])).toEqual([
      ["flow", 2],
      ["flow", 1],
    ]);
    const findings = paginate("finding_pages", findingPageBlocks);
    expect(findings.map((s) => s.kind)).toEqual(["finding", "finding"]);
    expect(findings[0].id).toBe("finding-f42");
    expect(paginate("x", [])).toEqual([]);
  });

  it("puts a cover block on its own sheet (Ruling R-6)", () => {
    const sheets = paginate("cover", [coverBlock]);
    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toMatchObject({ kind: "cover", blocks: [coverBlock] });
    expect(sheets[0].id).toContain("cover");
  });
});

describe("section cache", () => {
  it("starts idle, loads, appends pages and ends on a null cursor", () => {
    let s = sectionsReducer({}, { type: "start", section: sec("e1") });
    expect(s.summary.status).toBe("loading");
    expect(sectionsReducer(s, { type: "start", section: sec("e1") })).toBe(s); // no double start
    s = sectionsReducer(s, {
      type: "page",
      key: "summary",
      etag: "e1",
      cursor: null,
      page: page([para("a"), para("b")], "c2"),
    });
    expect(s.summary).toMatchObject({ status: "idle", cursor: "c2", done: false });
    s = sectionsReducer(s, { type: "start", section: sec("e1") });
    s = sectionsReducer(s, {
      type: "page",
      key: "summary",
      etag: "e1",
      cursor: "c2",
      page: page([para("c")], null),
    });
    expect(s.summary.done).toBe(true);
    expect(s.summary.blocks).toHaveLength(3);
  });

  it("ends on a repeated cursor (the Prism mock) and on an empty page", () => {
    let s = sectionsReducer({}, { type: "start", section: sec("e1") });
    s = sectionsReducer(s, {
      type: "page",
      key: "summary",
      etag: "e1",
      cursor: null,
      page: page([para("a")], "string"),
    });
    s = sectionsReducer(s, { type: "start", section: sec("e1") });
    s = sectionsReducer(s, {
      type: "page",
      key: "summary",
      etag: "e1",
      cursor: "string",
      page: page([para("a")], "string"),
    });
    expect(s.summary.done).toBe(true);
    let t = sectionsReducer({}, { type: "start", section: sec("e1") });
    t = sectionsReducer(t, { type: "page", key: "summary", etag: "e1", cursor: null, page: page([], "c9") });
    expect(t.summary.done).toBe(true);
  });

  it("ignores a page that arrives for an older etag, and keeps the old blocks as stale meanwhile", () => {
    let s = sectionsReducer({}, { type: "start", section: sec("e1") });
    s = sectionsReducer(s, {
      type: "page",
      key: "summary",
      etag: "e1",
      cursor: null,
      page: page([para("old")], null),
    });
    const changed = entryOf(s, sec("e2"));
    expect(changed).toMatchObject({ etag: "e2", blocks: [], done: false, status: "idle" });
    expect(changed.stale?.map((b) => (b as { text: string }).text)).toEqual(["old"]);
    s = sectionsReducer(s, { type: "start", section: sec("e2") });
    const late = sectionsReducer(s, {
      type: "page",
      key: "summary",
      etag: "e1",
      cursor: null,
      page: page([para("late")], null),
    });
    expect(late).toBe(s);
    expect(entryOf(s, sec("e2")).blocks).toEqual([]);
  });

  it("keeps a loaded entry when the etag is unchanged", () => {
    let s = sectionsReducer({}, { type: "start", section: sec("e1") });
    s = sectionsReducer(s, {
      type: "page",
      key: "summary",
      etag: "e1",
      cursor: null,
      page: page([para("a")], null),
    });
    expect(entryOf(s, sec("e1"))).toBe(s.summary);
  });

  it("treats an empty section as done without a request", () => {
    const e: SectionEntry = entryOf({}, sec("e1", 0));
    expect(e.done).toBe(true);
    expect(sectionsReducer({}, { type: "start", section: sec("e1", 0) })).toEqual({});
  });

  it("records a failure and lets retry return to idle", () => {
    let s = sectionsReducer({}, { type: "start", section: sec("e1") });
    s = sectionsReducer(s, { type: "fail", key: "summary", etag: "e1", error: "disk" });
    expect(s.summary).toMatchObject({ status: "error", error: "disk" });
    s = sectionsReducer(s, { type: "retry", key: "summary", etag: "e1" });
    expect(s.summary).toMatchObject({ status: "idle", error: null });
  });
});

describe("flipDeltas", () => {
  it("returns how far each moved section must start from", () => {
    const before = new Map([
      ["a", 0],
      ["b", 100],
      ["c", 200],
    ]);
    const after = new Map([
      ["b", 0],
      ["a", 100],
      ["c", 200],
      ["d", 300],
    ]);
    expect([...flipDeltas(before, after)]).toEqual([
      ["b", 100],
      ["a", -100],
    ]);
  });
});
