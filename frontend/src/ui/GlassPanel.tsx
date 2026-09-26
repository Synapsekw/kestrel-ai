import { forwardRef, type HTMLAttributes } from "react";
import { cx } from "./tokens";

export type GlassVariant = "pane" | "float";

export interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** `pane`: a translucent card, no blur. `float`: frosted glass over imagery, the only blur (F7). */
  variant?: GlassVariant;
  /** Adds the hover lift: translateY −2px and --elev-2. */
  interactive?: boolean;
  /** Defaults: `panel` (16px) for a pane, `control` (10px) for a float. */
  radius?: "panel" | "control";
  as?: "div" | "section" | "aside" | "nav" | "header";
}

const VARIANT: Record<GlassVariant, string> = {
  pane: "border border-card-line bg-surface shadow-elev-1",
  float: "glass-float",
};

export const GlassPanel = forwardRef<HTMLDivElement, GlassPanelProps>(function GlassPanel(
  { variant = "pane", interactive = false, radius, as = "div", className, ...rest },
  ref,
) {
  const Tag = as as "div";
  const r = radius ?? (variant === "pane" ? "panel" : "control");
  return (
    <Tag
      ref={ref}
      data-glass={variant}
      className={cx(
        VARIANT[variant],
        r === "panel" ? "rounded-panel" : "rounded-control",
        interactive &&
          "transition-[transform,box-shadow,border-color] duration-fast ease-out hover:-translate-y-0.5 hover:border-line-strong hover:shadow-elev-2 reduce-motion:transition-none reduce-motion:hover:translate-y-0",
        className,
      )}
      {...rest}
    />
  );
});
