import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { cx } from "./tokens";

export interface EmptyStateProps {
  icon?: IconName;
  title: ReactNode;
  children?: ReactNode;
  /** One or two buttons or links. */
  action?: ReactNode;
  className?: string;
}

/** Centred, teaches what the screen is for and offers the first action. */
export function EmptyState({ icon, title, children, action, className }: EmptyStateProps) {
  return (
    <div
      className={cx(
        "flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center animate-rise reduce-motion:animate-none",
        className,
      )}
    >
      {icon && (
        <span className="grid h-11 w-11 place-items-center rounded-control bg-surface-2 text-muted">
          <Icon name={icon} size={20} />
        </span>
      )}
      <p className="text-lg text-ink">{title}</p>
      {children && <div className="max-w-md text-sm leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
