import type { ReportConfig, RenderRequest, SectionKey } from "@/api/reports";

// Pure changes to a ReportConfig (plan R7 Task 2). The builder, the section list and the filters
// call these, so every rule about order and filters is unit-tested once.

/** The Data list page for the data-item filter (plan R7 "Budget"). */
export const DATA_ITEMS_LIMIT = 200;
/** Spec §12: an edit is sent 400 ms after the last change. */
export const PATCH_DEBOUNCE_MS = 400;

export const SECTION_LABEL: Record<SectionKey, string> = {
  cover: "Cover",
  summary: "Executive summary",
  findings_table: "Findings table",
  finding_pages: "Finding pages",
  measurements: "Measurements",
  comparison: "Survey comparison",
  object_counts: "Object counts",
  appendix: "Appendix",
};

export type Sections = ReportConfig["sections"];
export type Filters = ReportConfig["filters"];
type Section = Sections[number];
type Options = Record<string, unknown>;

/** Cover always prints first (spec §12, Ruling 4). */
export function normaliseSections(sections: Sections): Sections {
  const at = sections.findIndex((s) => s.key === "cover");
  if (at <= 0) return sections;
  const next = [...sections];
  const [cover] = next.splice(at, 1);
  return [cover, ...next];
}

const floorOf = (sections: Sections): number => (sections[0]?.key === "cover" ? 1 : 0);

/** One place up (−1) or down (1); null when `key` cannot move that way. */
export function moveSection(sections: Sections, key: SectionKey, delta: -1 | 1): Sections | null {
  const from = sections.findIndex((s) => s.key === key);
  const to = from + delta;
  if (from < 0 || key === "cover" || to < floorOf(sections) || to >= sections.length) return null;
  const next = [...sections];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Drag and drop: `key` takes `target`'s place (just below the cover when dropped on it). */
export function moveSectionTo(sections: Sections, key: SectionKey, target: SectionKey): Sections | null {
  const from = sections.findIndex((s) => s.key === key);
  const to = sections.findIndex((s) => s.key === target);
  if (from < 0 || to < 0 || from === to || key === "cover") return null;
  const next = [...sections];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(to, floorOf(sections)), 0, moved);
  return next;
}

export function setSectionEnabled(sections: Sections, key: SectionKey, enabled: boolean): Sections {
  return sections.map((s) => (s.key === key ? ({ ...s, enabled } as Section) : s));
}

export function setSectionOptions(sections: Sections, key: SectionKey, patch: Options): Sections {
  return sections.map((s) =>
    s.key === key ? ({ ...s, options: { ...(s.options as Options), ...patch } } as Section) : s,
  );
}

export function positionAnnouncement(sections: Sections, key: SectionKey): string {
  const at = sections.findIndex((s) => s.key === key);
  return `${SECTION_LABEL[key]} moved to position ${at + 1} of ${sections.length}`;
}

type DateFilter = Filters["date"];
export type DateRule = DateFilter["rule"];
type Status = Filters["statuses"][number];

const toggleIn = <T>(list: readonly T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
/** "None chosen" is every one (Ruling 13). */
const orAll = (list: string[]): string[] | null => (list.length === 0 ? null : list);

/**
 * Sets the severity floor. Ruling R-7.1 (coordinator ruling, overrides plan T2/T5, spec §7.1):
 * choosing a level excludes ungraded findings by default (`include_ungraded: false`); clearing the
 * level (back to "every level") restores `include_ungraded: true`. The control (Task 5) is a
 * Checkbox named "Include ungraded findings", shown only while a level is chosen, and can still
 * flip `include_ungraded` back on without changing `severity_min` — this function only sets the
 * default that follows a floor change.
 */
export const setSeverityMin = (f: Filters, level: number | null): Filters => ({
  ...f,
  severity_min: level,
  include_ungraded: level === null,
});

export const toggleStatus = (f: Filters, status: Status): Filters => ({ ...f, statuses: toggleIn(f.statuses, status) });

export const toggleType = (f: Filters, id: string): Filters => ({ ...f, type_ids: orAll(toggleIn(f.type_ids ?? [], id)) });

export const allTypes = (f: Filters): Filters => ({ ...f, type_ids: null });

export const toggleDataItem = (f: Filters, id: string): Filters => ({
  ...f,
  data_item_ids: orAll(toggleIn(f.data_item_ids ?? [], id)),
});

/** `today` is `YYYY-MM-DD`; it seeds a new range. Fields the rule does not use are null (R0's shape). */
export function setDateRule(f: Filters, rule: DateRule, today: string): Filters {
  const d = f.date;
  const date: DateFilter =
    rule === "range"
      ? { rule, from: d.from ?? today, to: d.to ?? today, days: null }
      : rule === "last_days"
        ? { rule, from: null, to: null, days: d.days ?? 30 }
        : { rule, from: null, to: null, days: null };
  return { ...f, date };
}

export function setDate(f: Filters, patch: Partial<Omit<DateFilter, "rule">>): Filters {
  return { ...f, date: { ...f.date, ...patch } };
}

export type RenderFormat = RenderRequest["formats"][number];

/** The PDF is always rendered (Ruling 3); CSV and XLSX toggle. */
export function toggleFormat(formats: RenderFormat[], fmt: RenderFormat): RenderFormat[] {
  if (fmt === "pdf") return formats;
  return formats.includes(fmt) ? formats.filter((x) => x !== fmt) : [...formats, fmt];
}

/** What a template may keep (Ruling 15, R1 Ruling 2): no data items, no logo, no fixed date. */
export function portableConfig(c: ReportConfig): ReportConfig {
  return {
    ...c,
    cover: { ...c.cover, logo_asset_id: null, report_date: null },
    filters: { ...c.filters, data_item_ids: null },
  };
}
