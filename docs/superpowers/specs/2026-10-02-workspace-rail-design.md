---
type: spec
date: 2026-10-02
status: draft
tags: [spec, maps, point-clouds, workspace, layout, ui, rail]
related: ["[[2026-09-26-map-workspace-design]]", "[[2026-09-26-point-cloud-workspace-design]]", "[[2026-09-26-foundation-design]]"]
---

# Workspace rail: one tool layout for Maps and Point clouds

## 1. Goal

The operator finds the Maps workspace hard to use. Its tools are split across a tool palette, a
layers panel with an "Annotations" group and a per-kind inspector. The same concept (a finding, a
drawing) is created in one panel, filtered in another and edited in a third, and several actions
have two or three entry points. The Point clouds workspace has its own, different arrangement of
the same concepts.

This spec reorganises both workspaces around **one shared rail**: a slim icon column on the left,
one topic panel at a time next to it, and a selection-only inspector on the right. Every feature
stays; only where it lives changes. Each concept gets exactly one home, and the first three topics
are identical on both screens, so the habits from one carry over to the other.

Approved mockups: `.superpowers/brainstorm/1245-1790950714/content/layout-options-v3.html` (option A
chosen over task modes, a bottom dock and a single tree) and `unified-rail.html` (both workspaces).

Done means: on a real project with an ortho, a drawing and a point cloud, the operator can do
every task the two workspaces support today, reaching each tool and each list from the rail; no
action has more than one entry point, apart from its keyboard shortcut and the command palette;
and the two screens share the rail component and the topic order.

### Non-goals

- No new features, no API or contract change, no database change, no engine change.
- No change to tool shortcuts beyond adding `\` (toggle the panel).
- Not merging the map and cloud inspector bodies; only their shell and width are unified.
- Not changing the separate `/findings` screen.

## 2. Layout (both workspaces)

| Region | Map | Point cloud |
|---|---|---|
| Rail, top-left, vertical glass strip | Navigate: Select V, Pan H | Navigate: Orbit O, Pan H, Fly W |
| Rail, shared topics | Layers · Findings · Measure | Layers · Findings · Measure |
| Rail, workspace topics (after a separator) | AI · Drawings | Clip · Photos |
| Topic panel, next to the rail, full height above the bottom bar | one at a time | one at a time |
| Inspector, right | selection only | selection only (new) |
| Bottom bar | Timeline, one survey-scope switch, Compare | Top/Front/Side/Iso, coordinate readout |
| Corners, unchanged | Coordinates, zoom, minimap | View gizmo, site minimap |

Every topic panel has the same anatomy, top to bottom:

1. **Header**: topic name, a count, and one **eye** that shows or hides the whole topic on the
   stage.
2. **Tool row**: the creation and measuring tools that belong to the topic (omitted where a topic
   has none).
3. **Filters**: chips and fields that narrow what is listed *and* what is drawn.
4. **List**: the topic's items. Clicking a row selects the item and frames it on the stage. The
   list scrolls inside the panel and renders only visible rows.

The panel and the inspector both use the `InspectorPane` width from `DESIGN.md` (340px), which
removes today's 318 / 330 / 340 drift.

## 3. Where every control goes

### 3.1 Map

| Topic | Holds | Today |
|---|---|---|
| **Layers** | Base maps and elevation rows (eye, opacity, reorder, ⋯ menu: set survey date, set date and role, open in evaluation view, delete map, delete surface). One "+ Import" menu: orthomosaic, elevation, DSM from cloud. | LayersPanel Base maps + Elevation groups, the "+" menu |
| **Findings** | Tools: Finding point M, Finding polygon G, Zone Z. Filters: status, minimum severity, zone category. List: findings and zones. | Palette Annotate group, Findings + Zones row extras |
| **Measure** | Tools: Distance L, Area Q, Elevation profile E, Volume U. Filters: kind. List: measurements and volumes. | Palette Measure group, Measurement + Volume rows |
| **AI** | Tools: Detect region D, "Run on the whole map". Filters: Pending / Accepted objects / Accepted defects / Rejected, classes. List: the review queue. Badge: pending count. | Palette D, raster menu "Run AI", DetectionFilters |
| **Drawings** | One "Import drawing" action. Rows: eye, opacity, reorder; ⋯ menu: Properties, Re-import, Delete. Align (K) is an action on the selected drawing. | Palette K, Drawings group, the duplicate "+ Import" link |

- **Survey scope**: one "This survey / All surveys" switch on the timeline bar replaces the two
  separate "All surveys" switches in the findings and detection filters. It applies to findings,
  detections and measurements alike.
- **Drawing actions with one home**: Align, Knock out white and DXF layer toggles live only in the
  drawing inspector. They are removed from the row menu, the palette and the "Layers…" dialog.
  K still starts Align on the selected drawing.
- **Removed**: `ToolPalette`, the `LayersPanel` "Annotations" group, the "+ Import" link inside the
  Drawings group, the drawing row menu entries Align / Knock out white / Layers….
- Compare bar, timeline, ToolHint, coordinates, nav controls, minimap and the stage right-click
  menu keep their behaviour; the compare bar joins the bottom bar.

### 3.2 Point cloud

| Topic | Holds | Today |
|---|---|---|
| **Layers** | Cloud picker (Import point cloud…, Details…), Colour by (RGB / Elevation / Intensity / Class) with its legend, point size, point budget, EDL, Show camera positions. | CloudPanel, RenderControls, CamerasPanelRow |
| **Findings** | Tools: Pin a finding M. List: finding pins. Menu: Capture missing views. | Palette M, inspector Findings tab, reportViews menu |
| **Measure** | Tools: Point P, Distance L, Height Z, Verticality U, Area Q, Cross-section E. Filters: kind. List: measurements. CSV export. | Palette measuring group, inspector Measurements tab |
| **Clip** | Clipping box C; its hint stays as the on-stage `ClipHint`. Hidden when the engine cannot clip. | Palette C, ClipHint |
| **Photos** | Photo link I and the Likely views list. | Palette I, LikelyViews |

- The inspector loses its Findings / Measurements tabs and shows only the selected item, through
  the existing `FindingInspector` (with its `AnchorSlot` / `MeasureSlot`) and the measurement
  details.
- Alt+1–4 views and F stay on the bottom bar's view buttons.

## 4. Behaviour

- **Open and close**: clicking a topic opens its panel; clicking the open topic closes it. One
  panel at a time. `\` toggles the panel (reopening the last topic).
- **Remembered topic**: each workspace remembers the last open topic and whether the panel was
  open, in `localStorage` (per-viewer convenience; every read and write is wrapped in try/catch and
  the rail falls back to the default). The default is Findings, or Layers when the workspace has
  no base data.
- **Tool keys**: pressing a tool key starts the tool. If the panel is open, it switches to the
  tool's topic; if the panel is closed, it stays closed and ToolHint names the tool.
- **Selection**: selecting an item on the stage opens the inspector. If the item's topic panel is
  open, its row is highlighted and scrolled into view.
- **Eye**: the header eye hides the topic's overlay on the stage. Filters only narrow a visible
  topic. A hidden topic shows a dimmed eye on its rail icon.
- **Badges**: only actionable counts (AI pending review). No badge on every icon.
- **Narrow windows**: below 1200px wide, opening the inspector closes the topic panel; closing the
  inspector does not reopen it.
- **Reduced effects and motion**: inherited from `GlassPanel` and the motion tokens; the panel
  switch is instant under `?motion=reduced`.
- **Disabled tools**: as today, a disabled tool shows its reason in the tooltip (for example Align
  without a selected drawing, Clip without engine support).
- **Accessibility**: the rail is a `toolbar` of toggle buttons with `aria-pressed` and
  `aria-controls` pointing at the panel; the panel is a labelled `region`. Focus moves into the
  panel on open from the keyboard and back to the rail icon on close.

## 5. Components

### 5.1 `frontend/src/ui/WorkspaceRail.tsx` (new, shared)

```ts
type RailTopic = {
  id: string;                 // 'layers' | 'findings' | ...
  label: string;
  icon: IconName;
  group: 'shared' | 'workspace';
  badge?: number;             // shown only when > 0
  visible?: { value: boolean; toggle(): void }; // header eye
  count?: number;
  Body: React.ComponentType;  // tool row + filters + list
};

type WorkspaceRailProps = {
  workspace: 'maps' | 'clouds';      // storage key
  navTools: React.ReactNode;         // select/pan or orbit/pan/fly
  topics: RailTopic[];
  defaultTopic: string;
};
```

A small `useRailStore(workspace)` holds `{ open: boolean, topic: string }` and exposes
`openTopic(id)`, `toggle()` and `revealTopicFor(id)`, which the tool keys call. The panel shell
reuses `GlassPanel` and the existing `FloatingToolbar` / `ToolButton`. A `TopicPanel` helper
renders the header (name, count, eye) and the tool row from `ToolButton`s, so every topic has the
same anatomy. Both are added to `/gallery.html`.

### 5.2 Map (`frontend/src/mapws/`)

- New `topics/` folder: `layers.topic.tsx`, `findings.topic.tsx`, `measure.topic.tsx`,
  `ai.topic.tsx`, `drawings.topic.tsx`, each composing existing parts (layer rows,
  `FindingsRowExtra`, `ZonesRowExtra`, `MeasurementRowExtra`, `DetectionFilters`, the tool
  definitions in `tools/*.tool.ts`).
- Each `*.tool.ts` gains a `topic` field; `useWorkspaceKeys` calls `revealTopicFor` on activation.
- `MapWorkspace.tsx` renders `WorkspaceRail` in place of `ToolPalette` + `LayersPanel`;
  `InspectorHost` moves to the shared width.
- Survey scope moves to a single store value read by the findings, detection and measurement
  layers; the timeline bar renders its switch.

### 5.3 Point cloud (`frontend/src/clouds/workspace/`)

- The `WorkspaceFeature` composition in `compose.ts` gains a `topics` slot next to `tools`, so
  `features/measure.tsx`, `pins.tsx`, `cameras.tsx` and `reportViews.tsx` each contribute their
  topic body instead of an inspector tab.
- `CloudWorkspace.tsx` renders `WorkspaceRail` in place of `Palette` + `CloudPanel`; `Inspector.tsx`
  becomes selection-only.

## 6. Budget

- **Background jobs**: none added. Import, AI detection, DSM build and profile jobs keep their
  existing job paths.
- **Bounded reads**: no new reads. Topic lists read the stores that already hold this data, and
  render only the rows in view. No image set is loaded.
- **Startup**: a failed `localStorage` read falls back to the default topic; the workspace always
  opens.

## 7. Execution DAG

| Unit | Depends on | Content |
|---|---|---|
| U1 Rail primitive | — | `WorkspaceRail`, `TopicPanel`, `useRailStore`, gallery entry, unit tests |
| U2 Map topics | U1 | five topics, tool → topic mapping, survey-scope switch, removals in §3.1 |
| U3 Cloud topics | U1 | five topics, `topics` feature slot, selection-only inspector |
| U4 E2E + docs | U2, U3 | Playwright flows through the rail, `DESIGN.md` workspace section, map and cloud spec cross-references |

Parallel batches: {U1} → {U2, U3} → {U4}. Critical path: U1 → U2 → U4 (the map has more to
move).

## 8. Testing

- **U1 unit**: click opens, click again closes, one panel at a time, `\` toggles,
  remembered topic restored, storage that throws falls back to the default, `revealTopicFor` only
  switches when open, narrow-window rule, eye calls `toggle`, badge hidden at 0, ARIA attributes.
- **U2 / U3 unit**: every tool id appears in exactly one topic (a registry test that fails on a
  duplicate or orphan tool); each topic renders its filters and list; the map drawing row menu no
  longer lists Align / Knock out white / Layers…; the cloud inspector renders no tabs.
- **E2E**: map: create a finding from the Findings topic, filter it, select it from the list,
  open the inspector; Align a drawing from its inspector; review an AI detection from the AI
  topic. Cloud: change colour mode from Layers, take a distance from Measure, pin a finding.
  Existing workspace E2E specs are updated to reach tools through the rail.
- The full gate in `AGENTS.md`.
