import { useEffect, useMemo } from "react";
import { GLOBAL_KEYS, WORKSPACE_KEYS, isTypingTarget, useToolShortcuts, type ToolShortcut } from "@/ui";
import { useTools, useWorkspace, useWorkspaceStores } from "../context";
import { inspectorRegistry } from "../inspect/inspectorRegistry";

const KEYS = [...GLOBAL_KEYS, ...WORKSPACE_KEYS.maps];
const keyOf = (action: string): string => {
  const entry = KEYS.find((e) => e.action === action);
  if (!entry) throw new Error(`no key for ${action}`);
  return entry.keys[0];
};

/**
 * The global keys as the map means them (spec §5.1) and M's workspace keys ([ ] P C Shift+N). A key
 * is disabled when it has nothing to act on, so Enter, Backspace, Delete and Esc keep their default
 * meaning on a focused button or menu.
 */
export function useWorkspaceKeys({ onDelete, onFit }: { onDelete: () => void; onFit: () => void }): void {
  const { workspace, tools } = useWorkspaceStores();
  const drawing = useTools((s) => s.draft.length > 0);
  const pending = useTools((s) => s.completed !== null);
  const selection = useWorkspace((s) => s.selection);
  const deletable = selection !== null && inspectorRegistry.get(selection.kind)?.remove !== undefined;

  const keys = useMemo<ToolShortcut[]>(
    () => [
      {
        shortcut: keyOf("cancel"),
        action: "cancel",
        disabled: !drawing && !pending && selection === null,
        onTrigger: () => {
          if (tools.getState().cancel() === "nothing") workspace.getState().select(null);
        },
      },
      {
        shortcut: keyOf("commit"),
        action: "commit",
        disabled: !drawing,
        onTrigger: () => tools.getState().finish(),
      },
      {
        shortcut: keyOf("remove-vertex"),
        action: "remove-vertex",
        disabled: !drawing,
        onTrigger: () => tools.getState().removeVertex(),
      },
      {
        shortcut: keyOf("undo"),
        action: "undo",
        disabled: !drawing,
        onTrigger: () => tools.getState().removeVertex(),
      },
      {
        shortcut: keyOf("delete"),
        action: "delete",
        disabled: !deletable,
        onTrigger: onDelete,
      },
      { shortcut: keyOf("fit"), action: "fit", onTrigger: onFit },
      {
        shortcut: keyOf("zoom-in"),
        action: "zoom-in",
        onTrigger: () => workspace.getState().viewApi?.zoomBy(1),
      },
      {
        shortcut: keyOf("zoom-out"),
        action: "zoom-out",
        onTrigger: () => workspace.getState().viewApi?.zoomBy(-1),
      },
      {
        shortcut: keyOf("previous-survey"),
        action: "previous-survey",
        onTrigger: () => workspace.getState().stepRight(-1),
      },
      {
        shortcut: keyOf("next-survey"),
        action: "next-survey",
        onTrigger: () => workspace.getState().stepRight(1),
      },
      {
        shortcut: keyOf("play"),
        action: "play",
        onTrigger: () => workspace.getState().togglePlay(),
      },
      {
        shortcut: keyOf("compare-mode"),
        action: "compare-mode",
        onTrigger: () => workspace.getState().cycleMode(),
      },
      {
        shortcut: keyOf("north-up"),
        action: "north-up",
        onTrigger: () => workspace.getState().viewApi?.resetNorth(),
      },
    ],
    [drawing, pending, selection, deletable, onDelete, onFit, tools, workspace],
  );
  useToolShortcuts(keys);
  useSpacePan();
}

/** Hold Space to pan from any tool (spec §5.1); not in text fields, dialogs or menus. */
export function useSpacePan(): void {
  const { tools } = useWorkspaceStores();
  useEffect(() => {
    const skip = (e: KeyboardEvent) =>
      e.key !== " " ||
      e.ctrlKey ||
      e.altKey ||
      e.metaKey ||
      isTypingTarget(e.target) ||
      (e.target instanceof Element && e.target.closest('[role="dialog"],[role="menu"]') !== null);
    const down = (e: KeyboardEvent) => {
      if (skip(e)) return;
      e.preventDefault();
      if (!e.repeat) tools.getState().setPanHold(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") tools.getState().setPanHold(false);
    };
    const blur = () => tools.getState().setPanHold(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [tools]);
}
