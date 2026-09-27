import { useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { Button, Tooltip, toast } from "@/ui";
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

  return (
    <Tooltip
      label={local ? "Show the georeferenced maps and surfaces" : "Show the surfaces without coordinates"}
      className="ml-auto"
    >
      <Button variant="ghost" size="sm" loading={pending} onClick={onSwitch} className="font-sans">
        {frameSwitchLabel(frame.kind, items)}
      </Button>
    </Tooltip>
  );
}
