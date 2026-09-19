import type { ReactNode } from "react";
import { cx } from "./tokens";

export interface FieldProps {
  label: ReactNode;
  htmlFor?: string;
  /** One line under the control, in muted. */
  hint?: ReactNode;
  /** Replaces the hint, in danger, announced as an alert. */
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Put the label after the control on the same row (checkbox-like fields). */
  inline?: boolean;
}

/** Label above, control, then hint or error below; links the error to the control for screen readers. */
export function Field({ label, htmlFor, hint, error, children, className, inline }: FieldProps) {
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;
  return (
    <div
      className={cx("flex min-w-0", inline ? "flex-row items-center gap-2" : "flex-col gap-1.5", className)}
    >
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs leading-relaxed text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
