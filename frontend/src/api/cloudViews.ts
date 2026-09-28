import type { ApiClient, CloudViewList, CloudViewMeta, CloudViewOut, components } from "@contract/client";
import { unwrap } from "./errors";
import type { ViewSubject } from "@/clouds/workspace/seams";

const P = "/api/v1/projects/{projectId}" as const;

/**
 * The metadata of every stored report view in a cloud (spec §11.4), no image bytes, at most 1 500.
 * C-R1 appends the view3d PUT wrappers to this file (controller ruling 13).
 */
export function listCloudViews(api: ApiClient, projectId: string, cloudId: string): Promise<CloudViewList> {
  return unwrap(api.GET(`${P}/pointclouds/{cloudId}/views`, { params: { path: { projectId, cloudId } } }));
}

/** The multipart body (`CloudViewUpload`): `meta` goes as a JSON Blob, which C-B4's PUTs accept. */
function viewForm(image: Blob, meta: CloudViewMeta): components["schemas"]["CloudViewUpload"] {
  const form = new FormData();
  form.append("image", image, image.type === "image/jpeg" ? "view.jpg" : "view.png");
  form.append("meta", new Blob([JSON.stringify(meta)], { type: "application/json" }));
  // openapi-fetch passes a FormData body through untouched and lets the browser set the boundary
  return form as unknown as components["schemas"]["CloudViewUpload"];
}

export function putFindingView3d(
  api: ApiClient,
  projectId: string,
  findingId: string,
  image: Blob,
  meta: CloudViewMeta,
  signal?: AbortSignal,
): Promise<CloudViewOut> {
  return unwrap(
    api.PUT("/api/v1/projects/{projectId}/findings/{findingId}/view3d", {
      params: { path: { projectId, findingId } },
      body: viewForm(image, meta),
      signal,
    }),
  );
}

export function putCloudMeasurementView3d(
  api: ApiClient,
  projectId: string,
  cloudId: string,
  cloudMeasurementId: string,
  image: Blob,
  meta: CloudViewMeta,
  signal?: AbortSignal,
): Promise<CloudViewOut> {
  return unwrap(
    api.PUT("/api/v1/projects/{projectId}/pointclouds/{cloudId}/measurements/{cloudMeasurementId}/view3d", {
      params: { path: { projectId, cloudId, cloudMeasurementId } },
      body: viewForm(image, meta),
      signal,
    }),
  );
}

/** `<img src>` for a stored view: the token in the query (images send no headers), `v` busts the cache per capture. */
export function view3dUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  cloudId: string,
  subject: ViewSubject,
  sha256: string,
): string {
  const path =
    subject.kind === "finding"
      ? `/api/v1/projects/${projectId}/findings/${subject.id}/view3d`
      : `/api/v1/projects/${projectId}/pointclouds/${cloudId}/measurements/${subject.id}/view3d`;
  const q = new URLSearchParams({ token, v: sha256 });
  return `${baseUrl.replace(/\/$/, "")}${path}?${q}`;
}
