/* eslint-disable react-refresh/only-export-components --
   the value helpers are exported next to the component for its tests; not a fast-refresh boundary. */
import { useRef, type KeyboardEvent } from "react";
import { cx, focusRing } from "./tokens";

export interface SliderRange {
  min: number;
  max: number;
  step?: number;
  /** Discrete values to snap to (point budget 0.5 M / 1 M / 2 M / 4 M). */
  stops?: readonly number[];
}

function decimals(n: number): number {
  const s = String(n);
  if (s.includes("e-")) return Number(s.split("e-")[1]);
  return s.split(".")[1]?.length ?? 0;
}

function bounds(r: SliderRange): [number, number] {
  return [Math.min(r.min, r.max), Math.max(r.min, r.max)];
}

function cleanStops(r: SliderRange): number[] {
  const [lo, hi] = bounds(r);
  const inRange = (r.stops ?? []).filter((s) => Number.isFinite(s) && s >= lo && s <= hi);
  return [...new Set(inRange)].sort((a, b) => a - b);
}

function stepOf(r: SliderRange): number {
  const [lo, hi] = bounds(r);
  return r.step && r.step > 0 ? r.step : (hi - lo) / 100 || 1;
}

export function snapValue(raw: number, r: SliderRange): number {
  const [lo, hi] = bounds(r);
  const v = Math.min(hi, Math.max(lo, Number.isFinite(raw) ? raw : lo));
  const stops = cleanStops(r);
  if (stops.length) return stops.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best));
  const step = stepOf(r);
  const n = Math.round((v - lo) / step);
  const places = Math.max(decimals(step), decimals(lo));
  return Math.min(hi, Number((lo + n * step).toFixed(places)));
}

export function stepValue(value: number, dir: 1 | -1, big: boolean, r: SliderRange): number {
  const stops = cleanStops(r);
  if (stops.length) {
    const at = stops.indexOf(snapValue(value, r));
    return stops[Math.max(0, Math.min(stops.length - 1, at + dir * (big ? 3 : 1)))];
  }
  return snapValue(value + dir * stepOf(r) * (big ? 10 : 1), r);
}

export interface SliderProps extends SliderRange {
  label: string;
  value: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  disabled?: boolean;
  /** The value in mono beside the track (default). */
  showValue?: boolean;
  className?: string;
}

/**
 * A continuous or stepped slider (opacity, blend, point size, point budget), mockup ws-maps
 * input[type=range]. The fill and thumb move with transforms; keys it handles stay inside it.
 */
export function Slider({
  label,
  min,
  max,
  step,
  stops,
  value,
  onChange,
  format = String,
  disabled = false,
  showValue = true,
  className,
}: SliderProps) {
  const range: SliderRange = { min, max, step, stops };
  const dragging = useRef(false);
  const current = snapValue(value, range);
  const span = max - min || 1;
  const pct = ((current - min) / span) * 100;

  const commit = (next: number) => {
    if (next !== current) onChange(next);
  };
  const fromPointer = (track: HTMLElement, clientX: number) => {
    const r = track.getBoundingClientRect();
    if (r.width <= 0) return;
    commit(snapValue(min + ((clientX - r.left) / r.width) * span, range));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let next: number;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = stepValue(current, 1, false, range);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = stepValue(current, -1, false, range);
        break;
      case "PageUp":
        next = stepValue(current, 1, true, range);
        break;
      case "PageDown":
        next = stepValue(current, -1, true, range);
        break;
      case "Home":
        next = snapValue(min, range);
        break;
      case "End":
        next = snapValue(max, range);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    commit(next);
  };

  return (
    <div className={cx("flex items-center gap-3", className)}>
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={current}
        aria-valuetext={format(current)}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          if (disabled) return;
          dragging.current = true;
          try {
            e.currentTarget.setPointerCapture?.(e.pointerId);
          } catch {
            // No active pointer with that id (a synthetic event); dragging still works while inside.
          }
          fromPointer(e.currentTarget, e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging.current) fromPointer(e.currentTarget, e.clientX);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        className={cx(
          "group relative flex h-5 min-w-10 flex-1 cursor-pointer touch-none items-center rounded-chip",
          focusRing,
          disabled && "pointer-events-none opacity-45",
        )}
      >
        <span className="relative h-1 w-full overflow-hidden rounded-chip bg-surface-2 ring-1 ring-inset ring-control-line">
          <span
            data-part="fill"
            className="absolute inset-0 rounded-chip bg-accent"
            style={{ transform: `translateX(${pct - 100}%)` }}
          />
        </span>
        {cleanStops(range).map((s) => (
          <span
            key={s}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 h-1.5 w-px -translate-y-1/2 bg-line-strong"
            style={{ left: `${((s - min) / span) * 100}%` }}
          />
        ))}
        <span className="pointer-events-none absolute inset-0" style={{ transform: `translateX(${pct}%)` }}>
          <span
            data-part="thumb"
            className="absolute left-0 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink shadow-[0_0_0_3px_rgba(143,123,255,.45)] reduce-effects:shadow-none transition-transform duration-fast group-hover:scale-110 reduce-motion:transition-none"
          />
        </span>
      </div>
      {showValue && (
        <output className="min-w-[4ch] text-right font-mono text-2xs tabular-nums text-muted">
          {format(current)}
        </output>
      )}
    </div>
  );
}
