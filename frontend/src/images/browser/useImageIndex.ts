import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@/api/client";
import { codeOf, messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { fetchImageIndex, type ImageIndexQuery, type ImageIndexResponse } from "./api";
import { filtersToIndexQuery, type BrowserFilterState } from "./filters";

/** `flags` bits (spec §7.1). */
export const FLAG_REVIEWED = 1;
export const FLAG_PENDING = 2;
export const FLAG_GPS = 4;
export const FLAG_EMPTY = 8;

/** A burst of image or finding changes re-reads the index once. */
export const INDEX_REFRESH_DEBOUNCE_MS = 800;

export interface ImageIndexData {
  total: number;
  ids: readonly string[];
  sev: readonly number[];
  count: readonly number[];
  flags: readonly number[];
  /** Always as long as `ids`; null where the image has no GPS. */
  lon: readonly (number | null)[];
  lat: readonly (number | null)[];
}

export interface ImageIndexState extends ImageIndexData {
  status: "loading" | "ready" | "error";
  error: string | null;
  /** `too_many_images` when more than 100,000 images match (spec §16). */
  errorCode: string | null;
  ordinalOf: (id: string | null) => number;
  reload: () => void;
}

export const EMPTY_INDEX: ImageIndexData = {
  total: 0,
  ids: [],
  sev: [],
  count: [],
  flags: [],
  lon: [],
  lat: [],
};

export function toIndexData(r: ImageIndexResponse): ImageIndexData {
  const n = r.ids.length;
  const nulls = (): (number | null)[] => new Array<number | null>(n).fill(null);
  return {
    total: r.total,
    ids: r.ids,
    sev: r.sev,
    count: r.count,
    flags: r.flags,
    lon: r.lon ?? nulls(),
    lat: r.lat ?? nulls(),
  };
}

interface Loaded {
  key: string;
  projectId: string;
  data: ImageIndexData;
  error: string | null;
  errorCode: string | null;
}

/**
 * Spec I-D1 / §7.1: one columnar index request per filter change feeds the grid, the filmstrip,
 * prev/next, the map dots and "N / M". Image and finding changes re-read it once per burst,
 * keeping the arrays on screen.
 */
export function useImageIndex(projectId: string, filters: BrowserFilterState): ImageIndexState {
  const api = useApi();
  const queryJson = JSON.stringify(filtersToIndexQuery(filters));
  const key = `${projectId}|${queryJson}`;
  const revision = useChangesStore((s) => `${s.imagesRevision}|${s.findingsRevision}`);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  const handledRevision = useRef(revision);

  const read = useCallback(
    (background: boolean) => {
      const mine = ++seq.current;
      const query = JSON.parse(queryJson) as ImageIndexQuery;
      fetchImageIndex(api, projectId, query).then(
        (r) => {
          if (mine === seq.current)
            setLoaded({ key, projectId, data: toIndexData(r), error: null, errorCode: null });
        },
        (e: unknown) => {
          if (mine !== seq.current) return;
          if (background) {
            pushLog(`image index refresh failed: ${messageOf(e, String(e))}`);
            return;
          }
          setLoaded({
            key,
            projectId,
            data: EMPTY_INDEX,
            error: messageOf(e, "could not load the images"),
            errorCode: codeOf(e),
          });
        },
      );
    },
    [api, projectId, key, queryJson],
  );

  // The first read, every filter change and every manual reload.
  useEffect(() => {
    read(false);
  }, [read, tick]);

  // Image or finding changes: one debounced background re-read per burst.
  useEffect(() => {
    if (revision === handledRevision.current) return;
    handledRevision.current = revision;
    const timer = window.setTimeout(() => read(true), INDEX_REFRESH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [revision, read]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  const current = loaded && loaded.key === key ? loaded : null;
  // While a new filter loads, the previous arrays of the same project stay on screen.
  const shown = current ?? (loaded && loaded.projectId === projectId && !loaded.error ? loaded : null);
  const data = shown?.data ?? EMPTY_INDEX;

  const positions = useMemo(() => {
    const m = new Map<string, number>();
    data.ids.forEach((id, i) => m.set(id, i));
    return m;
  }, [data.ids]);
  const ordinalOf = useCallback(
    (id: string | null) => (id === null ? -1 : (positions.get(id) ?? -1)),
    [positions],
  );

  return useMemo(
    () => ({
      ...data,
      status: !current ? "loading" : current.error ? "error" : "ready",
      error: current?.error ?? null,
      errorCode: current?.errorCode ?? null,
      ordinalOf,
      reload,
    }),
    [data, current, ordinalOf, reload],
  );
}
