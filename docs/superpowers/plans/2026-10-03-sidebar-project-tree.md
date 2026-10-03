# Sidebar project tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 64px icon rail, the top-bar breadcrumb and the project tab strip with one labelled, collapsible sidebar. The open project appears in it as a tree under Projects.

**Architecture:**
- Pure navigation rules live in `app/routeModel.ts`: forced collapse, the collapsed state and the top-bar title.
- A small zustand store in `app/sidebarStore.ts` holds the persisted preference and the per-visit override.
- Two presentational components draw the sidebar: `SidebarView` and `SidebarProjectTree`. The gallery renders them without an API.
- A thin `Sidebar` container in `app/Sidebar.tsx` wires them to the router, the jobs store and `useProjectCounts`.
- `Shell` renders `Sidebar` where it rendered `Rail` and `ProjectTabs`. `TopBar` shows a plain page title.

**Tech Stack:** React 19, TypeScript, react-router 7, zustand, Tailwind (with the design tokens), Vitest + Testing Library, Playwright with the Prism mock.

**Spec:** `docs/superpowers/specs/2026-10-03-sidebar-project-tree-design.md`

## Global Constraints

- Expanded width is **236px** (`w-[236px]`); collapsed width is **64px** (`w-16`).
- The forced-collapse threshold is a window **narrower than 1100px**.
- Storage key: **`kestrel.sidebar`**, value `{"collapsed": boolean}`. Every read and write goes through try/catch, and the default is expanded.
- Shortcut: **Ctrl+B**, keymap action `toggle-sidebar`, help text "Show or hide the sidebar". It is ignored when `isTypingTarget(e.target)`. `\` and plain `B` are unchanged.
- The landmark stays `<nav aria-label="Main navigation">` and carries `data-state="expanded" | "collapsed"`.
- A link's accessible name is its label, plus a space and the `toLocaleString()` count when it has one (e.g. "Images 1,284"). It is the same in both states. The Jobs badge is `aria-hidden`, so the Jobs link stays named "Jobs".
- Copy is sentence case and is exactly: "Collapse sidebar", "Expand sidebar", "More", "More pages", "Project" (the project name fallback).
- Colours come only from design tokens. `pnpm -C frontend lint` runs `check-tokens`, which rejects raw or arbitrary colours.
- The width animates with `transition-[width] duration-base ease-out`. `--dur-base` is 0 under reduced motion, so the change is instant there. The spec said `--dur-fast`, but that duration is not zeroed; Task 6 fixes the spec.
- There must be exactly **one** `GET /projects/{id}/overview` per project open. `foundation-journey.spec.ts` counts the reads.
- No change to `contract/`, `backend/` or `ui/WorkspaceRail`.

## Review Focus

1. **Overview read count.** Moving `useProjectCounts` must not add a second overview request. `foundation-journey` pins 5 reads. Task 4 adds a Shell test asserting one overview request.
2. **Accessible names on full-bleed routes.** On Maps the sidebar is collapsed, but e2e and assistive tech still find "Findings 47" by name. Task 3 tests that collapsed links keep their names.
3. **Ctrl+B while typing.** Pressing Ctrl+B in the Images filter field or a finding note must not collapse the sidebar. Task 4 has a Shell test for this.
4. **The override leaking across pages.** Expanding on Maps, going to Findings, then back to Maps must give a collapsed sidebar, and the stored preference must be unchanged. Task 4 (Shell) and Task 5 (e2e) cover it.
5. **`localStorage` throws** (blocked storage). The app still renders expanded and the toggle still works in memory. Task 2 has a store test for this.

## Execution DAG

The units match spec §9: U1 is Tasks 1 and 2, U2 is Task 3, U3 is Task 4, U4 is Task 5, and U5 is Task 6.

| Batch | Tasks (parallel within a batch) | Needs |
| --- | --- | --- |
| 1 | Task 1 (route rules), Task 2 (store and shortcut), Task 6 (docs) | – |
| 2 | Task 3 (sidebar components and gallery) | 1, 2 |
| 3 | Task 4 (Shell and TopBar), Task 5 (e2e migration) | 3 (Task 5 can be written alongside 4, but runs after it) |
| 4 | The full gate, merge, cleanup | all |

**Critical path:** Task 1 → Task 3 → Task 4 → gate.

**Budget:** no background job is added, and no new endpoint is read. The overview read moves from `ProjectTabs` to the sidebar.

**Workspace:** a worktree at `.claude/worktrees/sidebar` on branch `task/sidebar`. All commands below run from the worktree root. Stage by path; never use `git add -A`. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Route rules for the sidebar and the top-bar title

**Files:**
- Modify: `frontend/src/app/routeModel.ts` (append after `routeInfo`)
- Test: `frontend/src/app/routeModel.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: the existing `Layout`, `RouteInfo`, `SECTION_LABEL`, `SECONDARY_PAGES` and `routeInfo` from `routeModel.ts`.
- Produces:
  - `SIDEBAR_NARROW_WIDTH = 1100`
  - `isForcedCollapse(layout: Layout, windowWidth: number): boolean`
  - `sidebarCollapsed(stored: boolean, forced: boolean, override: boolean | null): boolean`
  - `topBarTitle(info: RouteInfo): string`
  - `secondaryOf(pathname: string): string | null`

- [ ] **Step 1: Write the failing tests.** Append this to `frontend/src/app/routeModel.test.ts`, and add the five new names to its existing import from `./routeModel`:

```ts
describe("sidebar rules", () => {
  it("forces collapse on full-bleed layouts and narrow windows only", () => {
    expect(isForcedCollapse("fullbleed", 1600)).toBe(true);
    expect(isForcedCollapse("page", 1099)).toBe(true);
    expect(isForcedCollapse("page", SIDEBAR_NARROW_WIDTH)).toBe(false);
    expect(isForcedCollapse("workspace", 1280)).toBe(false);
    expect(routeInfo("/p/p1/maps").layout).toBe("fullbleed");
    expect(routeInfo("/p/p1/models").layout).toBe("fullbleed");
    expect(routeInfo("/p/p1/clouds/c1").layout).toBe("fullbleed");
    expect(routeInfo("/p/p1/clouds").layout).toBe("page");
  });

  it("uses the stored preference unless forced, and a per-visit override when forced", () => {
    expect(sidebarCollapsed(false, false, null)).toBe(false);
    expect(sidebarCollapsed(true, false, null)).toBe(true);
    expect(sidebarCollapsed(false, false, true)).toBe(false); // the override only counts when forced
    expect(sidebarCollapsed(false, true, null)).toBe(true);
    expect(sidebarCollapsed(true, true, false)).toBe(false);
    expect(sidebarCollapsed(false, true, true)).toBe(true);
  });

  it.each([
    ["/projects", "Projects"],
    ["/projects/new", "Projects · New project"],
    ["/models", "Models · Library"],
    ["/models/datasets", "Models · Datasets"],
    ["/catalogue", "Catalogue · Types"],
    ["/catalogue/severity", "Catalogue · Severity"],
    ["/jobs", "Jobs"],
    ["/settings", "Settings"],
    ["/about", "Settings · About"],
    ["/p/p1/overview", "Overview"],
    ["/p/p1/maps/m1/evaluate", "Maps"],
    ["/p/p1/runs", "Runs"],
    ["/p/p1/site-areas", "Site areas"],
    ["/p/p1/nowhere", "Project"],
    ["/no/such/page", ""],
  ])("titles %s as %j", (path, title) => {
    expect(topBarTitle(routeInfo(path))).toBe(title);
  });

  it("names the secondary page of a project path", () => {
    expect(secondaryOf("/p/p1/runs")).toBe("runs");
    expect(secondaryOf("/p/p1/review")).toBe("review");
    expect(secondaryOf("/p/p1/settings")).toBe("settings");
    expect(secondaryOf("/p/p1/findings")).toBeNull();
    expect(secondaryOf("/settings")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**
Run: `pnpm -C frontend exec vitest run src/app/routeModel.test.ts`
Expected: FAIL, because `isForcedCollapse` (and the others) are not exported.

- [ ] **Step 3: Implement.** Append this to `frontend/src/app/routeModel.ts`:

```ts
/** Below this window width the sidebar collapses on its own (the inspector's breakpoint). */
export const SIDEBAR_NARROW_WIDTH = 1100;

/** Full-bleed surfaces and narrow windows collapse the sidebar (spec 2026-10-03-sidebar §4). */
export function isForcedCollapse(layout: Layout, windowWidth: number): boolean {
  return layout === "fullbleed" || windowWidth < SIDEBAR_NARROW_WIDTH;
}

/**
 * Whether the sidebar is collapsed: on a forced route it is, unless the operator chose otherwise on
 * this visit (`override`); elsewhere the stored preference decides and the override is ignored.
 */
export function sidebarCollapsed(stored: boolean, forced: boolean, override: boolean | null): boolean {
  if (forced) return override ?? true;
  return stored;
}

/** The top bar's title (spec §5): the page in a project, else the section and its sub-page. */
export function topBarTitle(info: RouteInfo): string {
  if (info.projectId) return info.page ?? "Project";
  if (!info.section) return info.page ?? "";
  const section = SECTION_LABEL[info.section];
  return info.page && info.page !== section ? `${section} · ${info.page}` : section;
}

/** The secondary page a project path is on (Runs, Review, …), or null. */
export function secondaryOf(pathname: string): string | null {
  const [head, , seg] = pathname.split("/").filter(Boolean);
  if (head !== "p" || !seg) return null;
  return SECONDARY_PAGES.find((p) => p.id === seg)?.id ?? null;
}
```

- [ ] **Step 4: Run the tests and confirm they pass.**
Run: `pnpm -C frontend exec vitest run src/app/routeModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/app/routeModel.ts frontend/src/app/routeModel.test.ts
git commit -m "feat(shell): route rules for the sidebar and the top-bar title"
```

---

### Task 2: Sidebar store, Ctrl+B shortcut and keymap entry

**Files:**
- Create: `frontend/src/app/sidebarStore.ts`
- Create: `frontend/src/app/useSidebarShortcut.ts`
- Create: `frontend/src/app/useWindowWidth.ts`
- Modify: `frontend/src/ui/keymap.ts` (`GLOBAL_KEYS`, after the `toggle-panel` entry)
- Test: `frontend/src/app/sidebarStore.test.ts`, `frontend/src/app/useSidebarShortcut.test.tsx`

**Interfaces:**
- Consumes: `sidebarCollapsed` (Task 1) and `isTypingTarget` from `@/ui/keymap`.
- Produces:
  - `SIDEBAR_STORAGE_KEY = "kestrel.sidebar"`
  - `readSidebarPref(): boolean`
  - `writeSidebarPref(collapsed: boolean): void`
  - `useSidebar`, a zustand hook with state `{ stored: boolean; override: boolean | null; toggle(forced: boolean): void; clearOverride(): void }`
  - `isSidebarChord(e): boolean`
  - `useSidebarShortcut(onToggle: () => void): void`
  - `useWindowWidth(): number`

- [ ] **Step 1: Write the failing store tests** in `frontend/src/app/sidebarStore.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSidebarPref, SIDEBAR_STORAGE_KEY, useSidebar, writeSidebarPref } from "./sidebarStore";

describe("sidebar store", () => {
  beforeEach(() => {
    localStorage.clear();
    useSidebar.setState({ stored: false, override: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("reads expanded when nothing or garbage is stored", () => {
    expect(readSidebarPref()).toBe(false);
    localStorage.setItem(SIDEBAR_STORAGE_KEY, "not json");
    expect(readSidebarPref()).toBe(false);
    localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({ collapsed: "yes" }));
    expect(readSidebarPref()).toBe(false);
  });

  it("round-trips the preference", () => {
    writeSidebarPref(true);
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('{"collapsed":true}');
    expect(readSidebarPref()).toBe(true);
  });

  it("toggles and persists the preference on an ordinary route", () => {
    useSidebar.getState().toggle(false);
    expect(useSidebar.getState().stored).toBe(true);
    expect(readSidebarPref()).toBe(true);
    expect(useSidebar.getState().override).toBeNull();
  });

  it("on a forced route sets a per-visit override and leaves the preference alone", () => {
    useSidebar.getState().toggle(true); // forced and collapsed, so it expands for this visit
    expect(useSidebar.getState().override).toBe(false);
    expect(useSidebar.getState().stored).toBe(false);
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBeNull();
    useSidebar.getState().toggle(true);
    expect(useSidebar.getState().override).toBe(true);
    useSidebar.getState().clearOverride();
    expect(useSidebar.getState().override).toBeNull();
  });

  it("survives a storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readSidebarPref()).toBe(false);
    expect(() => useSidebar.getState().toggle(false)).not.toThrow();
    expect(useSidebar.getState().stored).toBe(true);
  });
});
```

- [ ] **Step 2: Write the failing shortcut tests** in `frontend/src/app/useSidebarShortcut.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GLOBAL_KEYS } from "@/ui/keymap";
import { isSidebarChord, useSidebarShortcut } from "./useSidebarShortcut";

function Probe({ onToggle }: { onToggle: () => void }) {
  useSidebarShortcut(onToggle);
  return <input aria-label="Filter" />;
}

describe("useSidebarShortcut", () => {
  it("recognises Ctrl+B and Cmd+B only", () => {
    const k = { key: "b", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
    expect(isSidebarChord(k)).toBe(true);
    expect(isSidebarChord({ ...k, ctrlKey: false, metaKey: true })).toBe(true);
    expect(isSidebarChord({ ...k, ctrlKey: false })).toBe(false); // plain B is the Box tool
    expect(isSidebarChord({ ...k, shiftKey: true })).toBe(false);
    expect(isSidebarChord({ ...k, altKey: true })).toBe(false);
  });

  it("toggles on Ctrl+B outside a text field and not inside one", () => {
    const onToggle = vi.fn();
    render(<Probe onToggle={onToggle} />);
    fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
    expect(onToggle).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText("Filter"), { key: "b", ctrlKey: true });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("is listed in the keymap for the ? sheet", () => {
    const entry = GLOBAL_KEYS.find((e) => e.action === "toggle-sidebar");
    expect(entry?.keys).toEqual(["Ctrl+B"]);
    expect(entry?.help).toBe("Show or hide the sidebar");
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail.**
Run: `pnpm -C frontend exec vitest run src/app/sidebarStore.test.ts src/app/useSidebarShortcut.test.tsx`
Expected: FAIL, because the modules are not found.

- [ ] **Step 4: Implement the store** in `frontend/src/app/sidebarStore.ts`:

```ts
import { create } from "zustand";
import { sidebarCollapsed } from "./routeModel";

export const SIDEBAR_STORAGE_KEY = "kestrel.sidebar";

/** The remembered choice; expanded when nothing usable is stored or storage is blocked. */
export function readSidebarPref(): boolean {
  try {
    const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (raw === null) return false;
    const v: unknown = JSON.parse(raw);
    return typeof v === "object" && v !== null && (v as { collapsed?: unknown }).collapsed === true;
  } catch {
    return false;
  }
}

export function writeSidebarPref(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({ collapsed }));
  } catch {
    // a blocked storage only loses the remembered choice
  }
}

export interface SidebarState {
  /** The operator's remembered preference (spec 2026-10-03-sidebar §4). */
  stored: boolean;
  /** This visit's choice on a forced (full-bleed or narrow) route; null when none. */
  override: boolean | null;
  toggle(forced: boolean): void;
  clearOverride(): void;
}

export const useSidebar = create<SidebarState>((set, get) => ({
  stored: readSidebarPref(),
  override: null,
  toggle: (forced) => {
    const s = get();
    if (forced) {
      set({ override: !sidebarCollapsed(s.stored, true, s.override) });
      return;
    }
    const next = !s.stored;
    set({ stored: next });
    writeSidebarPref(next);
  },
  clearOverride: () => {
    if (get().override !== null) set({ override: null });
  },
}));
```

- [ ] **Step 5: Implement the shortcut** in `frontend/src/app/useSidebarShortcut.ts`:

```ts
import { useEffect, useRef } from "react";
import { isTypingTarget } from "@/ui/keymap";

export function isSidebarChord(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "b";
}

/** Ctrl+B shows or hides the sidebar, except while typing in a field (spec 2026-10-03-sidebar §4). */
export function useSidebarShortcut(onToggle: () => void): void {
  const latest = useRef(onToggle);
  useEffect(() => {
    latest.current = onToggle;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isSidebarChord(e) || isTypingTarget(e.target)) return;
      e.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
```

- [ ] **Step 6: Implement the window width hook** in `frontend/src/app/useWindowWidth.ts`:

```ts
import { useEffect, useState } from "react";

/** The window's inner width, updated on resize. */
export function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}
```

- [ ] **Step 7: Add the keymap entry** in `frontend/src/ui/keymap.ts`. Insert this directly after the `toggle-panel` line in `GLOBAL_KEYS`:

```ts
  g("Ctrl+B", "toggle-sidebar", "Show or hide the sidebar"),
```

- [ ] **Step 8: Run the tests and confirm they pass.**
Run: `pnpm -C frontend exec vitest run src/app/sidebarStore.test.ts src/app/useSidebarShortcut.test.tsx src/ui/keymap.test.tsx src/app/ShortcutSheet.test.tsx`
Expected: PASS. `keymap.test.tsx` walks collisions, and Ctrl+B collides with nothing. If `ShortcutSheet.test.tsx` counts global rows, raise its expected count by one.

- [ ] **Step 9: Commit.**
```bash
git add frontend/src/app/sidebarStore.ts frontend/src/app/sidebarStore.test.ts frontend/src/app/useSidebarShortcut.ts frontend/src/app/useSidebarShortcut.test.tsx frontend/src/app/useWindowWidth.ts frontend/src/ui/keymap.ts
git commit -m "feat(shell): sidebar store, Ctrl+B and the window width hook"
```
If Step 8 changed `frontend/src/app/ShortcutSheet.test.tsx`, add that file to the `git add` too.

---

### Task 3: Sidebar components and the gallery section

**Files:**
- Create: `frontend/src/app/SidebarLink.tsx`
- Create: `frontend/src/app/SidebarProjectTree.tsx`
- Create: `frontend/src/app/SidebarView.tsx`
- Create: `frontend/src/app/Sidebar.tsx`
- Create: `frontend/src/ui/gallery/sections/Sidebar.tsx`
- Test: `frontend/src/app/SidebarProjectTree.test.tsx`, `frontend/src/app/SidebarView.test.tsx`

**Interfaces:**
- Consumes:
  - From Task 1: `routeInfo`, `secondaryOf`, `isForcedCollapse` and `sidebarCollapsed`.
  - From `routeModel.ts`: `RAIL_ENTRIES`, `RAIL_SETTINGS`, `railHref`, `PROJECT_TABS`, `SECONDARY_PAGES` and `secondaryHref`.
  - From Task 2: `useSidebar`, `useSidebarShortcut` and `useWindowWidth`.
  - From existing code: `useProjectCounts` and `ProjectCounts` (`./useProjectCounts`), and `useJobsStore`, `isActiveJob` and `selectActiveCount` (`@/store/jobs`).
- Produces:
  - `SidebarView` with props `{ section: Section | null; projectId?: string; collapsed: boolean; activeJobs: number; onToggle: () => void; tree?: ReactNode }`.
  - `SidebarProjectTree` with props `{ projectId: string; projectName: string | null; busy: boolean; counts: ProjectCounts | null; tab: ProjectTabId | null; secondary: string | null; collapsed: boolean }`.
  - `projectInitials(name: string): string`.
  - `Sidebar` with props `{ projectId: string | undefined; projectName: string | null }`. Task 4 consumes this.

- [ ] **Step 1: Write the failing tree tests** in `frontend/src/app/SidebarProjectTree.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { projectInitials, SidebarProjectTree } from "./SidebarProjectTree";
import type { ProjectCounts } from "./useProjectCounts";

const COUNTS: ProjectCounts = { images: 1284, maps: 3, drawings: 0, pointClouds: 2, openFindings: 47 };

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

function renderTree(props: Partial<Parameters<typeof SidebarProjectTree>[0]> = {}) {
  render(
    <MemoryRouter initialEntries={["/p/p1/findings"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <SidebarProjectTree
                projectId="p1"
                projectName="Al Khail Gate Phase 2"
                busy={false}
                counts={COUNTS}
                tab="findings"
                secondary={null}
                collapsed={false}
                {...props}
              />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  const name = props.projectName === null ? "Project" : (props.projectName ?? "Al Khail Gate Phase 2");
  return screen.getByRole("group", { name });
}

describe("SidebarProjectTree", () => {
  it("lists the nine pages with counts in their names and marks the current one", () => {
    const tree = renderTree();
    const names = within(tree)
      .getAllByRole("link")
      .map((l) => l.getAttribute("aria-label"));
    expect(names).toEqual([
      "Al Khail Gate Phase 2",
      "Overview",
      "Images 1,284",
      "Maps 3",
      "Drawings 0",
      "Point clouds 2",
      "Asset models",
      "Findings 47",
      "Measurements",
      "Reports",
    ]);
    expect(within(tree).getByRole("link", { name: "Findings 47" })).toHaveAttribute("aria-current", "page");
    expect(within(tree).getByRole("link", { name: "Images 1,284" })).toHaveAttribute("href", "/p/p1/images");
    expect(within(tree).getByRole("link", { name: "Al Khail Gate Phase 2" })).toHaveAttribute(
      "href",
      "/p/p1/overview",
    );
    expect(within(tree).getByRole("link", { name: "Al Khail Gate Phase 2" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("names pages without counts while the counts are unavailable", () => {
    const tree = renderTree({ counts: null });
    expect(within(tree).getByRole("link", { name: "Images" })).toBeInTheDocument();
  });

  it("calls an unloaded project 'Project' and shows its live dot while a job runs", () => {
    const tree = renderTree({ projectName: null, busy: true });
    expect(within(tree).getByRole("link", { name: "Project" })).toBeInTheDocument();
    expect(within(tree).getByLabelText("Jobs running")).toBeInTheDocument();
  });

  it("opens More to reveal the secondary pages", () => {
    const tree = renderTree();
    expect(within(tree).queryByRole("link", { name: "Runs" })).toBeNull();
    const more = within(tree).getByRole("button", { name: "More" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(within(tree).getByRole("link", { name: "Review" })).toHaveAttribute("href", "/p/p1/review?view=runs");
    expect(within(tree).getByRole("link", { name: "Project settings" })).toHaveAttribute(
      "href",
      "/p/p1/settings",
    );
  });

  it("keeps More open on a secondary page and marks it", () => {
    const tree = renderTree({ tab: null, secondary: "runs" });
    expect(within(tree).getByRole("button", { name: "More" })).toHaveAttribute("aria-expanded", "true");
    expect(within(tree).getByRole("link", { name: "Runs" })).toHaveAttribute("aria-current", "page");
  });

  it("collapsed: keeps link names, shows a tooltip, and turns More into a menu", async () => {
    const tree = renderTree({ collapsed: true });
    const findings = within(tree).getByRole("link", { name: "Findings 47" });
    act(() => findings.focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent("Findings");
    fireEvent.click(within(tree).getByRole("button", { name: "More pages" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Analytics" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/p/p1/analytics");
  });

  it("makes initials from the first two words", () => {
    expect(projectInitials("Al Khail Gate Phase 2")).toBe("AK");
    expect(projectInitials("tank")).toBe("T");
    expect(projectInitials("  ")).toBe("P");
  });
});
```

- [ ] **Step 2: Write the failing view tests** in `frontend/src/app/SidebarView.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SidebarView } from "./SidebarView";

function renderView(props: Partial<Parameters<typeof SidebarView>[0]> = {}) {
  const onToggle = vi.fn();
  render(
    <MemoryRouter>
      <SidebarView section="models" collapsed={false} activeJobs={0} onToggle={onToggle} {...props} />
    </MemoryRouter>,
  );
  return { onToggle, nav: screen.getByRole("navigation", { name: "Main navigation" }) };
}

describe("SidebarView", () => {
  it("lists the brand, the sections and Settings, and marks the current section", () => {
    const { nav } = renderView();
    expect(within(nav).getAllByRole("link").map((l) => l.getAttribute("aria-label"))).toEqual([
      "Kestrel AI",
      "Projects",
      "Models",
      "Catalogue",
      "Jobs",
      "Settings",
    ]);
    expect(within(nav).getByRole("link", { name: "Models" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Jobs" })).toHaveAttribute("href", "/jobs");
    expect(nav).toHaveAttribute("data-state", "expanded");
  });

  it("inside a project: Projects is a parent, not current, and Jobs keeps the project", () => {
    const { nav } = renderView({ section: "projects", projectId: "p1", tree: <p>tree</p> });
    expect(within(nav).getByRole("link", { name: "Projects" })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("link", { name: "Jobs" })).toHaveAttribute("href", "/jobs?project=p1");
    expect(within(nav).getByText("tree")).toBeInTheDocument();
  });

  it("badges Jobs with the active count without renaming it, and hides the badge at 0", () => {
    const { nav } = renderView({ activeJobs: 2 });
    const jobs = within(nav).getByRole("link", { name: "Jobs" });
    expect(jobs).toHaveTextContent("2");
  });

  it("collapses: names stay, tooltips show, the button says Expand sidebar", () => {
    const { nav, onToggle } = renderView({ collapsed: true });
    expect(nav).toHaveAttribute("data-state", "collapsed");
    const catalogue = within(nav).getByRole("link", { name: "Catalogue" });
    act(() => catalogue.focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent("Catalogue");
    const expand = within(nav).getByRole("button", { name: "Expand sidebar" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(expand);
    expect(onToggle).toHaveBeenCalled();
  });

  it("offers Collapse sidebar with its Ctrl+B key caps when expanded", () => {
    const { nav } = renderView();
    const button = within(nav).getByRole("button", { name: "Collapse sidebar" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-keyshortcuts", "Control+B");
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail.**
Run: `pnpm -C frontend exec vitest run src/app/SidebarProjectTree.test.tsx src/app/SidebarView.test.tsx`
Expected: FAIL, because the modules are not found.

- [ ] **Step 4: Implement the shared row** in `frontend/src/app/SidebarLink.tsx`:

```tsx
import { Link } from "react-router-dom";
import { Icon, Tooltip, cx, focusRing, type IconName } from "@/ui";

/** The 3px gradient bar on the current row, as the rail had (DESIGN.md § Shell). */
const ACTIVE =
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
export function SidebarLink({ to, icon, label, count, badge, active, parent, nested, collapsed }: SidebarLinkProps) {
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
  return collapsed ? (
    <Tooltip label={label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}
```

- [ ] **Step 5: Implement the tree** in `frontend/src/app/SidebarProjectTree.tsx`:

```tsx
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
    .map((w) => w[0]!.toUpperCase())
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
      {collapsed ? (
        <Tooltip label={name} side="right">
          {head}
        </Tooltip>
      ) : (
        <Tooltip label={name} side="right" delay={800}>
          {head}
        </Tooltip>
      )}
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
```

`MenuButton` with `iconOnly` renders `<IconButton icon={icon ?? "chevron-down"} label={label} />` (`ui/Menu.tsx:145`), so `icon="more"` draws the "…" glyph and `label` is its accessible name.

- [ ] **Step 6: Implement the view** in `frontend/src/app/SidebarView.tsx`:

```tsx
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
      <SidebarLink
        to={projects!.to}
        icon={projects!.icon}
        label={projects!.label}
        active={section === "projects" && !projectId}
        parent={!!projectId}
        collapsed={collapsed}
      />
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
```

- [ ] **Step 7: Implement the container** in `frontend/src/app/Sidebar.tsx`. It has no unit test of its own; Task 4's Shell tests cover it.

```tsx
import { useCallback, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { isActiveJob, selectActiveCount, useJobsStore } from "@/store/jobs";
import { isForcedCollapse, routeInfo, secondaryOf, sidebarCollapsed, type RouteInfo } from "./routeModel";
import { useSidebar } from "./sidebarStore";
import { SidebarProjectTree } from "./SidebarProjectTree";
import { SidebarView } from "./SidebarView";
import { useProjectCounts } from "./useProjectCounts";
import { useSidebarShortcut } from "./useSidebarShortcut";
import { useWindowWidth } from "./useWindowWidth";

/** Loads what the tree shows; mounted only inside a project, so the overview is read once per project. */
function ProjectTree({
  projectId,
  projectName,
  info,
  pathname,
  collapsed,
}: {
  projectId: string;
  projectName: string | null;
  info: RouteInfo;
  pathname: string;
  collapsed: boolean;
}) {
  const counts = useProjectCounts(projectId);
  const busy = useJobsStore((s) =>
    Object.values(s.jobs).some((j) => j.project_id === projectId && isActiveJob(j)),
  );
  return (
    <SidebarProjectTree
      projectId={projectId}
      projectName={projectName}
      busy={busy}
      counts={counts}
      tab={info.tab}
      secondary={secondaryOf(pathname)}
      collapsed={collapsed}
    />
  );
}

/** The app's navigation (spec 2026-10-03-sidebar): the view wired to the route, jobs and collapse state. */
export function Sidebar({ projectId, projectName }: { projectId: string | undefined; projectName: string | null }) {
  const { pathname } = useLocation();
  const info = routeInfo(pathname);
  const forced = isForcedCollapse(info.layout, useWindowWidth());
  const stored = useSidebar((s) => s.stored);
  const override = useSidebar((s) => s.override);
  const collapsed = sidebarCollapsed(stored, forced, override);
  const activeJobs = useJobsStore(selectActiveCount);

  // A per-visit choice ends when the page changes (spec §4).
  useEffect(() => useSidebar.getState().clearOverride(), [info.transitionKey]);

  const toggle = useCallback(() => useSidebar.getState().toggle(forced), [forced]);
  useSidebarShortcut(toggle);

  return (
    <SidebarView
      section={info.section}
      projectId={projectId}
      collapsed={collapsed}
      activeJobs={activeJobs}
      onToggle={toggle}
      tree={
        projectId ? (
          <ProjectTree
            projectId={projectId}
            projectName={projectName}
            info={info}
            pathname={pathname}
            collapsed={collapsed}
          />
        ) : undefined
      }
    />
  );
}
```

- [ ] **Step 8: Add the gallery section** in `frontend/src/ui/gallery/sections/Sidebar.tsx`. The gallery's `main.tsx` already wraps sections in a `MemoryRouter`.

```tsx
import { useState } from "react";
import { SidebarProjectTree } from "@/app/SidebarProjectTree";
import { SidebarView } from "@/app/SidebarView";

export const title = "Sidebar";
export const order = 50;

const COUNTS = { images: 1284, maps: 3, drawings: 1, pointClouds: 2, openFindings: 47 };

function Frame({ collapsed, inProject }: { collapsed: boolean; inProject: boolean }) {
  const [c, setC] = useState(collapsed);
  return (
    <div className="flex h-[640px] overflow-hidden rounded-panel border border-line bg-bg">
      <SidebarView
        section="projects"
        projectId={inProject ? "demo" : undefined}
        collapsed={c}
        activeJobs={2}
        onToggle={() => setC((v) => !v)}
        tree={
          inProject ? (
            <SidebarProjectTree
              projectId="demo"
              projectName="Al Khail Gate Phase 2"
              busy
              counts={COUNTS}
              tab="findings"
              secondary={null}
              collapsed={c}
            />
          ) : undefined
        }
      />
      <div className="flex-1" />
    </div>
  );
}

export default function SidebarSection() {
  return (
    <div className="grid grid-cols-3 gap-4">
      <Frame collapsed={false} inProject />
      <Frame collapsed inProject />
      <Frame collapsed={false} inProject={false} />
    </div>
  );
}
```

- [ ] **Step 9: Run the tests, the gallery test and the lint, and confirm they pass.**
Run: `pnpm -C frontend exec vitest run src/app/SidebarProjectTree.test.tsx src/app/SidebarView.test.tsx src/ui/gallery/Gallery.test.tsx`
Expected: PASS.
Run: `pnpm -C frontend lint`
Expected: PASS, with no check-tokens violations. If `eslint` flags the non-null assertions (`projects!`, `w[0]!`), replace them with `RAIL_ENTRIES[0]` destructured with a guard, or with `w.charAt(0)`.

- [ ] **Step 10: Commit.**
```bash
git add frontend/src/app/SidebarLink.tsx frontend/src/app/SidebarProjectTree.tsx frontend/src/app/SidebarProjectTree.test.tsx frontend/src/app/SidebarView.tsx frontend/src/app/SidebarView.test.tsx frontend/src/app/Sidebar.tsx frontend/src/ui/gallery/sections/Sidebar.tsx
git commit -m "feat(shell): the labelled sidebar with the project tree"
```

---

### Task 4: Shell and TopBar use the sidebar; Rail and ProjectTabs go

**Files:**
- Modify: `frontend/src/app/Shell.tsx`
- Modify: `frontend/src/app/TopBar.tsx`
- Delete: `frontend/src/app/Rail.tsx`, `frontend/src/app/Rail.test.tsx`, `frontend/src/app/ProjectTabs.tsx`, `frontend/src/app/ProjectTabs.test.tsx`
- Test: `frontend/src/app/Shell.test.tsx`, `frontend/src/app/TopBar.test.tsx`

**Interfaces:**
- Consumes: `Sidebar` (Task 3), `topBarTitle` and `routeInfo` (Task 1), and `useSidebar` (Task 2).
- Produces: `TopBar` with props `{ projectId: string | undefined; onOpenPalette: () => void }`. The `projectName` prop is removed.

- [ ] **Step 1: Update the Shell tests.** In `frontend/src/app/Shell.test.tsx`:

  1. Add imports: `import { useSidebar } from "./sidebarStore";`.
  2. Add `findings` and `maps` routes inside `<Route path="/" element={<Shell />}>`:
     ```tsx
     <Route path="p/:projectId/findings" element={<p>findings page</p>} />
     <Route path="p/:projectId/maps" element={<p>map workspace</p>} />
     ```
  3. Replace `beforeEach(() => useJobsStore.setState({ jobs: {} }));` with:
     ```tsx
     beforeEach(() => {
       useJobsStore.setState({ jobs: {} });
       useSidebar.setState({ stored: false, override: null });
       Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 });
     });
     ```
  4. Replace the tests "frames an app page…", "frames a project page…", "hides the tabs on the full-bleed map…" and "still renders a project that cannot be loaded…" with:

```tsx
  it("frames an app page with the sidebar and the page title, and no tabs", async () => {
    renderShell("/projects");
    expect(await screen.findByText("projects page")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(nav).toHaveAttribute("data-state", "expanded");
    expect(within(nav).getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("banner")).toHaveTextContent("Projects");
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("puts the project and its pages in the sidebar, reading the overview once", async () => {
    const { requests } = renderShell(`/p/${PROJECT_ID}/images`);
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(await within(nav).findByRole("link", { name: exampleProject.name })).toBeInTheDocument();
    await within(nav).findByRole("link", { name: /^Images [\d,]+$/ });
    expect(within(nav).getByRole("link", { name: /^Images/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("banner")).toHaveTextContent("Images");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(requests.filter((r) => r.method === "GET" && r.url.endsWith("/overview"))).toHaveLength(1);
  });

  it("collapses on a full-bleed map, expands for the visit only, and collapses again on return", async () => {
    renderShell(`/p/${PROJECT_ID}/maps`);
    expect(await screen.findByText("map workspace")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(nav).toHaveAttribute("data-state", "collapsed");
    expect(screen.getByRole("banner")).toHaveTextContent("Maps");
    fireEvent.click(within(nav).getByRole("button", { name: "Expand sidebar" }));
    expect(nav).toHaveAttribute("data-state", "expanded");
    expect(useSidebar.getState().stored).toBe(false);
    fireEvent.click(within(nav).getByRole("link", { name: /^Findings/ }));
    expect(await screen.findByText("findings page")).toBeInTheDocument();
    expect(nav).toHaveAttribute("data-state", "expanded");
    fireEvent.click(within(nav).getByRole("link", { name: /^Maps/ }));
    expect(await screen.findByText("map workspace")).toBeInTheDocument();
    expect(nav).toHaveAttribute("data-state", "collapsed");
  });

  it("collapses under 1100px wide", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1000 });
    renderShell("/projects");
    expect(await screen.findByText("projects page")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toHaveAttribute("data-state", "collapsed");
  });

  it("toggles with Ctrl+B, but not while typing in a field", async () => {
    renderShell(`/p/${PROJECT_ID}/images`);
    const field = await screen.findByLabelText("Filter");
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    field.focus();
    fireEvent.keyDown(field, { key: "b", ctrlKey: true });
    expect(nav).toHaveAttribute("data-state", "expanded");
    fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
    expect(nav).toHaveAttribute("data-state", "collapsed");
    expect(useSidebar.getState().stored).toBe(true);
  });

  it("still renders a project that cannot be loaded, as 'Project'", async () => {
    const { requests } = renderShell(`/p/${PROJECT_ID}/images`, 409);
    await waitFor(() =>
      expect(requests.some((r) => r.method === "GET" && r.url.endsWith(`/projects/${PROJECT_ID}`))).toBe(
        true,
      ),
    );
    await waitFor(() => expect(collectDiagnostics()).toMatch(/load project failed: upgrading/));
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(within(nav).getByRole("link", { name: "Project" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/overview`,
    );
    expect(within(nav).getByRole("link", { name: /^Findings/ })).toBeInTheDocument();
  });
```

  5. Rename the test "has no jobs button: the rail and the pill lead to Jobs" to "has no jobs button: the sidebar and the pill lead to Jobs". Its body stays the same.

- [ ] **Step 2: Update the TopBar tests.** In `frontend/src/app/TopBar.test.tsx`:

  1. Change `renderBar` to drop `projectName`:
     ```tsx
     function renderBar(path: string, projectId?: string) {
       const onOpenPalette = vi.fn();
       render(
         <MemoryRouter initialEntries={[path]}>
           <TopBar projectId={projectId} onOpenPalette={onOpenPalette} />
         </MemoryRouter>,
       );
       return { onOpenPalette, banner: screen.getByRole("banner") };
     }
     ```
  2. Replace "shows Projects / the project / the tab, with an idle dot" and "calls a project whose name has not loaded 'Project'" with:
     ```tsx
     it("titles a project page by the page alone, with no breadcrumb", () => {
       const { banner } = renderBar(`/p/${PROJECT_ID}/images`, PROJECT_ID);
       expect(within(banner).getByText("Images")).toBeInTheDocument();
       expect(within(banner).queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
       expect(within(banner).queryByRole("link", { name: "Projects" })).toBeNull();
     });
     ```
  3. In "goes live and links the running job…", delete the line `expect(within(banner).getByLabelText("Jobs running")).toBeInTheDocument();` and keep the pill assertions.
  4. Replace the body of "names app sections and their pages, with no project actions" with:
     ```tsx
     const { banner } = renderBar("/models/datasets");
     expect(within(banner).getByText("Models · Datasets")).toBeInTheDocument();
     expect(within(banner).queryByRole("button", { name: "Add data" })).toBeNull();
     ```

- [ ] **Step 3: Run the tests and confirm they fail.**
Run: `pnpm -C frontend exec vitest run src/app/Shell.test.tsx src/app/TopBar.test.tsx`
Expected: FAIL. The sidebar's `data-state` is missing, the breadcrumb is still present, and `TopBar` still requires `projectName`.

- [ ] **Step 4: Change `TopBar.tsx`.**
  - Delete the `Crumbs` function.
  - Delete the `busy` selector and the `projectName` prop.
  - Delete the imports that are now unused: `StatusDot`, `isActiveJob`, `useJobsStore`, and `SECTION_LABEL`. Keep `Link`, which `ActionControl` still uses.
  - Replace `<Crumbs … />` with the title.

The component becomes:

```tsx
import { Link, useLocation } from "react-router-dom";
import { useAgentPanel } from "@/agent/panelStore";
import { Button, Icon, IconButton, KeyChord, Tooltip, buttonClass, cx, focusRing } from "@/ui";
import { useRouteActions, type RouteAction } from "./routeActions";
import { routeInfo, topBarTitle } from "./routeModel";
import { RunningPill } from "./RunningPill";

// ActionControl stays exactly as it is.

/**
 * The top bar (spec 2026-09-26-foundation section 5.1, title per 2026-10-03-sidebar §5): the page
 * title, the palette field (Ctrl K), the route's context actions, the running pill and the agent button.
 */
export function TopBar({ projectId, onOpenPalette }: { projectId: string | undefined; onOpenPalette: () => void }) {
  const { pathname } = useLocation();
  const actions = useRouteActions();
  const agentOpen = useAgentPanel((s) => s.open);
  return (
    <header className="flex h-14 shrink-0 items-center gap-3.5 border-b border-line px-5">
      <p className="min-w-0 truncate text-lg text-ink">{topBarTitle(routeInfo(pathname))}</p>
      <RunningPill projectId={projectId} />
      {/* the search button, the actions and the agent IconButton stay exactly as they are */}
    </header>
  );
}
```

`text-lg` already carries weight 600 in `tailwind.config.ts` (16/22 600), so no `font-semibold` is needed.

- [ ] **Step 5: Change `Shell.tsx`.**
  - Replace the imports `import { ProjectTabs } from "./ProjectTabs";` and `import { Rail } from "./Rail";` with `import { Sidebar } from "./Sidebar";`.
  - Change the grid class `grid-cols-[64px_minmax(0,1fr)]` to `grid-cols-[auto_minmax(0,1fr)]`.
  - Replace `<Rail projectId={projectId} />` with `<Sidebar projectId={projectId} projectName={project?.name ?? null} />`.
  - Remove `projectName={project?.name ?? null}` from `<TopBar …>`.
  - Delete the line `{projectId && info.layout !== "fullbleed" && <ProjectTabs projectId={projectId} />}`.
  - Update the doc comment to: "the sidebar, then a column of the top bar and the page, entering through PageTransition."

- [ ] **Step 6: Delete the replaced files.**
```bash
git rm frontend/src/app/Rail.tsx frontend/src/app/Rail.test.tsx frontend/src/app/ProjectTabs.tsx frontend/src/app/ProjectTabs.test.tsx
```
Then run `grep -rn "from \"./Rail\"\|from \"./ProjectTabs\"\|app/Rail\|app/ProjectTabs" frontend/src`. Expected: no output.

- [ ] **Step 7: Run the app tests, lint and build, and confirm they pass.**
Run: `pnpm -C frontend test`
Expected: PASS.
Run: `pnpm -C frontend lint`
Expected: PASS.
Run: `pnpm -C frontend build`
Expected: PASS.

- [ ] **Step 8: Commit.**
```bash
git add frontend/src/app/Shell.tsx frontend/src/app/Shell.test.tsx frontend/src/app/TopBar.tsx frontend/src/app/TopBar.test.tsx
git commit -m "feat(shell): the sidebar replaces the rail, the breadcrumb and the project tabs"
```
The deletions were staged by `git rm` in Step 6.

---

### Task 5: e2e specs find pages in the sidebar

**Files:**
- Modify:
  - `frontend/e2e/shell.spec.ts`
  - `frontend/e2e/boot.spec.ts:27-31`
  - `frontend/e2e/clouds.spec.ts:103-107`
  - `frontend/e2e/clouds-workspace.spec.ts:104-105`
  - `frontend/e2e/foundation-journey.spec.ts:572,604,614-615`
  - `frontend/e2e/images-annotate.spec.ts:101-102`
  - `frontend/e2e/images-flight.spec.ts:23`
  - `frontend/e2e/pointcloud-foundation.spec.ts:9,26,38`
  - `frontend/e2e/setup-real-backend.spec.ts:127`

**Interfaces:**
- Consumes these facts fixed by Tasks 3–4:
  - The nav is named "Main navigation" and carries `data-state`.
  - Link names are the label plus the count (e.g. "Images 1").
  - The collapse button is named "Collapse sidebar" or "Expand sidebar".
  - The More disclosure is a button named "More".
- Produces: nothing new.

In every file, use this locator for the sidebar:
```ts
const nav = page.getByRole("navigation", { name: "Main navigation" });
```
Declare it inline where a test uses it once.

- [ ] **Step 1: Migrate the one-line uses.**
  - **`boot.spec.ts`.** Rename the test title to "a project opens on Overview with counts in the sidebar". Replace line 30 with:
    `await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: /^Images/ })).toHaveAccessibleName(/^Images [\d,]+$/);`
  - **`clouds.spec.ts:103-107` and `clouds-workspace.spec.ts:104-105`.** Change the comment to `// Full-bleed: the sidebar opens collapsed here (spec 2026-10-03-sidebar §4).` and replace the tab assertion with:
    `await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveAttribute("data-state", "collapsed");`
  - **`foundation-journey.spec.ts`.**
    - Line 572: `await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Images 1" })).toBeVisible();`
    - Line 604: change the comment `(tab counts)` to `(sidebar counts)`.
    - Line 614: the same pattern with `"Findings 1"`.
    - Line 615: `await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Overview", exact: true }).click();`
  - **`images-annotate.spec.ts:101-102`.** Change the comment to `// Findings in the sidebar lists the four findings, the graded one as Major.` and the click to:
    `await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: /^Findings/ }).click();`
  - **`images-flight.spec.ts:23`.** `await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: /^Images/ }).click();`
  - **`pointcloud-foundation.spec.ts`.**
    - Rename the title (line 9) to "Point clouds opens the full-bleed workspace from the sidebar; Measurements still opens".
    - Line 26: the same pattern with `/^Point clouds/`.
    - Line 38: the same pattern with `/^Measurements/`.
  - **`setup-real-backend.spec.ts:127`.** `await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Images 2" })).toBeVisible();`

- [ ] **Step 2: Rewrite the tab-based tests in `shell.spec.ts`.**

  1. In "the rail reaches every section…":
     - Rename it to "the sidebar reaches every section and marks the current one".
     - Rename its variable `rail` to `nav`.
     - Replace `expect(box?.width).toBe(64);` with `expect(box?.width).toBe(236);`.
  2. Replace "a project opens on Overview; the tabs switch pages…" with:

```ts
test("a project opens on Overview; the sidebar tree switches pages and the entrance finishes", async ({ page }) => {
  const overview = await fromMock<{ data: { images: number } }>(page, `/api/v1/projects/${P}/overview`);
  await page.goto(`/p/${P}`);
  await expect(page).toHaveURL(new RegExp(`/p/${P}/overview$`));
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Overview", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: /^Drawings/ })).toHaveAttribute("href", `/p/${P}/drawings`);
  await expect(nav.getByRole("link", { name: /^Images/ })).toHaveAccessibleName(
    `Images ${overview.data.images.toLocaleString("en-US")}`,
  );
  await nav.getByRole("link", { name: /^Images/ }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/images(/[^/?]+)?$`));
  await expect(nav.getByRole("link", { name: /^Images/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("banner")).toContainText("Images");
  await settled(page);
});
```

  3. Rename "old addresses land on the new tabs" to "old addresses land on the new pages". Its body stays the same; the nav still fills the window height.
  4. Replace "the map viewer is full-bleed: no tabs, and the breadcrumb names the tab" and "the Maps tab is the full-bleed map workspace" with:

```ts
test("the map viewer is full-bleed: the sidebar is collapsed and the title names Maps", async ({ page }) => {
  await page.goto(`/p/${P}/maps/${MAP}/evaluate`);
  await expect(page.getByRole("banner")).toContainText("Maps");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveAttribute("data-state", "collapsed");
});

test("Maps opens collapsed; expanding there lasts for the visit only", async ({ page }) => {
  await page.goto(`/p/${P}/maps`);
  await expect(page.getByRole("toolbar", { name: "Map" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav).toHaveAttribute("data-state", "collapsed");
  await nav.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(nav).toHaveAttribute("data-state", "expanded");
  await nav.getByRole("link", { name: /^Findings/ }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/findings`));
  await expect(nav).toHaveAttribute("data-state", "expanded");
  await nav.getByRole("link", { name: /^Maps/ }).click();
  await expect(page.getByRole("toolbar", { name: "Map" })).toBeVisible();
  await expect(nav).toHaveAttribute("data-state", "collapsed");
});
```

  5. Replace "secondary pages open from More" with:

```ts
test("secondary pages open from More in the sidebar", async ({ page }) => {
  await page.goto(`/p/${P}/overview`);
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("button", { name: "More", exact: true }).click();
  await nav.getByRole("link", { name: "Analytics", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/analytics$`));
  await expect(page.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Analytics", exact: true })).toHaveAttribute("aria-current", "page");
});
```

  6. Append these new tests:

```ts
test("collapse by button and by Ctrl+B is remembered across a reload", async ({ page }) => {
  await page.goto("/projects");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav).toHaveAttribute("data-state", "expanded");
  await nav.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(nav).toHaveAttribute("data-state", "collapsed");
  await expect.poll(async () => (await nav.boundingBox())?.width).toBe(64);
  await page.reload();
  await expect(nav).toHaveAttribute("data-state", "collapsed");
  await page.locator("body").click({ position: { x: 640, y: 400 } });
  await page.keyboard.press("Control+B");
  await expect(nav).toHaveAttribute("data-state", "expanded");
  await page.reload();
  await expect(nav).toHaveAttribute("data-state", "expanded");
});

test("a window under 1100px wide starts with the sidebar collapsed", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 720 });
  await page.goto("/projects");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveAttribute("data-state", "collapsed");
});
```

- [ ] **Step 3: Search for leftovers.**
Run: `grep -rnE "getByRole\(\"tab\"|tablist|Breadcrumb" frontend/e2e`
Expected: only `models-workspace.spec.ts:42` (an in-page "parts" tab) and the `toHaveCount(0)` line in `shell.spec.ts`.

- [ ] **Step 4: Run the e2e suite and confirm it passes.**
Run: `pnpm -C frontend e2e`. If the default port is taken, use `scripts\finish-task.ps1` (which picks free ports); it fails on PowerShell 5.1, so in that case set the ports by hand as that script does.
Expected: PASS. If a spec outside this list fails because of a tab or breadcrumb selector, migrate it with the same pattern and add it to this task's commit.

- [ ] **Step 5: Commit.**
```bash
git add frontend/e2e/shell.spec.ts frontend/e2e/boot.spec.ts frontend/e2e/clouds.spec.ts frontend/e2e/clouds-workspace.spec.ts frontend/e2e/foundation-journey.spec.ts frontend/e2e/images-annotate.spec.ts frontend/e2e/images-flight.spec.ts frontend/e2e/pointcloud-foundation.spec.ts frontend/e2e/setup-real-backend.spec.ts
git commit -m "test(e2e): find project pages in the sidebar; collapse, full-bleed and narrow checks"
```

---

### Task 6: DESIGN.md, the ADR and the spec's duration note

**Files:**
- Modify: `DESIGN.md` (the `hover` / `rail` token row at line 26, and the `## Shell` section at lines 116-124)
- Create: `vault/decisions/2026-10-03-sidebar-replaces-rail-and-tabs.md`
- Modify: `docs/superpowers/specs/2026-10-03-sidebar-project-tree-design.md` (§4, the width-animation sentence)

**Interfaces:** none.

- [ ] **Step 1: Edit the DESIGN.md token row.** In the row at line 26, change "icon rail" to "sidebar".

- [ ] **Step 2: Replace the first two paragraphs of the `## Shell` section** (through "…with no exit animation."). The text before "## Workspaces" becomes:

```markdown
## Shell

A labelled sidebar, 236px wide, collapsible to a 64px icon column (`app/Sidebar`). Its rows, from the top:
the brand (logo tile and "Kestrel AI"), Projects, then, inside a project, the project as a tree under
Projects: its row (initials tile, name, `StatusDot` live while a job runs) and its nine pages
(Overview, Images, Maps, Drawings, Point clouds, Asset models, Findings, Measurements, Reports, with
counts in mono), then More, which opens the secondary pages in place. Then Models, Catalogue, Jobs
(badge: running jobs), a spacer, Settings and the collapse button. The current row is `accent-soft` with
the 3px gradient bar; the rows on its path are `ink` without the fill. Collapsed rows keep tooltips on
the right. Ctrl+B or the button toggles it, and the choice is kept in `localStorage`
(`kestrel.sidebar`). Full-bleed surfaces and windows under 1100px open collapsed; expanding there lasts
for that visit.

A 56px top bar: the page title, the search field that opens the command palette (Ctrl K), the route's
context actions, the running-jobs pill and the agent button. There is no breadcrumb and no project tab
strip. A page change fades and rises 6px over `--dur-base`, with no exit animation.
```

- [ ] **Step 3: Write the ADR** at `vault/decisions/2026-10-03-sidebar-replaces-rail-and-tabs.md`:

```markdown
---
type: decision
date: 2026-10-03
tags: [decision, shell, navigation, ui]
related: ["[[2026-10-03-sidebar-project-tree-design]]"]
---

# The sidebar replaces the rail, the breadcrumb and the project tabs

**Context.** The operator could not tell where they were. Location was split three ways: the icon-only
rail held the section, the breadcrumb held the project, and a nine-tab strip plus a More menu held the
page. They compared four options in an interactive prototype
(https://claude.ai/artifact/T39pC8fR9KxwRJAJLCssWG) and chose A, the project tree.

**Decision.** One labelled sidebar. The open project nests under Projects with all its pages, so the
current row and the rows above it read as a path. The tab strip and the breadcrumb are removed.

**Consequences.**
- Project pages are links in `<nav aria-label="Main navigation">`, not tabs. Tests find them with
  `getByRole("link", { name: "Images 1" })`. The count is part of the name in both states.
- Full-bleed surfaces open with the sidebar collapsed. A per-visit override, not the stored
  preference, is what expanding them sets. Do not "fix" this by persisting it, or Maps would lose its
  width for every later visit.
- The overview read for counts moved from `ProjectTabs` to the sidebar. There must still be exactly
  one per project open (`foundation-journey` counts reads).
- Ctrl+B is ignored in text fields. Plain B stays the Box tool.
```

- [ ] **Step 4: Fix the spec's duration sentence.** In the spec's §4, replace "The width animates over `--dur-fast`. Under `prefers-reduced-motion` or the Reduced effects setting it is instant." with:
"The width animates over `--dur-base`, which is 0 under reduced motion, so it is instant there. (`--dur-fast` is not reduced, so it would keep animating.)"

- [ ] **Step 5: Commit.**
```bash
git add DESIGN.md vault/decisions/2026-10-03-sidebar-replaces-rail-and-tabs.md docs/superpowers/specs/2026-10-03-sidebar-project-tree-design.md
git commit -m "docs: the sidebar shell in DESIGN.md, its ADR, and the spec's duration"
```

---

### Finish: gate, merge, clean up

- [ ] **Step 1: Run the full gate** from the worktree. Every step must pass.

```
pnpm -C contract check
cd backend; .\.venv\Scripts\python.exe -m ruff check .; .\.venv\Scripts\python.exe -m ruff format --check .; .\.venv\Scripts\python.exe -m pytest; cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
```

Run `cargo test --manifest-path frontend/src-tauri/Cargo.toml` only if `frontend/src-tauri/binaries/kestrel-backend-*.exe` exists. Otherwise record it as skipped.

- [ ] **Step 2: Merge `task/sidebar` into `main` by hand.** `scripts\finish-task.ps1` fails on PowerShell 5.1.
  - Check the branch first with `git -C E:\Dev\Yolo\app branch --show-current`; other sessions share the checkout.
  - The main checkout has an unrelated uncommitted `AGENTS.md` change. Leave it alone.

- [ ] **Step 3: Remove the worktree** following the vault rule: delete junctions as links via .NET, never with `rm -rf`, then run `git worktree remove`. Then delete the `task/sidebar` branch.

- [ ] **Step 4: Give the operator the walkthrough** from spec §10, and run `/wrapup`.
