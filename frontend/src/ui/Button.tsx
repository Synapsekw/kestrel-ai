/* eslint-disable react-refresh/only-export-components --
   the class helper is exported next to the component that uses it; not a fast-refresh boundary. */
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "./Icon";
import { cx, disabledClass, focusRing, pressable, transition } from "./tokens";

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
  primary: "border-transparent bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "border-line bg-panel text-ink hover:border-line-strong hover:bg-hover",
  ghost: "border-transparent bg-transparent text-ink hover:bg-hover",
  danger: "border-line bg-panel text-danger hover:border-danger/40 hover:bg-danger-soft",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-7 gap-1.5 px-2.5 text-[13px]",
  md: "h-9 gap-2 px-3.5 text-sm",
};

export const buttonClass = (variant: ButtonVariant, size: ButtonSize, className?: string) =>
  cx(
    "inline-flex items-center justify-center whitespace-nowrap rounded-md border font-medium",
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
        <Icon name="spinner" size={iconSize} className="animate-spin motion-reduce:animate-none" />
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
      className={cx(size === "sm" ? "w-7 px-0" : "w-9 px-0", className)}
      {...rest}
    >
      <Icon name={icon} size={size === "sm" ? 14 : 16} />
    </Button>
  );
});
