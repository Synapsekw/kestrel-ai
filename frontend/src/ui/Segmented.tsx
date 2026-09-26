import { Icon, type IconName } from "./Icon";
import { cx, focusRing, transition } from "./tokens";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  disabled?: boolean;
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

/** A two-to-four-way switch; the selected option is a raised panel. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("inline-flex gap-0.5 rounded-[9px] bg-surface-2 p-[3px]", className)}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            onClick={() => !o.disabled && onChange(o.value)}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-md font-medium",
              size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-[13px]",
              on ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
              "disabled:cursor-not-allowed disabled:opacity-40",
              transition,
              focusRing,
            )}
          >
            {o.icon && <Icon name={o.icon} size={14} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
