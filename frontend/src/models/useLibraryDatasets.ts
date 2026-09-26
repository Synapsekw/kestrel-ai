import { useCallback } from "react";
import { useApi } from "@/api/client";
import { fetchLibraryDatasets, type LibraryDataset } from "@/api/libraryDatasets";
import { usePagedList } from "./usePagedList";

export interface LibraryDatasets {
  datasets: LibraryDataset[];
  loading: boolean;
  unavailable: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
  remove: (id: string) => void;
  put: (dataset: LibraryDataset) => void;
}

export function useLibraryDatasets(): LibraryDatasets {
  const api = useApi();
  const fetchPage = useCallback((cursor?: string) => fetchLibraryDatasets(api, cursor), [api]);
  const list = usePagedList(fetchPage, "datasets");
  return { ...list, datasets: list.items };
}
