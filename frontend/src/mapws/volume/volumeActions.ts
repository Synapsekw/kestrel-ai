import type { ApiClient } from "@contract/client";
import { deleteVolume } from "@/api/volumes";

/** The Measurements view of one volume (ruling T7-1: works today; M-W6 redirects it to its volume view). */
export const volumeViewHref = (projectId: string, id: string): string => `/p/${projectId}/measurements/${id}`;

/** The inspector kind's `remove.run` (the Del key, after W1's confirm). */
export function deleteVolumeSelection(api: ApiClient, projectId: string, id: string): Promise<void> {
  return deleteVolume(api, projectId, id);
}
