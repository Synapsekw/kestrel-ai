import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { listTemplates, type ProjectTemplate } from "./api";

export interface TemplateList {
  items: ProjectTemplate[];
  loading: boolean;
  /** Why the templates cannot be read (catalogue down, or a 501 stub); the page then offers Blank only. */
  unavailable: string | null;
  reload: () => void;
}

export function useTemplates(): TemplateList {
  const api = useApi();
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{
    tick: number;
    items: ProjectTemplate[];
    unavailable: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    listTemplates(api)
      .then((items) => {
        if (!cancelled) setState({ tick, items, unavailable: null });
      })
      .catch((e: unknown) => {
        pushLog(`project templates unavailable: ${messageOf(e, String(e))}`);
        if (!cancelled)
          setState({ tick, items: [], unavailable: messageOf(e, "the templates could not be loaded") });
      });
    return () => {
      cancelled = true;
    };
  }, [api, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return {
    items: state?.items ?? [],
    loading: state === null || state.tick !== tick,
    unavailable: state?.unavailable ?? null,
    reload,
  };
}
