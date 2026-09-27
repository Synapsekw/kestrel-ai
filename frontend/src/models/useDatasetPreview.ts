import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import {
  previewDataset,
  type DatasetFilter,
  type DatasetPreview,
  type DatasetTask,
} from "@/api/libraryDatasets";
import { pushLog } from "@/app/diagnostics";

export const PREVIEW_DEBOUNCE_MS = 400;

interface State {
  key: string;
  preview: DatasetPreview | null;
  error: string | null;
}

/**
 * The builder's live counts (F §12.2 step 1): COUNT queries on the server, asked once the filter
 * and the task have been still for 400 ms. An answer for an older filter is dropped (Review Focus 2).
 */
export function useDatasetPreview(
  filter: DatasetFilter | null,
  task: DatasetTask,
): {
  preview: DatasetPreview | null;
  loading: boolean;
  error: string | null;
} {
  const api = useApi();
  const key = filter ? JSON.stringify({ filter, task }) : "";
  const [state, setState] = useState<State>({ key: "", preview: null, error: null });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const current = JSON.parse(key) as { filter: DatasetFilter; task: DatasetTask };
    const timer = window.setTimeout(() => {
      previewDataset(api, current.filter, current.task)
        .then((preview) => {
          if (!cancelled) setState({ key, preview, error: null });
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          pushLog(`dataset preview failed: ${messageOf(e, String(e))}`);
          setState({ key, preview: null, error: messageOf(e, "could not count the images") });
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api, key]);

  if (!key) return { preview: null, loading: false, error: null };
  const answered = state.key === key;
  return {
    preview: answered ? state.preview : null,
    loading: !answered,
    error: answered ? state.error : null,
  };
}
