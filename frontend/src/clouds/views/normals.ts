/**
 * The surface normal C-P1 estimates at pick time (spec §9.1), handed to the report-view upload
 * (`cloud_view.anchor_normal`). P1 sets it before `requestViewCapture`; R1 reads it into the meta.
 * One small entry per pinned finding (≤ 500), kept for the session.
 */
const normals = new Map<string, [number, number, number]>();

export function setAnchorNormal(id: string, n: [number, number, number] | null): void {
  if (n === null) normals.delete(id);
  else normals.set(id, [n[0], n[1], n[2]]);
}

export function getAnchorNormal(id: string): [number, number, number] | null {
  const n = normals.get(id);
  return n ? [n[0], n[1], n[2]] : null;
}
