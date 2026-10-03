import type { ApiClient, Job, components } from "@contract/client";
import { ApiFailure, codeOf, unwrap } from "./errors";

type S = components["schemas"];
export type CatalogueType = S["CatalogueType"];
export type CatalogueTypeCreate = S["CatalogueTypeCreate"];
export type CatalogueTypePatch = S["CatalogueTypePatch"];
export type CatalogueTypeUpdated = S["CatalogueTypeUpdated"];
export type SeverityLevel = S["SeverityLevel"];
export type TypeKind = CatalogueType["kind"];
export type SeverityRule = S["SeverityRule"];

export const CATALOGUE_PAGE = 500;
const MAX_PAGES = 50;

export interface CatalogueList {
  types: CatalogueType[];
  /** `catalogue_meta.needs_classification`: set by migration until the operator says Done (§7.5). */
  needsClassification: boolean;
}

/**
 * Every type, archived ones included (they still render everywhere, §7.2). Follows `next_cursor`,
 * stopping on a repeated cursor (the Prism mock repeats one forever) or after 50 pages.
 */
export async function fetchCatalogue(api: ApiClient): Promise<CatalogueList> {
  const byId = new Map<string, CatalogueType>();
  const seen = new Set<string>();
  let cursor: string | undefined;
  let needsClassification = false;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const r = await unwrap(
      api.GET("/api/v1/catalogue/types", {
        params: {
          query: { include_archived: true, limit: CATALOGUE_PAGE, ...(cursor ? { cursor } : {}) },
        },
      }),
    );
    // C0's optional `CatalogueTypePage.needs_classification` (absent means false; plan decision 1).
    if (page === 0) needsClassification = r.needs_classification ?? false;
    for (const t of r.items) if (!byId.has(t.id)) byId.set(t.id, t);
    const next = r.next_cursor;
    if (!next || seen.has(next)) break;
    seen.add(next);
    cursor = next;
  }
  return { types: [...byId.values()], needsClassification };
}

export function createCatalogueType(api: ApiClient, body: CatalogueTypeCreate): Promise<CatalogueType> {
  return unwrap(api.POST("/api/v1/catalogue/types", { body }));
}

export function fetchCatalogueType(api: ApiClient, typeId: string): Promise<CatalogueType> {
  return unwrap(api.GET("/api/v1/catalogue/types/{typeId}", { params: { path: { typeId } } }));
}

/** An object → defect change answers `backfill_candidates: true` (§7.2). */
export function patchCatalogueType(
  api: ApiClient,
  typeId: string,
  body: CatalogueTypePatch,
): Promise<CatalogueTypeUpdated> {
  return unwrap(api.PATCH("/api/v1/catalogue/types/{typeId}", { params: { path: { typeId } }, body }));
}

/** 202: a `findings_backfill` library job over the recent projects (§7.2). */
export async function startBackfill(api: ApiClient, typeId: string): Promise<Job> {
  const r = await unwrap(
    api.POST("/api/v1/catalogue/types/{typeId}/backfill", { params: { path: { typeId } } }),
  );
  return r.job;
}

export async function fetchSeverityScale(api: ApiClient): Promise<SeverityLevel[]> {
  const r = await unwrap(api.GET("/api/v1/catalogue/severity"));
  return r.levels;
}

/** Replaces the whole scale; removing a level still in use answers 409 `severity_in_use`. */
export async function saveSeverityScale(api: ApiClient, levels: SeverityLevel[]): Promise<SeverityLevel[]> {
  const r = await unwrap(api.PUT("/api/v1/catalogue/severity", { body: { levels } }));
  return r.levels;
}

/** Clears the migrated-types banner (plan decision 1). */
export async function finishClassification(api: ApiClient): Promise<void> {
  await unwrap<unknown>(api.POST("/api/v1/catalogue/classification/done"));
}

/** 503 `catalogue_unavailable`: the app started without `catalogue.db` (F §15). */
export function isCatalogueUnavailable(err: unknown): boolean {
  return codeOf(err) === "catalogue_unavailable";
}

export function unavailableFolder(err: unknown): string | null {
  return err instanceof ApiFailure && typeof err.details.folder === "string" ? err.details.folder : null;
}

/** 409 `type_exists` carries the id of the type that already has this name (BC: `details.type_id`). */
export function existingTypeId(err: unknown): string | null {
  if (!(err instanceof ApiFailure) || err.code !== "type_exists") return null;
  const id = err.details.type_id;
  return typeof id === "string" ? id : null;
}

export function isHotkeyConflict(err: unknown): boolean {
  return codeOf(err) === "hotkey_conflict";
}

/** 422 `invalid_severity_rule`: a rule names a level that is not on the scale, or there are more than 8 (S1 §5). */
export function isInvalidSeverityRule(err: unknown): boolean {
  return codeOf(err) === "invalid_severity_rule";
}

/** 409 `job_running`: a backfill of this type is already queued or running (controller ruling P13). */
export function isBackfillRunning(err: unknown): boolean {
  return codeOf(err) === "job_running";
}

/** BC's `details.job_id` on a `job_running` 409, when it carries one. */
export function backfillRunningJobId(err: unknown): string | null {
  if (!(err instanceof ApiFailure) || err.code !== "job_running") return null;
  const id = err.details.job_id;
  return typeof id === "string" ? id : null;
}

export interface SeverityInUse {
  level: number;
  projects: string[];
}

export function severityInUse(err: unknown): SeverityInUse | null {
  if (!(err instanceof ApiFailure) || err.code !== "severity_in_use") return null;
  const { level, projects } = err.details;
  if (typeof level !== "number") return null;
  const names = Array.isArray(projects) ? projects.filter((p): p is string => typeof p === "string") : [];
  return { level, projects: names };
}
