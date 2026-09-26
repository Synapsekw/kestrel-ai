import type { ApiClient, components } from "@contract/client";
import { unwrap } from "./errors";

type S = components["schemas"];
export type DesignInspection = S["DesignInspection"];
export type DesignCandidate = S["DesignCandidate"];
export type DesignImportOptions = S["DesignImportOptions"];
export type DesignPreview = S["DesignPreview"];
export type DesignWarning = S["DesignWarning"];
export type DesignSuggestion = S["DesignSuggestion"];
export type LinearUnit = S["LinearUnit"];
export type Surface = S["Surface"];
export type DesignInspectionWithJob = S["DesignInspectionWithJob"];
export type DesignPreviewWithJob = S["DesignPreviewWithJob"];
export type SurfaceWithJob = S["SurfaceWithJob"];
export type DesignSurfaceCreate = S["DesignSurfaceCreate"];

const P = "/api/v1/projects/{projectId}" as const;

export function createDesignInspection(
  api: ApiClient,
  projectId: string,
  path: string,
): Promise<DesignInspectionWithJob> {
  return unwrap(api.POST(`${P}/design-inspections`, { params: { path: { projectId } }, body: { path } }));
}

export function getDesignInspection(
  api: ApiClient,
  projectId: string,
  inspectionId: string,
): Promise<DesignInspection> {
  return unwrap(
    api.GET(`${P}/design-inspections/{inspectionId}`, { params: { path: { projectId, inspectionId } } }),
  );
}

export async function deleteDesignInspection(
  api: ApiClient,
  projectId: string,
  inspectionId: string,
): Promise<void> {
  await unwrap(
    api.DELETE(`${P}/design-inspections/{inspectionId}`, { params: { path: { projectId, inspectionId } } }),
  );
}

export function createDesignPreview(
  api: ApiClient,
  projectId: string,
  inspectionId: string,
  body: DesignImportOptions,
): Promise<DesignPreviewWithJob> {
  return unwrap(
    api.POST(`${P}/design-inspections/{inspectionId}/previews`, {
      params: { path: { projectId, inspectionId } },
      body,
    }),
  );
}

export function getDesignPreview(
  api: ApiClient,
  projectId: string,
  inspectionId: string,
  previewId: string,
): Promise<DesignPreview> {
  return unwrap(
    api.GET(`${P}/design-inspections/{inspectionId}/previews/{previewId}`, {
      params: { path: { projectId, inspectionId, previewId } },
    }),
  );
}

export function createDesignSurface(
  api: ApiClient,
  projectId: string,
  body: DesignSurfaceCreate,
): Promise<SurfaceWithJob> {
  return unwrap(api.POST(`${P}/design-surfaces`, { params: { path: { projectId } }, body }));
}

/** Ready cloud surfaces: the targets a design can be aligned to. */
export async function listTargetSurfaces(api: ApiClient, projectId: string): Promise<Surface[]> {
  const items = (await unwrap(api.GET(`${P}/surfaces`, { params: { path: { projectId } } }))).items;
  return items.filter((s) => s.kind === "cloud_dsm" && s.status === "ready");
}

function root(baseUrl: string, projectId: string, inspectionId: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/v1/projects/${projectId}/design-inspections/${inspectionId}`;
}

export function designThumbnailUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  inspectionId: string,
  candidateId: string,
): string {
  return `${root(baseUrl, projectId, inspectionId)}/candidates/${candidateId}/thumbnail?${new URLSearchParams({ token })}`;
}

export function designPreviewImageUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  inspectionId: string,
  previewId: string,
): string {
  return `${root(baseUrl, projectId, inspectionId)}/previews/${previewId}/image?${new URLSearchParams({ token })}`;
}
