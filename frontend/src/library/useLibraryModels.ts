import { useCallback, useEffect, useState } from "react";
import type { Model } from "@contract/client";
import { useApi } from "@/api/client";
import { isNotImplemented, messageOf } from "@/api/errors";
import { fetchAllModels } from "@/api/models";
import { pushLog } from "@/app/diagnostics";

export interface ModelsList {
  models: Model[];
  loading: boolean;
  /** 501 from the backend: the registry arrives with S3. */
  unavailable: boolean;
  error: string | null;
  reload: () => void;
  replace: (model: Model) => void;
  remove: (id: string) => void;
}

interface State {
  key: string;
  models: Model[];
  unavailable: boolean;
  error: string | null;
}

export function useModels(projectId: string): ModelsList {
  const api = useApi();
  const [attempt, setAttempt] = useState(0);
  const key = `${projectId}|${attempt}`;
  const [state, setState] = useState<State>({ key: "", models: [], unavailable: false, error: null });

  useEffect(() => {
    let cancelled = false;
    fetchAllModels(api, projectId)
      .then((models) => {
        if (!cancelled) setState({ key, models, unavailable: false, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load models failed: ${messageOf(e, String(e))}`);
        const unavailable = isNotImplemented(e);
        setState({
          key,
          models: [],
          unavailable,
          error: unavailable ? null : messageOf(e, "could not load the model registry"),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, key]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  const replace = useCallback(
    (model: Model) =>
      setState((s) => ({
        ...s,
        models: s.models.some((m) => m.id === model.id)
          ? s.models.map((m) => (m.id === model.id ? model : m))
          : [model, ...s.models],
      })),
    [],
  );
  const remove = useCallback(
    (id: string) => setState((s) => ({ ...s, models: s.models.filter((m) => m.id !== id) })),
    [],
  );

  const loaded = state.key === key;
  return {
    models: state.models,
    loading: !loaded,
    unavailable: loaded && state.unavailable,
    error: loaded ? state.error : null,
    reload,
    replace,
    remove,
  };
}
