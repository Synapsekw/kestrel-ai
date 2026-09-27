/* eslint-disable react-refresh/only-export-components --
   shortcutFor is exported next to the component that uses it; not a fast-refresh boundary. */
import type { ReactNode } from "react";
import { deleteSelection } from "@/images/canvas/actions";
import type { CommandContext } from "@/images/canvas/commands";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { cx, FloatingToolbar, GlassPanel, ToolButton, ToolSeparator, TypeChip } from "@/ui";
import { keysFor } from "@/ui/keymap";
import { activateTool, listTools } from "./registry";
import { useToolApi } from "./toolApi";

const ENTRIES = keysFor("images");

/** The first chord F's keymap gives an action (the one the tooltip shows). */
export function shortcutFor(action: string): string | undefined {
  return ENTRIES.find((e) => e.action === action)?.keys[0];
}

/**
 * The floating palette, top-left of the canvas (spec §6.2): the registered tools, Delete, the two
 * layer toggles (dimmed when off), any extra buttons (FA's AI detect), and the active-type chip.
 * Keys are bound by the images keymap, never here (`shortcuts={false}`).
 */
export function ToolPalette({
  ctx,
  className,
  children,
}: {
  ctx: CommandContext;
  className?: string;
  children?: ReactNode;
}) {
  const api = useToolApi(ctx);
  const tool = useImagesWorkspace((s) => s.tool);
  const hasSelection = useImagesWorkspace(
    (s) => s.selectedIds.length > 0 || s.selectedMeasurementId !== null,
  );
  const showAnnotations = useImagesWorkspace((s) => s.showAnnotations);
  const showSuggestions = useImagesWorkspace((s) => s.showSuggestions);
  const activeType = useImagesWorkspace((s) => s.types.find((t) => t.id === s.activeTypeId));
  const state = useImagesWorkspace.getState;
  const tools = listTools();
  return (
    <div data-testid="tool-palette" className={cx("flex flex-col items-start gap-2", className)}>
      <FloatingToolbar
        label="Image tools"
        shortcuts={false}
        tools={tools.map((t) => {
          const reason = t.available?.(state()) ?? null;
          return {
            id: t.id,
            icon: t.icon,
            label: reason ? `${t.label} (${reason})` : t.label,
            shortcut: shortcutFor(t.action),
            action: t.action,
            active: tool === t.id,
            disabled: reason !== null,
            onClick: () => activateTool(t.id, api),
          };
        })}
      >
        <ToolSeparator />
        <ToolButton
          icon="trash"
          label="Delete"
          shortcut="Delete"
          disabled={!hasSelection}
          onClick={() => void deleteSelection(ctx)}
        />
        <span className={showAnnotations ? undefined : "opacity-50"}>
          <ToolButton
            icon="layers"
            label={showAnnotations ? "Hide annotations" : "Show annotations"}
            shortcut="Shift+H"
            onClick={() => state().toggleAnnotations()}
          />
        </span>
        <span className={showSuggestions ? undefined : "opacity-50"}>
          <ToolButton
            icon="sparkle"
            label={showSuggestions ? "Hide AI suggestions" : "Show AI suggestions"}
            shortcut="G"
            onClick={() => state().toggleSuggestions()}
          />
        </span>
        {children}
      </FloatingToolbar>
      {activeType && (
        <GlassPanel variant="float" className="p-1">
          <button
            type="button"
            aria-label={`Active type: ${activeType.name}. Change (T)`}
            onClick={() => api.openPicker("active")}
            className="rounded-control px-1.5 py-0.5 hover:bg-surface-2"
          >
            <TypeChip
              name={activeType.name}
              colour={activeType.colour}
              kind={activeType.kind}
              size="sm"
              showKind={false}
            />
          </button>
        </GlassPanel>
      )}
    </div>
  );
}
