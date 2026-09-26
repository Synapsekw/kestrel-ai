/* eslint-disable react-refresh/only-export-components --
   the class helper is exported next to the component that uses it; not a fast-refresh boundary. */
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "./Icon";
import { cx, disabledClass, focusRing, lift, pressable, transition } from "./tokens";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Disables the button and shows a spinner before the label; the label stays readable. */
  loading?: boolean;
  icon?: IconName;
}

const VARIANT: Record<ButtonVariant, string> = {
  // The mockup's .btn.pri: the violet → indigo gradient and its glow (the glow drops in reduced effects).
  primary: cx("border-transparent bg-grad-primary text-accent-fg shadow-glow", lift),
  secondary: cx("border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-2", lift),
  ghost: "border-transparent bg-transparent text-ink hover:bg-surface-2",
  danger: "border-line bg-surface text-danger hover:border-danger/40 hover:bg-danger-soft",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-7 gap-1.5 px-2.5 text-xs",
  md: "h-[34px] gap-2 px-3.5 text-sm",
};

export const buttonClass = (variant: ButtonVariant, size: ButtonSize, className?: string) =>
  cx(
    "inline-flex items-center justify-center whitespace-nowrap rounded-control border font-semibold",
    VARIANT[variant],
    SIZE[size],
    transition,
    pressable,
    focusRing,
    disabledClass,
    className,
  );

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    icon,
    className,
    children,
    type = "button",
    disabled,
    ...rest
  },
  ref,
) {
  const iconSize = size === "sm" ? 13 : 15;
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {loading ? (
        <Icon name="spinner" size={iconSize} className="animate-spin reduce-motion:animate-none" />
      ) : icon ? (
        <Icon name={icon} size={iconSize} />
      ) : null}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, "children" | "icon"> {
  icon: IconName;
  /** The accessible name and the tooltip. */
  label: string;
}

/** A square button with only an icon; `label` becomes its accessible name and its title. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = "md", variant = "ghost", className, ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      aria-label={label}
      title={label}
      className={cx(size === "sm" ? "w-7 px-0" : "w-[34px] px-0", className)}
      {...rest}
    >
      <Icon name={icon} size={size === "sm" ? 14 : 16} />
    </Button>
  );
});
