import { useCallback, useEffect, useState } from "react";
import type { AssetModel, AssetModelVersion, AssetModelVersionDetail } from "@contract/client";
import { useApi } from "@/api/client";
import { getVersion, listAssetModels, listVersions } from "@/api/assetModels";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The project's asset models (one bounded list read), reloaded when a build or run job finishes. */
export function useAssetModelList(projectId: string) {
  const api = useApi();
  const [models, setModels] = useState<AssetModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    void listAssetModels(api, projectId)
      .then((ms) => {
        setModels(ms);
        setError(null);
      })
      .catch((e: unknown) => setError(message(e)));
  }, [api, projectId]);
  useEffect(reload, [reload]);
  useOnJobsFinished("asset_model_glb", reload);
  useOnJobsFinished("asset_model_run", reload);
  return { models, error, reload };
}

/**
 * One model's version list; null until loaded or while no model is selected. A failed read sets
 * `error` (keeping a list loaded before), so the Versions tab can offer a retry instead of "no versions".
 */
export function useVersions(projectId: string, modelId: string | null) {
  const api = useApi();
  // Keyed by model so a switch never shows the previous model's versions.
  const [loaded, setLoaded] = useState<{
    key: string;
    versions: AssetModelVersion[] | null;
    error: string | null;
  } | null>(null);
  const reload = useCallback(() => {
    if (!modelId) return;
    const key = `${projectId}/${modelId}`;
    void listVersions(api, projectId, modelId)
      .then((versions) => setLoaded({ key, versions, error: null }))
      .catch((e: unknown) =>
        setLoaded((prev) => ({
          key,
          versions: prev?.key === key ? prev.versions : null,
          error: message(e),
        })),
      );
  }, [api, projectId, modelId]);
  useEffect(reload, [reload]);
  useOnJobsFinished("asset_model_glb", reload);
  useOnJobsFinished("asset_model_run", reload);
  const current = modelId && loaded?.key === `${projectId}/${modelId}` ? loaded : null;
  return { versions: current?.versions ?? null, error: current?.error ?? null, reload };
}

/** One version with its spec and overlay; reloads when a build finishes. */
export function useVersionDetail(projectId: string, modelId: string | null, version: number | null) {
  const api = useApi();
  const [loaded, setLoaded] = useState<{
    key: string;
    detail: AssetModelVersionDetail | null;
    error: string | null;
  } | null>(null);
  const key = `${projectId}/${modelId}/${version}`;
  const reload = useCallback(() => {
    if (!modelId || version == null) return;
    void getVersion(api, projectId, modelId, version)
      .then((detail) => setLoaded({ key, detail, error: null }))
      .catch((e: unknown) => setLoaded({ key, detail: null, error: message(e) }));
  }, [api, projectId, modelId, version, key]);
  useEffect(reload, [reload]);
  useOnJobsFinished("asset_model_glb", reload);
  useOnJobsFinished("asset_model_run", reload);
  const current = modelId && version != null && loaded?.key === key ? loaded : null;
  return { detail: current?.detail ?? null, error: current?.error ?? null, reload };
}
