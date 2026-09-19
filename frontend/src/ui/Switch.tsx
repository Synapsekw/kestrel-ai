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
        "group inline-flex items-center gap-2 text-sm text-ink disabled:opacity-45 disabled:pointer-events-none",
        focusRing,
        "rounded-md",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "relative h-5 w-[34px] shrink-0 rounded-full",
          checked ? "bg-accent" : "bg-line-strong group-hover:bg-dim",
          transition,
        )}
      >
        <span
          className={cx(
            "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.3)]",
            "transition-transform duration-180 ease-out motion-reduce:transition-none",
            checked && "translate-x-3.5",
          )}
        />
      </span>
      <span className={hideLabel ? "sr-only" : undefined}>{label}</span>
    </button>
  );
}
