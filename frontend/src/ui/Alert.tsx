import type { ReactNode } from "react";
import { IconButton } from "./Button";
import { Icon, type IconName } from "./Icon";
import { cx } from "./tokens";

export type AlertTone = "info" | "ok" | "warn" | "danger";

export interface AlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  onDismiss?: () => void;
  className?: string;
  /** Forwarded as `data-testid` for the tests that look a notice up. */
  testId?: string;
  /** Override the role (`alert` for danger, `status` otherwise). */
  role?: "alert" | "status";
  /** Extra controls on the right (a Retry button, a link). */
  actions?: ReactNode;
}

const TONE: Record<AlertTone, { box: string; icon: IconName; iconColor: string }> = {
  info: { box: "border-line bg-surface text-ink", icon: "info", iconColor: "text-info" },
  ok: { box: "border-ok/25 bg-ok-soft text-ink", icon: "check", iconColor: "text-ok" },
  warn: { box: "border-warn/30 bg-warn-soft text-ink", icon: "warning", iconColor: "text-warn" },
  danger: { box: "border-danger/30 bg-danger-soft text-ink", icon: "warning", iconColor: "text-danger" },
};

/** An inline message with an icon; enters with a short reveal. */
export function Alert({
  tone = "info",
  title,
  children,
  onDismiss,
  className,
  testId,
  role,
  actions,
}: AlertProps) {
  const t = TONE[tone];
  return (
    <div
      role={role ?? (tone === "danger" ? "alert" : "status")}
      data-testid={testId}
      className={cx(
        "flex items-start gap-2.5 rounded-control border px-3 py-2.5 text-sm animate-reveal reduce-motion:animate-none",
        t.box,
        className,
      )}
    >
      <Icon name={t.icon} size={16} className={cx("mt-0.5", t.iconColor)} />
      <div className="min-w-0 flex-1 leading-relaxed">
        {title && <p className="font-medium">{title}</p>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      {onDismiss && (
        <IconButton icon="x" label="Dismiss" size="sm" onClick={onDismiss} className="-my-1 -mr-1" />
      )}
    </div>
  );
}
