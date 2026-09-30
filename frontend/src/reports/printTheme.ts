import type { CSSProperties } from "react";

/**
 * The print design (spec §10.1). A literal copy of contract/fixtures/report-theme.json (R4 owns the
 * fixture; printTheme.parity.test.ts pins the copy). Blocks never read PRINT_THEME: they use PRINT
 * and the helpers below, so a change in the fixture's shape touches this file only.
 */
export const PRINT_THEME = {
  version: 1,
  fonts: { sans: "Space Grotesk", mono: "JetBrains Mono" },
  colours: {
    ink: "#15142B",
    muted: "#5E5C7A",
    rule: "#DAD8EA",
    head_fill: "#F3F1FC",
    paper: "#FFFFFF",
    violet: "#6A5CFF",
    violet_print: "#8F7BFF",
    teal: "#0F8F76",
    teal_print: "#5FE3C0",
    placeholder_fill: "#EEEDF5",
    ungraded: "#9A98B0",
    tone_neutral: "#5E5C7A",
    tone_good: "#0F8F76",
    tone_bad: "#B3261E",
    tone_warn: "#8A5A00",
  },
  cover: {
    gradient: ["#3B2A7A", "#6A5CFF", "#0F5B66"],
    band_fraction: 0.38,
    title_pt: 30,
    subtitle_pt: 12,
    logo_chip_mm: [44, 22],
  },
  type: {
    body_pt: 9.5,
    body_leading_pt: 13,
    small_pt: 8,
    note_pt: 9,
    h1_pt: 18,
    h2_pt: 14,
    h3_pt: 11,
    mono_pt: 8.5,
    furniture_pt: 7.5,
    kpi_value_pt: 16,
  },
  page: {
    margin_mm: 18,
    furniture_offset_mm: 10,
    radius_mm: 3,
    sizes_mm: { A4: [210, 297], Letter: [215.9, 279.4] },
  },
  severity: { dot_mm: 2.2, pill_tint: 0.12 },
  finding: { main_mm: [170, 105], secondary_mm: [83, 52], photo_mm: [40, 30] },
  chart: {
    height_mm: 70,
    palette: ["#6A5CFF", "#0F8F76", "#8F7BFF", "#5FE3C0", "#5E5C7A", "#3B2A7A"],
  },
} as const;

const C = PRINT_THEME.colours;
const T = PRINT_THEME.type;

/** The names the preview blocks use. */
export const PRINT = {
  paper: C.paper,
  ink: C.ink,
  muted: C.muted,
  rule: C.rule,
  head: C.head_fill,
  placeholder: C.placeholder_fill,
  accent: C.violet,
  teal: C.teal,
  ungraded: C.ungraded,
  danger: C.tone_bad,
  tone: { neutral: C.tone_neutral, good: C.tone_good, bad: C.tone_bad, warn: C.tone_warn },
  cover: PRINT_THEME.cover.gradient,
  series: PRINT_THEME.chart.palette,
  size: {
    body: T.body_pt,
    leading: T.body_leading_pt,
    h1: T.h1_pt,
    h2: T.h2_pt,
    h3: T.h3_pt,
    mono: T.mono_pt,
    small: T.small_pt,
    comment: T.note_pt,
    kpi: T.kpi_value_pt,
    coverTitle: PRINT_THEME.cover.title_pt,
    coverSubtitle: PRINT_THEME.cover.subtitle_pt,
  },
  margin: PRINT_THEME.page.margin_mm,
  radius: PRINT_THEME.page.radius_mm,
  coverBand: PRINT_THEME.cover.band_fraction,
  tint: PRINT_THEME.severity.pill_tint,
  dot: PRINT_THEME.severity.dot_mm,
  chartHeight: PRINT_THEME.chart.height_mm,
  logoChip: PRINT_THEME.cover.logo_chip_mm,
} as const;

export type PaperSize = "A4" | "Letter";
export const MM_PER_PT = 25.4 / 72;

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** A printed length: `--mm` is one printed millimetre in px for the current column (Ruling 6). */
export function mm(n: number): string {
  return `calc(var(--mm) * ${r4(n)})`;
}

export function pt(n: number): string {
  return mm(n * MM_PER_PT);
}

export function paperOf(size: PaperSize): { width_mm: number; height_mm: number } {
  const [width_mm, height_mm] = PRINT_THEME.page.sizes_mm[size];
  return { width_mm, height_mm };
}

export function contentWidthMm(size: PaperSize): number {
  return r4(paperOf(size).width_mm - 2 * PRINT.margin);
}

/** The value of `--mm` inside the preview's `container-type: inline-size` scroller (48px = its px-6 gutters). */
export function mmVar(size: PaperSize): string {
  return `min(calc((100cqw - 48px) / ${paperOf(size).width_mm}), 1mm)`;
}

/** A data colour (#rrggbb) as a translucent fill: the severity pill's 12 % tint. */
export function tint(hex: string, alpha: number = PRINT.tint): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "transparent";
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Font size, leading (the body's 13/9.5 ratio) and colour for printed text. */
export function textStyle(sizePt: number, colour: string = PRINT.ink): CSSProperties {
  return { fontSize: pt(sizePt), lineHeight: pt(sizePt * (PRINT.size.leading / PRINT.size.body)), color: colour };
}

/** `F-0042` (DESIGN.md Copy); a string number is printed as given. */
export function findingLabel(n: number | string): string {
  return typeof n === "number" ? `F-${String(n).padStart(4, "0")}` : n;
}
