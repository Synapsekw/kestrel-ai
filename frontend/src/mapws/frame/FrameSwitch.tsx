import { useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { Icon, Tooltip, cx, focusRing, toast, transition } from "@/ui";
import { useWorkspace, useWorkspaceStores } from "../context";
import { bumpWorkspaceData } from "../data/bump";
import { frameSwitchLabel, setSiteFrame } from "./frameSwitchModel";

/** Spec M §6: switch between the site CRS and local metres; shown only when both frames hold items. */
export function FrameSwitch() {
  const { projectId, frame } = useWorkspaceStores();
  const items = useWorkspace((s) => s.frameItems);
  const api = useApi();
  const [pending, setPending] = useState(false);
  if (items === null || items.crs === 0 || items.local === 0) return null;
  const local = frame.kind === "local";

  const onSwitch = () => {
    setPending(true);
    // Back to the site CRS: no epsg, the server picks it by rule M3.
    setSiteFrame(api, projectId, { kind: local ? "crs" : "local" })
      .then(() => bumpWorkspaceData())
      .catch((e: unknown) => toast("danger", messageOf(e, "Could not switch the frame.")))
      .finally(() => setPending(false));
  };

  const label = frameSwitchLabel(frame.kind, items);
  const action = local ? "Show the georeferenced maps and surfaces" : "Show the surfaces without coordinates";
  // A text-height control, capped in width, so it neither grows the coordinates row nor pushes it
  // into the timeline; the full label stays in its name and tooltip.
  return (
    <Tooltip label={`${label}. ${action}`} className="ml-auto min-w-0">
      <button
        type="button"
        aria-label={label}
        aria-busy={pending || undefined}
        disabled={pending}
        onClick={onSwitch}
        className={cx(
          "inline-flex max-w-44 items-center gap-1 rounded-control px-1 font-sans text-xs font-semibold leading-4 text-ink hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-45",
          transition,
          focusRing,
        )}
      >
        {pending && <Icon name="spinner" size={12} className="shrink-0 animate-spin reduce-motion:animate-none" />}
        <span className="truncate">{label}</span>
      </button>
    </Tooltip>
  );
}
