import { useCallback, useReducer, useRef } from "react";
import type { Block, BlockPage, LoadBlocks, OutlineSection } from "@/api/reports";
import { messageOf } from "@/api/errors";

export interface SectionEntry {
  etag: string;
  blocks: Block[];
  /** The previous etag's blocks, shown dimmed until the first new page arrives (Ruling 11). */
  stale: Block[] | null;
  cursor: string | null;
  done: boolean;
  status: "idle" | "loading" | "error";
  error: string | null;
}

export type SectionState = Record<string, SectionEntry>;

export type SectionAction =
  | { type: "start"; section: OutlineSection }
  | { type: "page"; key: string; etag: string; cursor: string | null; page: BlockPage }
  | { type: "fail"; key: string; etag: string; error: string }
  | { type: "retry"; key: string; etag: string };

export function freshEntry(section: OutlineSection, stale: Block[] | null = null): SectionEntry {
  return {
    etag: section.etag,
    blocks: [],
    stale,
    cursor: null,
    done: section.block_count <= 0,
    status: "idle",
    error: null,
  };
}

/** The cached entry for this etag, or a fresh one carrying the old blocks as `stale`. */
export function entryOf(state: SectionState, section: OutlineSection): SectionEntry {
  const e = state[section.key];
  if (e && e.etag === section.etag) return e;
  const previous = e ? (e.blocks.length > 0 ? e.blocks : e.stale) : null;
  return freshEntry(section, previous);
}

export function sectionsReducer(state: SectionState, a: SectionAction): SectionState {
  switch (a.type) {
    case "start": {
      const e = entryOf(state, a.section);
      if (e.status !== "idle" || e.done) return state;
      return { ...state, [a.section.key]: { ...e, status: "loading", error: null } };
    }
    case "page": {
      const e = state[a.key];
      if (!e || e.etag !== a.etag || e.cursor !== a.cursor || e.status !== "loading") return state;
      const next = a.page.next_cursor;
      const done = !next || next === a.cursor || a.page.items.length === 0;
      return {
        ...state,
        [a.key]: {
          ...e,
          blocks: [...e.blocks, ...a.page.items],
          stale: null,
          cursor: done ? e.cursor : next,
          done,
          status: "idle",
        },
      };
    }
    case "fail": {
      const e = state[a.key];
      if (!e || e.etag !== a.etag || e.status !== "loading") return state;
      return { ...state, [a.key]: { ...e, status: "error", error: a.error } };
    }
    case "retry": {
      const e = state[a.key];
      if (!e || e.etag !== a.etag || e.status !== "error") return state;
      return { ...state, [a.key]: { ...e, status: "idle", error: null } };
    }
  }
}

/** Blocks per section, keyed by etag; `request` asks for the next page when a section is near. */
export function useSectionBlocks(loadBlocks: LoadBlocks) {
  const [state, dispatch] = useReducer(sectionsReducer, {});
  // `latest` is advanced by every action as it is sent, never synced from `state` in an effect: a
  // section's effect (a child) runs before this hook's effects (the parent), so a request made as a
  // page lands would see the old entry, and a sync would roll back a "start" made in the same commit.
  const latest = useRef(state);
  const send = useCallback((a: SectionAction) => {
    latest.current = sectionsReducer(latest.current, a);
    dispatch(a);
  }, []);

  const request = useCallback(
    (section: OutlineSection) => {
      const e = entryOf(latest.current, section);
      if (e.status !== "idle" || e.done) return;
      // Marked synchronously, so a second call in the same tick is a no-op.
      send({ type: "start", section });
      const { key, etag } = section;
      const cursor = e.cursor;
      loadBlocks(key, cursor).then(
        (page) => send({ type: "page", key, etag, cursor, page }),
        (err: unknown) =>
          send({ type: "fail", key, etag, error: messageOf(err, "could not load this section") }),
      );
    },
    [loadBlocks, send],
  );

  const retry = useCallback(
    (section: OutlineSection) => send({ type: "retry", key: section.key, etag: section.etag }),
    [send],
  );

  const get = useCallback((section: OutlineSection) => entryOf(state, section), [state]);
  return { entryOf: get, request, retry };
}
