import type { PointCloud } from "@/api/clouds";

export const MAX_CLOUD_LINKS = 5;

/** Ruling 11: ready clouds whose WGS84 bounds [minlon, minlat, maxlon, maxlat] hold the image. */
export function cloudsContaining(
  clouds: readonly PointCloud[],
  lon: number | null,
  lat: number | null,
): PointCloud[] {
  if (lon === null || lat === null) return [];
  return clouds
    .filter((c) => {
      const b = c.bounds_wgs84;
      return c.status === "ready" && !!b && lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, MAX_CLOUD_LINKS);
}

/** C §10.4's image → cloud jump, from the frame centre in stored pixels. */
export function openIn3dHref(
  projectId: string,
  cloudId: string,
  imageId: string,
  width: number,
  height: number,
): string {
  return `/p/${projectId}/clouds/${cloudId}?from_image=${imageId}&px=${Math.round(width / 2)},${Math.round(height / 2)}`;
}
