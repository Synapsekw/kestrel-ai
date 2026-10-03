/* eslint-disable react-refresh/only-export-components -- projectInitials is a pure helper kept beside the tree it names */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon, MenuButton, StatusDot, Tooltip, cx, focusRing } from "@/ui";
import { PROJECT_TABS, SECONDARY_PAGES, secondaryHref, type ProjectTabId } from "./routeModel";
import { SidebarLink } from "./SidebarLink";
import type { ProjectCounts } from "./useProjectCounts";

export function projectInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "P";
  return words
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

function countFor(id: ProjectTabId, counts: ProjectCounts | null): number | null {
  if (!counts) return null;
  if (id === "images") return counts.images;
  if (id === "maps") return counts.maps;
  if (id === "drawings") return counts.drawings;
  if (id === "clouds") return counts.pointClouds;
  if (id === "findings") return counts.openFindings;
  return null;
}

export interface SidebarProjectTreeProps {
  projectId: string;
  projectName: string | null;
  busy: boolean;
  counts: ProjectCounts | null;
  tab: ProjectTabId | null;
  secondary: string | null;
  collapsed: boolean;
}

/** The open project under Projects: its row, its nine pages and More (spec 2026-10-03-sidebar §3.1). */
export function SidebarProjectTree({
  projectId,
  projectName,
  busy,
  counts,
  tab,
  secondary,
  collapsed,
}: SidebarProjectTreeProps) {
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const showMore = moreOpen || secondary !== null;
  const name = projectName ?? "Project";
  const tile = (
    <span
      aria-hidden="true"
      className="grid h-6 w-6 shrink-0 place-items-center rounded-sm bg-grad-brand text-2xs font-semibold text-accent-fg"
    >
      {projectInitials(name)}
    </span>
  );
  const head = (
    <Link
      to={`/p/${projectId}/overview`}
      aria-label={name}
      className={cx(
        "relative flex shrink-0 items-center gap-2 rounded-control font-semibold text-ink hover:bg-hover",
        collapsed ? "h-10 w-[42px] justify-center" : "h-[30px] w-full px-2",
        focusRing,
      )}
    >
      {tile}
      {!collapsed && <span className="min-w-0 flex-1 truncate text-sm">{name}</span>}
      <StatusDot
        status={busy ? "running" : "idle"}
        live={busy}
        label={busy ? "Jobs running" : "Idle"}
        className={collapsed ? "absolute right-1 top-1" : undefined}
      />
    </Link>
  );
  return (
    <div
      role="group"
      aria-label={name}
      className={
        collapsed
          ? "relative my-1 flex flex-col items-center gap-0.5 border-y border-line py-1.5"
          : "mb-1 ml-[19px] flex flex-col gap-px border-l border-line pl-2"
      }
    >
      <Tooltip label={name} side="right" delay={collapsed ? 400 : 800}>
        {head}
      </Tooltip>
      <ul className={cx("flex flex-col gap-px", collapsed && "items-center")}>
        {PROJECT_TABS.map((t) => (
          <li key={t.id}>
            <SidebarLink
              to={`/p/${projectId}/${t.id}`}
              icon={t.icon}
              label={t.label}
              count={countFor(t.id, counts)}
              active={tab === t.id}
              nested
              collapsed={collapsed}
            />
          </li>
        ))}
      </ul>
      {collapsed ? (
        <MenuButton
          label="More pages"
          iconOnly
          icon="more"
          side="right"
          items={SECONDARY_PAGES.map((p) => ({
            id: p.id,
            label: p.label,
            icon: p.icon,
            onSelect: () => void navigate(secondaryHref(projectId, p)),
          }))}
        />
      ) : (
        <>
          <button
            type="button"
            aria-expanded={showMore}
            onClick={() => setMoreOpen((o) => !o)}
            className={cx(
              "flex h-[30px] w-full items-center gap-2.5 rounded-control px-2.5 text-sm text-dim hover:bg-hover hover:text-ink",
              focusRing,
            )}
          >
            <Icon name="more" size={18} />
            <span className="flex-1 text-left">More</span>
            <Icon name={showMore ? "chevron-down" : "chevron-right"} size={14} />
          </button>
          {showMore && (
            <ul className="flex flex-col gap-px">
              {SECONDARY_PAGES.map((p) => (
                <li key={p.id}>
                  <SidebarLink
                    to={secondaryHref(projectId, p)}
                    icon={p.icon}
                    label={p.label}
                    active={secondary === p.id}
                    nested
                    collapsed={false}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
