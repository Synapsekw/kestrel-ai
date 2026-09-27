import { useEffect, useState } from "react";
import type { ApiClient } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchResultsCsv } from "@/api/library";
import { parseResultsCsv, type CurvePoint } from "@/library/resultsCsv";

export type CurveState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; points: CurvePoint[] }
  | { state: "error"; error: string };

/** Fetches and parses one model's `results.csv`; shared by `useResultsCurve` and `useResultsCurves`. */
async function loadCurve(api: ApiClient, modelId: string): Promise<CurveState> {
  try {
    const text = await fetchResultsCsv(api, modelId);
    return { state: "ready", points: parseResultsCsv(text) };
  } catch (e) {
    return { state: "error", error: messageOf(e, "this model has no training curve") };
  }
}

/** One model's `results.csv` artefact, read client-side (F §12.4). */
export function useResultsCurve(modelId: string | null): CurveState {
  const api = useApi();
  const [loaded, setLoaded] = useState<{ id: string; value: CurveState } | null>(null);
  useEffect(() => {
    if (!modelId) return;
    let cancelled = false;
    loadCurve(api, modelId).then((value) => {
      if (!cancelled) setLoaded({ id: modelId, value });
    });
    return () => {
      cancelled = true;
    };
  }, [api, modelId]);
  if (!modelId) return { state: "idle" };
  return loaded && loaded.id === modelId ? loaded.value : { state: "loading" };
}

/** Several models' curves at once (Compare, at most 4 requests). */
export function useResultsCurves(modelIds: string[]): Record<string, CurveState> {
  const api = useApi();
  const key = modelIds.join(",");
  const [loaded, setLoaded] = useState<{ key: string; curves: Record<string, CurveState> }>({
    key: "",
    curves: {},
  });
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const ids = key.split(",");
    for (const id of ids) {
      loadCurve(api, id).then((value) => {
        if (cancelled) return;
        setLoaded((s) => ({ key, curves: { ...(s.key === key ? s.curves : {}), [id]: value } }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [api, key]);
  const curves = loaded.key === key ? loaded.curves : {};
  return Object.fromEntries(modelIds.map((id) => [id, curves[id] ?? ({ state: "loading" } as CurveState)]));
}
