/**
 * Where a map with no coordinates is worked on (spec §11, §14). M-X moves MapsScreen to
 * `/maps/:mapId/evaluate` and changes this one function when it adds that route (deviation 3).
 */
export function evaluateHref(projectId: string, mapId: string): string {
  return `/p/${projectId}/maps/${mapId}`;
}

export function workspaceHref(projectId: string, params: Record<string, string> = {}): string {
  const q = new URLSearchParams(params).toString();
  return `/p/${projectId}/maps${q ? `?${q}` : ""}`;
}
