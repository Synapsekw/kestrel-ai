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
 * tick that scales in. The drawn box is a sibling styled through the `peer` state.
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
      {/* The real input lies transparently over the drawn box: it takes the clicks, keeps native
          keyboard and form behaviour, and stays visible to tools that check visibility. */}
      <span className="relative grid h-4 w-4 shrink-0">
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          {...rest}
        />
        <span
          aria-hidden="true"
          className={cx(
            "grid h-4 w-4 place-items-center rounded-[5px] border",
            onDark ? "border-white/70 bg-black/30" : "border-control-line bg-field",
            "peer-hover:border-accent",
            "peer-checked:border-accent peer-checked:bg-accent peer-checked:[&>svg]:scale-100 peer-checked:[&>svg]:opacity-100",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2",
            onDark ? "peer-focus-visible:ring-offset-black/40" : "peer-focus-visible:ring-offset-bg",
            "peer-disabled:opacity-45",
            "peer-active:scale-90 reduce-motion:peer-active:scale-100",
            transition,
          )}
        >
          <Icon
            name="check"
            size={11}
            className="scale-50 text-accent-fg opacity-0 transition-[transform,opacity] duration-fast ease-out [stroke-width:3] reduce-motion:transition-none"
          />
        </span>
      </span>
      {label && <span>{label}</span>}
    </label>
  );
});
