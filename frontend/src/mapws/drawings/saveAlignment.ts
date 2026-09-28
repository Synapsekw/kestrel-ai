import type { ApiClient } from "@contract/client";
import { putDrawingGeoref, type Drawing } from "@/api/drawings";
import type { AlignSession } from "../georef/alignModel";
import { useAlignStore } from "../georef/alignStore";
import { useDrawingsStore } from "./drawingsStore";

/** "Save placement": the server refits (authoritative), bumps georef_version and returns the drawing. */
export async function saveAlignment(api: ApiClient, projectId: string, s: AlignSession): Promise<Drawing> {
  const d = await putDrawingGeoref(api, projectId, s.drawingId, {
    model: s.model,
    points: s.pairs.map((p) => ({ id: p.id, src: p.src, dst: p.dst })),
    dst_frame: "site",
  });
  useDrawingsStore.getState().upsert(d);
  useAlignStore.getState().endFor(s.drawingId);
  return d;
}
