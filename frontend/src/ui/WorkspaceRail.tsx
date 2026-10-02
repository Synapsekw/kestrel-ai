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
