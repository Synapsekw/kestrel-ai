/** "1,284 images" / "1 image": a thousands-grouped count plus its singular or plural noun.
 * Shared by the Projects list chips (`screens/projects/projectCards.ts`) and the Overview
 * KPI chips (`overview/kpis.ts`) so the formatting rule lives in one place (F17). */
export function countLabel(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}
