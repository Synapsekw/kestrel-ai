import type { MapLabel, MapZone } from "@contract/client";
import type { MapLabelCreate, MapLabelUpdate } from "@/api/maps";
import type { Extent } from "./grid";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type LabelCommand =
  | { kind: "create"; id: string; body: MapLabelCreate }
  | { kind: "update"; id: string; before: MapLabelUpdate; after: MapLabelUpdate }
  | { kind: "delete"; id: string; body: MapLabelCreate };

export interface LabelApi {
  create(body: MapLabelCreate): Promise<string>;
  update(id: string, body: MapLabelUpdate): Promise<void>;
  remove(id: string): Promise<void>;
}

/**
 * Undo/redo over label edits that are already saved: every step is an API call, so nothing is
 * ever held unsaved. Re-creating a label gives it a new id; later steps that named the old id are
 * remapped so a redo chain keeps working.
 */
export class LabelHistory {
  private past: LabelCommand[] = [];
  private future: LabelCommand[] = [];

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  record(cmd: LabelCommand): void {
    this.past.push(cmd);
    this.future = [];
  }

  private remap(oldId: string, newId: string): void {
    for (const c of [...this.past, ...this.future]) if (c.id === oldId) c.id = newId;
  }

  /**
   * A create/delete pair swaps a label's id every time it crosses the recreate boundary. The
   * executed command must be part of the remap pass (it is pushed onto its destination stack
   * before `remap` runs, so its own `id` field is one of the ones rewritten), and a failed API
   * call must put the command back where it came from rather than lose it, so the history and the
   * server never disagree about what exists.
   */
  async undo(api: LabelApi): Promise<boolean> {
    const cmd = this.past.pop();
    if (!cmd) return false;
    try {
      if (cmd.kind === "create") {
        await api.remove(cmd.id);
        this.future.push(cmd);
      } else if (cmd.kind === "update") {
        await api.update(cmd.id, cmd.before);
        this.future.push(cmd);
      } else {
        const oldId = cmd.id;
        const newId = await api.create(cmd.body);
        this.future.push(cmd);
        this.remap(oldId, newId);
      }
      return true;
    } catch (err) {
      this.past.push(cmd);
      throw err;
    }
  }

  async redo(api: LabelApi): Promise<boolean> {
    const cmd = this.future.pop();
    if (!cmd) return false;
    try {
      if (cmd.kind === "create") {
        const oldId = cmd.id;
        const newId = await api.create(cmd.body);
        this.past.push(cmd);
        this.remap(oldId, newId);
      } else if (cmd.kind === "update") {
        await api.update(cmd.id, cmd.after);
        this.past.push(cmd);
      } else {
        await api.remove(cmd.id);
        this.past.push(cmd);
      }
      return true;
    } catch (err) {
      this.future.push(cmd);
      throw err;
    }
  }
}

export function pointInPolygon(x: number, y: number, poly: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function outsideZones(labels: MapLabel[], zones: MapZone[]): Set<string> {
  const out = new Set<string>();
  for (const l of labels) {
    const cx = l.x + l.w / 2;
    const cy = l.y + l.h / 2;
    if (!zones.some((z) => pointInPolygon(cx, cy, z.polygon))) out.add(l.id);
  }
  return out;
}

export function boxFromExtent(e: Extent): Box {
  const x = Math.round(e[0]);
  const y = Math.round(-e[3]);
  return { x, y, w: Math.max(1, Math.round(e[2]) - x), h: Math.max(1, Math.round(-e[1]) - y) };
}
