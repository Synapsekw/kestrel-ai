import { FloatingToolbar, MenuButton, ToolButton, ToolSeparator, type ToolDef } from "@/ui";
import type { PresetId } from "../engine/camera";
import type { NavMode } from "../engine/SiteEngine";

export interface ViewToolsProps {
  nav: NavMode;
  onNav(mode: NavMode): void;
  onPreset(id: PresetId): void;
  areas: readonly string[];
  disabled: boolean;
}

/** Orbit, pan, fly; fit, plan and one preset per area (spec §11 view tools; ruling R13: no shortcuts). */
export function ViewTools({ nav, onNav, onPreset, areas, disabled }: ViewToolsProps) {
  const tools: ToolDef[] = [
    {
      id: "orbit",
      icon: "orbit",
      label: "Orbit",
      active: nav === "orbit",
      disabled,
      onClick: () => onNav("orbit"),
    },
    { id: "pan", icon: "pan", label: "Pan", active: nav === "pan", disabled, onClick: () => onNav("pan") },
    {
      id: "fly",
      icon: "fly",
      label: "Fly (W A S D, Q E)",
      active: nav === "fly",
      disabled,
      onClick: () => onNav("fly"),
    },
  ];
  return (
    <FloatingToolbar label="View tools" tools={tools} shortcuts={false}>
      <ToolSeparator />
      <ToolButton icon="fit" label="Fit to site" disabled={disabled} onClick={() => onPreset("fit")} />
      <ToolButton icon="north" label="Plan view" disabled={disabled} onClick={() => onPreset("plan")} />
      {areas.length > 0 && (
        <MenuButton
          iconOnly
          icon="area"
          label="Go to an area"
          menuLabel="Areas"
          variant="ghost"
          side="right"
          disabled={disabled}
          items={areas.map((a) => ({ id: a, label: `Area ${a}`, onSelect: () => onPreset(`area:${a}`) }))}
        />
      )}
    </FloatingToolbar>
  );
}
