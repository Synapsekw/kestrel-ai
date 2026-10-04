import type { SiteLayer } from "./types";

/** Why a layer shows, or why it can't: the Layers panel prints it (S3). */
export type LayerStatus =
  | { kind: "loading" }
  | { kind: "ready"; note?: string }
  | { kind: "unavailable"; reason: string }
  | { kind: "error"; message: string };

export class StatusCell {
  private value: LayerStatus;
  private readonly listeners = new Set<(s: LayerStatus) => void>();

  constructor(initial: LayerStatus = { kind: "loading" }) {
    this.value = initial;
  }

  get(): LayerStatus {
    return this.value;
  }

  set(next: LayerStatus): void {
    this.value = next;
    for (const cb of [...this.listeners]) cb(next);
  }

  subscribe(cb: (s: LayerStatus) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}

export interface StatusLayer extends SiteLayer {
  readonly status: StatusCell;
}

/** One line for a layer: "shown", "hidden", a reason or an error. */
export function statusText(s: LayerStatus, visible: boolean): string {
  switch (s.kind) {
    case "loading":
      return "loading";
    case "ready":
      return [visible ? "shown" : "hidden", s.note].filter(Boolean).join(", ");
    case "unavailable":
      return s.reason;
    case "error":
      return s.message;
  }
}
