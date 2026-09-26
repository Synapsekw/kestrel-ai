import type { ReactNode } from "react";
import { cx, focusRing, transition } from "./tokens";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** Hide the label visually (it stays the accessible name). */
  hideLabel?: boolean;
}

export function Switch({ checked, onChange, label, disabled, className, id, hideLabel }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "group inline-flex items-center gap-2 rounded-control text-sm text-ink disabled:pointer-events-none disabled:opacity-45",
        focusRing,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "relative h-[18px] w-8 shrink-0 rounded-chip",
          checked ? "bg-accent" : "bg-surface-2 ring-1 ring-inset ring-control-line group-hover:bg-hover",
          transition,
        )}
      >
        <span
          data-part="thumb"
          className={cx(
            "absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-ink shadow-elev-1",
            "transition-transform duration-base ease-out reduce-motion:transition-none",
            checked && "translate-x-3.5",
          )}
        />
      </span>
      <span className={hideLabel ? "sr-only" : undefined}>{label}</span>
    </button>
  );
}
