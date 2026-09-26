import { useEffect, useState } from "react";

type State<T> = { key: string; data: T | null; error: string | null };

/**
 * Loads `load()` whenever `key` changes; a response for an older key is dropped. `data` keeps the
 * last good value while a new key loads, so a table does not flash empty on every refresh.
 */
export function useLoad<T>(key: string | null, load: () => Promise<T>) {
  const [state, setState] = useState<State<T>>({ key: "", data: null, error: null });
  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    load()
      .then((data) => {
        if (!cancelled) setState({ key, data, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setState((s) => ({ key, data: s.data, error: e instanceof Error ? e.message : String(e) }));
      });
    return () => {
      cancelled = true;
    };
    // `key` names everything `load` depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return {
    data: key === null ? null : state.data,
    loading: key !== null && state.key !== key,
    error: state.error,
  };
}
