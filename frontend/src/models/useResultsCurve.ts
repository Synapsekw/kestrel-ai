import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchResultsCsv } from "@/api/library";
import { parseResultsCsv, type CurvePoint } from "@/library/resultsCsv";

export type CurveState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; points: CurvePoint[] }
  | { state: "error"; error: string };

/** One model's `results.csv` artefact, read client-side (F §12.4). */
export function useResultsCurve(modelId: string | null): CurveState {
  const api = useApi();
  const [loaded, setLoaded] = useState<{ id: string; value: CurveState } | null>(null);
  useEffect(() => {
    if (!modelId) return;
    let cancelled = false;
    fetchResultsCsv(api, modelId)
      .then((text) => {
        if (!cancelled) setLoaded({ id: modelId, value: { state: "ready", points: parseResultsCsv(text) } });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setLoaded({
            id: modelId,
            value: { state: "error", error: messageOf(e, "this model has no training curve") },
          });
      });
    return () => {
      cancelled = true;
    };
  }, [api, modelId]);
  if (!modelId) return { state: "idle" };
  return loaded && loaded.id === modelId ? loaded.value : { state: "loading" };
}
