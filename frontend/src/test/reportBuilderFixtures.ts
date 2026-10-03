import type { Job } from "@contract/client";
import type {
  BlockPage,
  Report,
  ReportConfig,
  ReportListItem,
  ReportOutline,
  ReportTemplate,
  ReportVersion,
} from "@/api/reports";
import { runningJob } from "./fixtures";

// R7's report fixtures, typed against R0's schemas. When tsc names a missing required field, add it
// here with a neutral value and never cast.

export const REPORT_ID = "r0000000-9999-4000-8000-000000000001";
export const REPORT_ID_2 = "r0000000-9999-4000-8000-000000000002";
export const RENDER_JOB_ID = "j0000000-4444-4000-8000-000000000071";
export const LOGO_ASSET_ID = "l0000000-9999-4000-8000-000000000001";

const TITLES: Record<string, string> = {
  cover: "Cover",
  summary: "Executive summary",
  findings_table: "Findings",
  finding_pages: "Finding pages",
  measurements: "Measurements",
  comparison: "Survey comparison",
  object_counts: "Object counts",
  appendix: "Appendix",
};

export function reportConfig(over: Partial<ReportConfig> = {}): ReportConfig {
  return {
    cover: {
      title: "Site inspection",
      subtitle: null,
      site: null,
      client: null,
      author: "Site engineer",
      logo_asset_id: null,
      report_date: null,
    },
    brand_id: null,
    csv_layout: "findings",
    paper: { size: "A4", orientation: "portrait" },
    filters: {
      severity_min: null,
      include_ungraded: true,
      statuses: ["open", "reviewed"],
      type_ids: null,
      data_item_ids: null,
      date: { rule: "all", from: null, to: null, days: null },
    },
    sections: [
      { key: "cover", enabled: true, options: { show_locator: true } },
      { key: "summary", enabled: true, options: { narrative: "", show_deltas: true } },
      {
        key: "findings_table",
        enabled: true,
        options: {
          columns: ["number", "type", "severity", "status", "data_item", "observed", "note"],
          sort: "severity_desc",
        },
      },
      {
        key: "finding_pages",
        enabled: true,
        options: {
          snapshots: ["image", "map", "cloud"],
          photos_max: 4,
          comments: "last",
          context_inset: true,
          min_severity: null,
        },
      },
      {
        key: "measurements",
        enabled: true,
        options: {
          kinds: ["length", "area", "height", "lean", "profile", "volume"],
          snapshots: true,
          measurement_ids: null,
        },
      },
      { key: "comparison", enabled: false, options: { pairs: "auto", mode: "both", counts_chart: true } },
      {
        key: "object_counts",
        enabled: false,
        options: { type_ids: null, per_area: true, verified_only: false },
      },
      { key: "appendix", enabled: true, options: { include_methods: true } },
    ],
    ...over,
  };
}

export function report(over: Partial<Report> = {}): Report {
  return {
    id: REPORT_ID,
    title: "Site inspection September",
    template_id: "builtin-full",
    archived: false,
    config: reportConfig(),
    created_at: "2026-09-24T08:00:00Z",
    updated_at: "2026-09-24T09:00:00Z",
    last_version: null,
    ...over,
  };
}

/** The outline of `config`'s enabled sections; `etags` overrides a section's etag (default `<key>-1`). */
export function outline(
  etags: Record<string, string> = {},
  over: Partial<ReportOutline> = {},
  config: ReportConfig = reportConfig(),
): ReportOutline {
  return {
    report_id: REPORT_ID,
    sections: config.sections
      .filter((s) => s.enabled)
      .map((s) => ({
        key: s.key,
        title: TITLES[s.key],
        block_count: 2,
        etag: etags[s.key] ?? `${s.key}-1`,
        estimated_pages: 1,
      })),
    finding_count: 38,
    warnings: [],
    deltas: { baseline: null, new: 0, closed: 0, escalated: 0, deescalated: 0, reopened: 0, left: 0 },
    ...over,
  };
}

export function blocks(text: string): BlockPage {
  return { items: [{ kind: "heading", level: 1, text }], next_cursor: null };
}

export function version(n: number, over: Partial<ReportVersion> = {}): ReportVersion {
  return {
    id: `v0000000-9999-4000-8000-00000000000${n}`,
    report_id: REPORT_ID,
    number: n,
    state: "ready",
    issued_at: null,
    job_id: null,
    folder: `reports/${REPORT_ID}/v00${n}`,
    files: [
      {
        name: `ahmadia-site-inspection-v00${n}.pdf`,
        kind: "pdf",
        bytes: 2_400_000,
        sha256: "a".repeat(64),
        pages: 38,
      },
      { name: "findings.csv", kind: "csv", bytes: 12_000, sha256: "b".repeat(64), pages: null },
    ],
    config: reportConfig(),
    baseline_version_id: null,
    stats: { finding_count: 38, page_count: 38, part_count: 1, warnings: [], label: null, error: null },
    created_at: "2026-09-24T10:00:00Z",
    ...over,
  };
}

/** A `ReportVersion["stats"]` with only the given keys set. */
export function stats(over: Partial<ReportVersion["stats"]> = {}): ReportVersion["stats"] {
  return {
    finding_count: null,
    page_count: null,
    part_count: null,
    warnings: [],
    label: null,
    error: null,
    ...over,
  };
}

export function renderJob(over: Partial<Job> = {}): Job {
  return {
    ...runningJob,
    id: RENDER_JOB_ID,
    type: "report_render",
    message: "Snapshots 12 / 40",
    params: { report_id: REPORT_ID, formats: ["pdf"] },
    ...over,
  };
}

function tpl(id: string, name: string, description: string): ReportTemplate {
  return {
    id,
    name,
    description,
    builtin: true,
    config: reportConfig(),
    created_at: "2026-09-30T00:00:00Z",
    updated_at: "2026-09-30T00:00:00Z",
  };
}

export const TEMPLATES: ReportTemplate[] = [
  tpl("builtin-full", "Full inspection report", "Every section."),
  tpl("builtin-findings-summary", "Findings summary", "Cover, summary and the findings table."),
  tpl("builtin-survey-counts", "Survey count report", "Cover, survey comparison and object counts."),
  tpl("builtin-volumes", "Volumes report", "Cover, volumes and the appendix."),
];

export function listItem(over: Partial<ReportListItem> = {}): ReportListItem {
  return {
    id: REPORT_ID,
    title: "Site inspection September",
    template_id: "builtin-full",
    archived: false,
    created_at: "2026-09-24T08:00:00Z",
    updated_at: "2026-09-24T09:00:00Z",
    last_version: { number: 3, state: "ready", issued_at: "2026-09-24T12:00:00Z", pages: 38 },
    ...over,
  };
}
