import type { IconName } from "@/ui";
import type { WorkspaceScope } from "@/ui/keymap";

/** The seven project tabs, in order (spec 2026-09-26-foundation section 5.2). */
export type ProjectTabId =
  "overview" | "images" | "maps" | "clouds" | "findings" | "measurements" | "reports";
/** The rail's sections (section 5.1). */
export type Section = "projects" | "models" | "catalogue" | "jobs" | "settings";
/** A padded, scrolling page; a bare workspace under the tabs; or a full-bleed surface without tabs. */
export type Layout = "page" | "workspace" | "fullbleed";

export interface NavEntry<Id extends string = string> {
  id: Id;
  label: string;
  icon: IconName;
}

export interface RailEntry extends NavEntry<Section> {
  to: string;
}

export const PROJECT_TABS: readonly NavEntry<ProjectTabId>[] = [
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "images", label: "Images", icon: "images" },
  { id: "maps", label: "Maps", icon: "map" },
  { id: "clouds", label: "Point clouds", icon: "cloud" },
  { id: "findings", label: "Findings", icon: "findings" },
  { id: "measurements", label: "Measurements", icon: "measure" },
  { id: "reports", label: "Reports", icon: "report" },
];

/** A project page without a tab; `search` is appended to its link (e.g. `?view=runs`). */
export interface PageEntry extends NavEntry {
  search?: string;
}

/** Project pages without a tab (section 5.3): the tab strip's More menu and the palette reach them. */
export const SECONDARY_PAGES: readonly PageEntry[] = [
  { id: "runs", label: "Runs", icon: "detect" },
  // I-FW I3: the suggestions review is the Images tab (`?filter=suggestions`); this entry is the
  // detection runs picker, which `/review` renders only at `?view=runs`.
  { id: "review", label: "Review", icon: "review", search: "?view=runs" },
  { id: "query", label: "Detect", icon: "detect" },
  { id: "analytics", label: "Analytics", icon: "trend" },
  { id: "site-areas", label: "Site areas", icon: "map" },
  { id: "settings", label: "Project settings", icon: "settings" },
];

/** Where the More menu and the palette send a secondary page. */
export function secondaryHref(projectId: string, page: PageEntry): string {
  return `/p/${projectId}/${page.id}${page.search ?? ""}`;
}

export const RAIL_ENTRIES: readonly RailEntry[] = [
  { id: "projects", label: "Projects", icon: "folder", to: "/projects" },
  { id: "models", label: "Models", icon: "models", to: "/models" },
  { id: "catalogue", label: "Catalogue", icon: "catalogue", to: "/catalogue" },
  { id: "jobs", label: "Jobs", icon: "jobs", to: "/jobs" },
];

export const RAIL_SETTINGS: RailEntry = {
  id: "settings",
  label: "Settings",
  icon: "settings",
  to: "/settings",
};

/** Where a rail entry goes: Jobs keeps the current project (`/jobs?project=`), the rest are fixed. */
export function railHref(entry: RailEntry, projectId: string | null | undefined): string {
  return entry.id === "jobs" && projectId ? `/jobs?project=${projectId}` : entry.to;
}

export const SECTION_LABEL: Record<Section, string> = {
  projects: "Projects",
  models: "Models",
  catalogue: "Catalogue",
  jobs: "Jobs",
  settings: "Settings",
};

const MODELS_PAGES: Record<string, string> = {
  library: "Library",
  datasets: "Datasets",
  training: "Training",
};

export interface RouteInfo {
  section: Section | null;
  projectId: string | null;
  /** The highlighted project tab; null on secondary pages and outside a project. */
  tab: ProjectTabId | null;
  /** The human name of the page, for the breadcrumb; null when unknown. */
  page: string | null;
  layout: Layout;
  /** Changes when the page transition should play: the tab in a project, two segments elsewhere. */
  transitionKey: string;
}

/**
 * How the shell frames a project page. The one place a workspace unit changes when its surface
 * lands: `maps` is full-bleed at its list (the map workspace, M-W1); C makes `clouds` full-bleed.
 */
export function layoutOf(tab: string, detail: boolean, sub?: string): Layout {
  if (tab === "maps") return "fullbleed";
  if (tab === "clouds" && detail) return "fullbleed"; // C-W1: the point cloud workspace
  if (tab === "images") return "workspace";
  // R7: the report builder's three panes fill the page under the tabs; Data exports stays a page.
  if (tab === "reports" && detail && sub !== "exports") return "workspace";
  return "page";
}

export function routeInfo(pathname: string): RouteInfo {
  const parts = pathname.split("/").filter(Boolean);
  const [head, second] = parts;
  const app = (section: Section | null, page: string | null): RouteInfo => ({
    section,
    projectId: null,
    tab: null,
    page,
    layout: "page",
    transitionKey: parts.slice(0, 2).join("/"),
  });
  if (!head || head === "projects") return { ...app("projects", "Projects"), transitionKey: "projects" };
  if (head === "p" && second) {
    const seg = parts[2] ?? "overview";
    const tab = PROJECT_TABS.find((t) => t.id === seg) ?? null;
    const secondary = SECONDARY_PAGES.find((s) => s.id === seg) ?? null;
    return {
      section: "projects",
      projectId: second,
      tab: tab?.id ?? null,
      page: tab?.label ?? secondary?.label ?? null,
      layout: layoutOf(seg, parts.length > 3, parts[3]),
      transitionKey: `p/${second}/${seg}`,
    };
  }
  if (head === "models") return app("models", second ? (MODELS_PAGES[second] ?? null) : "Library");
  if (head === "catalogue") return app("catalogue", second === "severity" ? "Severity" : "Types");
  if (head === "jobs") return app("jobs", "Jobs");
  if (head === "settings") return app("settings", "Settings");
  if (head === "about") return app("settings", "About");
  return app(null, null);
}

// `findings` is reserved empty in DS's keymap (S1 fills it later); the sheet still shows the
// scope on the Findings tab so the global and review rows render there too (controller ruling F6).
const WORKSPACE_TABS: readonly WorkspaceScope[] = ["images", "maps", "clouds", "findings"];

/** The `?` sheet's keymap scope for a route: the workspace tab's own, else none (global only). */
export function sheetScope(info: RouteInfo): WorkspaceScope | null {
  return info.tab && (WORKSPACE_TABS as readonly string[]).includes(info.tab)
    ? (info.tab as WorkspaceScope)
    : null;
}
