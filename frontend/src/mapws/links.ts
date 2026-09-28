/**
 * Where a map with no coordinates is worked on (spec §11, §14): `MapEvaluateScreen` at
 * `/maps/:mapId/evaluate` (M-X deviation 3).
 */
export function evaluateHref(projectId: string, mapId: string): string {
  return `/p/${projectId}/maps/${mapId}/evaluate`;
}

export function workspaceHref(projectId: string, params: Record<string, string> = {}): string {
  const q = new URLSearchParams(params).toString();
  return `/p/${projectId}/maps${q ? `?${q}` : ""}`;
}
