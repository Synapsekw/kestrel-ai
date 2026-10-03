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
- Canvas surfaces (full-bleed layouts, and the `workspace` layout: Images and the report builder) open with the sidebar collapsed, so the canvas keeps its width. Expanded, the sidebar left the Images canvas about 370px wide at 1280px and broke drawing. A per-visit override, not the stored preference, is what expanding them sets. Do not "fix" this by persisting it, or those screens would lose their width on every later visit.
- The overview read for counts moved from `ProjectTabs` to the sidebar. There must still be exactly
  one per project open (`foundation-journey` counts reads).
- Ctrl+B is ignored in text fields. Plain B stays the Box tool.
