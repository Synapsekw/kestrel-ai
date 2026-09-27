import { useEffect, useMemo, useState } from "react";
import type { LibraryModel } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchLibraryModels } from "@/api/library";
import { useProjectTypes } from "@/findings/useProjectTypes";
import { DETECT_TASKS, reachableTypes } from "./models";

/** Library models that can run here: ready, a detect/obb/segment task, and reaching a project type. */
export function useDetectModels(projectId: string): {
  models: LibraryModel[];
  loading: boolean;
  error: string | null;
} {
  const api = useApi();
  const { all } = useProjectTypes(projectId);
  const [raw, setRaw] = useState<LibraryModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchLibraryModels(api)
      .then((m) => !cancelled && setRaw(m))
      .catch((e: unknown) => !cancelled && setError(messageOf(e, "could not load the model library")));
    return () => {
      cancelled = true;
    };
  }, [api]);
  const models = useMemo(
    () =>
      (raw ?? []).filter(
        (m) => m.state === "ready" && DETECT_TASKS.has(m.task) && reachableTypes(m, all).length > 0,
      ),
    [raw, all],
  );
  return { models, loading: raw === null && error === null, error };
}
