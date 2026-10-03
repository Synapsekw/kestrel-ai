import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { formatFindingNumber, formatHeight } from "@/findings/format";
import { cx, GlassPanel, severityOf, useSeverityScale } from "@/ui";
import { geometry, type MapFrame, type MapReview } from "./geometry";
import type { FindingMapDot } from "./useAssetMapDots";

export interface FindingsMapProps {
  review: MapReview;
  frame: MapFrame;
  dots: readonly FindingMapDot[];
  onOpen: (findingId: string) => void;
  className?: string;
}

interface Tip {
  id: string;
  left: number;
  top: number;
}

/**
 * Spec §9 "Asset findings map": x is the side (compass bearing or face), y is height. Every
 * coordinate comes from `geometry`, the TS twin of the report's `findings_map.py`, so the Overview
 * and the PDF agree (shared fixture `contract/fixtures/asset-findings-map.json`).
 */
export function FindingsMap({ review, frame, dots, onOpen, className }: FindingsMapProps) {
  const scale = useSeverityScale();
  const g = useMemo(() => geometry(review, frame, [...dots]), [review, frame, dots]);
  const facts = useMemo(() => new Map(dots.map((d) => [d.id, d])), [dots]);
  const zoneLabel = useMemo(() => new Map(review.zones.map((z) => [z.id, z.label])), [review]);
  const host = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const font = g.height * 0.028;

  const tipText = (id: string): string => {
    const d = facts.get(id);
    if (!d) return "";
    const zone = d.zone ? (zoneLabel.get(d.zone) ?? d.zone) : null;
    return [
      formatFindingNumber(d.number),
      severityOf(scale, d.severity)?.name ?? null,
      zone,
      d.side,
      formatHeight(d.height_m),
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const show = (id: string) => (e: SyntheticEvent<SVGCircleElement>) => {
    const box = host.current?.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ id, left: r.left - (box?.left ?? 0) + r.width / 2, top: r.top - (box?.top ?? 0) });
  };
  const hide = () => setTip(null);
  const onKey = (id: string) => (e: KeyboardEvent<SVGCircleElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(id);
    }
  };

  return (
    <div ref={host} className={cx("relative min-h-0", className)}>
      <svg
        role="img"
        aria-label={`Findings map, ${g.dots.length} ${g.dots.length === 1 ? "finding" : "findings"} by height and side`}
        viewBox={`0 0 ${g.width} ${g.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
      >
        {g.zones.map((z) => (
          <g key={z.id} data-testid="zone-band">
            <rect
              x={g.plot.x}
              y={z.y}
              width={g.plot.w}
              height={z.h}
              className={z.shade ? "fill-surface-2" : "fill-transparent"}
            />
            <text x={g.zone_label_x} y={z.label_y} fontSize={font} className="fill-muted">
              {z.label}
            </text>
          </g>
        ))}
        {g.silhouette && (
          <path
            data-testid="silhouette"
            d={`M ${g.silhouette.map(([x, y]) => `${x} ${y}`).join(" L ")} Z`}
            className="fill-surface stroke-line-strong"
            strokeWidth={1}
          />
        )}
        {g.levels.map((l) => (
          <g key={l.value} data-testid="level">
            <line x1={l.x1} x2={l.x2} y1={l.y} y2={l.y} className="stroke-line" strokeDasharray="2 3" />
            <text
              x={l.x2 + font * 0.3}
              y={l.y}
              fontSize={font * 0.85}
              dominantBaseline="middle"
              className="fill-dim font-mono"
            >
              {`${l.value} m`}
            </text>
          </g>
        ))}
        {g.y_ticks.map((t) => (
          <text
            key={t.value}
            x={g.plot.x - font * 0.4}
            y={t.y}
            fontSize={font * 0.85}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-dim font-mono"
          >
            {`${t.value} m`}
          </text>
        ))}
        {g.x_ticks.map((t, i) => (
          <text
            key={`${i}-${t.label}`}
            x={t.x}
            y={g.plot.y + g.plot.h + font * 1.2}
            fontSize={font}
            textAnchor="middle"
            className="fill-muted font-mono"
          >
            {t.label}
          </text>
        ))}
        <text
          x={g.plot.x + g.plot.w / 2}
          y={g.plot.y + g.plot.h + font * 2.6}
          fontSize={font}
          textAnchor="middle"
          className="fill-muted"
        >
          {g.axis_title}
        </text>
        {g.dots.map((d) => {
          const colour = severityOf(scale, d.severity)?.colour;
          return (
            <circle
              key={d.id}
              data-testid="map-dot"
              role="button"
              tabIndex={0}
              aria-label={tipText(d.id)}
              cx={d.x}
              cy={d.y}
              r={g.dot_r}
              strokeWidth={g.dot_r * 0.4}
              style={colour ? ({ "--c": colour } as CSSProperties) : undefined}
              className={cx(
                colour ? "fill-[color:var(--c)]" : "fill-muted",
                "cursor-pointer stroke-bg outline-none focus-visible:stroke-accent",
              )}
              onMouseEnter={show(d.id)}
              onFocus={show(d.id)}
              onMouseLeave={hide}
              onBlur={hide}
              onClick={() => onOpen(d.id)}
              onKeyDown={onKey(d.id)}
            />
          );
        })}
      </svg>
      {tip && (
        <GlassPanel
          variant="float"
          role="tooltip"
          className="pointer-events-none absolute z-[2] -translate-x-1/2 -translate-y-full whitespace-nowrap px-2 py-1 font-mono text-2xs"
          style={{ left: tip.left, top: tip.top }}
        >
          {tipText(tip.id)}
        </GlassPanel>
      )}
    </div>
  );
}
