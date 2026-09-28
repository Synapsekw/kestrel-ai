import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "@/api/client";
import { listCloudMeasurements, type CloudMeasurement } from "@/api/cloudMeasurements";
import { messageOf } from "@/api/errors";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { useChangesStore } from "@/store/changes";

/** The server's cap per cloud (S1); the list is never paged. */
export const MAX_PER_CLOUD = 1000;
export const FULL_TEXT = "1 000 of 1 000: delete one to save another";

export interface CloudMeasurements {
  items: CloudMeasurement[];
  loaded: boolean;
  error: string | null;
  selectedId: string | null;
  selected: CloudMeasurement | null;
  /** 1 000 saved: Save is refused until one is deleted. */
  full: boolean;
  select: (id: string | null) => void;
  upsert: (m: CloudMeasurement) => void;
  remove: (id: string) => void;
  reload: () => void;
}

interface Loaded {
  key: string;
  items: CloudMeasurement[];
  error: string | null;
}

const EMPTY: CloudMeasurement[] = [];

/** One cloud's saved measurements (≤ 1 000), re-read on `pointclouds.changed` and when a profile job ends. */
export function useCloudMeasurements(projectId: string, cloudId: string | null): CloudMeasurements {
  const api = useApi();
  const revision = useChangesStore((s) => s.pointcloudsRevision);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useOnJobsFinished("pointcloud_profile", reload);
  const key = `${projectId}|${cloudId ?? ""}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [selection, setSelection] = useState<{ key: string; id: string | null }>({ key: "", id: null });

  useEffect(() => {
    if (!cloudId) return;
    // A late answer for an earlier cloud or project never overwrites the current list.
    let current = true;
    listCloudMeasurements(api, projectId, cloudId)
      .then((items) => {
        if (current) setLoaded({ key, items, error: null });
      })
      .catch((e: unknown) => {
        if (current)
          setLoaded((l) => ({
            key,
            items: l?.key === key ? l.items : [],
            error: messageOf(e, "could not load the measurements"),
          }));
      });
    return () => {
      current = false;
    };
  }, [api, projectId, cloudId, key, revision, tick]);

  const mine = loaded?.key === key ? loaded : null;
  const items = mine?.items ?? EMPTY;
  const selectedId = selection.key === key ? selection.id : null;
  const selected = items.find((m) => m.id === selectedId) ?? null;
  const select = useCallback((id: string | null) => setSelection({ key, id }), [key]);
  const upsert = useCallback(
    (m: CloudMeasurement) =>
      setLoaded((l) => {
        const base = l?.key === key ? l.items : [];
        const i = base.findIndex((x) => x.id === m.id);
        return { key, error: null, items: i >= 0 ? base.map((x) => (x.id === m.id ? m : x)) : [...base, m] };
      }),
    [key],
  );
  const remove = useCallback(
    (id: string) =>
      setLoaded((l) => (l?.key === key ? { ...l, items: l.items.filter((x) => x.id !== id) } : l)),
    [key],
  );
  return useMemo(
    () => ({
      items,
      loaded: mine !== null,
      error: mine?.error ?? null,
      selectedId,
      selected,
      full: items.length >= MAX_PER_CLOUD,
      select,
      upsert,
      remove,
      reload,
    }),
    [items, mine, selectedId, selected, select, upsert, remove, reload],
  );
}
