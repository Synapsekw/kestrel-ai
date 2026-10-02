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
  /** px kept free under the panel for the bottom-left chrome. */
  bottomInset: number;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Spec §2/§4: navigation tools, then topics; one topic panel at a time next to the rail. */
export function WorkspaceRail({ label, store, nav, topics, inspectorOpen, bottomInset }: WorkspaceRailProps) {
  const open = useStore(store, (s) => s.open);
  const topic = useStore(store, (s) => s.topic);
  const panelId = useId();
  const current = open ? topics.find((t) => t.id === topic) : undefined;
  const barRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** Spec §4: where focus goes after the next render (a keyboard open or a close from the panel). */
  const focusNext = useRef<"panel" | "rail" | null>(null);

  // Runs the store change; a keyboard open moves focus into the panel, a close from inside the
  // panel moves it back to the topic's rail button.
  const change = (fn: () => void, keyboard: boolean) => {
    const wasOpen = store.getState().open;
    const inPanel = !!panelRef.current?.contains(document.activeElement);
    fn();
    const s = store.getState();
    if (!s.open && wasOpen && inPanel) focusNext.current = "rail";
    else if (s.open && keyboard) focusNext.current = "panel";
  };

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    if (target === "panel") {
      const panel = panelRef.current;
      if (!panel) return;
      (panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel).focus();
    } else {
      barRef.current?.querySelector<HTMLElement>(`[data-rail-topic="${CSS.escape(topic)}"] button`)?.focus();
    }
  });

  const toggle = () => change(() => store.getState().toggle(), true);
  useToolShortcuts([
    { shortcut: "\\", action: "toggle-panel", onTrigger: toggle },
    { shortcut: "Ctrl+Alt+\\", action: "toggle-panel", onTrigger: toggle },
  ]);

  // Narrow windows: the inspector takes the room; closing it does not reopen the panel.
  const wasOpen = useRef(inspectorOpen);
  useEffect(() => {
    if (inspectorOpen && !wasOpen.current && window.innerWidth < NARROW_WIDTH) store.getState().close();
    wasOpen.current = inspectorOpen;
  }, [inspectorOpen, store]);

  const shared = topics.filter((t) => t.group === "shared");
  const extra = topics.filter((t) => t.group === "workspace");
  const button = (t: RailTopic) => {
    const name = [t.label, t.badge ? `${t.badge} waiting` : null, t.hidden ? "hidden" : null]
      .filter(Boolean)
      .join(", ");
    const on = open && topic === t.id;
    return (
      <span key={t.id} className="relative" data-rail-topic={t.id}>
        <ToolButton
          icon={t.icon}
          label={name}
          active={on}
          controls={on ? panelId : undefined}
          // A click from Enter or Space has detail 0.
          onClick={(e) => change(() => store.getState().openTopic(t.id), e.detail === 0)}
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
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-dim"
          />
        )}
      </span>
    );
  };

  return (
    <>
      <GlassPanel
        ref={barRef}
        variant="float"
        role="toolbar"
        aria-label={label}
        aria-orientation="vertical"
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
          ref={panelRef}
          id={panelId}
          as="section"
          tabIndex={-1}
          variant="float"
          radius="panel"
          role="region"
          aria-label={current.label}
          data-testid="rail-panel"
          data-topic={current.id}
          style={{ bottom: bottomInset }}
          className={cx(
            "absolute left-[72px] top-3.5 z-10 flex w-[340px] flex-col overflow-hidden outline-none",
            "animate-rise reduce-motion:animate-none",
          )}
        >
          {current.body}
        </GlassPanel>
      )}
    </>
  );
}
