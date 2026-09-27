import {
  inspectorRegistry,
  slotRegistry,
  type InspectorKind,
  type InspectorSlot,
} from "./inspect/inspectorRegistry";
import { layerRegistry, type LayerKind } from "./layers/layerRegistry";
import { panelRegistry, type WorkspacePanel } from "./panels/panelRegistry";
import { toolRegistry, type MapTool } from "./tools/toolStore";

/**
 * Plugin discovery (R-W1-1): every file matching a pattern below registers its default export.
 * W2–W5 add files; nobody edits this list. Import this module for its side effect.
 */
type Mod<T> = { default: T };

const tools = import.meta.glob<Mod<MapTool>>("./tools/*.tool.{ts,tsx}", { eager: true });
const layers = import.meta.glob<Mod<LayerKind>>("./layers/*.layer.{ts,tsx}", { eager: true });
const inspectors = import.meta.glob<Mod<InspectorKind>>("./inspect/*.inspector.{ts,tsx}", { eager: true });
const slots = import.meta.glob<Mod<InspectorSlot>>("./inspect/*.slot.{ts,tsx}", { eager: true });
const panels = import.meta.glob<Mod<WorkspacePanel>>("./panels/*.panel.{ts,tsx}", { eager: true });

export function loadPlugins(): void {
  for (const m of Object.values(tools)) toolRegistry.register(m.default);
  for (const m of Object.values(layers)) layerRegistry.register(m.default);
  for (const m of Object.values(inspectors)) inspectorRegistry.register(m.default);
  for (const m of Object.values(slots)) slotRegistry.register(m.default);
  for (const m of Object.values(panels)) panelRegistry.register(m.default);
}

loadPlugins();
