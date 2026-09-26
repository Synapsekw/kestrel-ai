import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchLibraryModels, isLibraryUnavailable, type LibraryModel, type ModelTask } from "@/api/library";
import { pushLog } from "@/app/diagnostics";

export interface LibraryModels {
  models: LibraryModel[];
  loading: boolean;
  error: string | null;
  /** 503 `library_unavailable`: the app started without its library. */
  unavailable: boolean;
  reload: () => void;
  /** Insert or update one model without a refetch (a PATCH answer, a finished import). */
  replace: (model: LibraryModel) => void;
  remove: (id: string) => void;
}

interface State {
  key: string;
  models: LibraryModel[];
  unavailable: boolean;
  error: string | null;
}

/** Every model in the app-wide library, optionally only one task (boxes or rotated boxes). */
export function useLibraryModels(task?: ModelTask): LibraryModels {
  const api = useApi();
  const [attempt, setAttempt] = useState(0);
  const key = `${task ?? ""}|${attempt}`;
  const [state, setState] = useState<State>({ key: "", models: [], unavailable: false, error: null });

  useEffect(() => {
    let cancelled = false;
    fetchLibraryModels(api, task ? { task } : {})
      .then((models) => {
        if (!cancelled) setState({ key, models, unavailable: false, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load library models failed: ${messageOf(e, String(e))}`);
        const unavailable = isLibraryUnavailable(e);
        setState({
          key,
          models: [],
          unavailable,
          error: unavailable ? null : messageOf(e, "could not load the model library"),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [api, task, key]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  const replace = useCallback(
    (model: LibraryModel) =>
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
