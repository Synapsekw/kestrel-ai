import { Link, useLocation } from "react-router-dom";
import { Icon, Tooltip, cx, focusRing } from "@/ui";
import { Brand } from "./Brand";
import { RAIL_ENTRIES, RAIL_SETTINGS, routeInfo, type RailEntry } from "./routeModel";

function RailLink({ entry, to, active }: { entry: RailEntry; to: string; active: boolean }) {
  return (
    <Tooltip label={entry.label} side="right">
      <Link
        to={to}
        aria-label={entry.label}
        aria-current={active ? "page" : undefined}
        className={cx(
          "relative grid h-[42px] w-[42px] place-items-center rounded-control",
          focusRing,
          active
            ? "bg-accent-soft text-accent-ink before:absolute before:-left-[11px] before:bottom-2.5 before:top-2.5 before:w-[3px] before:rounded-chip before:bg-grad-ink"
            : "text-muted hover:bg-hover hover:text-ink",
        )}
      >
        <Icon name={entry.icon} size={20} />
      </Link>
    </Tooltip>
  );
}

/**
 * The 64px icon rail (spec 2026-09-26-foundation section 5.1): the logo tile, Projects, Models,
 * Catalogue and Jobs, then Settings at the foot. Selection is instant (`--dur-instant`).
 */
export function Rail({ projectId }: { projectId: string | undefined }) {
  const { pathname } = useLocation();
  const section = routeInfo(pathname).section;
  return (
    <nav
      aria-label="Main navigation"
      className="flex w-16 shrink-0 flex-col items-center gap-1.5 border-r border-line bg-rail py-3.5"
    >
      <Link to="/projects" aria-label="Kestrel AI" className={cx("mb-3.5 rounded-xl", focusRing)}>
        <Brand compact />
      </Link>
      {RAIL_ENTRIES.map((entry) => (
        <RailLink
          key={entry.id}
          entry={entry}
          active={section === entry.id}
          to={entry.id === "jobs" && projectId ? `/jobs?project=${projectId}` : entry.to}
        />
      ))}
      <div className="flex-1" />
      <RailLink entry={RAIL_SETTINGS} to={RAIL_SETTINGS.to} active={section === "settings"} />
    </nav>
  );
}
