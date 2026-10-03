// src/api/assetReview.ts
// The asset review operations of spec §8 (contract by C0). Lists are keyset-paged and read a page
// at a time, at most 2,000 poses or placements and 500 findings per request (Review Focus 5).
import { useCallback, useEffect, useRef, useState } from "react";
import {
  placementLabelsUrl,
  placementMeshUrl,
  placementTextureUrl,
  type ApiClient,
  type AssetModelVersion,
  type Job,
  type components,
  type paths,
} from "@contract/client";
import type { FetchPatch } from "@/assetmodels/viewer/placements";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { useApi } from "./client";
import { messageOf, unwrap } from "./errors";
import { listFindings, type Finding, type FindingListQuery } from "./findings";

type S = components["schemas"];
export type ImagePose = S["ImagePose"];
export type Placement = S["Placement"];
export type FindingSighting = S["FindingSighting"];
export type ImageReview = S["ImageReview"];

export const POSES_PAGE = 2000;
export const PLACEMENTS_PAGE = 2000;
export const FINDINGS_PAGE = 500;
export const MAX_PAGES = 50;

const P = "/api/v1/projects/{projectId}" as const;
const M = `${P}/asset-models/{assetModelId}` as const;
const mPath = (projectId: string, assetModelId: string) => ({ projectId, assetModelId });

export interface Paged<T> {
  items: T[];
  done: boolean;
  error: string | null;
  reload(): void;
}

interface PageOf<T> {
  items: T[];
  next: string | null;
}

/**
 * Reads every page of a keyset list, one request at a time, publishing after each page so a long
 * list shows as it arrives. Stops on a null or repeated cursor (the Prism mock repeats "string"),
 * on an error (kept items stay), or after MAX_PAGES. A reload of the same list (a finished job)
 * keeps the previous answer on screen and swaps the new one in whole once it has arrived, so the
 * viewer never sees the list flash empty or shrink to page 1; a different key starts empty.
 */
function usePaged<T, Pg extends PageOf<T>>(
  key: string | null,
  fetchPage: (after: string | null) => Promise<Pg>,
): Paged<T> & { first: Pg | null } {
  const [gen, setGen] = useState(0);
  const [state, setState] = useState<{
    key: string;
    items: T[];
    done: boolean;
    error: string | null;
    first: Pg | null;
  } | null>(null);
  const fetchRef = useRef(fetchPage);
  const stateRef = useRef(state);
  useEffect(() => {
    fetchRef.current = fetchPage;
    stateRef.current = state;
  });
  useEffect(() => {
    if (key === null) return;
    let alive = true;
    const prev = stateRef.current;
    // the same list reloading: hold the previous answer until the new one is complete
    const reloading = prev !== null && prev.key === key;
    void (async () => {
      const seen = new Set<string>();
      let after: string | null = null;
      let items: T[] = [];
      let first: Pg | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        let got: Pg;
        try {
          got = await fetchRef.current(after);
        } catch (e) {
          if (!alive) return;
          const error = messageOf(e, "The list could not be loaded.");
          if (reloading) setState((s) => (s && s.key === key ? { ...s, error } : s));
          else setState({ key, items, done: true, error, first });
          return;
        }
        if (!alive) return;
        first ??= got;
        items = items.concat(got.items);
        const next = got.next;
        const end = !next || seen.has(next) || page === MAX_PAGES - 1;
        if (end || !reloading) setState({ key, items, done: end, error: null, first });
        if (end) return;
        seen.add(next);
        after = next;
      }
    })();
    return () => {
      alive = false;
    };
  }, [key, gen]);
  const reload = useCallback(() => setGen((g) => g + 1), []);
  const mine = state && state.key === key ? state : null;
  return {
    items: mine?.items ?? [],
    done: mine?.done ?? false,
    error: mine?.error ?? null,
    first: mine?.first ?? null,
    reload,
  };
}

export function usePoses(
  projectId: string,
  modelId: string | null,
  sequence: string | null = null,
): Paged<ImagePose> {
  const api = useApi();
  const paged = usePaged<ImagePose, PageOf<ImagePose>>(
    modelId ? `${projectId}/${modelId}/poses/${sequence ?? ""}` : null,
    async (after) =>
      unwrap(
        api.GET(`${M}/poses`, {
          params: {
            path: mPath(projectId, modelId ?? ""),
            query: { limit: POSES_PAGE, ...(after ? { after } : {}), ...(sequence ? { sequence } : {}) },
          },
        }),
      ),
  );
  useOnJobsFinished("asset_pose", paged.reload);
  useOnJobsFinished("review_kit_import", paged.reload);
  return paged;
}

export function usePlacements(
  projectId: string,
  modelId: string | null,
): Paged<Placement> & { version: number | null } {
  const api = useApi();
  const paged = usePaged<Placement, PageOf<Placement> & { version: number | null }>(
    modelId ? `${projectId}/${modelId}/placements` : null,
    async (after) =>
      unwrap(
        api.GET(`${M}/placements`, {
          params: {
            path: mPath(projectId, modelId ?? ""),
            query: { limit: PLACEMENTS_PAGE, ...(after ? { after } : {}) },
          },
        }),
      ),
  );
  useOnJobsFinished("asset_place", paged.reload);
  useOnJobsFinished("asset_group", paged.reload);
  useOnJobsFinished("review_kit_import", paged.reload);
  return { ...paged, version: paged.first?.version ?? null };
}

export function useAssetFindings(
  projectId: string,
  modelId: string | null,
  query: Omit<FindingListQuery, "asset_model_id" | "cursor" | "limit"> = {},
): Paged<Finding> {
  const api = useApi();
  const q = JSON.stringify(query);
  const paged = usePaged<Finding, PageOf<Finding>>(
    modelId ? `${projectId}/${modelId}/findings/${q}` : null,
    async (after) => {
      const page = await listFindings(api, projectId, {
        ...(JSON.parse(q) as FindingListQuery),
        asset_model_id: modelId ?? "",
        limit: FINDINGS_PAGE,
        ...(after ? { cursor: after } : {}),
      });
      return { items: page.items, next: page.next_cursor };
    },
  );
  useOnJobsFinished("asset_group", paged.reload);
  useOnJobsFinished("asset_place", paged.reload);
  useOnJobsFinished("review_kit_import", paged.reload);
  return paged;
}

export function useSightings(projectId: string, findingId: string | null) {
  const api = useApi();
  const [gen, setGen] = useState(0);
  const [state, setState] = useState<{
    key: string;
    sightings: FindingSighting[] | null;
    error: string | null;
  } | null>(null);
  const key = findingId ? `${projectId}/${findingId}#${gen}` : null;
  useEffect(() => {
    if (!key || !findingId) return;
    let alive = true;
    unwrap(
      api.GET(`${P}/findings/{findingId}/sightings`, { params: { path: { projectId, findingId } } }),
    ).then(
      (r) => alive && setState({ key, sightings: r.items, error: null }),
      (e: unknown) =>
        alive &&
        setState({ key, sightings: null, error: messageOf(e, "The sightings could not be loaded.") }),
    );
    return () => {
      alive = false;
    };
  }, [api, projectId, findingId, key]);
  const reload = useCallback(() => setGen((g) => g + 1), []);
  useOnJobsFinished("asset_group", reload);
  const mine = state && state.key === key ? state : null;
  return { sightings: mine?.sightings ?? null, error: mine?.error ?? null, reload };
}

export async function estimatePoses(
  api: ApiClient,
  projectId: string,
  modelId: string,
  imageIds?: string[],
): Promise<Job> {
  const r = await unwrap(
    api.POST(`${M}/poses/estimate`, {
      params: { path: mPath(projectId, modelId) },
      body: imageIds ? { image_ids: imageIds } : {},
    }),
  );
  return r.job;
}

export async function computePlacements(
  api: ApiClient,
  projectId: string,
  modelId: string,
  onlyDirty = false,
): Promise<Job> {
  const r = await unwrap(
    api.POST(`${M}/placements/compute`, {
      params: { path: mPath(projectId, modelId) },
      body: onlyDirty ? { only_dirty: true } : {},
    }),
  );
  return r.job;
}

export async function regroup(api: ApiClient, projectId: string, modelId: string): Promise<Job> {
  const r = await unwrap(api.POST(`${M}/findings/regroup`, { params: { path: mPath(projectId, modelId) } }));
  return r.job;
}

export type ImportGlbBody = NonNullable<
  paths["/api/v1/projects/{projectId}/asset-models/{assetModelId}/versions/import-glb"]["post"]["requestBody"]
>["content"]["application/json"];

export async function importGlb(
  api: ApiClient,
  projectId: string,
  modelId: string,
  body: ImportGlbBody,
): Promise<{ version: AssetModelVersion; job: Job }> {
  return unwrap(api.POST(`${M}/versions/import-glb`, { params: { path: mPath(projectId, modelId) }, body }));
}

export async function mergeFinding(
  api: ApiClient,
  projectId: string,
  findingId: string,
  into: string,
): Promise<Finding> {
  return unwrap(
    api.POST(`${P}/findings/{findingId}/merge`, {
      params: { path: { projectId, findingId } },
      body: { into },
    }),
  );
}

export async function splitFinding(
  api: ApiClient,
  projectId: string,
  findingId: string,
  sightingIds: string[],
): Promise<Finding> {
  return unwrap(
    api.POST(`${P}/findings/{findingId}/split`, {
      params: { path: { projectId, findingId } },
      body: { sighting_ids: sightingIds },
    }),
  );
}

export async function getImageReview(
  api: ApiClient,
  projectId: string,
  imageId: string,
): Promise<ImageReview> {
  return unwrap(api.GET(`${P}/images/{imageId}/review`, { params: { path: { projectId, imageId } } }));
}

export async function putImageReview(
  api: ApiClient,
  projectId: string,
  imageId: string,
  body: { status: ImageReview["status"]; note?: string },
): Promise<ImageReview> {
  return unwrap(api.PUT(`${P}/images/{imageId}/review`, { params: { path: { projectId, imageId } }, body }));
}

/** One patch's three files, fetched in parallel (token in the query, as for GLBs and image files). */
export function fetchPatchBuffers(
  backend: { baseUrl: string; token: string },
  projectId: string,
  modelId: string,
): FetchPatch {
  const get = async (url: string) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`patch ${r.status}`);
    return r;
  };
  return async (sightingId) => {
    const { baseUrl, token } = backend;
    const [mesh, texture, labels] = await Promise.all([
      get(placementMeshUrl(baseUrl, token, projectId, modelId, sightingId)).then((r) => r.arrayBuffer()),
      get(placementTextureUrl(baseUrl, token, projectId, modelId, sightingId)).then((r) => r.blob()),
      get(placementLabelsUrl(baseUrl, token, projectId, modelId, sightingId)).then((r) => r.arrayBuffer()),
    ]);
    return { mesh, texture, labels };
  };
}
