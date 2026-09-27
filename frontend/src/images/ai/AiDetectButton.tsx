import { useRef } from "react";
import { ToolButton } from "@/ui";
import { useAiStore } from "./aiStore";
import { ModelMenu } from "./ModelMenu";

/** The palette's "AI detect · D" button with the model menu anchored to it (spec §9.2 row D). */
export function AiDetectButton({ projectId }: { projectId: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const open = useAiStore((s) => s.menuOpen);
  return (
    <>
      {/* ToolButton does not forward a ref; the span is the Popover's anchor. */}
      <span ref={anchor} className="inline-flex">
        <ToolButton
          icon="detect"
          label="AI detect"
          shortcut="D"
          active={open}
          onClick={() => useAiStore.getState().openMenu()}
        />
      </span>
      <ModelMenu projectId={projectId} anchorRef={anchor} />
    </>
  );
}
