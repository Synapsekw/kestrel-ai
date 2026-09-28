import type { ApiClient } from "@contract/client";
import { fetchFinding } from "@/api/findings";
import { fetchMap } from "@/api/maps";
import type { Coord, Selection, SiteFrame } from "../types";
import { planFindingArrival, planMapArrival, type ArrivalRequest } from "./arrival";

export interface ArrivalOutcome {
  navigate?: string;
  r?: string | null;
  selection?: Selection | null;
  centre?: Coord | null;
  resolution?: number | null;
  notice?: string | null;
  error?: string;
}

/** Fetches what an arrival needs (one finding, one map) and plans it; never throws. */
export async function resolveArrival(
  req: ArrivalRequest,
  ctx: {
    api: ApiClient;
    projectId: string;
    frame: SiteFrame;
    activateTool: (id: string) => boolean;
  },
): Promise<ArrivalOutcome> {
  try {
    if (req.kind === "tool") {
      ctx.activateTool(req.toolId);
      return {};
    }
    if (req.kind === "map") {
      const map = await fetchMap(ctx.api, ctx.projectId, req.mapId);
      const plan = planMapArrival({ projectId: ctx.projectId, map, at: req.at, frame: ctx.frame });
      return plan.kind === "navigate" ? { navigate: plan.to } : plan;
    }
    if (req.kind === "finding") {
      const finding = await fetchFinding(ctx.api, ctx.projectId, req.findingId);
      const a = finding.anchor;
      const own = a.kind === "map" && (req.mapId === null || req.mapId === a.map_id);
      const anchorMap =
        own && a.kind === "map" ? await fetchMap(ctx.api, ctx.projectId, a.map_id).catch(() => null) : null;
      const plan = planFindingArrival({
        projectId: ctx.projectId,
        requestedMapId: req.mapId,
        finding,
        anchorMap,
        frame: ctx.frame,
      });
      return plan.kind === "navigate" ? { navigate: plan.to } : plan;
    }
    return {};
  } catch {
    return {
      error:
        req.kind === "finding"
          ? "That finding no longer exists or could not be loaded."
          : "That map no longer exists or could not be loaded.",
    };
  }
}
