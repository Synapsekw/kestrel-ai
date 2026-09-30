import type { BlockOf } from "@/api/reports";
import { MM_PER_PT, PRINT, mm, textStyle } from "../../printTheme";
import { CHART_WIDTH_MM, chartLayout, type ChartKind } from "./chartGeometry";
import { Dot } from "./marks";

const NAME: Record<ChartKind, string> = { bar: "Bar chart", stacked_bar: "Stacked bar chart", line: "Line chart" };
const svgPt = (p: number) => p * MM_PER_PT;
const tick = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/**
 * Spec §10.2/§12: vector charts, never a PNG.
 * Ruling R-8: a non-null `title` prints above the chart as caption text (not a heading) and
 * becomes the accessible name's subject; a null title falls back to the series names. `unit`
 * null or "" omits the " (<unit>)" suffix either way.
 */
export function ChartBlock({ block }: { block: BlockOf<"chart"> }) {
  const kind = block.chart as ChartKind;
  const l = chartLayout(kind, block.series, block.x_labels, PRINT.series, CHART_WIDTH_MM, PRINT.chartHeight);
  const names = block.series.map((s) => s.name).join(", ") || "no data";
  const subject = block.title ?? names;
  const label = `${NAME[kind]} of ${subject}${block.unit ? ` (${block.unit})` : ""}`;
  return (
    <figure data-block="chart" style={{ margin: `0 0 ${mm(4)}` }}>
      {block.title ? (
        <p style={{ ...textStyle(PRINT.size.small, PRINT.ink), fontWeight: 600, margin: `0 0 ${mm(1.5)}` }}>
          {block.title}
        </p>
      ) : null}
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${l.width} ${l.height}`}
        style={{ width: mm(l.width), maxWidth: "100%", height: "auto", display: "block" }}
      >
        <title>{label}</title>
        {l.ticks.map((t) => (
          <g key={t.value}>
            <line x1={l.plot.x} x2={l.plot.x + l.plot.w} y1={t.y} y2={t.y} stroke={PRINT.rule} strokeWidth={0.2} />
            <text x={l.plot.x - 1.5} y={t.y + 0.9} textAnchor="end" fontSize={svgPt(7)} fill={PRINT.muted}>
              {tick(t.value)}
            </text>
          </g>
        ))}
        {l.bars.map((b, i) => (
          <rect key={i} x={b.x} y={b.y} width={b.w} height={Math.max(b.h, 0)} rx={0.4} fill={b.colour}>
            <title>{`${b.series} · ${b.label}: ${b.value}`}</title>
          </rect>
        ))}
        {l.lines.map((line) => (
          <g key={line.series}>
            <polyline
              points={line.points.map((p) => p.join(",")).join(" ")}
              fill="none"
              stroke={line.colour}
              strokeWidth={0.6}
              strokeLinejoin="round"
            />
            {line.points.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={0.8} fill={line.colour} />
            ))}
          </g>
        ))}
        {l.xLabels.map((x, i) => (
          <text key={i} x={x.x} y={l.height - 3} textAnchor="middle" fontSize={svgPt(7)} fill={PRINT.muted}>
            {x.text}
          </text>
        ))}
      </svg>
      {block.series.length > 1 || block.unit ? (
        <figcaption
          className="flex flex-wrap items-center"
          style={{ ...textStyle(PRINT.size.small, PRINT.muted), gap: `${mm(1)} ${mm(4)}`, marginTop: mm(1) }}
        >
          {block.series.length > 1
            ? block.series.map((s, i) => (
                <span key={s.name} className="inline-flex items-center" style={{ gap: mm(1) }}>
                  <Dot colour={s.colour ?? PRINT.series[i % PRINT.series.length]} sizeMm={2} />
                  {s.name}
                </span>
              ))
            : null}
          {block.unit ? <span>Unit: {block.unit}</span> : null}
        </figcaption>
      ) : null}
    </figure>
  );
}
