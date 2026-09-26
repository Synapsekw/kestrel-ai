import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/api/client";
import {
  fetchCatalogue,
  isCatalogueUnavailable,
  unavailableFolder,
  type CatalogueType,
} from "@/api/catalogue";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";

export interface Catalogue {
  types: CatalogueType[];
  needsClassification: boolean;
  /** True only until the first answer; a reload keeps showing the last list. */
  loading: boolean;
  /** 503 `catalogue_unavailable` (F §15). */
  unavailable: boolean;
  folder: string | null;
  error: string | null;
  reload: () => void;
  /** Shows a saved or created type at once; the `catalogue.changed` reload confirms it. */
  put: (type: CatalogueType) => void;
}

interface State {
  key: string;
  types: CatalogueType[];
  needsClassification: boolean;
  unavailable: boolean;
  folder: string | null;
  error: string | null;
}

const INITIAL: State = {
  key: "",
  types: [],
  needsClassification: false,
  unavailable: false,
  folder: null,
  error: null,
};

/** The app-wide catalogue, reloaded on every `catalogue.changed` event. */
export function useCatalogue(): Catalogue {
  const api = useApi();
  const revision = useChangesStore((s) => s.catalogueRevision);
  const [attempt, setAttempt] = useState(0);
  const key = `${revision}|${attempt}`;
  const [state, setState] = useState<State>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    fetchCatalogue(api)
      .then((list) => {
        if (cancelled) return;
        setState({
          key,
          types: list.types,
          needsClassification: list.needsClassification,
          unavailable: false,
          folder: null,
          error: null,
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load catalogue failed: ${messageOf(e, String(e))}`);
        const unavailable = isCatalogueUnavailable(e);
        setState((s) => ({
          key,
          types: unavailable ? [] : s.types,
          needsClassification: false,
          unavailable,
          folder: unavailableFolder(e),
          error: unavailable ? null : messageOf(e, "could not load the catalogue"),
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [api, key]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  const put = useCallback(
    (type: CatalogueType) =>
      setState((s) => ({
        ...s,
        types: s.types.some((t) => t.id === type.id)
          ? s.types.map((t) => (t.id === type.id ? type : t))
          : [...s.types, type],
      })),
    [],
  );

  return {
    types: state.types,
    needsClassification: state.needsClassification,
    loading: state.key === "",
    unavailable: state.unavailable,
    folder: state.folder,
    error: state.error,
    reload,
    put,
  };
}
