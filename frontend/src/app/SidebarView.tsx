import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon, KeyChord, Tooltip, cx, focusRing } from "@/ui";
import { Brand } from "./Brand";
import { RAIL_ENTRIES, RAIL_SETTINGS, railHref, type Section } from "./routeModel";
import { SidebarLink } from "./SidebarLink";

export interface SidebarViewProps {
  section: Section | null;
  projectId?: string;
  collapsed: boolean;
  activeJobs: number;
  onToggle: () => void;
  /** The open project's tree, rendered under Projects. */
  tree?: ReactNode;
}

/** The labelled sidebar, expanded (236px) or collapsed (64px) (spec 2026-10-03-sidebar §3). */
export function SidebarView({ section, projectId, collapsed, activeJobs, onToggle, tree }: SidebarViewProps) {
  const [projects, ...rest] = RAIL_ENTRIES;
  const toggle = (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      aria-keyshortcuts="Control+B"
      className={cx(
        "flex h-8 shrink-0 items-center gap-2.5 rounded-control text-xs text-dim hover:bg-hover hover:text-ink",
        collapsed ? "w-[42px] justify-center" : "w-full px-2.5",
        focusRing,
      )}
    >
      <Icon name={collapsed ? "chevron-right" : "chevron-left"} size={16} />
      {!collapsed && (
        <>
          <span className="flex-1 text-left">Collapse sidebar</span>
          <KeyChord chord="Ctrl+B" className="shrink-0" />
        </>
      )}
    </button>
  );
  return (
    <nav
      aria-label="Main navigation"
      data-state={collapsed ? "collapsed" : "expanded"}
      className={cx(
        "flex shrink-0 flex-col gap-0.5 overflow-y-auto overflow-x-hidden border-r border-line bg-rail py-3.5 transition-[width] duration-base ease-out",
        collapsed ? "w-16 items-center px-[11px]" : "w-[236px] px-3",
      )}
    >
      <Link
        to="/projects"
        aria-label="Kestrel AI"
        className={cx("mb-3.5 shrink-0 rounded-xl", !collapsed && "px-1", focusRing)}
      >
        <Brand compact={collapsed} size={collapsed ? "md" : "lg"} />
      </Link>
      {projects && (
        <SidebarLink
          to={projects.to}
          icon={projects.icon}
          label={projects.label}
          active={section === "projects" && !projectId}
          parent={!!projectId}
          collapsed={collapsed}
        />
      )}
      {tree}
      {rest.map((entry) => (
        <SidebarLink
          key={entry.id}
          to={railHref(entry, projectId)}
          icon={entry.icon}
          label={entry.label}
          active={section === entry.id}
          badge={entry.id === "jobs" && activeJobs > 0 ? activeJobs : undefined}
          collapsed={collapsed}
        />
      ))}
      <div className="min-h-4 flex-1" />
      <SidebarLink
        to={RAIL_SETTINGS.to}
        icon={RAIL_SETTINGS.icon}
        label={RAIL_SETTINGS.label}
        active={section === "settings"}
        collapsed={collapsed}
      />
      {collapsed ? (
        <Tooltip label="Expand sidebar" side="right" shortcut="Ctrl+B">
          {toggle}
        </Tooltip>
      ) : (
        toggle
      )}
    </nav>
  );
}
