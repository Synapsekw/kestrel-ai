import { createStore, type StoreApi } from "zustand/vanilla";

export type RailWorkspace = "maps" | "clouds" | "models";
export const RAIL_STORAGE_PREFIX = "kestrel.rail.";

export interface RailState {
  open: boolean;
  topic: string;
  /** Opens `id`; on the topic already open, closes the panel. */
  openTopic(id: string): void;
  close(): void;
  /** `\`: closes, or reopens the last topic. */
  toggle(): void;
  /** A tool of topic `id` was armed: follow it only while the panel is open. */
  revealTopicFor(id: string | null): void;
}

function read(key: string, topics: readonly string[]): { open: boolean; topic: string } | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const { open, topic } = v as Record<string, unknown>;
    if (typeof open !== "boolean" || typeof topic !== "string" || !topics.includes(topic)) return null;
    return { open, topic };
  } catch {
    return null;
  }
}

function write(key: string, v: { open: boolean; topic: string }): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // a blocked storage only loses the remembered topic
  }
}

/** One rail's state (spec §4 "Remembered topic"); the panel starts open on the default topic. */
export function createRailStore(
  workspace: RailWorkspace,
  topics: readonly string[],
  defaultTopic: string,
): StoreApi<RailState> {
  const key = `${RAIL_STORAGE_PREFIX}${workspace}`;
  const initial = read(key, topics) ?? { open: true, topic: defaultTopic };
  return createStore<RailState>((set, get) => {
    const put = (next: { open: boolean; topic: string }) => {
      set(next);
      write(key, next);
    };
    return {
      ...initial,
      openTopic: (id) => {
        const s = get();
        put(s.open && s.topic === id ? { open: false, topic: id } : { open: true, topic: id });
      },
      close: () => put({ open: false, topic: get().topic }),
      toggle: () => put({ open: !get().open, topic: get().topic }),
      revealTopicFor: (id) => {
        const s = get();
        if (id === null || !s.open || s.topic === id) return;
        put({ open: true, topic: id });
      },
    };
  });
}
