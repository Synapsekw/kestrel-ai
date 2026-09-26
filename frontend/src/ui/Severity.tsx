import { useRef, type CSSProperties, type KeyboardEvent } from "react";
import { severityOf, useSeverityScale, type SeverityLevel } from "./severityScale";
import { cx, focusRing, transition } from "./tokens";

/** A colour from data travels only as --c on a style prop (spec §4.5). */
const colourVar = (colour: string) => ({ "--c": colour }) as CSSProperties;

export interface SeverityPillProps {
  level: number | null;
  size?: "sm" | "md";
  className?: string;
}

/** A severity: dot and name on a tint of its colour. */
export function SeverityPill({ level, size = "md", className }: SeverityPillProps) {
  const s = severityOf(useSeverityScale(), level);
  const text = level === null ? "No severity" : s ? s.name : `Level ${level} (removed)`;
  return (
    <span
      data-level={level ?? "none"}
      style={s ? colourVar(s.colour) : undefined}
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-chip font-semibold",
        size === "sm" ? "h-[18px] px-1.5 text-2xs" : "h-[22px] px-2.5 text-xs",
        s ? "bg-[color:color-mix(in_srgb,var(--c)_18%,transparent)] text-ink" : "bg-surface-2 text-muted",
        className,
      )}
    >
      {s && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[color:var(--c)]" />}
      {text}
    </span>
  );
}

export interface SeverityPickerProps {
  value: number | null;
  onChange: (level: number | null) => void;
  /** Adds a "None" option (catalogue default severity). */
  allowNone?: boolean;
  label?: string;
  className?: string;
}

/**
 * The inspector's severity grid (ws-images .sevseg), four tiles per row. While focused, 1–9 choose a
 * level in the scale (digits beyond it pass through untouched), 0 chooses None when allowed, ← → move.
 */
export function SeverityPicker({
  value,
  onChange,
  allowNone = false,
  label = "Severity",
  className,
}: SeverityPickerProps) {
  const scale = useSeverityScale();
  const group = useRef<HTMLDivElement>(null);
  const options: Array<SeverityLevel | null> = allowNone ? [...scale, null] : [...scale];
  const levelOf = (o: SeverityLevel | null) => o?.level ?? null;
  const checked = options.findIndex((o) => levelOf(o) === value);

  const choose = (next: number | null) => {
    onChange(next);
    group.current?.querySelector<HTMLButtonElement>(`[data-level="${next ?? "none"}"]`)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let next: number | null;
    if (/^[1-9]$/.test(e.key)) {
      const level = Number(e.key);
      if (!scale.some((s) => s.level === level)) return;
      next = level;
    } else if (e.key === "0" && allowNone) {
      next = null;
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const step = e.key === "ArrowRight" ? 1 : -1;
      next = levelOf(options[(Math.max(0, checked) + step + options.length) % options.length]);
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    choose(next);
  };

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx("grid grid-cols-4 gap-1", className)}
    >
      {options.map((s, i) => {
        const on = levelOf(s) === value;
        const tabIndex = (checked < 0 ? i === 0 : on) ? 0 : -1;
        if (!s) {
          return (
            <button
              key="none"
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={tabIndex}
              data-level="none"
              onClick={() => choose(null)}
              className={cx(
                "col-span-4 h-8 rounded-[9px] border text-xs font-semibold",
                on
                  ? "border-line-strong bg-surface-2 text-ink"
                  : "border-line bg-field text-muted hover:text-ink",
                transition,
                focusRing,
              )}
            >
              None
            </button>
          );
        }
        return (
          <button
            key={s.level}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${s.level} ${s.name}`}
            tabIndex={tabIndex}
            data-level={s.level}
            style={colourVar(s.colour)}
            onClick={() => choose(s.level)}
            className={cx(
              "flex h-[42px] flex-col items-center justify-center gap-px rounded-[9px] border text-xs font-semibold",
              on
                ? "-translate-y-px border-[color:var(--c)] bg-[color:var(--c)] text-bg shadow-[0_6px_18px_color-mix(in_srgb,var(--c)_45%,transparent)]"
                : "border-line bg-field text-muted hover:border-[color:var(--c)] hover:text-ink",
              transition,
              focusRing,
            )}
          >
            <span className="font-mono text-[13px]">{s.level}</span>
            {s.name}
          </button>
        );
      })}
    </div>
  );
}
