export type ChartKind = "bar" | "stacked_bar" | "line";

export interface ChartSeriesIn {
  name: string;
  /** Contract `ChartSeries.values` items are `number | null`; null draws as 0 (Ruling 13). */
  values: readonly (number | null)[];
  colour?: string | null;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BarMark extends Rect {
  series: string;
  colour: string;
  value: number;
  label: string;
}

export interface LineMark {
  series: string;
  colour: string;
  points: [number, number][];
}

export interface ChartLayout {
  width: number;
  height: number;
  plot: Rect;
  max: number;
  ticks: { value: number; y: number }[];
  bars: BarMark[];
  lines: LineMark[];
  xLabels: { x: number; text: string }[];
}

/** The A4 content width (210 − 2 × 18 mm); the chart's viewBox units are millimetres. */
export const CHART_WIDTH_MM = 174;

export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = [1, 2, 2.5, 5, 10].find((s) => n <= s + 1e-9) ?? 10;
  return Math.round(step * p * 1e9) / 1e9;
}

/** Negative, non-finite and null values all draw as 0 (Ruling 13). */
const clean = (v: number | null | undefined) =>
  v !== undefined && v !== null && Number.isFinite(v) && v > 0 ? v : 0;

export function chartLayout(
  kind: ChartKind,
  series: readonly ChartSeriesIn[],
  xLabels: readonly string[],
  palette: readonly string[],
  width = CHART_WIDTH_MM,
  height = 60,
): ChartLayout {
  const plot: Rect = { x: 14, y: 4, w: width - 16, h: height - 12 };
  const band = plot.w / Math.max(xLabels.length, 1);
  const colourOf = (i: number) => series[i].colour ?? palette[i % palette.length];
  const at = (s: ChartSeriesIn, i: number) => clean(s.values[i]);
  const totals = xLabels.map((_, i) => series.reduce((sum, s) => sum + at(s, i), 0));
  const all = series.flatMap((s) => xLabels.map((_, i) => at(s, i)));
  const max = niceMax(kind === "stacked_bar" ? Math.max(0, ...totals) : Math.max(0, ...all));
  const yOf = (v: number) => plot.y + plot.h * (1 - v / max);
  const bars: BarMark[] = [];
  const lines: LineMark[] = [];

  if (kind === "line") {
    series.forEach((s, si) =>
      lines.push({
        series: s.name,
        colour: colourOf(si),
        points: xLabels.map((_, i) => [plot.x + band * (i + 0.5), yOf(at(s, i))]),
      }),
    );
  } else if (kind === "stacked_bar") {
    const w = band * 0.6;
    xLabels.forEach((label, i) => {
      let base = 0;
      series.forEach((s, si) => {
        const v = at(s, i);
        if (v > 0)
          bars.push({
            x: plot.x + band * i + (band - w) / 2,
            y: yOf(base + v),
            w,
            h: yOf(base) - yOf(base + v),
            series: s.name,
            colour: colourOf(si),
            value: v,
            label,
          });
        base += v;
      });
    });
  } else {
    const group = band * 0.7;
    const w = group / Math.max(series.length, 1);
    xLabels.forEach((label, i) =>
      series.forEach((s, si) => {
        const v = at(s, i);
        bars.push({
          x: plot.x + band * i + (band - group) / 2 + w * si,
          y: yOf(v),
          w,
          h: yOf(0) - yOf(v),
          series: s.name,
          colour: colourOf(si),
          value: v,
          label,
        });
      }),
    );
  }

  return {
    width,
    height,
    plot,
    max,
    ticks: [0, max / 2, max].map((value) => ({ value, y: yOf(value) })),
    bars,
    lines,
    xLabels: xLabels.map((text, i) => ({ x: plot.x + band * (i + 0.5), text })),
  };
}
