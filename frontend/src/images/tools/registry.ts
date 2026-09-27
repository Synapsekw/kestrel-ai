import type { ClassDef } from "@contract/client";
import type { ToolId } from "@/store/imagesWorkspace";
import type { ToolApi, ToolDefinition } from "./types";
import { rememberedType } from "./typeMemory";

const tools = new Map<ToolId, ToolDefinition>();

/** Adds a tool to the palette and the keymap dispatch. FA registers the S tool this way. */
export function registerTool(def: ToolDefinition): void {
  if (tools.has(def.id)) throw new Error(`tool "${def.id}" is already registered`);
  for (const t of tools.values()) {
    if (t.action === def.action)
      throw new Error(`tools "${t.id}" and "${def.id}" share the action "${def.action}"`);
  }
  tools.set(def.id, def);
}

export function listTools(): ToolDefinition[] {
  return [...tools.values()].sort((a, b) => a.order - b.order);
}

export function getTool(id: ToolId): ToolDefinition | undefined {
  return tools.get(id);
}

export function toolForAction(action: string): ToolDefinition | undefined {
  for (const t of tools.values()) if (t.action === action) return t;
  return undefined;
}

/** Test-only: forget every registration. */
export function resetToolsForTests(): void {
  tools.clear();
}

export function restoreType(api: ToolApi, def: ToolDefinition): void {
  const s = api.store.getState();
  const accepts = (t: ClassDef | undefined): t is ClassDef => !!t && (!def.typeFilter || def.typeFilter(t));
  const remembered = s.projectId
    ? s.types.find((t) => t.id === rememberedType(s.projectId!, def.id))
    : undefined;
  const current = s.types.find((t) => t.id === s.activeTypeId);
  const pick = accepts(remembered) ? remembered : accepts(current) ? current : s.types.find(accepts);
  s.setActiveType(pick?.id ?? null);
}

/**
 * Re-picks the active type for the tool in use, e.g. after the type catalogue changed (another
 * project): `activateTool` returns early when the tool is unchanged, so it would not (I5).
 */
export function restoreActiveType(api: ToolApi): void {
  const def = tools.get(api.store.getState().tool);
  if (def?.drawsShapes && def.id !== "pan") restoreType(api, def);
}

/** Switches tools: deactivates the old one, restores the type (ruling FC-R13), activates the new one. */
export function activateTool(id: ToolId, api: ToolApi): void {
  const s = api.store.getState();
  if (s.tool === id) return;
  const next = tools.get(id);
  if (!next) return;
  const reason = next.available?.(s) ?? null;
  if (reason) {
    api.notify(reason);
    return;
  }
  tools.get(s.tool)?.onDeactivate?.(api);
  s.setTool(id);
  if (next.drawsShapes && next.id !== "pan") restoreType(api, next);
  next.onActivate?.(api);
}
