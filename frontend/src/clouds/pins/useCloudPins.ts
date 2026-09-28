import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CloudViewOut } from "@contract/client";
import { useApi } from "@/api/client";
import { listCloudPins, pinCapNote, type PinPage } from "@/api/cloudFindings";
import { listCloudViews } from "@/api/cloudViews";
import { messageOf } from "@/api/errors";
import type { Finding } from "@/api/findings";
import { pushLog } from "@/app/diagnostics";
import type { Vec3 } from "@/clouds/viewer/types";
import { getAnchorNormal } from "@/clouds/views/normals";
import { useChangesStore } from "@/store/changes";
import type { CloudPin } from "./types";

export const REFETCH_DEBOUNCE_MS = 300;

export interface CloudPinsState {
  pins: CloudPin[];
  views: ReadonlyMap<string, CloudViewOut>;
  total: number;
  capNote: string | null;
  status: "loading" | "ready" | "error";
  error: string | null;
  reload: () => void;
}

const asVec3 = (v: readonly number[] | null | undefined): Vec3 | null =>
  v && v.length === 3 && v.every(Number.isFinite) ? [v[0], v[1], v[2]] : null;

/**
 * Ruling 3 / T3-2: the normal recorded this session first (`getAnchorNormal`); otherwise the
 * listed view's `anchor_normal`, but only while that view is not stale (a stale view's normal may
 * belong to an old anchor position); otherwise null. A null normal is never dimmed by the facing
 * test (spec §9.1).
 */
export function toCloudPin(f: Finding, view: CloudViewOut | undefined): CloudPin | null {
  const a = f.anchor;
  if (a.kind !== "cloud") return null;
  return {
    id: f.id,
    number: f.number,
    typeId: f.type_id,
    severity: f.severity,
    status: f.status,
    note: f.note,
    p: [a.x, a.y, a.z],
    u: a.uncertainty_m,
    normal: getAnchorNormal(f.id) ?? (view && !view.stale ? asVec3(view.anchor_normal) : null),
  };
}

interface Loaded {
  key: string;
  page: PinPage;
  views: ReadonlyMap<string, CloudViewOut>;
  error: string | null;
}

const EMPTY_VIEWS: ReadonlyMap<string, CloudViewOut> = new Map();
const EMPTY: CloudPin[] = [];

/** Spec §9.2 "Data": the pins and the views of one cloud, refetched on `findings.changed` and `pointclouds.changed`. */
export function useCloudPins(projectId: string, cloudId: string | null): CloudPinsState {
  const api = useApi();
  const findingsRevision = useChangesStore((s) => s.findingsRevision);
  const pointcloudsRevision = useChangesStore((s) => s.pointcloudsRevision);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tick, setTick] = useState(0);
  const key = `${projectId}|${cloudId ?? ""}`;
  const loadedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!cloudId) return;
    let cancelled = false;
    const first = loadedKey.current !== key;
    const run = () => {
      Promise.all([
        listCloudPins(api, projectId, cloudId),
        listCloudViews(api, projectId, cloudId).catch((e: unknown) => {
          pushLog(`cloud views failed: ${messageOf(e, String(e))}`);
          return { items: [] as CloudViewOut[] };
        }),
      ])
        .then(([page, views]) => {
          if (cancelled) return;
          loadedKey.current = key;
          const byFinding = new Map<string, CloudViewOut>();
          for (const v of views.items) if (v.subject_kind === "finding") byFinding.set(v.subject_id, v);
          setLoaded({ key, page, views: byFinding, error: null });
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          loadedKey.current = key;
          setLoaded({
            key,
            page: { items: [], total: 0, totalIsFloor: false },
            views: EMPTY_VIEWS,
            error: messageOf(e, "could not load the findings"),
          });
        });
    };
    const timer = window.setTimeout(run, first ? 0 : REFETCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api, projectId, cloudId, key, findingsRevision, pointcloudsRevision, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const current = loaded && loaded.key === key ? loaded : null;
  const pins = useMemo(
    () =>
      current
        ? current.page.items.flatMap((f) => {
            const p = toCloudPin(f, current.views.get(f.id));
            return p ? [p] : [];
          })
        : EMPTY,
    [current],
  );
  return {
    pins: cloudId ? pins : EMPTY,
    views: current?.views ?? EMPTY_VIEWS,
    total: current?.page.total ?? 0,
    capNote: current ? pinCapNote(current.page) : null,
    status: !cloudId ? "ready" : !current ? "loading" : current.error ? "error" : "ready",
    error: current?.error ?? null,
    reload,
  };
}
