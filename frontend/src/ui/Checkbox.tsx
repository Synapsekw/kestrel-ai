import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { Icon } from "./Icon";
import { cx, transition } from "./tokens";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: ReactNode;
  /** Renders the box on a dark surface (thumbnails, the selection bar). */
  onDark?: boolean;
}

/**
 * A real `<input type="checkbox">` (roles, keyboard and tests unchanged) drawn as a 16px box with a
 * tick that scales in. The box itself is a sibling styled through the `peer` state.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, onDark, className, id, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <label
      htmlFor={inputId}
      className={cx("inline-flex cursor-pointer items-center gap-2 text-sm", className)}
    >
      <input ref={ref} id={inputId} type="checkbox" className="peer sr-only" {...rest} />
      <span
        aria-hidden="true"
        className={cx(
          "grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border",
          onDark ? "border-white/70 bg-black/30" : "border-line-strong bg-panel",
          "peer-checked:border-accent peer-checked:bg-accent peer-checked:[&>svg]:scale-100 peer-checked:[&>svg]:opacity-100",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2",
          onDark ? "peer-focus-visible:ring-offset-black/40" : "peer-focus-visible:ring-offset-ground",
          "peer-disabled:opacity-45",
          "active:scale-90 motion-reduce:active:scale-100",
          transition,
        )}
      >
        <Icon
          name="check"
          size={11}
          className="scale-50 text-white opacity-0 transition-[transform,opacity] duration-140 ease-out [stroke-width:3] motion-reduce:transition-none"
        />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
});
