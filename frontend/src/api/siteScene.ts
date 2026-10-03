import { useCallback, useEffect, useRef, useState } from "react";
import { assetModelGlbUrl, type ApiClient, type paths, type Schemas } from "@contract/client";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import type { SiteFrameT } from "@/site3d/engine/siteTransform";
import { useApi } from "./client";
import { codeOf, unwrap } from "./errors";

export type SiteScene = Schemas["SiteScene"];
export type SceneOrtho = SiteScene["orthos"][number];
export type SceneDrawing = SiteScene["drawings"][number];
export type SceneCloud = SiteScene["clouds"][number];
export type AssetItemPage = Schemas["AssetItemPage"];
export type AssetItemRow = Schemas["AssetItemRow"];
export type AssetItem = Schemas["AssetItem"];

const SCENE = "/api/v1/projects/{projectId}/site-scene" as const;
const ITEMS = "/api/v1/projects/{projectId}/asset-models/{assetModelId}/versions/{version}/items" as const;
const ITEM = `${ITEMS}/{itemId}` as const;
type ItemsQuery = NonNullable<paths[typeof ITEMS]["get"]["parameters"]["query"]>;
export type ItemFilters = Omit<ItemsQuery, "cursor">;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Plan ruling R1: the manifest's URLs are server-relative and token-free; this makes one fetchable. */
export function absUrl(info: { baseUrl: string; token: string }, rel: string): string {
  const base = info.baseUrl.replace(/\/$/, "");
  const sep = rel.includes("?") ? "&" : "?";
  return `${base}${rel}${sep}token=${encodeURIComponent(info.token)}`;
}

/** The one GLB URL the Site 3D view loads (ruling R-S3-19): token-bearing, for a model version. */
export function siteModelUrl(
  info: { baseUrl: string; token: string },
  projectId: string,
  modelId: string,
  version: number,
): string {
  return assetModelGlbUrl(info.baseUrl, info.token, projectId, modelId, version);
}

export function toFrameT(f: SiteScene["frame"]): SiteFrameT | null {
  if (!f) return null;
  return {
    crs: { epsg: f.crs.epsg ?? null, wkt: f.crs.wkt ?? null },
    origin_crs: [f.origin_crs[0], f.origin_crs[1]],
    plant_north_deg: f.plant_north_deg,
    datum: { label: f.datum.label, el_m: f.datum.el_m },
  };
}

export async function getSiteScene(
  api: ApiClient,
  projectId: string,
  modelId?: string | null,
): Promise<SiteScene> {
  return unwrap(
    api.GET(SCENE, { params: { path: { projectId }, query: modelId ? { modelId } : undefined } }),
  );
}

/** Register page size: well under the contract's 500-row cap, a few screens of 44 px rows. */
export const ITEMS_PAGE = 200;

/** One cursor page of a version's register; blank filters are left out, `limit` defaults to ITEMS_PAGE. */
export async function listAssetItems(
  api: ApiClient,
  projectId: string,
  assetModelId: string,
  version: number,
  filters: ItemFilters = {},
  cursor?: string | null,
  signal?: AbortSignal,
): Promise<AssetItemPage> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filters)) {
    const t = typeof v === "string" ? v.trim() : v;
    if (t !== undefined && t !== null && t !== "") clean[k] = t;
  }
  const query = {
    ...clean,
    limit: filters.limit ?? ITEMS_PAGE,
    ...(cursor ? { cursor } : {}),
  } as ItemsQuery;
  return unwrap(api.GET(ITEMS, { params: { path: { projectId, assetModelId, version }, query }, signal }));
}

export async function getAssetItem(
  api: ApiClient,
  projectId: string,
  assetModelId: string,
  version: number,
  itemId: string,
): Promise<AssetItem> {
  return unwrap(api.GET(ITEM, { params: { path: { projectId, assetModelId, version, itemId } } }));
}

/** The Site 3D manifest; reloads when a GLB build finishes (a new version may be the one shown). */
export function useSiteScene(projectId: string, modelId?: string | null) {
  const api = useApi();
  const key = `${projectId}/${modelId ?? ""}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    scene: SiteScene | null;
    error: string | null;
    code?: string | null;
  } | null>(null);
  const seq = useRef(0);
  const reload = useCallback(() => {
    // GLB jobs finishing back to back reload twice; an older answer that lands last is dropped.
    const mine = ++seq.current;
    const fresh = () => mine === seq.current;
    void getSiteScene(api, projectId, modelId).then(
      (scene) => {
        if (fresh()) setLoaded({ key, scene, error: null });
      },
      (e: unknown) => {
        if (!fresh()) return;
        setLoaded((prev) => ({
          key,
          scene: prev?.key === key ? prev.scene : null,
          error: message(e),
          code: codeOf(e),
        }));
      },
    );
  }, [api, projectId, modelId, key]);
  useEffect(reload, [reload]);
  useOnJobsFinished("asset_model_glb", reload);
  const current = loaded?.key === key ? loaded : null;
  return {
    scene: current?.scene ?? null,
    error: current?.error ?? null,
    /** The API error code (`not_found` for an unknown model id), null without an error. */
    errorCode: current?.code ?? null,
    loading: current === null,
    reload,
  };
}

/** The register rows of one version, ≤ 500 per page (index Global Constraints), appended by cursor. */
export function useAssetItems(
  projectId: string,
  modelId: string | null,
  version: number | null,
  filters: ItemFilters = {},
) {
  const api = useApi();
  const key = JSON.stringify([projectId, modelId, version, filters]);
  const inFlight = useRef<string | null>(null);
  const latest = useRef(key);
  const [state, setState] = useState<{
    key: string;
    items: AssetItemRow[];
    next: string | null;
    error: string | null;
  } | null>(null);
  const fetchPage = useCallback(
    (cursor: string | null) => {
      const [pid, mid, ver, f] = JSON.parse(key) as [string, string | null, number | null, ItemFilters];
      if (!mid || ver == null || inFlight.current === key) return;
      inFlight.current = key;
      latest.current = key;
      void listAssetItems(api, pid, mid, ver, f, cursor)
        .then(
          (page) => {
            if (latest.current !== key) return;
            setState((prev) => ({
              key,
              items: cursor && prev?.key === key ? [...prev.items, ...page.items] : page.items,
              next: page.next_cursor ?? null,
              error: null,
            }));
          },
          (e: unknown) => {
            if (latest.current !== key) return;
            setState((prev) => ({
              key,
              items: prev?.key === key ? prev.items : [],
              next: prev?.key === key ? prev.next : null,
              error: message(e),
            }));
          },
        )
        .finally(() => {
          if (inFlight.current === key) inFlight.current = null;
        });
    },
    [api, key],
  );
  useEffect(() => fetchPage(null), [fetchPage]);
  const current = state?.key === key ? state : null;
  const next = current?.next ?? null;
  const loadMore = useCallback(() => {
    if (next) fetchPage(next);
  }, [fetchPage, next]);
  const reload = useCallback(() => fetchPage(null), [fetchPage]);
  return {
    items: current ? current.items : null,
    error: current?.error ?? null,
    hasMore: Boolean(current?.next),
    loadMore,
    reload,
  };
}
