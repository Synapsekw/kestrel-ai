import { useCallback } from "react";
import { useApi } from "@/api/client";
import { fetchTrainingRuns, type TrainingRun } from "@/api/trainingRuns";
import { usePagedList } from "./usePagedList";

export interface TrainingRuns {
  runs: TrainingRun[];
  loading: boolean;
  unavailable: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
  put: (run: TrainingRun) => void;
}

export function useTrainingRuns(): TrainingRuns {
  const api = useApi();
  const fetchPage = useCallback((cursor?: string) => fetchTrainingRuns(api, cursor), [api]);
  const list = usePagedList(fetchPage, "training runs");
  return { ...list, runs: list.items };
}
