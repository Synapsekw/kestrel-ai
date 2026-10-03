import type { AssetDrawing } from "@/api/reports";
import { PRINT, mm } from "../../printTheme";
import { usePreviewEnv } from "../PreviewContext";

/**
 * Spec 2026-10-02-asset-findings §10: the findings map and the height locator, drawn from the
 * server's primitives. Every offset below equals pdf/asset_flowables.py so the preview matches the PDF.
 */
export function AssetDrawingSvg({
  drawing,
  label,
  widthMm,
}: {
  drawing: AssetDrawing;
  label: string;
  widthMm: number;
}) {
  const d = drawing;
  const p = d.plot;
  const fs = d.font_size;
  const headFill = usePreviewEnv().brand?.headFill ?? PRINT.head; // the PDF's branded band fill
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${d.width} ${d.height}`}
      style={{ width: mm(widthMm), maxWidth: "100%", height: "auto", display: "block" }}
    >
      <title>{label}</title>
      {d.bands.map((b, i) => (
        <g key={`band-${i}`} data-band>
          <rect
            x={p.x0}
            y={b.y0}
            width={p.x1 - p.x0}
            height={b.y1 - b.y0}
            fill={b.shaded ? headFill : PRINT.paper}
          />
          <text x={p.x1 + fs * 0.8} y={(b.y0 + b.y1) / 2 + fs * 0.35} fontSize={fs * 0.9} fill={PRINT.ink}>
            {b.label}
          </text>
        </g>
      ))}
      {d.y_ticks.map((t, i) => (
        <g key={`y-${i}`}>
          <line x1={p.x0} x2={p.x1} y1={t.at} y2={t.at} stroke={PRINT.rule} strokeWidth={0.5} />
          <text
            x={p.x0 - fs * 0.6}
            y={t.at + fs * 0.35}
            textAnchor="end"
            fontSize={fs * 0.85}
            fill={PRINT.muted}
          >
            {t.label}
          </text>
        </g>
      ))}
      {d.x_ticks.map((t, i) => (
        <g key={`x-${i}`}>
          <line
            x1={t.at}
            x2={t.at}
            y1={p.y0}
            y2={p.y1}
            stroke={PRINT.rule}
            strokeWidth={0.5}
            strokeDasharray="2 4"
          />
          <text x={t.at} y={p.y1 + fs * 1.3} textAnchor="middle" fontSize={fs * 0.9} fill={PRINT.ink}>
            {t.label}
          </text>
        </g>
      ))}
      {d.silhouette.length > 2 ? (
        <polygon
          points={d.silhouette.map(([x, y]) => `${x},${y}`).join(" ")}
          fill={PRINT.placeholder}
          stroke={PRINT.muted}
          strokeWidth={0.6}
        />
      ) : null}
      {d.levels.map((l, i) => (
        <line key={`l-${i}`} x1={l.x0} x2={l.x1} y1={l.y} y2={l.y} stroke={PRINT.muted} strokeWidth={0.5} />
      ))}
      {d.marker ? (
        <line
          x1={d.marker.x0}
          x2={d.marker.x1}
          y1={d.marker.y}
          y2={d.marker.y}
          stroke={d.marker.colour}
          strokeWidth={1.4}
        />
      ) : null}
      {d.dots.map((dot, i) => (
        <circle
          key={`d-${i}`}
          data-dot
          cx={dot.x}
          cy={dot.y}
          r={dot.r}
          fill={dot.colour}
          stroke={PRINT.paper}
          strokeWidth={dot.r * 0.25}
        >
          <title>{dot.label}</title>
        </circle>
      ))}
      {d.x_title ? (
        <text
          x={(p.x0 + p.x1) / 2}
          y={d.height - fs * 0.3}
          textAnchor="middle"
          fontSize={fs * 0.85}
          fill={PRINT.muted}
        >
          {d.x_title}
        </text>
      ) : null}
    </svg>
  );
}
