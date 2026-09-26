import { useRef, type KeyboardEvent } from "react";
import { Icon, type IconName } from "./Icon";
import { cx, focusRing, transition } from "./tokens";
import { useSlidingIndicator } from "./useSlidingIndicator";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  disabled?: boolean;
  /** A count after the label, in mono ("Running 3"). */
  count?: number;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  size?: "sm" | "md";
  className?: string;
}

/** A two-to-five-way switch (mockup .seg): the brand-gradient thumb slides to the chosen option. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
  className,
}: SegmentedProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  useSlidingIndicator(listRef, thumbRef, value, "width");

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    const enabled = options.filter((o) => !o.disabled);
    if (enabled.length === 0) return;
    const at = enabled.findIndex((o) => o.value === value);
    const next = enabled[(Math.max(0, at) + step + enabled.length) % enabled.length];
    e.preventDefault();
    e.stopPropagation();
    onChange(next.value);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-item-id="${next.value}"]`)?.focus();
  };

  return (
    <div
      ref={listRef}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx(
        "relative inline-flex gap-0.5 rounded-[9px] border border-line bg-black/20 p-[3px]",
        className,
      )}
    >
      <span
        ref={thumbRef}
        aria-hidden="true"
        data-part="thumb"
        className="pointer-events-none absolute bottom-[3px] left-0 top-[3px] rounded-sm bg-grad-primary opacity-0 shadow-[0_4px_14px_rgba(143,123,255,.35)] reduce-effects:shadow-none data-[ready=true]:transition-transform data-[ready=true]:duration-emphasis data-[ready=true]:ease-out reduce-motion:transition-none"
      />
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={o.disabled}
            data-item-id={o.value}
            data-indicator-target={on ? "true" : undefined}
            onClick={() => !o.disabled && onChange(o.value)}
            className={cx(
              "relative z-10 inline-flex items-center gap-1.5 rounded-sm font-medium",
              size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-sm",
              on ? "text-accent-fg" : "text-muted hover:text-ink",
              "disabled:cursor-not-allowed disabled:opacity-40",
              transition,
              focusRing,
            )}
          >
            {o.icon && <Icon name={o.icon} size={14} />}
            {o.label}
            {o.count !== undefined && (
              <span className="font-mono text-2xs opacity-80">{o.count.toLocaleString()}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
