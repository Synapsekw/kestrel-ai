import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listMaps } from "@/api/maps";
import { Button, Tooltip, toast } from "@/ui";
import { useWorkspace, useWorkspaceStores } from "../context";
import { bumpWorkspaceData } from "../data/bump";
import {
  defaultSiteEpsg,
  frameSwitchLabel,
  rememberCrsEpsg,
  rememberedCrsEpsg,
  setSiteFrame,
} from "./frameSwitchModel";

/**
 * The EPSG code for the switch back to the site CRS: the last CRS frame shown this session, else
 * rule M3 over the maps list (one bounded read, only while it is needed). Null while unknown.
 */
function useCrsEpsg(projectId: string, needed: boolean): number | null {
  const api = useApi();
  const remembered = rememberedCrsEpsg(projectId);
  const [derived, setDerived] = useState<{ projectId: string; epsg: number | null } | null>(null);
  useEffect(() => {
    if (!needed || remembered !== null) return;
    let cancelled = false;
    listMaps(api, projectId)
      .then((maps) => {
        if (!cancelled) setDerived({ projectId, epsg: defaultSiteEpsg(maps) });
      })
      .catch(() => {
        if (!cancelled) setDerived({ projectId, epsg: null });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, needed, remembered]);
  return remembered ?? (derived?.projectId === projectId ? derived.epsg : null);
}

/** Spec M §6: switch between the site CRS and local metres; shown only when both frames hold items. */
export function FrameSwitch() {
  const { projectId, frame } = useWorkspaceStores();
  const items = useWorkspace((s) => s.frameItems);
  const api = useApi();
  const [pending, setPending] = useState(false);
  const local = frame.kind === "local";
  const both = items !== null && items.crs > 0 && items.local > 0;

  useEffect(() => {
    if (frame.kind === "crs" && frame.epsg !== null) rememberCrsEpsg(projectId, frame.epsg);
  }, [projectId, frame.kind, frame.epsg]);
  const epsg = useCrsEpsg(projectId, local && both);

  if (!both || (local && epsg === null)) return null;

  const onSwitch = () => {
    setPending(true);
    setSiteFrame(api, projectId, local ? { kind: "crs", epsg: epsg! } : { kind: "local" })
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
