import { useLocation, useNavigate } from "react-router-dom";
import { MenuButton, Tabs } from "@/ui";
import { PROJECT_TABS, SECONDARY_PAGES, routeInfo, secondaryHref, type ProjectTabId } from "./routeModel";
import { useProjectCounts, type ProjectCounts } from "./useProjectCounts";

function countFor(id: ProjectTabId, counts: ProjectCounts | null): number | null {
  if (!counts) return null;
  if (id === "images") return counts.images;
  if (id === "maps") return counts.maps;
  if (id === "drawings") return counts.drawings;
  if (id === "clouds") return counts.pointClouds;
  if (id === "findings") return counts.openFindings;
  return null;
}

/** The project tabs (spec 2026-09-26-foundation section 5.2, plus Drawings) and the More menu. */
export function ProjectTabs({ projectId }: { projectId: string }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const counts = useProjectCounts(projectId);
  const items = PROJECT_TABS.map((t) => ({
    id: t.id,
    label: t.label,
    to: `/p/${projectId}/${t.id}`,
    count: countFor(t.id, counts),
  }));
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line px-5">
      <Tabs
        label="Project"
        items={items}
        value={routeInfo(pathname).tab ?? undefined}
        asLinks
        className="min-w-0 flex-1"
      />
      <MenuButton
        label="More"
        items={SECONDARY_PAGES.map((p) => ({
          id: p.id,
          label: p.label,
          icon: p.icon,
          onSelect: () => void navigate(secondaryHref(projectId, p)),
        }))}
      />
    </div>
  );
}
