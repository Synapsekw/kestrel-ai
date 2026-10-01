import type {
  Block,
  BlockKind,
  BlockOf,
  BlockPage,
  LoadBlocks,
  OutlineSection,
  ReportOutline,
  SectionKey,
  SnapshotRef,
} from "@/api/reports";

/** Every block kind once: a compile error here means R0 added or renamed a kind. */
export const ALL_BLOCK_KINDS = {
  heading: true,
  para: true,
  kv: true,
  kpis: true,
  table: true,
  figure: true,
  figure_row: true,
  chart: true,
  finding: true,
  page_break: true,
  volume: true,
  cover: true,
} satisfies Record<BlockKind, true>;

export function snap(key: string, missing_reason: string | null = null): SnapshotRef {
  return {
    key,
    spec: { kind: "volume_plan", measurement_id: "m1" } as SnapshotRef["spec"],
    width_px: 1200,
    height_px: 900,
    missing_reason,
  };
}

export function figure(
  key: string,
  caption: string,
  width_mm = 170,
  height_mm = 105,
  missing: string | null = null,
): BlockOf<"figure"> {
  return { kind: "figure", snapshot: snap(key, missing), caption, width_mm, height_mm };
}

const finding42: BlockOf<"finding"> = {
  kind: "finding",
  finding_id: "f42",
  number: 42,
  head: {
    type_name: "Crack",
    type_colour: "#FF5A4F",
    severity_level: 3,
    severity_name: "Major",
    severity_colour: "#FF9C3A",
    status: "open",
  },
  figures: [
    figure("s-main", "Image crop"),
    figure("s-map", "Map", 83, 52),
    figure("s-3d", "3D view", 83, 52),
  ],
  kv: [
    ["Data item", "DJI_0042.JPG"],
    ["Observed", "2026-09-24"],
    ["Coordinates", "44.99012, 15.01234"],
  ],
  note: "Hairline crack along the joint.",
  photos: [figure("p1", "", 40, 30), figure("p2", "North face", 40, 30)],
  comments: [{ author: "D. Jovanovic", text: "Checked on site.", created_at: "2026-09-24T09:12:00Z" }],
};

const finding43: BlockOf<"finding"> = {
  kind: "finding",
  finding_id: "f43",
  number: 43,
  head: {
    type_name: "Spall",
    type_colour: "#3FB68E",
    severity_level: null,
    severity_name: null,
    severity_colour: null,
    status: "reviewed",
  },
  figures: [figure("s-gone", "Image crop", 170, 105, "The source image was moved")],
  kv: [],
  note: "",
  photos: [],
  comments: [],
};

export const FIXTURE_BLOCKS: Record<SectionKey, Block[]> = {
  cover: [
    {
      kind: "cover",
      title: "North yard inspection",
      subtitle: "Monthly condition survey",
      rows: [
        ["Project", "North yard"],
        ["Site", "North yard"],
        ["Client", "Acme Build"],
        ["Author", "D. Jovanovic"],
        ["Report date", "2026-09-30"],
      ],
      logo: { asset_id: "logo1", path: "reports/assets/logo-1a2b3c4d.png", width_px: 600, height_px: 200 },
      locator: figure("loc", "Site locator", 83, 52),
    },
  ],
  summary: [
    { kind: "heading", level: 2, text: "Findings at a glance" },
    {
      kind: "kpis",
      items: [
        { label: "Findings", value: "38", delta: "+4 since v1", tone: "bad", colour: null },
        { label: "Closed", value: "12", delta: "3 closed since v1", tone: "good", colour: "#3FB68E" },
        { label: "Ungraded", value: "2", delta: null, tone: "neutral", colour: null },
      ],
    },
    {
      kind: "chart",
      chart: "bar",
      title: null,
      series: [{ name: "Findings", values: [12, 8, 5, 3], colour: null }],
      x_labels: ["Crack", "Spall", "Rust", "Leak"],
      unit: "findings",
    },
    {
      kind: "chart",
      chart: "stacked_bar",
      title: "Findings by severity",
      series: [
        { name: "Open", values: [4, 3], colour: null },
        { name: "Closed", values: [2, 5], colour: null },
      ],
      x_labels: ["Major", "Minor"],
      unit: "findings",
    },
    {
      kind: "chart",
      chart: "line",
      title: null,
      series: [{ name: "Excavators", values: [3, 5, 4], colour: null }],
      x_labels: ["Jul", "Aug", "Sep"],
      unit: "",
    },
    { kind: "para", text: "Work progressed on the north face.\n\nTwo cracks need review.", style: "body" },
  ],
  findings_table: [
    {
      kind: "table",
      columns: [
        { key: "number", label: "No.", align: "left", width_mm: 18, style: "mono" },
        { key: "type", label: "Type", align: "left", width_mm: null, style: "text" },
        { key: "severity", label: "Severity", align: "left", width_mm: 24, style: "text" },
        { key: "area", label: "Area m²", align: "right", width_mm: 20, style: "text" },
      ],
      rows: [
        ["F-0042", "Crack", { text: "Major", dot: "#FF9C3A" }, "0.40"],
        ["F-0043", "Spall", "Ungraded", ""],
      ],
      repeat_header: true,
    },
  ],
  finding_pages: [finding42, finding43],
  measurements: [
    { kind: "heading", level: 2, text: "Volumes" },
    {
      kind: "volume",
      measurement_id: "m1",
      title: "Stockpile A",
      rows: [
        ["Cut", "1 204.5 m³"],
        ["Fill", "310.2 m³"],
        ["Net", "894.3 m³"],
      ],
      figure: figure("v1", "Stockpile A plan"),
      stale: false,
    },
    { kind: "volume", measurement_id: "m2", title: "Stockpile B", rows: [], figure: null, stale: true },
    { kind: "figure_row", figures: [figure("l1", "Length 1", 83, 52), figure("l2", "Length 2", 83, 52)] },
    figure("a1", "Area 1"),
  ],
  comparison: [{ kind: "para", text: "No data", style: "small" }],
  object_counts: [{ kind: "para", text: "No data", style: "small" }],
  appendix: [
    { kind: "heading", level: 2, text: "Method" },
    { kind: "para", text: "Snapshots are rendered from the source data.", style: "small" },
    {
      kind: "kv",
      rows: [
        ["Site", "North yard"],
        ["Client", "Acme Build"],
        ["Author", "D. Jovanovic"],
      ],
    },
    { kind: "page_break" },
    { kind: "para", text: "Model provenance: yolo11s (0.87).", style: "note" },
  ],
};

export function outlineSection(
  key: SectionKey,
  title: string,
  etag: string,
  estimated_pages = 1,
): OutlineSection {
  return { key, title, block_count: FIXTURE_BLOCKS[key].length, etag, estimated_pages };
}

export const FIXTURE_OUTLINE: ReportOutline = {
  report_id: "r-fixture",
  sections: [
    outlineSection("cover", "Cover", "e-cover"),
    outlineSection("summary", "Summary", "e-summary"),
    outlineSection("findings_table", "Findings table", "e-table"),
    outlineSection("finding_pages", "Finding pages", "e-pages", 2),
    outlineSection("measurements", "Measurements", "e-meas"),
    outlineSection("appendix", "Appendix", "e-app", 2),
  ],
  finding_count: 2,
  warnings: [],
  deltas: { baseline: null, new: 0, closed: 0, escalated: 0, deescalated: 0, reopened: 0, left: 0 },
};

/** Serves FIXTURE_BLOCKS a page at a time; the cursor is the next offset. */
export function fixtureLoader(blocks: Record<string, Block[]> = FIXTURE_BLOCKS, pageSize = 50): LoadBlocks {
  return (key, cursor) => {
    const all = blocks[key] ?? [];
    const start = cursor ? Number(cursor) : 0;
    const end = start + pageSize;
    const page = { items: all.slice(start, end), next_cursor: end < all.length ? String(end) : null };
    return Promise.resolve(page as BlockPage);
  };
}
