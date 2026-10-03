import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { cx, focusRing } from "@/ui";
import { SPLIT_MAX, SPLIT_MIN, splitFromKey, splitFromPointer } from "./split";

/** A vertical separator between the asset stage and the photo (keys: arrows, Shift+arrows, Home, End). */
export function Splitter({
  value,
  onChange,
  onCommit,
  label = "Resize the model and photo panes",
}: {
  value: number;
  /** Every move, drag frames included: only sets the width. */
  onChange(v: number): void;
  /** The settled width, after a drag ends or a key moves it: the place to remember it. */
  onCommit?(v: number): void;
  label?: string;
}) {
  const drag = useRef<{ left: number; width: number; last: number | null } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const host = e.currentTarget.parentElement?.getBoundingClientRect();
    if (!host) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { left: host.left, width: host.width, last: null };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.last = splitFromPointer(e.clientX, d.left, d.width);
    onChange(d.last);
  };
  const end = () => {
    const last = drag.current?.last ?? null;
    drag.current = null;
    if (last !== null) onCommit?.(last);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = splitFromKey(value, e.key, e.shiftKey);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(next);
    onCommit?.(next);
  };
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={SPLIT_MIN}
      aria-valuemax={SPLIT_MAX}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`${Math.round(value)}% model`}
      data-testid="inspect-splitter"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      className={cx(
        "group relative z-20 w-2 shrink-0 cursor-col-resize touch-none bg-line hover:bg-accent-soft",
        focusRing,
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line-strong group-hover:bg-accent"
      />
    </div>
  );
}
