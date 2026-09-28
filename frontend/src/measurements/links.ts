/** The Measurements tab (R8). */
export function measurementsTabPath(projectId: string): string {
  return `/p/${projectId}/measurements`;
}

/** The kept volume view (VolumesScreen), moved under the tab (R-W6-1). */
export function volumeViewPath(projectId: string, measurementId?: string): string {
  return `/p/${projectId}/measurements/volumes${measurementId ? `/${measurementId}` : ""}`;
}

/**
 * Where a row opens (R-W6-3): a map measurement in the map workspace (M §5 `sel=<kind>:<id>`), a
 * cloud measurement in its cloud's workspace, a volume in the volume view. Unknown kinds: null.
 */
export function measurementHref(
  projectId: string,
  item: { kind: string; id: string; data_id?: string | null },
): string | null {
  const base = `/p/${projectId}`;
  switch (item.kind) {
    case "map":
      return `${base}/maps?sel=measurement:${item.id}`;
    case "cloud":
      return item.data_id ? `${base}/clouds/${item.data_id}` : `${base}/clouds`;
    case "volume":
      return volumeViewPath(projectId, item.id);
    default:
      return null;
  }
}
