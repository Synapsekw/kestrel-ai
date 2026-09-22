/* eslint-disable react-refresh/only-export-components --
   the class helper is exported next to the component that uses it; not a fast-refresh boundary. */
import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Icon } from "./Icon";
import { cx, transition } from "./tokens";

/** Shared field chrome: border, panel background, accent focus ring, invalid state. */
export const fieldClass = (invalid?: boolean, className?: string) =>
  cx(
    "w-full rounded-md border bg-panel text-sm text-ink placeholder:text-muted",
    "hover:border-muted focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/20",
    "disabled:opacity-45 disabled:pointer-events-none",
    invalid ? "border-danger" : "border-control-line",
    transition,
    className,
  );

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  invalid?: boolean;
  /** 28px for dense rows; the default is 36px. */
  dense?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, dense, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={fieldClass(invalid, cx(dense ? "h-7 px-2 text-[13px]" : "h-9 px-3", className))}
      {...rest}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={fieldClass(invalid, cx("px-3 py-2 leading-relaxed", className))}
      {...rest}
    />
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  dense?: boolean;
  /** Width of the wrapper; the select itself is always full width inside it. */
  wrapperClassName?: string;
}

/** A native select (keyboard, tests and screen readers keep working) with a drawn chevron. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, dense, className, wrapperClassName, children, ...rest },
  ref,
) {
  return (
    // cx() does not resolve Tailwind conflicts and w-full is emitted after arbitrary widths, so a
    // caller's width only wins if the default steps aside.
    <span
      className={cx(
        "relative inline-flex",
        !/(^|\s)w-/.test(wrapperClassName ?? "") && "w-full",
        wrapperClassName,
      )}
    >
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={fieldClass(
          invalid,
          cx("appearance-none pr-8", dense ? "h-7 pl-2 text-[13px]" : "h-9 pl-3", className),
        )}
        {...rest}
      >
        {children}
      </select>
      <Icon
        name="chevron-down"
        size={14}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
      />
    </span>
  );
});
