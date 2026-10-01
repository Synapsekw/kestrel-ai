import type { ApiClient, Job, components } from "@contract/client";
import { codeOf, unwrap } from "@/api/errors";
import { fetchJob } from "@/api/jobs";
import { LIBRARY_JOBS } from "@/api/library";

type S = components["schemas"];
export type ProjectTemplate = S["ProjectTemplate"];
export type TemplateConfig = S["TemplateConfig"];
export type TemplateSlot = S["TemplateSlot"];
export type SlotRoute = TemplateSlot["route"];
export type SlotMatch = NonNullable<TemplateSlot["match"]>;
export type CatalogueTypeSpec = S["CatalogueTypeSpec"];
export type SeverityRule = NonNullable<CatalogueTypeSpec["severity_rules"]>[number];
export type ProjectTemplateCreate = S["ProjectTemplateCreate"];
export type ProjectTemplatePatch = S["ProjectTemplatePatch"];
export type EnsureTypesRequest = S["EnsureTypesRequest"];
export type EnsureTypesResult = S["EnsureTypesResult"];
export type EnsuredType = S["EnsuredType"];
export type TypeConflict = NonNullable<EnsuredType["conflict"]>;
export type SetupInspectRequest = S["SetupInspectRequest"];
export type InspectBucket = S["InspectBucket"];
export type InspectNotRecognised = S["InspectNotRecognised"];
export type InspectResult = S["InspectResult"];

/** Built-ins first, then by name (the server's order). 503 `catalogue_unavailable` when the catalogue is down. */
export async function listTemplates(api: ApiClient): Promise<ProjectTemplate[]> {
  const page = await unwrap(api.GET("/api/v1/project-templates"));
  return page.items;
}

export function createTemplate(api: ApiClient, body: ProjectTemplateCreate): Promise<ProjectTemplate> {
  return unwrap(api.POST("/api/v1/project-templates", { body }));
}

export function patchTemplate(
  api: ApiClient,
  templateId: string,
  body: ProjectTemplatePatch,
): Promise<ProjectTemplate> {
  return unwrap(
    api.PATCH("/api/v1/project-templates/{templateId}", { params: { path: { templateId } }, body }),
  );
}

export async function deleteTemplate(api: ApiClient, templateId: string): Promise<void> {
  await unwrap(api.DELETE("/api/v1/project-templates/{templateId}", { params: { path: { templateId } } }));
}

/** Resolves type names against the Catalogue (spec §6); `dry_run: true` writes nothing. */
export function ensureTypes(api: ApiClient, body: EnsureTypesRequest): Promise<EnsureTypesResult> {
  return unwrap(api.POST("/api/v1/catalogue/types/ensure", { body }));
}

/** Starts `setup_inspect` on the library runner (S-R3); the job is read through `GET /library/jobs/{id}`. */
export async function startInspect(api: ApiClient, body: SetupInspectRequest): Promise<Job> {
  const ref = await unwrap(api.POST("/api/v1/setup/inspect", { body }));
  return ref.job;
}

/** The `InspectResult` of a finished sort; null while it runs, for another job type, or for a malformed result. */
export function inspectResultOf(job: Job): InspectResult | null {
  if (job.type !== "setup_inspect" || job.state !== "succeeded" || !job.result) return null;
  const r = job.result as unknown as Partial<InspectResult>;
  if (!Array.isArray(r.buckets) || !r.not_recognised) return null;
  return r as InspectResult;
}

export async function readInspectJob(
  api: ApiClient,
  jobId: string,
): Promise<{ job: Job; result: InspectResult | null }> {
  const job = await fetchJob(api, LIBRARY_JOBS, jobId);
  return { job, result: inspectResultOf(job) };
}

export const isTemplateNameTaken = (err: unknown): boolean => codeOf(err) === "template_name_taken";
export const isTemplateBuiltin = (err: unknown): boolean => codeOf(err) === "template_builtin";
