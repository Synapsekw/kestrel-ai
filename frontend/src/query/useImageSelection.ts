import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchImagePage, type ListImagesQuery } from "@/api/images";
import { collectPages } from "@/api/paging";
import { pushLog } from "@/app/diagnostics";
import { imageQuery, type QueryForm } from "./queryModel";

export interface ImageSelection {
  ids: string[];
  loading: boolean;
  error: string | null;
}

interface State {
  key: string | null;
  ids: string[];
  error: string | null;
}

/** Resolves the form's image mode to image ids: the carried selection, or a listing by filter. */
export function useImageSelection(projectId: string, form: QueryForm, preloaded: string[]): ImageSelection {
  const api = useApi();
  const spec = imageQuery(form);
  const key = spec ? JSON.stringify({ projectId, ...spec }) : null;
  const cap = form.mode === "first_n" ? Number(form.firstN) || 1 : Number.POSITIVE_INFINITY;
  const [state, setState] = useState<State>({ key: null, ids: [], error: null });

  useEffect(() => {
    if (!key) return;
    const { query, maxPages } = JSON.parse(key) as { query: ListImagesQuery; maxPages: number };
    let cancelled = false;
    collectPages((cursor) => fetchImagePage(api, projectId, cursor ? { ...query, cursor } : query), maxPages)
      .then((items) => {
        if (!cancelled) setState({ key, ids: items.map((i) => i.id), error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`list images for query failed: ${messageOf(e, String(e))}`);
        setState({ key, ids: [], error: messageOf(e, "could not list the images") });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, key]);

  if (!key) return { ids: preloaded, loading: false, error: null };
  const loaded = state.key === key;
  return {
    ids: loaded ? state.ids.slice(0, cap) : [],
    loading: !loaded,
    error: loaded ? state.error : null,
  };
}
