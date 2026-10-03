import { Link } from "react-router-dom";
import { Icon, Tooltip, cx, focusRing, type IconName } from "@/ui";

/** The 3px gradient bar on the current row, as the rail had (DESIGN.md § Shell). */
export const ACTIVE =
  "bg-accent-soft font-medium text-accent-ink before:absolute before:-left-[11px] before:bottom-2 before:top-2 before:w-[3px] before:rounded-chip before:bg-grad-ink";

export interface SidebarLinkProps {
  to: string;
  icon: IconName;
  label: string;
  /** Shown after the label and part of the accessible name ("Images 1,284"). */
  count?: number | null;
  /** A visual badge (running jobs); not part of the name. */
  badge?: number;
  active?: boolean;
  /** On the path to the current page: drawn bright, without the active fill. */
  parent?: boolean;
  nested?: boolean;
  collapsed: boolean;
}

/** One sidebar row; icon-only with a right-side tooltip when collapsed (spec 2026-10-03-sidebar §3). */
export function SidebarLink({
  to,
  icon,
  label,
  count,
  badge,
  active,
  parent,
  nested,
  collapsed,
}: SidebarLinkProps) {
  const hasCount = count !== null && count !== undefined;
  const name = hasCount ? `${label} ${count.toLocaleString()}` : label;
  const link = (
    <Link
      to={to}
      aria-label={name}
      aria-current={active ? "page" : undefined}
      className={cx(
        "relative flex shrink-0 items-center gap-2.5 rounded-control text-sm",
        collapsed ? "h-10 w-[42px] justify-center" : cx("w-full px-2.5", nested ? "h-[30px]" : "h-[34px]"),
        active ? ACTIVE : parent ? "text-ink hover:bg-hover" : "text-muted hover:bg-hover hover:text-ink",
        focusRing,
      )}
    >
      <Icon name={icon} size={collapsed ? 20 : nested ? 18 : 20} />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {!collapsed && hasCount && (
        <span className="font-mono text-2xs tabular-nums text-dim">{count.toLocaleString()}</span>
      )}
      {badge ? (
        <span
          aria-hidden="true"
          className={cx(
            "rounded-chip bg-accent px-1.5 font-mono text-2xs leading-4 text-accent-fg",
            collapsed && "absolute -right-0.5 top-0.5 px-1",
          )}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
  return (
    <Tooltip label={label} side="right" disabled={!collapsed} className={collapsed ? undefined : "w-full"}>
      {link}
    </Tooltip>
  );
}
