import { useRef } from "react";
import { retypeSelection } from "@/images/canvas/actions";
import type { CommandContext } from "@/images/canvas/commands";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { ComboboxList, Popover } from "@/ui";
import { getTool } from "./registry";
import { rememberType } from "./typeMemory";

/**
 * T (spec §9.2): a filterable picker at the cursor. A type's catalogue hotkey picks it while the
 * filter is empty; Enter picks the highlighted one. With a selection it retypes (F's
 * confirm_finding_delete dialog on defect → object); without, it sets the active type for the tool.
 */
export function TypePicker({ ctx }: { ctx: CommandContext }) {
  const picker = useImagesWorkspace((s) => s.picker);
  const types = useImagesWorkspace((s) => s.types);
  const tool = useImagesWorkspace((s) => s.tool);
  const activeTypeId = useImagesWorkspace((s) => s.activeTypeId);
  const selectionHasPoint = useImagesWorkspace((s) =>
    s.selectedIds.some((id) => s.boxes[id]?.shape === "point"),
  );
  const anchor = useRef<HTMLSpanElement>(null);
  if (!picker) return null;
  const filter = picker.purpose === "active" ? getTool(tool)?.typeFilter : undefined;
  const offered = types.filter(
    (t) =>
      (filter ? filter(t) : true) &&
      (!selectionHasPoint || picker.purpose !== "retype" || t.kind === "defect"),
  );
  const close = () => ctx.store.getState().closePicker();
  const pick = (id: string) => {
    close();
    const s = ctx.store.getState();
    if (picker.purpose === "retype") {
      void retypeSelection(ctx, id);
      return;
    }
    s.setActiveType(id);
    if (s.projectId) rememberType(s.projectId, s.tool, id);
  };
  return (
    <>
      <span
        ref={anchor}
        aria-hidden="true"
        className="pointer-events-none absolute h-px w-px"
        style={{ left: picker.at.x, top: picker.at.y }}
      />
      <Popover open onClose={close} anchorRef={anchor} label="Choose a type">
        <ComboboxList
          label="Type"
          items={offered.map((t) => ({
            id: t.id,
            label: t.name,
            hint: [t.kind === "defect" ? "Defect" : "Object", t.group].filter(Boolean).join(" · "),
            hotkey: t.hotkey,
            colour: t.colour,
          }))}
          value={picker.purpose === "active" ? activeTypeId : null}
          emptyText="No types to offer here"
          onSelect={pick}
        />
      </Popover>
    </>
  );
}
