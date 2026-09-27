import { Fragment } from "react";
import { FloatingToolbar, ToolButton, ToolSeparator } from "@/ui";
import { PALETTE, type CloudToolId } from "./tools";

/**
 * The tool palette (spec §6: left 14, top 14, 38 px buttons, the mockup's three separators). Keys
 * are bound once by useWorkspaceTool, so the toolbar's own shortcut binding is off.
 */
export function Palette({
  active,
  isAvailable,
  onArm,
}: {
  active: CloudToolId;
  isAvailable(id: CloudToolId): boolean;
  onArm(id: CloudToolId): void;
}) {
  return (
    <FloatingToolbar label="Point cloud tools" shortcuts={false} className="absolute left-3.5 top-3.5 z-10">
      {PALETTE.map((group, i) => (
        <Fragment key={group[0].id}>
          {i > 0 && <ToolSeparator />}
          {group.map((t) => (
            <ToolButton
              key={t.id}
              icon={t.icon}
              label={t.label}
              shortcut={t.shortcut}
              active={active === t.id}
              disabled={!isAvailable(t.id)}
              onClick={() => onArm(t.id)}
            />
          ))}
        </Fragment>
      ))}
    </FloatingToolbar>
  );
}
