# Workspace rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the map's tool palette + layers panel and the point cloud's palette + cloud panel +
tabbed inspector with one shared left rail (navigation tools, then topics), one topic panel at a
time, and a selection-only inspector, without removing any feature.

**Architecture:** A new `ui/WorkspaceRail` primitive (rail + one panel shell + a persisted
per-workspace store) is plugged by each workspace with its own topics. Map topics are assembled
from the existing layer rows, row filters (`RowExtra`) and tool plugins; map tools gain a `topic`
field. Cloud features gain a `topics` slot in `compose.ts`, and their list tabs are split into a
list part (rail) and a detail part (inspector).

**Tech Stack:** React 18 + TS, zustand, Tailwind tokens and `frontend/src/ui` primitives, Vitest +
Testing Library, Playwright e2e. OpenLayers (map) and three.js/potree-core (clouds) are untouched.

**Spec:** `docs/superpowers/specs/2026-10-02-workspace-rail-design.md`

## Global Constraints

- No API, contract, database or engine change. `contract/` is not touched.
- Only one new key: `\` (global action `toggle-panel`). Every other shortcut keeps its key.
- Every colour, radius, blur and duration comes from the tokens/primitives; `pnpm -C frontend lint`
  (`scripts/check-tokens.mjs`) must pass.
- Topic panel and inspector width: 340px on both workspaces (`DESIGN.md` `InspectorPane`).
- Rail at `left 14, top 14`; topic panel at `left 72, top 14` on both workspaces.
- Rail topic order: Map `layers, findings, measure | ai, drawings`; Clouds
  `layers, findings, measure | clip, photos`.
- `localStorage` is a per-viewer convenience: every read and write is wrapped in try/catch; a
  failure falls back to the default topic and never blocks the workspace.
- Narrow window threshold: 1200px.
- Lists render only the rows in view (`ui/useVirtualRows`); no new reads.
- Sentence case everywhere; no all-caps labels.
- Work in a task worktree (`.claude/worktrees/workspace-rail` on `task/workspace-rail`); stage by
  path, never `git add -A`.

## Review Focus

1. **A tool whose topic panel is closed** — pressing its key must start the tool without opening the
   panel, and the hint pill must still name it (Task 2 `revealTopicFor` test, Task 6 map test).
2. **Corrupt or blocked `localStorage`** (`"{"`, an unknown topic id, a throwing `getItem`) — the
   rail must open on the default topic, never crash (Task 1 tests).
3. **Topic switch while drawing** — opening another topic must not cancel a draft in progress; only
   Esc or another tool does (Task 6 test: draft survives `openTopic`).
4. **Selecting an item whose topic panel is closed** — the inspector opens, the panel stays closed;
   with it open, the row is highlighted and scrolled into view (Task 3 `TopicList` test, Task 6).
5. **Hiding a topic, then using its tool** — the eye is off and the operator draws a finding: the
   new item must not vanish silently; activating a topic's creation tool turns its eye back on
   (Task 5 test).

## Execution DAG

| Unit | Tasks | Depends on |
|---|---|---|
| U1 Rail primitive | 1, 2, 3 | — |
| U2 Map | 4, 5, 6 | U1 |
| U3 Clouds | 7, 8 | U1 |
| U4 E2E + docs | 9 | U2, U3 |

Parallel batches: {1 → 2 → 3} → {4 → 5 → 6 ‖ 7 → 8} → {9}. Critical path: 1 → 2 → 3 → 4 → 5 → 6 → 9.

## File structure

| File | Responsibility |
|---|---|
| `frontend/src/ui/railStore.ts` (new) | Per-workspace `{ open, topic }` store with safe persistence |
| `frontend/src/ui/WorkspaceRail.tsx` (new) | Rail toolbar + one panel shell, narrow-window rule, `\` key |
| `frontend/src/ui/TopicPanel.tsx` (new) | Topic anatomy: header (name, count, eye), tool row, filters, `TopicList` |
| `frontend/src/ui/gallery/sections/Rail.tsx` (new) | Gallery entry |
| `frontend/src/ui/keymap.ts` | `\` → `toggle-panel` global entry |
| `frontend/src/mapws/topics/*.tsx` (new) | The five map topic bodies and list adapters |
| `frontend/src/mapws/topics/useMapRail.tsx` (new) | Builds the map's `RailTopic[]` |
| `frontend/src/mapws/tools/*.tool.ts`, `toolStore.ts` | `topic` field on every tool |
| `frontend/src/mapws/tools/useMapToolKeys.ts` (new) | Tool shortcuts (were bound by `ToolPalette`) |
| `frontend/src/mapws/chrome/LayerGroups.tsx` (new, from `LayersPanel.tsx`) | Layer rows for chosen groups, no shell |
| `frontend/src/mapws/timeline/SurveyScope.tsx` (new) | The one "This survey / All surveys" switch |
| `frontend/src/clouds/workspace/topics.ts` (new) | Cloud tool → topic map |
| `frontend/src/clouds/workspace/compose.ts`, `types.ts` | `topics` feature slot, `showTopic` |
| `frontend/src/clouds/pins/FindingsTab.tsx`, `clouds/measuring/MeasurementsTab.tsx` | Split list / detail |

---

### Task 1: Rail store

**Files:**
- Create: `frontend/src/ui/railStore.ts`
- Test: `frontend/src/ui/railStore.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type RailWorkspace = "maps" | "clouds";
  export interface RailState { open: boolean; topic: string;
    openTopic(id: string): void; close(): void; toggle(): void;
    /** Switches to `id` only when the panel is open. */ revealTopicFor(id: string | null): void; }
  export function createRailStore(workspace: RailWorkspace, topics: readonly string[], defaultTopic: string): StoreApi<RailState>;
  export const RAIL_STORAGE_PREFIX = "kestrel.rail.";
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRailStore, RAIL_STORAGE_PREFIX } from "./railStore";

const TOPICS = ["layers", "findings", "measure"];
const KEY = `${RAIL_STORAGE_PREFIX}maps`;

describe("railStore", () => {
  beforeEach(() => localStorage.clear());

  it("starts open on the default topic", () => {
    const s = createRailStore("maps", TOPICS, "findings").getState();
    expect(s.open).toBe(true);
    expect(s.topic).toBe("findings");
  });

  it("clicking the open topic closes, another topic switches", () => {
    const store = createRailStore("maps", TOPICS, "findings");
    store.getState().openTopic("findings");
    expect(store.getState().open).toBe(false);
    store.getState().openTopic("measure");
    expect(store.getState()).toMatchObject({ open: true, topic: "measure" });
  });

  it("toggle reopens the last topic", () => {
    const store = createRailStore("maps", TOPICS, "findings");
    store.getState().openTopic("measure");
    store.getState().toggle();
    expect(store.getState().open).toBe(false);
    store.getState().toggle();
    expect(store.getState()).toMatchObject({ open: true, topic: "measure" });
  });

  it("revealTopicFor switches only while open, and ignores null", () => {
    const store = createRailStore("maps", TOPICS, "findings");
    store.getState().revealTopicFor("measure");
    expect(store.getState().topic).toBe("measure");
    store.getState().close();
    store.getState().revealTopicFor("layers");
    expect(store.getState()).toMatchObject({ open: false, topic: "measure" });
    store.getState().revealTopicFor(null);
    expect(store.getState().topic).toBe("measure");
  });

  it("persists and restores per workspace", () => {
    createRailStore("maps", TOPICS, "findings").getState().openTopic("layers");
    expect(createRailStore("maps", TOPICS, "findings").getState().topic).toBe("layers");
    expect(createRailStore("clouds", TOPICS, "findings").getState().topic).toBe("findings");
  });

  it.each([["{"], [JSON.stringify({ open: true, topic: "gone" })], [JSON.stringify(42)]])(
    "falls back to the default on stored %s",
    (raw) => {
      localStorage.setItem(KEY, raw);
      expect(createRailStore("maps", TOPICS, "findings").getState()).toMatchObject({
        open: true,
        topic: "findings",
      });
    },
  );

  it("survives a storage that throws", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const store = createRailStore("maps", TOPICS, "findings");
    expect(() => store.getState().openTopic("measure")).not.toThrow();
    expect(store.getState().topic).toBe("measure");
    get.mockRestore();
    set.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/ui/railStore.test.ts`
Expected: FAIL — `Cannot find module './railStore'`.

- [ ] **Step 3: Write the implementation**

```ts
import { createStore, type StoreApi } from "zustand/vanilla";

export type RailWorkspace = "maps" | "clouds";
export const RAIL_STORAGE_PREFIX = "kestrel.rail.";

export interface RailState {
  open: boolean;
  topic: string;
  /** Opens `id`; on the topic already open, closes the panel. */
  openTopic(id: string): void;
  close(): void;
  /** `\`: closes, or reopens the last topic. */
  toggle(): void;
  /** A tool of topic `id` was armed: follow it only while the panel is open. */
  revealTopicFor(id: string | null): void;
}

function read(key: string, topics: readonly string[]): { open: boolean; topic: string } | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const { open, topic } = v as Record<string, unknown>;
    if (typeof open !== "boolean" || typeof topic !== "string" || !topics.includes(topic)) return null;
    return { open, topic };
  } catch {
    return null;
  }
}

function write(key: string, v: { open: boolean; topic: string }): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // a blocked storage only loses the remembered topic
  }
}

/** One rail's state (spec §4 "Remembered topic"); the panel starts open on the default topic. */
export function createRailStore(
  workspace: RailWorkspace,
  topics: readonly string[],
  defaultTopic: string,
): StoreApi<RailState> {
  const key = `${RAIL_STORAGE_PREFIX}${workspace}`;
  const initial = read(key, topics) ?? { open: true, topic: defaultTopic };
  return createStore<RailState>((set, get) => {
    const put = (next: { open: boolean; topic: string }) => {
      set(next);
      write(key, next);
    };
    return {
      ...initial,
      openTopic: (id) => {
        const s = get();
        put(s.open && s.topic === id ? { open: false, topic: id } : { open: true, topic: id });
      },
      close: () => put({ open: false, topic: get().topic }),
      toggle: () => put({ open: !get().open, topic: get().topic }),
      revealTopicFor: (id) => {
        const s = get();
        if (id === null || !s.open || s.topic === id) return;
        put({ open: true, topic: id });
      },
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/ui/railStore.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ui/railStore.ts frontend/src/ui/railStore.test.ts
git commit -m "feat(ui): rail store with safe per-workspace persistence"
```

---

### Task 2: `WorkspaceRail` and the `\` key

**Files:**
- Create: `frontend/src/ui/WorkspaceRail.tsx`
- Modify: `frontend/src/ui/keymap.ts` (`GLOBAL_KEYS`), `frontend/src/ui/index.ts`
- Test: `frontend/src/ui/WorkspaceRail.test.tsx`

**Interfaces:**
- Consumes: `createRailStore`, `RailState` (Task 1); `GlassPanel`, `ToolButton`, `ToolSeparator`,
  `useToolShortcuts`, `IconName`.
- Produces:
  ```ts
  export interface RailTopic {
    id: string; label: string; icon: IconName; group: "shared" | "workspace";
    badge?: number; hidden?: boolean;   // hidden → dimmed eye mark on the rail icon
    body: ReactNode;                    // a <TopicPanel> (Task 3)
  }
  export interface WorkspaceRailProps {
    label: string;                      // "Map" | "Point cloud"
    store: StoreApi<RailState>;
    nav: ReactNode;                     // <ToolButton>s for select/pan or orbit/pan/fly
    topics: readonly RailTopic[];
    inspectorOpen: boolean;
    /** px kept free under the panel for the bottom-left chrome. */
    bottomInset: number;
  }
  export function WorkspaceRail(p: WorkspaceRailProps): JSX.Element;
  export const NARROW_WIDTH = 1200;
  ```
  `index.ts` also exports `createRailStore`, `RailState`, `RailWorkspace`.

- [ ] **Step 1: Add the key and run the keymap collision test**

In `ui/keymap.ts`, add to `GLOBAL_KEYS` after the `fit` entry:

```ts
  g("\\", "toggle-panel", "Show or hide the side panel"),
```

Run: `pnpm -C frontend exec vitest run src/ui/keymap.test.tsx`
Expected: PASS (no collision: `\` is used nowhere else).

- [ ] **Step 2: Write the failing component test**

```tsx
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { createRailStore } from "./railStore";
import { WorkspaceRail, type RailTopic } from "./WorkspaceRail";

const topics: RailTopic[] = [
  { id: "layers", label: "Layers", icon: "layers", group: "shared", body: <p>layers body</p> },
  { id: "findings", label: "Findings", icon: "findings", group: "shared", body: <p>findings body</p> },
  { id: "ai", label: "AI", icon: "detect", group: "workspace", badge: 3, body: <p>ai body</p> },
];

function setup(inspectorOpen = false) {
  const store = createRailStore("maps", topics.map((t) => t.id), "findings");
  const utils = render(
    <WorkspaceRail label="Map" store={store} nav={null} topics={topics} inspectorOpen={inspectorOpen} bottomInset={140} />,
  );
  return { store, ...utils };
}

describe("WorkspaceRail", () => {
  beforeEach(() => localStorage.clear());

  it("shows the default topic's panel as a labelled region", () => {
    setup();
    expect(screen.getByRole("region", { name: "Findings" })).toHaveTextContent("findings body");
    expect(screen.getByRole("button", { name: "Findings" })).toHaveAttribute("aria-pressed", "true");
  });

  it("one panel at a time; clicking the open topic closes it", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.getByRole("region", { name: "Layers" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Findings" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("\\ toggles the panel", () => {
    setup();
    fireEvent.keyDown(window, { key: "\\" });
    expect(screen.queryByRole("region")).toBeNull();
    fireEvent.keyDown(window, { key: "\\" });
    expect(screen.getByRole("region", { name: "Findings" })).toBeInTheDocument();
  });

  it("shows a badge only when > 0", () => {
    setup();
    expect(screen.getByRole("button", { name: "AI, 3 waiting" })).toBeInTheDocument();
  });

  it("separates shared and workspace topics", () => {
    setup();
    const bar = screen.getByRole("toolbar", { name: "Map" });
    expect(bar.querySelectorAll('[role="separator"]').length).toBe(1);
  });

  it("closes the panel when the inspector opens on a narrow window", () => {
    window.innerWidth = 1100;
    const { store, rerender } = setup(false);
    rerender(
      <WorkspaceRail label="Map" store={store} nav={null} topics={topics} inspectorOpen bottomInset={140} />,
    );
    expect(store.getState().open).toBe(false);
    window.innerWidth = 1600;
  });

  it("keeps the panel on a wide window", () => {
    window.innerWidth = 1600;
    const { store, rerender } = setup(false);
    rerender(
      <WorkspaceRail label="Map" store={store} nav={null} topics={topics} inspectorOpen bottomInset={140} />,
    );
    expect(store.getState().open).toBe(true);
  });

  it("re-renders on store changes from outside", () => {
    const { store } = setup();
    act(() => store.getState().openTopic("ai"));
    expect(screen.getByRole("region", { name: "AI" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/ui/WorkspaceRail.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

```tsx
import { useEffect, useId, useRef, type ReactNode } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { GlassPanel } from "./GlassPanel";
import { ToolButton, ToolSeparator } from "./FloatingToolbar";
import type { IconName } from "./Icon";
import { useToolShortcuts } from "./keymap";
import type { RailState } from "./railStore";
import { cx } from "./tokens";

export const NARROW_WIDTH = 1200;

export interface RailTopic {
  id: string;
  label: string;
  icon: IconName;
  group: "shared" | "workspace";
  /** An actionable count (AI waiting for review); shown only when > 0. */
  badge?: number;
  /** The topic is hidden on the stage (its header eye is off). */
  hidden?: boolean;
  body: ReactNode;
}

export interface WorkspaceRailProps {
  label: string;
  store: StoreApi<RailState>;
  nav: ReactNode;
  topics: readonly RailTopic[];
  inspectorOpen: boolean;
  bottomInset: number;
}

/** Spec §2/§4: navigation tools, then topics; one topic panel at a time next to the rail. */
export function WorkspaceRail({ label, store, nav, topics, inspectorOpen, bottomInset }: WorkspaceRailProps) {
  const open = useStore(store, (s) => s.open);
  const topic = useStore(store, (s) => s.topic);
  const panelId = useId();
  const current = open ? topics.find((t) => t.id === topic) : undefined;

  useToolShortcuts([{ shortcut: "\\", action: "toggle-panel", onTrigger: () => store.getState().toggle() }]);

  // Narrow windows: the inspector takes the room; closing it does not reopen the panel.
  const wasOpen = useRef(inspectorOpen);
  useEffect(() => {
    if (inspectorOpen && !wasOpen.current && window.innerWidth < NARROW_WIDTH) store.getState().close();
    wasOpen.current = inspectorOpen;
  }, [inspectorOpen, store]);

  const shared = topics.filter((t) => t.group === "shared");
  const extra = topics.filter((t) => t.group === "workspace");
  const button = (t: RailTopic) => {
    const name = t.badge ? `${t.label}, ${t.badge} waiting` : t.label;
    return (
      <span key={t.id} className="relative">
        <ToolButton
          icon={t.icon}
          label={name}
          active={open && topic === t.id}
          onClick={() => store.getState().openTopic(t.id)}
        />
        {t.badge ? (
          <span
            aria-hidden
            className="pointer-events-none absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-accent px-1 text-center font-mono text-2xs tabular-nums text-accent-fg"
          >
            {t.badge}
          </span>
        ) : null}
        {t.hidden && (
          <span aria-hidden className="pointer-events-none absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-dim" />
        )}
      </span>
    );
  };

  return (
    <>
      <GlassPanel
        variant="float"
        role="toolbar"
        aria-label={label}
        aria-orientation="vertical"
        aria-controls={current ? panelId : undefined}
        className="absolute left-3.5 top-3.5 z-10 inline-flex flex-col gap-0.5 p-[5px] animate-reveal reduce-motion:animate-none"
      >
        {nav}
        {nav ? <ToolSeparator /> : null}
        {shared.map(button)}
        {extra.length > 0 && <ToolSeparator />}
        {extra.map(button)}
      </GlassPanel>
      {current && (
        <GlassPanel
          id={panelId}
          as="section"
          variant="float"
          radius="panel"
          role="region"
          aria-label={current.label}
          data-testid="rail-panel"
          data-topic={current.id}
          style={{ bottom: bottomInset }}
          className={cx(
            "absolute left-[72px] top-3.5 z-10 flex w-[340px] flex-col overflow-hidden",
            "animate-rise reduce-motion:animate-none",
          )}
        >
          {current.body}
        </GlassPanel>
      )}
    </>
  );
}
```

Add to `ui/index.ts`:

```ts
export { createRailStore, RAIL_STORAGE_PREFIX, type RailState, type RailWorkspace } from "./railStore";
export { NARROW_WIDTH, WorkspaceRail, type RailTopic, type WorkspaceRailProps } from "./WorkspaceRail";
```

`style={{ bottom }}` is a layout number, not a colour: `check-tokens.mjs` allows it (the cloud
inspector already uses px geometry from `layout.ts`). If the arbitrary `min-w-4` is rejected, use
`min-w-[16px]` the way `ToolButton` uses `w-[38px]`.

- [ ] **Step 5: Run tests and lint**

Run: `pnpm -C frontend exec vitest run src/ui/WorkspaceRail.test.tsx src/ui/keymap.test.tsx` then `pnpm -C frontend lint`
Expected: PASS; lint clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/ui/WorkspaceRail.tsx frontend/src/ui/WorkspaceRail.test.tsx frontend/src/ui/keymap.ts frontend/src/ui/index.ts
git commit -m "feat(ui): WorkspaceRail with one topic panel and the \\ toggle"
```

---

### Task 3: `TopicPanel`, `TopicList` and the gallery entry

**Files:**
- Create: `frontend/src/ui/TopicPanel.tsx`, `frontend/src/ui/gallery/sections/Rail.tsx`
- Modify: `frontend/src/ui/index.ts`
- Test: `frontend/src/ui/TopicPanel.test.tsx`

**Interfaces:**
- Consumes: `ToolButton`, `IconButton`, `useVirtualRows`, `computeWindow`, `cx`, `focusRing`.
- Produces:
  ```ts
  export interface TopicTool { id: string; icon: IconName; label: string; shortcut?: string;
    active?: boolean; disabledReason?: string | null; onClick(): void; }
  export interface TopicPanelProps {
    title: string; count?: number | string | null;
    visible?: { value: boolean; toggle(): void };
    menu?: ReactNode;                 // e.g. a MenuButton ("+ Import", "Capture missing views")
    tools?: readonly TopicTool[];
    filters?: ReactNode;
    children: ReactNode;              // the list (usually <TopicList>) or empty state
  }
  export function TopicPanel(p: TopicPanelProps): JSX.Element;

  export interface TopicItem { id: string; label: string; meta?: string; swatch?: string; }
  export interface TopicListProps { label: string; items: readonly TopicItem[];
    selectedId: string | null; onSelect(id: string): void; empty?: ReactNode; }
  export const TOPIC_ROW_HEIGHT = 40;
  export function TopicList(p: TopicListProps): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TOPIC_ROW_HEIGHT, TopicList, TopicPanel } from "./TopicPanel";

describe("TopicPanel", () => {
  it("renders header, eye, tools, filters, then the list", () => {
    const toggle = vi.fn();
    const draw = vi.fn();
    render(
      <TopicPanel
        title="Findings"
        count={14}
        visible={{ value: true, toggle }}
        tools={[{ id: "pt", icon: "pin", label: "Finding point", shortcut: "M", onClick: draw }]}
        filters={<p>filters</p>}
      >
        <p>list</p>
      </TopicPanel>,
    );
    expect(screen.getByRole("heading", { name: "Findings" })).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide findings" }));
    expect(toggle).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Finding point" }));
    expect(draw).toHaveBeenCalled();
    const text = document.body.textContent ?? "";
    expect(text.indexOf("filters")).toBeLessThan(text.indexOf("list"));
  });

  it("a disabled tool names its reason", () => {
    render(
      <TopicPanel title="Drawings" tools={[{ id: "k", icon: "align", label: "Align drawing", disabledReason: "Choose a drawing first", onClick: () => {} }]}>
        <p />
      </TopicPanel>,
    );
    expect(screen.getByRole("button", { name: "Align drawing — Choose a drawing first" })).toBeDisabled();
  });

  it("eye reads Show when hidden", () => {
    render(<TopicPanel title="AI" visible={{ value: false, toggle: () => {} }}><p /></TopicPanel>);
    expect(screen.getByRole("button", { name: "Show AI" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("TopicList", () => {
  const items = Array.from({ length: 500 }, (_, i) => ({ id: `f${i}`, label: `Finding ${i}` }));

  it("renders only a window of a long list", () => {
    render(<TopicList label="Findings" items={items} selectedId={null} onSelect={() => {}} />);
    expect(screen.getAllByRole("option").length).toBeLessThan(60);
  });

  it("marks the selected row and scrolls it into view", () => {
    const { container } = render(<TopicList label="Findings" items={items} selectedId="f300" onSelect={() => {}} />);
    const scroller = container.querySelector('[role="listbox"]') as HTMLElement;
    expect(scroller.scrollTop).toBe(300 * TOPIC_ROW_HEIGHT);
    expect(screen.getByRole("option", { name: /Finding 300/ })).toHaveAttribute("aria-selected", "true");
  });

  it("selects on click", () => {
    const onSelect = vi.fn();
    render(<TopicList label="Findings" items={items.slice(0, 3)} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("option", { name: /Finding 1/ }));
    expect(onSelect).toHaveBeenCalledWith("f1");
  });

  it("shows the empty state", () => {
    render(<TopicList label="Findings" items={[]} selectedId={null} onSelect={() => {}} empty={<p>none yet</p>} />);
    expect(screen.getByText("none yet")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/ui/TopicPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Read `ui/useVirtualRows.ts` fully first: it returns `{ containerRef, height, scrollTop, onScroll,
scrollToIndex }` and in jsdom falls back to a fixed height, which the window test relies on.

```tsx
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { ToolButton } from "./FloatingToolbar";
import { IconButton } from "./Button";
import type { IconName } from "./Icon";
import { cx, focusRing } from "./tokens";
import { computeWindow, useVirtualRows } from "./useVirtualRows";

export interface TopicTool {
  id: string;
  icon: IconName;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabledReason?: string | null;
  onClick(): void;
}

export interface TopicPanelProps {
  title: string;
  count?: number | string | null;
  visible?: { value: boolean; toggle(): void };
  menu?: ReactNode;
  tools?: readonly TopicTool[];
  filters?: ReactNode;
  children: ReactNode;
}

/** Spec §2: every topic reads header → tool row → filters → list. */
export function TopicPanel({ title, count, visible, menu, tools = [], filters, children }: TopicPanelProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 px-3 py-2.5">
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        {count !== undefined && count !== null && (
          <span className="font-mono text-2xs tabular-nums text-muted">{count}</span>
        )}
        <span className="flex-1" />
        {menu}
        {visible && (
          <IconButton
            size="sm"
            icon={visible.value ? "eye" : "eye-off"}
            label={`${visible.value ? "Hide" : "Show"} ${title.toLowerCase()}`}
            aria-pressed={visible.value}
            onClick={visible.toggle}
          />
        )}
      </header>
      {tools.length > 0 && (
        <div role="group" aria-label={`${title} tools`} className="flex flex-wrap gap-0.5 border-b border-line px-2 pb-2">
          {tools.map((t) => (
            <ToolButton
              key={t.id}
              icon={t.icon}
              label={t.disabledReason ? `${t.label} — ${t.disabledReason}` : t.label}
              shortcut={t.shortcut}
              active={t.active}
              disabled={!!t.disabledReason}
              onClick={t.onClick}
              tooltipSide="bottom"
            />
          ))}
        </div>
      )}
      {filters && <div className="border-b border-line px-3 py-2">{filters}</div>}
      <div className="flex min-h-0 flex-1 flex-col px-2 py-2">{children}</div>
    </div>
  );
}

export interface TopicItem {
  id: string;
  label: string;
  meta?: string;
  /** A data colour (severity, class), passed as `--c`. */
  swatch?: string;
}

export interface TopicListProps {
  label: string;
  items: readonly TopicItem[];
  selectedId: string | null;
  onSelect(id: string): void;
  empty?: ReactNode;
}

export const TOPIC_ROW_HEIGHT = 40;

/** A virtualised single-select list; the selected row is scrolled into view (spec §4 "Selection"). */
export function TopicList({ label, items, selectedId, onSelect, empty }: TopicListProps) {
  const vp = useVirtualRows({ rowHeight: TOPIC_ROW_HEIGHT });
  const win = computeWindow(vp.scrollTop, vp.height, TOPIC_ROW_HEIGHT, items.length);
  const selectedIndex = selectedId === null ? -1 : items.findIndex((i) => i.id === selectedId);
  useEffect(() => {
    if (selectedIndex >= 0) vp.scrollToIndex(selectedIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scroll only when the selection moves
  }, [selectedIndex]);
  if (items.length === 0) return <>{empty}</>;
  return (
    <div
      ref={vp.containerRef}
      role="listbox"
      aria-label={label}
      onScroll={vp.onScroll}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div style={{ height: win.totalHeight, position: "relative" }}>
        <div style={{ transform: `translateY(${win.offsetTop}px)` }}>
          {items.slice(win.start, win.end).map((item) => {
            const on = item.id === selectedId;
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => onSelect(item.id)}
                style={{ height: TOPIC_ROW_HEIGHT, "--c": item.swatch ?? "var(--surface-2)" } as CSSProperties}
                className={cx(
                  "flex w-full items-center gap-2 rounded-control px-2 text-left hover:bg-hover",
                  on && "bg-accent-soft",
                  focusRing,
                )}
              >
                {item.swatch && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[var(--c)]" />}
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{item.label}</span>
                {item.meta && <span className="shrink-0 font-mono text-2xs tabular-nums text-muted">{item.meta}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

`useVirtualRows({ rowHeight })` owns the row height, so `scrollToIndex(index)` needs only the index
(`DataTable.tsx` is the existing caller). Export from `ui/index.ts`:

```ts
export { TOPIC_ROW_HEIGHT, TopicList, TopicPanel, type TopicItem, type TopicListProps, type TopicPanelProps, type TopicTool } from "./TopicPanel";
```

- [ ] **Step 4: Add the gallery section**

`ui/gallery/sections/Rail.tsx`, discovered like `Toolbar.tsx` (same `title`, `order`, default
export):

```tsx
import { useMemo } from "react";
import { createRailStore, TopicList, TopicPanel, ToolButton, WorkspaceRail } from "@/ui";

export const title = "Workspace rail";
export const order = 51;

const FINDINGS = [
  { id: "1", label: "Crack, retaining wall", meta: "F-0031", swatch: "#ff5a4f" },
  { id: "2", label: "Pooling water", meta: "F-0032", swatch: "#ff9c3a" },
  { id: "3", label: "Rebar exposed", meta: "F-0033", swatch: "#e2bf2e" },
];

export default function RailSection() {
  const store = useMemo(() => createRailStore("maps", ["layers", "findings", "measure", "ai", "drawings"], "findings"), []);
  return (
    <div className="relative h-[460px] overflow-hidden rounded-panel bg-bg">
      <WorkspaceRail
        label="Gallery rail"
        store={store}
        inspectorOpen={false}
        bottomInset={14}
        nav={<ToolButton icon="fit" label="Select" active onClick={() => {}} />}
        topics={[
          { id: "layers", label: "Layers", icon: "layers", group: "shared", body: <TopicPanel title="Layers"><p className="text-sm text-muted">Base maps</p></TopicPanel> },
          {
            id: "findings", label: "Findings", icon: "findings", group: "shared",
            body: (
              <TopicPanel title="Findings" count={3} visible={{ value: true, toggle: () => {} }}
                tools={[{ id: "pt", icon: "pin", label: "Finding point", shortcut: "M", onClick: () => {} }]}>
                <TopicList label="Findings" items={FINDINGS} selectedId="1" onSelect={() => {}} />
              </TopicPanel>
            ),
          },
          { id: "measure", label: "Measure", icon: "measure", group: "shared", body: <TopicPanel title="Measure"><p /></TopicPanel> },
          { id: "ai", label: "AI", icon: "detect", group: "workspace", badge: 6, body: <TopicPanel title="AI"><p /></TopicPanel> },
          { id: "drawings", label: "Drawings", icon: "drawing", group: "workspace", body: <TopicPanel title="Drawings"><p /></TopicPanel> },
        ]}
      />
    </div>
  );
}
```

The gallery uses `#…` swatches as data colours through `--c`, as the severity scale does; if
`check-tokens.mjs` rejects them in this file, import the scale from `ui/severityScale.ts` instead.

- [ ] **Step 5: Run tests, lint and the gallery test**

Run: `pnpm -C frontend exec vitest run src/ui/TopicPanel.test.tsx src/ui/gallery/Gallery.test.tsx` then `pnpm -C frontend lint`
Expected: PASS; lint clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/ui/TopicPanel.tsx frontend/src/ui/TopicPanel.test.tsx frontend/src/ui/gallery/sections/Rail.tsx frontend/src/ui/index.ts
git commit -m "feat(ui): TopicPanel anatomy, virtualised TopicList, gallery entry"
```

---

### Task 4: Map tools belong to topics; tool keys move off the palette

**Files:**
- Modify: `frontend/src/mapws/tools/toolStore.ts`, all 11 `frontend/src/mapws/tools/*.tool.ts`
- Create: `frontend/src/mapws/tools/useMapToolKeys.ts`, `frontend/src/mapws/topics/topicIds.ts`
- Test: `frontend/src/mapws/tools/topics.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // topics/topicIds.ts
  export const MAP_TOPICS = ["layers", "findings", "measure", "ai", "drawings"] as const;
  export type MapTopicId = (typeof MAP_TOPICS)[number];
  // toolStore.ts — MapTool gains:
  topic: MapTopicId | "nav";
  export function toolsOfTopic(tools: readonly MapTool[], topic: MapTopicId | "nav"): MapTool[]; // sorted by order, id
  // useMapToolKeys.ts
  export function useMapToolKeys(context: ToolContext): void;
  ```

| Tool file | `topic` |
|---|---|
| `select.tool.ts`, `pan.tool.ts` | `"nav"` |
| `distance`, `area`, `profile`, `volume` | `"measure"` |
| `findingPoint`, `findingPolygon`, `zone` | `"findings"` |
| `aiRegion` | `"ai"` |
| `alignDrawing` | `"drawings"` |

Keep `group` and `groupTools` until Task 6 deletes `ToolPalette`; then delete both (Task 6 Step 5).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import "@/mapws/plugins";
import { MAP_TOOL_ACTIONS, toolRegistry, toolsOfTopic } from "./toolStore";
import { MAP_TOPICS } from "../topics/topicIds";

describe("every map tool has exactly one home", () => {
  const tools = toolRegistry.all();

  it("each registered tool names a known topic", () => {
    for (const t of tools) expect([...MAP_TOPICS, "nav"]).toContain(t.topic);
  });

  it("the topics together hold every tool once", () => {
    const placed = [...MAP_TOPICS, "nav" as const].flatMap((id) => toolsOfTopic(tools, id).map((t) => t.id));
    expect(placed.sort()).toEqual(Object.keys(MAP_TOOL_ACTIONS).sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("topic order follows `order`", () => {
    expect(toolsOfTopic(tools, "measure").map((t) => t.id)).toEqual(["distance", "area", "profile", "volume"]);
    expect(toolsOfTopic(tools, "findings").map((t) => t.id)).toEqual(["finding-point", "finding-polygon", "zone"]);
  });
});
```

If the `order` values in the tool files do not already sort as asserted, set them to 10/20/30/40 in
that order (they are only used for sorting).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/mapws/tools/topics.test.ts`
Expected: FAIL — `toolsOfTopic` is not exported; TS error on `topic`.

- [ ] **Step 3: Implement**

`topics/topicIds.ts`:

```ts
/** Spec §2: the map rail, shared topics first. */
export const MAP_TOPICS = ["layers", "findings", "measure", "ai", "drawings"] as const;
export type MapTopicId = (typeof MAP_TOPICS)[number];
```

In `toolStore.ts`, import `MapTopicId` and add to `MapTool` after `group`:

```ts
  /** The rail topic whose panel holds this tool (spec §3.1); "nav" sits on the rail itself. */
  topic: MapTopicId | "nav";
```

and below `groupTools`:

```ts
/** One topic's tools, by `order` then id. */
export function toolsOfTopic(tools: readonly MapTool[], topic: MapTopicId | "nav"): MapTool[] {
  return tools.filter((t) => t.topic === topic).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
```

Add the `topic:` line from the table to each of the 11 tool files, right after `group:`.

`tools/useMapToolKeys.ts` — the shortcut binding that lived in `ToolPalette`:

```ts
import { useMemo } from "react";
import { useToolShortcuts } from "@/ui";
import { useTools } from "../context";
import { useRegistry } from "../registry";
import { shortcutFor, toolRegistry, type ToolContext } from "./toolStore";

/** Every tool's key, whatever topic is open (spec §4 "Tool keys"). */
export function useMapToolKeys(context: ToolContext): void {
  const tools = useRegistry(toolRegistry);
  const activate = useTools((s) => s.activate);
  const keys = useMemo(
    () =>
      tools.map((t) => ({
        shortcut: shortcutFor(t.action),
        action: t.action,
        disabled: (t.disabledReason?.(context) ?? null) !== null,
        onTrigger: () => activate(t.id),
      })),
    [tools, context, activate],
  );
  useToolShortcuts(keys);
}
```

- [ ] **Step 4: Run tests and type-check**

Run: `pnpm -C frontend exec vitest run src/mapws/tools` then `pnpm -C frontend exec tsc -p . --noEmit`
Expected: PASS; no type errors (test fixtures that build a `MapTool` literal need `topic:` added —
fix each one the compiler names).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/mapws/tools frontend/src/mapws/topics/topicIds.ts
git commit -m "feat(maps): every tool belongs to one rail topic"
```

---

### Task 5: Map topic bodies and the one survey-scope switch

**Files:**
- Create: `frontend/src/mapws/chrome/LayerGroups.tsx` (body of `LayersPanel` without its shell),
  `frontend/src/mapws/topics/useTopicRows.ts`, `frontend/src/mapws/topics/TopicTools.tsx`,
  `frontend/src/mapws/topics/LayersTopic.tsx`, `FindingsTopic.tsx`, `MeasureTopic.tsx`,
  `AiTopic.tsx`, `DrawingsTopic.tsx`, `frontend/src/mapws/timeline/SurveyScope.tsx`,
  `frontend/src/mapws/topics/listItems.ts`
- Modify: `frontend/src/mapws/findings/FindingsRowExtra.tsx`, `frontend/src/mapws/detect/DetectionFilters.tsx`,
  `frontend/src/mapws/timeline/TimelineScrubber.tsx`, `frontend/src/mapws/drawings/drawingRows.ts`
- Test: `frontend/src/mapws/topics/topics.test.tsx`, `frontend/src/mapws/topics/listItems.test.ts`,
  `frontend/src/mapws/timeline/SurveyScope.test.tsx`

**Interfaces:**
- Consumes: `TopicPanel`, `TopicList`, `TopicItem`, `TopicTool` (Task 3); `toolsOfTopic`,
  `MapTopicId` (Task 4); `LayerRow`, `layerRegistry`, `effectiveState`, `useWorkspace`,
  `useMapFindingsStore`, `useMeasurementsStore`, `useZonesStore`, `useDetectStore`.
- Produces:
  ```ts
  // useTopicRows.ts
  export const TOPIC_KINDS: Record<MapTopicId, readonly string[]> = {
    layers: [], findings: ["findings", "zones"], measure: ["measurements", "volumes"],
    ai: ["detections"], drawings: [] };
  export function useTopicVisibility(rows: readonly LayerRow[], topic: MapTopicId): { value: boolean; toggle(): void };
  // listItems.ts (pure)
  export function findingItems(pins: readonly MapFindingPin[], filters: FindingFilterValues, typeName: (id: string) => string | undefined): TopicItem[];
  export function zoneItems(areas: readonly SiteArea[]): TopicItem[];
  export function measurementItems(items: readonly MapMeasurement[], kinds: readonly string[]): TopicItem[];
  export function extentOf(coords: readonly (readonly number[])[]): SiteExtent | null;
  // ids of TopicItem are `<selection kind>:<id>` so one list can mix findings and zones
  // SurveyScope.tsx
  export function useSurveyScope(): { all: boolean; set(all: boolean): void };
  export function SurveyScope(): JSX.Element;
  // each *Topic.tsx
  export function FindingsTopic(p: MapTopicProps): JSX.Element; // same for the other four
  export interface MapTopicProps { rows: readonly LayerRow[]; notInCompare: ReadonlySet<string>; projectId: string; context: ToolContext; }
  ```

- [ ] **Step 1: Extract `LayerGroups` (refactor, tests stay green)**

Move everything inside `LayersPanel`'s `{!collapsed && (…)}` into
`chrome/LayerGroups.tsx`:

```tsx
export interface LayerGroupsProps {
  rows: readonly LayerRow[];
  notInCompare: ReadonlySet<string>;
  groups: readonly LayerGroup[];
}
/** The layer rows of `groups`, top to bottom, with eye, opacity, reorder and the row menu. */
export function LayerGroups({ rows, notInCompare, groups }: LayerGroupsProps) { … }
```

Drop the Drawings group's "+ Import" link (spec §3.1: one import action per topic). Keep the
`grouped`, `move`, `LayerRowView` code unchanged otherwise. Make `LayersPanel` render
`<LayerGroups groups={GROUP_ORDER} …/>` for now.

Run: `pnpm -C frontend exec vitest run src/mapws/chrome`
Expected: PASS, except the test asserting the Drawings "+ Import" link — delete that assertion.

- [ ] **Step 2: Write the failing list-adapter test**

```ts
import { describe, expect, it } from "vitest";
import { extentOf, findingItems, measurementItems, zoneItems } from "./listItems";

const pin = (id: string, severity: number | null, status = "open") =>
  ({ id, number: Number(id), type_id: "t", severity, status, created_by: "human", map_id: "m",
     geometry_site: { type: "Point", coordinates: [10, 20] } }) as never;

describe("list items", () => {
  it("findings follow the row filters, worst first, labelled by type and number", () => {
    const items = findingItems([pin("1", 1), pin("2", 4), pin("3", 3, "closed")],
      { allSurveys: false, statuses: ["open"], minSeverity: null }, () => "Crack");
    expect(items.map((i) => i.id)).toEqual(["finding:2", "finding:1"]);
    expect(items[0]).toMatchObject({ label: "Crack", meta: "F-0002" });
  });

  it("zones are listed by name", () => {
    expect(zoneItems([{ id: "z", name: "Yard", category: "laydown" } as never])[0]).toMatchObject({ id: "zone:z", label: "Yard" });
  });

  it("measurements follow the kind filter", () => {
    const m = (id: string, kind: string) => ({ id, kind, name: `M${id}` }) as never;
    expect(measurementItems([m("a", "distance"), m("b", "area")], ["area"]).map((i) => i.id)).toEqual(["measurement:b"]);
  });

  it("extentOf bounds a ring and refuses nothing", () => {
    expect(extentOf([[0, 1], [4, -2], [2, 5]])).toEqual([0, -2, 4, 5]);
    expect(extentOf([])).toBeNull();
  });
});
```

Run: `pnpm -C frontend exec vitest run src/mapws/topics/listItems.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `listItems.ts`**

```ts
import type { MapFindingPin } from "@/api/mapFindings";
import type { MapMeasurement } from "@/api/mapMeasurements";
import type { SiteArea } from "@/api/siteAreas";
import { formatFindingNumber } from "@/findings/format";
import type { TopicItem } from "@/ui";
import { visibleFindings, type FindingFilterValues } from "../findings/tooltip";
import type { SiteExtent } from "../view/siteGrid";

export function findingItems(
  pins: readonly MapFindingPin[],
  filters: FindingFilterValues,
  typeName: (id: string) => string | undefined,
): TopicItem[] {
  return visibleFindings(pins, filters)
    .slice()
    .sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0) || a.number - b.number)
    .map((f) => ({
      id: `finding:${f.id}`,
      label: typeName(f.type_id) ?? "Finding",
      meta: formatFindingNumber(f.number),
    }));
}

export function zoneItems(areas: readonly SiteArea[]): TopicItem[] {
  return areas.map((a) => ({ id: `zone:${a.id}`, label: a.name }));
}

export function measurementItems(items: readonly MapMeasurement[], kinds: readonly string[]): TopicItem[] {
  return items.filter((m) => kinds.includes(m.kind)).map((m) => ({ id: `measurement:${m.id}`, label: m.name }));
}

export function extentOf(coords: readonly (readonly number[])[]): SiteExtent | null {
  if (coords.length === 0) return null;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of coords) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}
```

Severity swatches: pass `swatch: severityOf(scale, f.severity)?.colour` in `FindingsTopic` (the
cloud `pins.tsx` already does this with `severityOf` and `useSeverityScale`); keep the pure function
free of the scale. If `MapMeasurement` names its label field differently from `name`, use the field
`MeasurementInspector.tsx` shows as the title.

Run the test again. Expected: PASS.

- [ ] **Step 4: Survey scope — failing test**

```tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDetectStore } from "@/mapws/detect/detectStore";
import { renderHookInWorkspace } from "@/mapws/test/harness";
import { useSurveyScope } from "./SurveyScope";

describe("useSurveyScope", () => {
  it("one switch drives findings and detections", () => {
    const { result, workspace } = renderHookInWorkspace(() => useSurveyScope());
    act(() => result.current.set(true));
    expect(useDetectStore.getState().filters.allSurveys).toBe(true);
    expect(workspace.getState().layerState["findings:all"]?.style?.allSurveys).toBe(true);
    expect(result.current.all).toBe(true);
  });
});
```

`mapws/test/harness.tsx` already has `makeStores()` and `renderInWorkspace()`. Add
`renderHookInWorkspace(hook)` next to them: `renderHook(hook, { wrapper })` with the same
`WorkspaceProvider` wrapper `renderInWorkspace` uses, returning `{ result, workspace: stores.workspace,
tools: stores.tools }`. Stage `harness.tsx` with this task's commit.

Run: `pnpm -C frontend exec vitest run src/mapws/timeline/SurveyScope.test.tsx` — Expected: FAIL.

- [ ] **Step 5: Implement `SurveyScope.tsx` and remove the two switches**

```tsx
import { Switch } from "@/ui";
import { useWorkspace } from "../context";
import { useDetectStore } from "../detect/detectStore";

const FINDINGS_ROW = "findings:all";

/** Spec §3.1 "Survey scope": one switch for findings and detections (measurements follow `r`). */
export function useSurveyScope(): { all: boolean; set(all: boolean): void } {
  const all = useDetectStore((s) => s.filters.allSurveys);
  const setFilters = useDetectStore((s) => s.setFilters);
  const row = useWorkspace((s) => s.layerState[FINDINGS_ROW]);
  const setLayerState = useWorkspace((s) => s.setLayerState);
  return {
    all,
    set: (on) => {
      setFilters({ allSurveys: on });
      setLayerState(FINDINGS_ROW, { style: { ...row?.style, allSurveys: on } });
    },
  };
}

export function SurveyScope() {
  const { all, set } = useSurveyScope();
  return <Switch label="All surveys" checked={all} onChange={set} />;
}
```

If `setLayerState` requires `visible`/`opacity` for an unseen key, read the current effective
state with `effectiveState` and spread it first. Render `<SurveyScope />` in
`timeline/TimelineScrubber.tsx` at the end of its control row. Delete the `<Switch … "All surveys">`
from `FindingsRowExtra.tsx` and `DetectionFilters.tsx` (and their now-unused imports). Update the two
row-extra tests that asserted the switch.

Run: `pnpm -C frontend exec vitest run src/mapws/timeline src/mapws/findings src/mapws/detect` — Expected: PASS.

- [ ] **Step 6: Topic bodies — failing test**

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderTopic } from "./testTopic";
import { FindingsTopic } from "./FindingsTopic";
import { DrawingsTopic } from "./DrawingsTopic";
import { MeasureTopic } from "./MeasureTopic";
import { AiTopic } from "./AiTopic";
import { LayersTopic } from "./LayersTopic";

describe("map topics", () => {
  it("Findings: point, polygon and zone tools, filters, list", () => {
    renderTopic(FindingsTopic);
    for (const name of ["Add finding point", "Add finding polygon", /Zone/])
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Status" })).toBeInTheDocument();
  });

  it("Findings eye hides findings and zones together", () => {
    const { workspace } = renderTopic(FindingsTopic);
    fireEvent.click(screen.getByRole("button", { name: "Hide findings" }));
    const s = workspace.getState().layerState;
    expect(s["findings:all"]?.visible).toBe(false);
    expect(s["zones:all"]?.visible).toBe(false);
  });

  it("using a creation tool turns a hidden topic back on", () => {
    const { workspace, tools } = renderTopic(FindingsTopic);
    fireEvent.click(screen.getByRole("button", { name: "Hide findings" }));
    fireEvent.click(screen.getByRole("button", { name: "Add finding point" }));
    expect(tools.getState().active).toBe("finding-point");
    expect(workspace.getState().layerState["findings:all"]?.visible).toBe(true);
  });

  it("clicking a list row selects it", () => {
    const { workspace } = renderTopic(FindingsTopic, { findings: [{ id: "f1", number: 1 }] });
    fireEvent.click(screen.getByRole("option", { name: /F-0001/ }));
    expect(workspace.getState().selection).toEqual({ kind: "finding", id: "f1" });
  });

  it("Measure holds distance, area, profile, volume", () => {
    renderTopic(MeasureTopic);
    expect(screen.getByRole("group", { name: "Measure tools" }).querySelectorAll("button")).toHaveLength(4);
  });

  it("AI holds detect region and the review filters, no survey switch", () => {
    renderTopic(AiTopic);
    expect(screen.getByRole("button", { name: /AI detect/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Pending")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "All surveys" })).toBeNull();
  });

  it("Drawings: one import action, Align disabled without a selected drawing, no duplicate menu entries", () => {
    renderTopic(DrawingsTopic, { drawing: true });
    expect(screen.getAllByRole("button", { name: /Import drawing/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Align drawing — Choose a drawing first/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /actions$/ }));
    expect(screen.queryByRole("menuitem", { name: /Align|Knock out white|Layers…/ })).toBeNull();
  });

  it("Layers: base and elevation only, one import menu", () => {
    renderTopic(LayersTopic);
    expect(screen.queryByRole("region", { name: "Annotations" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Drawings" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add a layer" })).toBeInTheDocument();
  });
});
```

Create `topics/testTopic.tsx`: a helper built on `makeStores()` / `renderInWorkspace()` from
`mapws/test/harness.tsx`, which seeds `useMapFindingsStore.getState().setSide("single", pins, false)` from
`opts.findings` (fill the other `MapFindingPin` fields as in Step 2), adds one drawing layer row when
`opts.drawing`, and renders `<Topic rows={…} notInCompare={new Set()} projectId="p" context={…} />`
with `rows` from `layerRegistry.all().flatMap(k => k.rows(ctx))`. It returns `{ workspace, tools }`.

Run: `pnpm -C frontend exec vitest run src/mapws/topics/topics.test.tsx` — Expected: FAIL.

- [ ] **Step 7: Implement the shared helpers**

`topics/useTopicRows.ts`:

```ts
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspace } from "../context";
import { layerRegistry, type LayerRow } from "../layers/layerRegistry";
import { effectiveState } from "../layers/placement";
import type { MapTopicId } from "./topicIds";

export const TOPIC_KINDS: Record<MapTopicId, readonly string[]> = {
  layers: [],
  findings: ["findings", "zones"],
  measure: ["measurements", "volumes"],
  ai: ["detections"],
  drawings: [],
};

/** The header eye (spec §4 "Eye"): on when any of the topic's rows is visible; toggles them together. */
export function useTopicVisibility(rows: readonly LayerRow[], topic: MapTopicId) {
  const own = useMemo(() => rows.filter((r) => TOPIC_KINDS[topic].includes(r.kind)), [rows, topic]);
  const state = useWorkspace(useShallow((s) => s.layerState));
  const setLayerState = useWorkspace((s) => s.setLayerState);
  const value = own.some((r) => effectiveState(r, layerRegistry.get(r.kind), state).visible);
  return {
    value,
    toggle: () => own.forEach((r) => setLayerState(r.key, { visible: !value })),
    show: () => own.forEach((r) => setLayerState(r.key, { visible: true })),
  };
}

/** One annotation row's filter controls, wired to its persisted style (as LayerRowView does). */
export function useRowStyle(rows: readonly LayerRow[], kind: string) {
  const row = rows.find((r) => r.kind === kind);
  const state = useWorkspace((s) => (row ? s.layerState[row.key] : undefined));
  const setLayerState = useWorkspace((s) => s.setLayerState);
  const style = state?.style ?? {};
  return {
    row,
    style,
    setStyle: (patch: Record<string, unknown>) => row && setLayerState(row.key, { style: { ...style, ...patch } }),
  };
}
```

`topics/TopicTools.ts` — one topic's map tools as `TopicTool`s:

```ts
import { useRegistry } from "../registry";
import { useTools } from "../context";
import { shortcutFor, toolRegistry, toolsOfTopic, type ToolContext } from "../tools/toolStore";
import type { TopicTool } from "@/ui";
import type { MapTopicId } from "./topicIds";

export function useTopicTools(topic: MapTopicId, context: ToolContext, beforeActivate?: () => void): TopicTool[] {
  const tools = useRegistry(toolRegistry);
  const active = useTools((s) => s.active);
  const activate = useTools((s) => s.activate);
  return toolsOfTopic(tools, topic).map((t) => ({
    id: t.id,
    icon: t.icon,
    label: t.label,
    shortcut: shortcutFor(t.action),
    active: active === t.id,
    disabledReason: t.disabledReason?.(context) ?? null,
    onClick: () => {
      beforeActivate?.();
      activate(t.id);
    },
  }));
}
```

The "creation tool turns the topic back on" rule (Review Focus 5) must also hold for keys: in
Task 6 `useMapRail` subscribes to `tools.active` and calls the topic's `show()` when a tool of a
hidden topic becomes active, so pass `beforeActivate={vis.show}` here and rely on Task 6 for keys.

- [ ] **Step 8: Implement the five topics**

`FindingsTopic.tsx`:

```tsx
import { useMemo } from "react";
import { useProjectTypes } from "@/findings/useProjectTypes";
import { TopicList, TopicPanel, useSeverityScale } from "@/ui";
import { severityOf } from "@/ui/severityScale";
import { useWorkspace } from "../context";
import { FindingsRowExtra } from "../findings/FindingsRowExtra";
import { useMapFindingsStore } from "../findings/store";
import { findingFilters } from "../findings/tooltip";
import { ZonesRowExtra } from "../zones/ZonesRowExtra";
import { useZonesStore } from "../zones/store";
import { findingItems, zoneItems } from "./listItems";
import { useTopicTools } from "./TopicTools";
import { useRowStyle, useTopicVisibility } from "./useTopicRows";
import type { MapTopicProps } from "./types";

export function FindingsTopic({ rows, projectId, context }: MapTopicProps) {
  const vis = useTopicVisibility(rows, "findings");
  const tools = useTopicTools("findings", context, vis.show);
  const f = useRowStyle(rows, "findings");
  const z = useRowStyle(rows, "zones");
  const byId = useMapFindingsStore((s) => s.byId);
  const zones = useZonesStore((s) => s.items);
  const { all } = useProjectTypes(projectId);
  const scale = useSeverityScale();
  const selection = useWorkspace((s) => s.selection);
  const select = useWorkspace((s) => s.select);
  const items = useMemo(() => {
    const name = (id: string) => all.find((t) => t.id === id)?.name;
    const pins = Object.values(byId);
    const swatch = new Map(pins.map((p) => [`finding:${p.id}`, severityOf(scale, p.severity)?.colour]));
    return [
      ...findingItems(pins, findingFilters(f.style), name).map((i) => ({ ...i, swatch: swatch.get(i.id) })),
      ...zoneItems(zones),
    ];
  }, [byId, zones, f.style, all, scale]);
  return (
    <TopicPanel
      title="Findings"
      count={items.length}
      visible={vis}
      tools={tools}
      filters={
        <div className="flex flex-col gap-3">
          {f.row && <FindingsRowExtra row={f.row} style={f.style} setStyle={f.setStyle} />}
          {z.row && <ZonesRowExtra row={z.row} style={z.style} setStyle={z.setStyle} />}
        </div>
      }
    >
      <TopicList
        label="Findings and zones"
        items={items}
        selectedId={selection ? `${selection.kind}:${selection.id}` : null}
        onSelect={(id) => {
          const [kind, ...rest] = id.split(":");
          select({ kind, id: rest.join(":") });
        }}
        empty={<p className="px-1 text-sm text-muted">No findings in view. Press M and click the map.</p>}
      />
    </TopicPanel>
  );
}
```

`topics/types.ts` holds `MapTopicProps`. Framing on select: after `select(...)`, call
`workspace.getState().viewApi?.fit(extent)` (or `centreOn` for a point) using the pin's
`geometry_site` / the zone's `polygon_site` through `extentOf`; add a `frame(id)` helper in
`FindingsTopic` that looks the item up in `byId` / `zones`. Do the same in `MeasureTopic` with
`vertices_site`.

`MeasureTopic.tsx` — same shape: `useTopicVisibility(rows, "measure")`, tools for `"measure"`,
filters `MeasurementRowExtra` (row kind `measurements`), list `measurementItems(items,
measureFilters(style).kinds)` from `useMeasurementsStore`. The `volumes` row keeps its eye through
the header eye; volumes are selected on the map (spec §3.1 lists them; there is no bounded volume
list store — see the hand-off note).

`AiTopic.tsx` — `useTopicVisibility(rows, "ai")`, tools for `"ai"`, filters `<DetectionFilters />`,
a "Run on the whole map" button that calls the same action as the raster menu's "Run AI" entry
(find it in `layers/rasterMenu.ts` and import the function it calls; pass the current `r` survey's
map). List: `useDetectStore` `inView` ids → `byId` entries with `review_state === "unreviewed"`
first, id `detection:${runId}:${d.id}` built with `detectionSelection(runId, d.id)`; label the
class name from `useProjectTypes`, meta the confidence as `NN %`. Export `usePendingCount()` (the
number of unreviewed in view) for the rail badge.

`LayersTopic.tsx` — `TopicPanel title="Layers"` with the `+` `MenuButton` from `LayersPanel`
(Import orthomosaic, Import elevation, Build DSM from cloud — **not** Import drawing) as `menu`, and
`<LayerGroups groups={["base", "elevation"]} …/>` as the list.

`DrawingsTopic.tsx` — `TopicPanel title="Drawings"`, `menu` = one `Button` "Import drawing"
(`openAddData("drawing")`, disabled with `ADD_DATA_LOADING` hint until `useAddDataReady`), tools =
`useTopicTools("drawings", context)` (Align), list = `<LayerGroups groups={["drawings"]} …/>`.

- [ ] **Step 9: Remove the duplicate drawing actions**

In `drawings/drawingRows.ts` delete the row-menu entries Align, Knock out white and Layers… (keep
Properties, Re-import…, Delete…). Update `drawingRows.test.ts` to assert the three are gone. The
drawing inspector keeps all three (`DrawingInspector.tsx` is not changed). In `layers/rasterMenu.ts`
remove "Run AI on the whole map" (it moved to the AI topic) and update its test.

- [ ] **Step 10: Run tests**

Run: `pnpm -C frontend exec vitest run src/mapws`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/mapws/topics frontend/src/mapws/chrome/LayerGroups.tsx frontend/src/mapws/chrome/LayersPanel.tsx frontend/src/mapws/chrome/LayersPanel.test.tsx frontend/src/mapws/timeline frontend/src/mapws/test/harness.tsx frontend/src/mapws/findings/FindingsRowExtra.tsx frontend/src/mapws/detect/DetectionFilters.tsx frontend/src/mapws/drawings/drawingRows.ts frontend/src/mapws/drawings/drawingRows.test.ts frontend/src/mapws/layers/rasterMenu.ts frontend/src/mapws/layers/rasterMenu.test.ts
git commit -m "feat(maps): five rail topics, one survey-scope switch, one home per drawing action"
```

(Add any other test file Step 5/9 touched by path.)

---

### Task 6: Mount the rail in the map workspace

**Files:**
- Create: `frontend/src/mapws/topics/useMapRail.tsx`
- Modify: `frontend/src/mapws/MapWorkspace.tsx`, `frontend/src/mapws/inspect/InspectorHost.tsx`,
  `frontend/src/mapws/tools/toolStore.ts`
- Delete: `frontend/src/mapws/chrome/ToolPalette.tsx`, `ToolPalette.test.tsx`, `LayersPanel.tsx`,
  `LayersPanel.test.tsx`
- Test: `frontend/src/mapws/MapWorkspace.test.tsx` (update), `frontend/src/mapws/topics/useMapRail.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces:
  ```ts
  export function useMapRail(p: MapTopicProps & { hasBaseData: boolean }): { store: StoreApi<RailState>; topics: RailTopic[]; nav: ReactNode };
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// useMapRail.test.tsx — rendered inside the Task 5 test harness
it("arming a tool follows its topic only while the panel is open", () => {
  const { tools, rail } = renderMapRail();
  act(() => tools.getState().activate("distance"));
  expect(rail.getState().topic).toBe("measure");
  act(() => rail.getState().close());
  act(() => tools.getState().activate("finding-point"));
  expect(rail.getState()).toMatchObject({ open: false, topic: "measure" });
});

it("switching topic keeps a draft in progress", () => {
  const { tools, rail } = renderMapRail();
  act(() => tools.getState().activate("area"));
  act(() => tools.getState().addVertex([0, 0]));
  act(() => rail.getState().openTopic("layers"));
  expect(tools.getState().draft).toHaveLength(1);
});

it("a key for a tool of a hidden topic turns the topic back on", () => {
  const { tools, workspace } = renderMapRail();
  act(() => workspace.getState().setLayerState("findings:all", { visible: false }));
  act(() => tools.getState().activate("finding-point"));
  expect(workspace.getState().layerState["findings:all"]?.visible).toBe(true);
});

it("defaults to Layers when the project has no base data", () => {
  const { rail } = renderMapRail({ hasBaseData: false });
  expect(rail.getState().topic).toBe("layers");
});
```

In `MapWorkspace.test.tsx` replace assertions on `toolbar "Map tools"` / `region "Layers"` /
"Collapse layers" with: the toolbar named "Map" exists; `getByRole("region", { name: "Findings" })`
is open by default; pressing `L` arms Distance and the open region becomes "Measure".

Run: `pnpm -C frontend exec vitest run src/mapws/topics/useMapRail.test.tsx src/mapws/MapWorkspace.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement `useMapRail.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { createRailStore, ToolButton, type RailTopic } from "@/ui";
import { useStore } from "zustand";
import { useTools, useWorkspaceStores } from "../context";
import { useRegistry } from "../registry";
import { shortcutFor, toolRegistry, toolsOfTopic } from "../tools/toolStore";
import { AiTopic, usePendingCount } from "./AiTopic";
import { DrawingsTopic } from "./DrawingsTopic";
import { FindingsTopic } from "./FindingsTopic";
import { LayersTopic } from "./LayersTopic";
import { MeasureTopic } from "./MeasureTopic";
import { MAP_TOPICS, type MapTopicId } from "./topicIds";
import { useTopicVisibility } from "./useTopicRows";
import type { MapTopicProps } from "./types";

export function useMapRail(p: MapTopicProps & { hasBaseData: boolean }) {
  const { tools: toolStore } = useWorkspaceStores();
  const [store] = useState(() => createRailStore("maps", MAP_TOPICS, p.hasBaseData ? "findings" : "layers"));
  const registry = useRegistry(toolRegistry);
  const active = useTools((s) => s.active);
  const activate = useTools((s) => s.activate);
  const vis = {
    findings: useTopicVisibility(p.rows, "findings"),
    measure: useTopicVisibility(p.rows, "measure"),
    ai: useTopicVisibility(p.rows, "ai"),
  };
  const pending = usePendingCount();

  // Spec §4 "Tool keys": the open panel follows the armed tool; a hidden topic comes back on.
  useEffect(() => {
    const topic = registry.find((t) => t.id === active)?.topic;
    if (!topic || topic === "nav") return;
    store.getState().revealTopicFor(topic);
    if (topic in vis && !vis[topic as keyof typeof vis].value) vis[topic as keyof typeof vis].show();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the armed tool only
  }, [active]);

  const nav = toolsOfTopic(registry, "nav").map((t) => (
    <ToolButton key={t.id} icon={t.icon} label={t.label} shortcut={shortcutFor(t.action)}
      active={active === t.id} onClick={() => activate(t.id)} />
  ));
  const topics = useMemo<RailTopic[]>(() => {
    const body: Record<MapTopicId, JSX.Element> = {
      layers: <LayersTopic {...p} />,
      findings: <FindingsTopic {...p} />,
      measure: <MeasureTopic {...p} />,
      ai: <AiTopic {...p} />,
      drawings: <DrawingsTopic {...p} />,
    };
    return [
      { id: "layers", label: "Layers", icon: "layers", group: "shared", body: body.layers },
      { id: "findings", label: "Findings", icon: "findings", group: "shared", hidden: !vis.findings.value, body: body.findings },
      { id: "measure", label: "Measure", icon: "measure", group: "shared", hidden: !vis.measure.value, body: body.measure },
      { id: "ai", label: "AI", icon: "detect", group: "workspace", badge: pending, hidden: !vis.ai.value, body: body.ai },
      { id: "drawings", label: "Drawings", icon: "drawing", group: "workspace", body: body.drawings },
    ];
  }, [p, vis.findings.value, vis.measure.value, vis.ai.value, pending]);
  void toolStore;
  return { store, topics, nav };
}
```

Remove the `toolStore` lines if unused after wiring. `store` is per mount; `MapWorkspace` keys its
body by project, so a project switch gets a fresh rail.

- [ ] **Step 3: Wire it into `MapWorkspace.tsx`**

Replace the two lines

```tsx
      <ToolPalette context={toolContext} />
      <LayersPanel rows={rows} notInCompare={notInCompare} projectId={projectId} />
```

with

```tsx
      <WorkspaceRail
        label="Map"
        store={rail.store}
        nav={rail.nav}
        topics={rail.topics}
        inspectorOpen={selection !== null}
        bottomInset={140}
      />
```

and, near `useWorkspaceKeys(...)`, add

```tsx
  useMapToolKeys(toolContext);
  const rail = useMapRail({ rows, notInCompare, projectId, context: toolContext, hasBaseData: inFrame.length > 0 });
```

(`toolContext` is declared below `useCommands` today; move its `useMemo` above these two calls.)
Remove the `ToolPalette` and `LayersPanel` imports.

- [ ] **Step 4: Inspector width**

In `inspect/InspectorHost.tsx` change `w-[318px]` to `w-[340px]` in `PLACE` and in the framed
branch, and `right-4 top-4` to `right-3.5 top-3.5`.

- [ ] **Step 5: Delete the old chrome**

Delete `chrome/ToolPalette.tsx`, `chrome/ToolPalette.test.tsx`, `chrome/LayersPanel.tsx`,
`chrome/LayersPanel.test.tsx` (`git rm`). Remove `ToolGroup`, `TOOL_GROUPS`, `groupTools` and the
`group` field from `toolStore.ts` and the 11 tool files; keep `order`. Remove `layersCollapsed`,
`collapsedBeforeSide` and `toggleLayersCollapsed` from `state/workspaceStore.ts` only if no other
caller remains (`grep -rn layersCollapsed frontend/src`); otherwise leave them.

- [ ] **Step 6: Run the map tests, lint, type-check**

Run: `pnpm -C frontend exec vitest run src/mapws` then `pnpm -C frontend lint` then `pnpm -C frontend exec tsc -p . --noEmit`
Expected: PASS / clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/mapws
git commit -m "feat(maps): the workspace rail replaces the tool palette and layers panel"
```

---

### Task 7: Cloud features contribute topics; lists split from details

**Files:**
- Create: `frontend/src/clouds/workspace/topics.ts`
- Modify: `frontend/src/clouds/workspace/types.ts`, `compose.ts`, `features/pins.tsx`,
  `features/measure.tsx`, `features/cameras.tsx`, `features/reportViews.tsx`,
  `frontend/src/clouds/pins/FindingsTab.tsx`, `frontend/src/clouds/measuring/MeasurementsTab.tsx`
- Test: `frontend/src/clouds/workspace/compose.test.ts`, `frontend/src/clouds/workspace/topics.test.ts`,
  `clouds/pins/FindingsTab.test.tsx`, `clouds/measuring/MeasurementsTab.test.tsx` (update)

**Interfaces:**
- Produces:
  ```ts
  // topics.ts
  export const CLOUD_TOPICS = ["layers", "findings", "measure", "clip", "photos"] as const;
  export type CloudTopicId = (typeof CLOUD_TOPICS)[number];
  export const TOPIC_OF_TOOL: Record<CloudToolId, CloudTopicId | "nav">;
  // types.ts
  export interface TopicContent { list: ReactNode; detail: ReactNode | null; count?: number | null; menu?: readonly MenuItem[]; }
  // WorkspaceFeature: findingsTab/measurementsTab/findingsMenu → findings?: TopicContent; measure?: TopicContent; layersRow?: ReactNode (was cloudPanel)
  // FeatureContext: showTab(tab) → showTopic(id: CloudTopicId): void
  // ComposedFeatures: findings: TopicContent | null; measure: TopicContent | null; layersRows: Slot[]
  // FindingsTab → export function FindingsList(p: FindingsTabProps) and FindingDetail(p: FindingsTabProps)
  // MeasurementsTab → export function MeasurementsList(p) and MeasurementDetail(p)
  ```

- [ ] **Step 1: Failing tests**

`topics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PALETTE } from "./tools";
import { CLOUD_TOPICS, TOPIC_OF_TOOL } from "./topics";

it("every cloud tool has exactly one home", () => {
  const ids = PALETTE.flat().map((e) => e.id).sort();
  expect(Object.keys(TOPIC_OF_TOOL).sort()).toEqual(ids);
  for (const t of Object.values(TOPIC_OF_TOOL)) expect([...CLOUD_TOPICS, "nav"]).toContain(t);
  expect(TOPIC_OF_TOOL.pin).toBe("findings");
  expect(TOPIC_OF_TOOL.section).toBe("measure");
  expect(TOPIC_OF_TOOL.clip).toBe("clip");
  expect(TOPIC_OF_TOOL.photo).toBe("photos");
});
```

In `compose.test.ts` replace the tab assertions with: the first feature's `findings` wins; `measure`
is taken from the measure feature; `layersRow` slots collect in order; a feature with no topics
adds nothing. In `FindingsTab.test.tsx` render `FindingsList` and `FindingDetail` separately: the
list has no `FindingInspector`; the detail renders it for `selectedId` and nothing for `null`. In
`MeasurementsTab.test.tsx` likewise for `MeasurementsList` (rows + CSV) and `MeasurementDetail`.

Run: `pnpm -C frontend exec vitest run src/clouds` — Expected: FAIL.

- [ ] **Step 2: Implement `topics.ts`**

```ts
import type { CloudToolId } from "./tools";

/** Spec §2/§3.2: the cloud rail, shared topics first. */
export const CLOUD_TOPICS = ["layers", "findings", "measure", "clip", "photos"] as const;
export type CloudTopicId = (typeof CLOUD_TOPICS)[number];

export const TOPIC_OF_TOOL: Record<CloudToolId, CloudTopicId | "nav"> = {
  orbit: "nav",
  pan: "nav",
  fly: "nav",
  point: "measure",
  distance: "measure",
  height: "measure",
  vertical: "measure",
  area: "measure",
  section: "measure",
  clip: "clip",
  pin: "findings",
  photo: "photos",
};
```

- [ ] **Step 3: Split the two tab components**

In `pins/FindingsTab.tsx`: rename the `<ul>` part (with the cap note, error and empty state) to
`export function FindingsList(p: FindingsTabProps)`, and the `{selected && …FindingInspector…}`
part to `export function FindingDetail(p: FindingsTabProps)` (returns `null` without a selection;
its wrapper becomes `min-h-0 flex-1 overflow-y-auto` without `border-t`). Remove the list's
`max-h-[40%]` (the list now owns the whole panel). Delete `FindingsTab`.

In `measuring/MeasurementsTab.tsx`: `MeasurementsList` = header (count + "Copy all as CSV"), error,
empty text and the `<ul>`; `MeasurementDetail` = the `MeasurementDetails` block for
`list.selected` or `null`. Delete `MeasurementsTab`.

- [ ] **Step 4: Change the feature contract**

`types.ts`: replace `InspectorTab`, `TabContent`, `findingsTab`, `measurementsTab`, `findingsMenu`,
`cloudPanel` with:

```ts
export interface TopicContent {
  /** The rail panel's list (spec §2). */
  list: ReactNode;
  /** The selected item's details, shown in the inspector; null when nothing is selected. */
  detail: ReactNode | null;
  count?: number | null;
  menu?: readonly MenuItem[];
}
// in WorkspaceFeature
  findings?: TopicContent;
  measure?: TopicContent;
  /** A row at the bottom of the Layers topic (L1's camera switch). */
  layersRow?: ReactNode;
  /** Extra menu entries for the Findings topic (C-R1's "Capture missing views"). */
  findingsMenu?: readonly MenuItem[];
// in FeatureContext
  showTopic(id: CloudTopicId): void;
```

`compose.ts`: `findings` and `measure` first-wins like the old tabs; `findingsMenu` merged into
`findings.menu` after composing; `layersRow` slots replace `cloudPanel`.

`features/pins.tsx` returns
`findings: { count: pins.total, list: <FindingsList …/>, detail: selectedPin ? <FindingDetail …/> : null }`
and calls `latest.current.showTopic("findings")` where it called `showTab("findings")`.
`features/measure.tsx` returns `measure: { count, list: <MeasurementsList …/>, detail: list.selected ? <MeasurementDetail …/> : null }`
and `onArm: () => showTopic("measure")`. `features/cameras.tsx`: `cloudPanel` → `layersRow`.
`features/reportViews.tsx`: unchanged key name `findingsMenu`. Update the features' tests for the
renamed fields (`showTab` mocks become `showTopic`).

- [ ] **Step 5: Run tests**

Run: `pnpm -C frontend exec vitest run src/clouds`
Expected: PASS except `CloudWorkspace.test.tsx` (wired in Task 8).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/clouds
git commit -m "refactor(clouds): features contribute rail topics; lists split from details"
```

---

### Task 8: Mount the rail in the cloud workspace

**Files:**
- Create: `frontend/src/clouds/workspace/useCloudRail.tsx`
- Modify: `frontend/src/clouds/workspace/CloudWorkspace.tsx`, `Inspector.tsx`, `CloudPanel.tsx`,
  `layout.ts`
- Delete: `frontend/src/clouds/workspace/Palette.tsx`
- Test: `frontend/src/clouds/workspace/CloudWorkspace.test.tsx`, `Inspector.test.tsx`, `CloudPanel.test.tsx` (update)

**Interfaces:**
- Consumes: Tasks 1–3, 7.
- Produces:
  ```ts
  export function useCloudRail(p: { active: CloudToolId; arm(id: CloudToolId): void; isAvailable(id: CloudToolId): boolean;
    features: ComposedFeatures; layersBody: ReactNode; clipBody: ReactNode; photosBody: ReactNode }): { store; topics: RailTopic[]; nav: ReactNode };
  // Inspector becomes: export function Inspector({ detail }: { detail: ReactNode | null }): JSX.Element | null
  // CloudPanel keeps the picker + Import/Details, renders as a TopicPanel body (no GlassPanel shell) when `embedded`
  ```

- [ ] **Step 1: Failing tests**

`Inspector.test.tsx`: renders nothing for `detail={null}`; renders an `aside` named "Inspector" with
the detail and no tabs (`queryByRole("tab")` is null). `CloudWorkspace.test.tsx`: replace palette
and tab assertions with — the toolbar named "Point cloud" holds Orbit, Pan, Fly and five topics;
"Findings" region is open by default; pressing `L` opens the "Measure" region; selecting a pin shows
the finding in the inspector while the Findings list stays in the rail; the Layers topic shows the
colour mode control and "Show camera positions"; Clip topic is absent from the rail's enabled
buttons when the engine cannot clip (its button is disabled with the reason "This view cannot clip").

Run: `pnpm -C frontend exec vitest run src/clouds/workspace` — Expected: FAIL.

- [ ] **Step 2: `Inspector.tsx` becomes selection-only**

```tsx
import type { ReactNode } from "react";
import { GlassPanel, stagger } from "@/ui";
import { INSPECTOR_WIDTH } from "./layout";

/** Spec §3.2: the selected finding or measurement only; the lists live in the rail. */
export function Inspector({ detail }: { detail: ReactNode | null }) {
  if (!detail) return null;
  return (
    <GlassPanel
      variant="float"
      radius="panel"
      as="aside"
      aria-label="Inspector"
      data-testid="cloud-inspector"
      style={{ ...stagger(2), width: INSPECTOR_WIDTH }}
      className="stagger absolute bottom-[204px] right-3.5 top-3.5 z-10 flex flex-col overflow-hidden animate-slide-in reduce-motion:animate-none"
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">{detail}</div>
    </GlassPanel>
  );
}
```

- [ ] **Step 3: `layout.ts`**

Set `CLOUD_PANEL_WIDTH = 340` and `INSPECTOR_WIDTH = 340`; `NOTICE_INSET` and `PROFILE_PANEL`
follow automatically. Run `pnpm -C frontend exec vitest run src/clouds/workspace/minimap.test.ts`
(it reads these) — fix numbers the test pins.

- [ ] **Step 4: `CloudPanel.tsx` as a Layers body**

Add an `embedded?: boolean` prop: when true, render the header (picker, Import, Details) and
`children` inside a plain `div className="flex min-h-0 flex-1 flex-col overflow-y-auto"` instead of
the `GlassPanel` shell. The importing/failed states (no rail) keep the shell (`embedded` false).

- [ ] **Step 5: `useCloudRail.tsx`**

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { createRailStore, MenuButton, TopicPanel, ToolButton, type RailTopic } from "@/ui";
import type { ComposedFeatures } from "./compose";
import { ENTRY, PALETTE, type CloudToolId } from "./tools";
import { CLOUD_TOPICS, TOPIC_OF_TOOL } from "./topics";

const toolsOf = (topic: string) => PALETTE.flat().filter((e) => TOPIC_OF_TOOL[e.id] === topic);

export function useCloudRail(p: {
  active: CloudToolId;
  arm(id: CloudToolId): void;
  isAvailable(id: CloudToolId): boolean;
  features: ComposedFeatures;
  layersBody: ReactNode;
  clipBody: ReactNode;
  photosBody: ReactNode;
}) {
  const [store] = useState(() => createRailStore("clouds", CLOUD_TOPICS, "findings"));
  useEffect(() => {
    const t = TOPIC_OF_TOOL[p.active];
    store.getState().revealTopicFor(t === "nav" ? null : t);
  }, [p.active, store]);

  const tools = (topic: string) =>
    toolsOf(topic).map((e) => ({
      id: e.id,
      icon: e.icon,
      label: e.label,
      shortcut: e.shortcut,
      active: p.active === e.id,
      disabledReason: p.isAvailable(e.id) ? null : "This view cannot " + (e.id === "clip" ? "clip" : "do this"),
      onClick: () => p.arm(e.id),
    }));
  const { findings, measure } = p.features;
  const nav = toolsOf("nav").map((e) => (
    <ToolButton key={e.id} icon={e.icon} label={e.label} shortcut={e.shortcut}
      active={p.active === e.id} disabled={!p.isAvailable(e.id)} onClick={() => p.arm(e.id)} />
  ));
  const topics: RailTopic[] = [
    { id: "layers", label: "Layers", icon: "layers", group: "shared",
      body: <TopicPanel title="Layers">{p.layersBody}</TopicPanel> },
    { id: "findings", label: "Findings", icon: "findings", group: "shared",
      body: (
        <TopicPanel title="Findings" count={findings?.count ?? null} tools={tools("findings")}
          menu={findings?.menu?.length ? <MenuButton label="Findings actions" iconOnly size="sm" items={[...findings.menu]} /> : undefined}>
          {findings?.list}
        </TopicPanel>
      ) },
    { id: "measure", label: "Measure", icon: "measure", group: "shared",
      body: <TopicPanel title="Measure" count={measure?.count ?? null} tools={tools("measure")}>{measure?.list}</TopicPanel> },
    { id: "clip", label: "Clip", icon: "clip-box", group: "workspace",
      body: <TopicPanel title="Clip" tools={tools("clip")}>{p.clipBody}</TopicPanel> },
    { id: "photos", label: "Photos", icon: "camera", group: "workspace",
      body: <TopicPanel title="Photos" tools={tools("photos")}>{p.photosBody}</TopicPanel> },
  ];
  void ENTRY;
  return { store, topics, nav };
}
```

Drop `void ENTRY` and its import if unused. `clipBody`: a short paragraph "Press C and click the
cloud to centre the box; set its size in the hint bar." (`ClipHint` stays on the stage, spec §3.2).
`photosBody`: the `LikelyViews` list is shown in the finding detail today; in the Photos topic show
"Press I and click a point to list the drone photos that saw it." plus the `layersRow` camera
switch is **not** repeated here (it lives in Layers). The cloud panel has no eye in this release
(spec §2 header eye is for overlay topics; clouds have only pins and measurements, both always on).

- [ ] **Step 6: Wire `CloudWorkspace.tsx`**

- Remove `tab`/`setTab`, `InspectorTab`, the `Palette` import and render.
- `ctx.showTab: setTab` → `showTopic: (id) => railStoreRef.current?.getState().revealTopicFor(id)`;
  keep a `railStoreRef` updated from `useCloudRail`'s `store` (the context is built before the hook
  returns, so use a ref).
- Build `layersBody` from the existing `CloudPanel` (now `embedded`) with `RenderControls` and
  `features.layersRows` as children.
- Render, inside `hasView`:
  ```tsx
  <WorkspaceRail label="Point cloud" store={rail.store} nav={rail.nav} topics={rail.topics}
    inspectorOpen={detail !== null} bottomInset={120} />
  ```
  where `const detail = features.findings?.detail ?? features.measure?.detail ?? null;`.
- Replace `<CloudPanel …>` + `<Inspector …/>` at the end with `<Inspector detail={detail} />`.
- Delete `Palette.tsx` (`git rm`).

- [ ] **Step 7: Run tests, lint, type-check**

Run: `pnpm -C frontend exec vitest run src/clouds` then `pnpm -C frontend lint` then `pnpm -C frontend exec tsc -p . --noEmit`
Expected: PASS / clean.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/clouds
git commit -m "feat(clouds): the workspace rail replaces the palette, cloud panel and inspector tabs"
```

---

### Task 9: End-to-end flows and docs

**Files:**
- Modify: `frontend/e2e/maps.spec.ts`, `maps-measure.spec.ts`, `map-workspace.spec.ts`,
  `measurements.spec.ts`, `volumes.spec.ts`, `effects.spec.ts`, `shell.spec.ts`,
  `clouds-pins.spec.ts`, `clouds-workspace.spec.ts`, `pointcloud-foundation.spec.ts`
- Create: `frontend/e2e/workspace-rail.spec.ts`
- Modify: `DESIGN.md` (Workspaces section), `docs/superpowers/specs/2026-09-26-map-workspace-design.md`
  and `2026-09-26-point-cloud-workspace-design.md` (one "Superseded layout" line each pointing at
  the rail spec), `docs/progress.md`

- [ ] **Step 1: Update existing specs**

In each listed spec, replace locators:

| Old | New |
|---|---|
| `getByRole("toolbar", { name: "Map tools" })` | `getByRole("toolbar", { name: "Map" })` |
| `getByRole("toolbar", { name: "Point cloud tools" })` | `getByRole("toolbar", { name: "Point cloud" })` |
| `getByRole("region", { name: "Layers" })` / "Collapse layers" | open it first: `rail.getByRole("button", { name: "Layers" }).click()` when the region is not open, then `getByRole("region", { name: "Layers" })` |
| tool buttons on the palette | the button inside the open topic region (or press the key) |
| `getByTestId("cloud-inspector")` + `getByRole("tab", { name: /Findings/ })` | `getByRole("region", { name: "Findings" })` for the list; `getByTestId("cloud-inspector")` for the selected item |
| the Drawings group "+ Import" | `getByRole("region", { name: "Drawings" }).getByRole("button", { name: "Import drawing" })` |
| findings / detections "All surveys" switch | the timeline's `getByRole("switch", { name: "All surveys" })` |

Clear `localStorage` in each spec's `beforeEach` (`page.addInitScript(() => localStorage.clear())`)
so the default topic is deterministic.

- [ ] **Step 2: New flow spec**

`e2e/workspace-rail.spec.ts`, using the same fixtures as `maps.spec.ts` and `clouds-workspace.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
// import the project fixture helpers the two existing specs use

test("map: create, filter, select a finding from the Findings topic", async ({ page }) => {
  // open the fixture project's Maps tab
  const findings = page.getByRole("region", { name: "Findings" });
  await expect(findings).toBeVisible();
  await findings.getByRole("button", { name: "Add finding point" }).click();
  // click the map centre, pick a type in the popover, save (as maps-review.spec.ts does)
  await expect(findings.getByRole("option")).toHaveCount(1);
  await findings.getByRole("option").first().click();
  await expect(page.getByTestId("map-inspector")).toBeVisible();
});

test("map: \\ hides and restores the panel; a tool key follows its topic", async ({ page }) => {
  await page.keyboard.press("\\");
  await expect(page.getByTestId("rail-panel")).toHaveCount(0);
  await page.keyboard.press("\\");
  await page.keyboard.press("l");
  await expect(page.getByRole("region", { name: "Measure" })).toBeVisible();
});

test("map: Align lives only in the drawing inspector", async ({ page }) => {
  await page.getByRole("toolbar", { name: "Map" }).getByRole("button", { name: "Drawings" }).click();
  await page.getByRole("region", { name: "Drawings" }).getByRole("button", { name: /actions$/ }).first().click();
  await expect(page.getByRole("menuitem", { name: /Align/ })).toHaveCount(0);
});

test("cloud: colour mode from Layers, a distance from Measure, a pin from Findings", async ({ page }) => {
  // open the fixture cloud
  await page.getByRole("toolbar", { name: "Point cloud" }).getByRole("button", { name: "Layers" }).click();
  await expect(page.getByRole("region", { name: "Layers" }).getByText(/Colour by/)).toBeVisible();
  await page.keyboard.press("l");
  await expect(page.getByRole("region", { name: "Measure" })).toBeVisible();
  // two clicks on the canvas + Enter, as clouds-measure.spec.ts does
  await page.keyboard.press("m");
  await expect(page.getByRole("region", { name: "Findings" })).toBeVisible();
});
```

Fill the fixture/setup lines by copying the first `test(...)` body of `maps.spec.ts`,
`maps-review.spec.ts` (finding creation) and `clouds-measure.spec.ts` (measuring clicks); those
specs are the source of truth for coordinates and waits.

- [ ] **Step 3: Run e2e**

Run: `pnpm -C frontend e2e` (or `scripts\finish-task.ps1`, which picks free ports)
Expected: PASS.

- [ ] **Step 4: Docs**

`DESIGN.md` "Workspaces": replace the palette sentence with — "Maps and Point clouds share the
workspace rail (`ui/WorkspaceRail`): navigation tools, then Layers · Findings · Measure, then the
workspace's own topics; one 340px topic panel at a time (`\` toggles it); the inspector on the
right shows only the selection." Add a one-line "Layout superseded by
[[2026-10-02-workspace-rail-design]]" under §5 of the map spec and §6 of the cloud spec. Add a
`docs/progress.md` entry with the gate results.

- [ ] **Step 5: Full gate**

```
pnpm -C contract check
cd backend; .\.venv\Scripts\python.exe -m ruff check .; .\.venv\Scripts\python.exe -m ruff format --check .; .\.venv\Scripts\python.exe -m pytest
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
pnpm -C frontend e2e
```

Expected: all green (backend and contract are untouched; they must still pass).

- [ ] **Step 6: Commit**

```bash
git add frontend/e2e DESIGN.md docs/superpowers/specs/2026-09-26-map-workspace-design.md docs/superpowers/specs/2026-09-26-point-cloud-workspace-design.md docs/progress.md
git commit -m "test(e2e): rail flows on maps and clouds; docs point at the rail spec"
```

---

## Hand-off notes

- **Volumes list**: the spec's Measure topic lists "measurements and volumes"; the map keeps no
  bounded volume list store today (`volume/volumeStore.ts` holds only flags), so this plan lists
  measurements and gives volumes the header eye and map selection only. Adding a list needs a new
  bounded read — a follow-up, not part of this layout change.
- **Cloud topic eye**: the cloud topics have no header eye in this release (pins and measurements
  are always drawn today; adding a hide switch would be a new feature).
- `useCloudRail`'s Clip and Photos bodies are short guidance plus the tool; their live controls
  stay where they are today (the hint bar and the finding detail's Likely views).
