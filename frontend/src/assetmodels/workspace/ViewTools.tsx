/* eslint-disable react-refresh/only-export-components -- the palette, its cut slider and the key lookup they share */
import { useRef, useState } from "react";
import type { ModelView } from "@/assetmodels/viewer/engine";
import { GLOBAL_KEYS, Icon, Menu, Slider, ToolButton, ToolSeparator, Tooltip, WORKSPACE_KEYS } from "@/ui";

/** The chord the keymap gives an action in the models workspace (F, fit, is a global key). */
export function modelKey(action: string): string {
  const e =
    WORKSPACE_KEYS.models.find((k) => k.action === action) ?? GLOBAL_KEYS.find((k) => k.action === action);
  return e?.keys[0] ?? "";
}

export const VIEWS: readonly { view: Exclude<ModelView, "fit">; label: string; action: string }[] = [
  { view: "top", label: "Top view", action: "view-top" },
  { view: "front", label: "Front view", action: "view-front" },
  { view: "side", label: "Side view", action: "view-side" },
  { view: "iso", label: "Iso view", action: "view-iso" },
];

/** M1's engine has one navigation mode; the palette shows it with its gestures instead of a dead button. */
const ORBIT_HELP = "Orbit: drag to turn, right-drag to pan, scroll to zoom";

export interface ViewToolState {
  cut: boolean;
  levels: boolean;
  headOff: boolean;
}

/**
 * The view tools, the navigation of the asset workspace rail (the rail's toolbar holds them): orbit
 * is the only navigation tool, then the three view aids, then fit and the view presets. Keys are
 * bound once by the workspace.
 */
export function ViewToolButtons({
  state,
  disabled,
  onToggle,
  onView,
}: {
  state: ViewToolState;
  disabled: boolean;
  onToggle(tool: keyof ViewToolState): void;
  onView(view: ModelView): void;
}) {
  const [viewsOpen, setViewsOpen] = useState(false);
  const viewsAnchor = useRef<HTMLSpanElement>(null);
  return (
    <>
      <Tooltip label={ORBIT_HELP} side="right" delay={250}>
        <span
          role="img"
          aria-label={ORBIT_HELP}
          className="grid h-9 w-[38px] place-items-center rounded-control bg-grad-primary text-accent-fg shadow-glow reduce-effects:shadow-none"
        >
          <Icon name="orbit" size={18} />
        </span>
      </Tooltip>
      <ToolSeparator />
      <ToolButton
        icon="section"
        label="Cut"
        shortcut={modelKey("cut")}
        active={state.cut}
        disabled={disabled}
        onClick={() => onToggle("cut")}
      />
      <ToolButton
        icon="height"
        label="Levels"
        shortcut={modelKey("levels")}
        active={state.levels}
        disabled={disabled}
        onClick={() => onToggle("levels")}
      />
      <ToolButton
        icon="eye-off"
        label="Head off"
        shortcut={modelKey("head-off")}
        active={state.headOff}
        disabled={disabled}
        onClick={() => onToggle("headOff")}
      />
      <ToolSeparator />
      <ToolButton
        icon="fit"
        label="Fit"
        shortcut={modelKey("fit")}
        disabled={disabled}
        onClick={() => onView("fit")}
      />
      <span ref={viewsAnchor} className="grid">
        <ToolButton icon="cube" label="Views" disabled={disabled} onClick={() => setViewsOpen((o) => !o)} />
      </span>
      <Menu
        open={viewsOpen}
        onClose={() => setViewsOpen(false)}
        anchorRef={viewsAnchor}
        label="Views"
        side="right"
        align="start"
        items={VIEWS.map((v) => ({
          id: v.view,
          label: v.label,
          shortcut: modelKey(v.action),
          onSelect: () => onView(v.view),
        }))}
      />
    </>
  );
}

/** The cut plane's bearing (clockwise from plant north), shown in the model panel while Cut is on. */
export function CutBearing({ bearing, onBearing }: { bearing: number; onBearing(deg: number): void }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
      <span className="text-xs text-muted">Cut bearing, clockwise from plant north</span>
      <Slider
        label="Cut bearing"
        min={0}
        max={359}
        step={1}
        value={bearing}
        onChange={onBearing}
        format={(v) => `${Math.round(v)}°`}
      />
    </div>
  );
}
