import { describe, expect, it } from "vitest";
import { CLASS_ID } from "@/test/fixtures";
import { reportConfig } from "@/test/reportBuilderFixtures";
import {
  allTypes,
  moveSection,
  moveSectionTo,
  normaliseSections,
  portableConfig,
  positionAnnouncement,
  setDate,
  setDateRule,
  setSectionEnabled,
  setSectionOptions,
  setSeverityMin,
  toggleDataItem,
  toggleFormat,
  toggleStatus,
  toggleType,
  type Filters,
  type Sections,
} from "./builderModel";

const keys = (s: Sections | null) => s?.map((x) => x.key);
const base = () => reportConfig().sections;

describe("sections", () => {
  it("keeps the cover first", () => {
    const s = base();
    const moved = [s[1], s[0], ...s.slice(2)];
    expect(keys(normaliseSections(moved))?.slice(0, 2)).toEqual(["cover", "summary"]);
    expect(normaliseSections(s)).toBe(s);
  });

  it("moves one place, never above the cover, never the cover itself", () => {
    expect(keys(moveSection(base(), "measurements", -1))?.slice(3, 5)).toEqual([
      "measurements",
      "finding_pages",
    ]);
    expect(moveSection(base(), "summary", -1)).toBeNull();
    expect(moveSection(base(), "cover", 1)).toBeNull();
    expect(moveSection(base(), "appendix", 1)).toBeNull();
  });

  it("drops a dragged section where the target was", () => {
    expect(keys(moveSectionTo(base(), "appendix", "summary"))?.slice(0, 3)).toEqual([
      "cover",
      "appendix",
      "summary",
    ]);
    expect(keys(moveSectionTo(base(), "summary", "measurements"))?.slice(1, 5)).toEqual([
      "findings_table",
      "finding_pages",
      "measurements",
      "summary",
    ]);
    expect(keys(moveSectionTo(base(), "appendix", "cover"))?.slice(0, 2)).toEqual(["cover", "appendix"]);
    expect(moveSectionTo(base(), "cover", "appendix")).toBeNull();
    expect(moveSectionTo(base(), "summary", "summary")).toBeNull();
  });

  it("toggles and edits one section only", () => {
    const off = setSectionEnabled(base(), "appendix", false);
    expect(off.find((s) => s.key === "appendix")?.enabled).toBe(false);
    expect(off.find((s) => s.key === "summary")?.enabled).toBe(true);
    const opts = setSectionOptions(base(), "finding_pages", { photos_max: 0 });
    expect(opts.find((s) => s.key === "finding_pages")?.options).toMatchObject({
      photos_max: 0,
      comments: "last",
    });
  });

  it("announces a new position", () => {
    const next = moveSection(base(), "measurements", -1)!;
    expect(positionAnnouncement(next, "measurements")).toBe("Measurements moved to position 4 of 8");
  });
});

describe("filters", () => {
  const f = (): Filters => reportConfig().filters;

  it("sets a severity floor and clears it", () => {
    expect(setSeverityMin(f(), 3).severity_min).toBe(3);
    expect(setSeverityMin(setSeverityMin(f(), 3), null).severity_min).toBeNull();
  });

  it("sets include_ungraded per the severity floor (Ruling R-7.1)", () => {
    expect(setSeverityMin(f(), 3).include_ungraded).toBe(false);
    expect(setSeverityMin(setSeverityMin(f(), 3), null).include_ungraded).toBe(true);
  });

  it("toggles statuses", () => {
    expect(toggleStatus(f(), "closed").statuses).toEqual(["open", "reviewed", "closed"]);
    expect(toggleStatus(f(), "open").statuses).toEqual(["reviewed"]);
  });

  it("treats no types as every type", () => {
    const one = toggleType(f(), CLASS_ID(1));
    expect(one.type_ids).toEqual([CLASS_ID(1)]);
    expect(toggleType(one, CLASS_ID(2)).type_ids).toEqual([CLASS_ID(1), CLASS_ID(2)]);
    expect(toggleType(one, CLASS_ID(1)).type_ids).toBeNull();
    expect(allTypes(one).type_ids).toBeNull();
  });

  it("treats no data items as every data item", () => {
    const one = toggleDataItem(f(), "d1");
    expect(one.data_item_ids).toEqual(["d1"]);
    expect(toggleDataItem(one, "d1").data_item_ids).toBeNull();
  });

  it("switches date rules with sensible defaults and nulls elsewhere", () => {
    expect(setDateRule(f(), "last_days", "2026-09-30").date).toEqual({
      rule: "last_days",
      from: null,
      to: null,
      days: 30,
    });
    expect(setDateRule(f(), "range", "2026-09-30").date).toEqual({
      rule: "range",
      from: "2026-09-30",
      to: "2026-09-30",
      days: null,
    });
    expect(setDateRule(f(), "since_last_issued", "2026-09-30").date).toEqual({
      rule: "since_last_issued",
      from: null,
      to: null,
      days: null,
    });
    expect(setDate(setDateRule(f(), "last_days", "2026-09-30"), { days: 14 }).date.days).toBe(14);
  });
});

describe("formats and templates", () => {
  it("always keeps the PDF", () => {
    expect(toggleFormat(["pdf"], "xlsx")).toEqual(["pdf", "xlsx"]);
    expect(toggleFormat(["pdf", "xlsx"], "xlsx")).toEqual(["pdf"]);
    expect(toggleFormat(["pdf"], "pdf")).toEqual(["pdf"]);
  });

  it("drops the project-only fields from a template", () => {
    const c = reportConfig();
    const own = {
      ...c,
      cover: { ...c.cover, logo_asset_id: "a1", report_date: "2026-09-30" },
      filters: { ...c.filters, data_item_ids: ["d1"] },
    };
    const t = portableConfig(own);
    expect(t.filters.data_item_ids).toBeNull();
    expect(t.cover.logo_asset_id).toBeNull();
    expect(t.cover.report_date).toBeNull();
    expect(t.sections).toEqual(c.sections);
  });
});
