import { useChangesStore } from "./changes";
import { FINDING_ECHO_MAX_IDS } from "./changesEcho";

export interface OwnWriteOptions<T> {
  /** Runs after a successful write and before the bump, with the revision the bump will produce. */
  onSaved?: (result: T, revision: number) => void;
  /** Bump even when the write failed: a chunked bulk may have committed its earlier chunks. */
  bumpOnError?: boolean;
}

/**
 * Every finding write of this client goes through here: it registers the echo it will cause before
 * the request (the event can arrive before the answer), bumps `findingsRevision` once on success,
 * and releases the expectation on failure (rulings R8).
 */
export async function ownFindingsWrite<T>(
  ids: readonly string[],
  write: () => Promise<T>,
  opts: OwnWriteOptions<T> = {},
): Promise<T> {
  const tracked = ids.length <= FINDING_ECHO_MAX_IDS ? ids : [];
  useChangesStore.getState().expectFindingEchoes(tracked);
  let result: T;
  try {
    result = await write();
  } catch (e) {
    const s = useChangesStore.getState();
    s.releaseFindingEchoes(tracked);
    if (opts.bumpOnError) s.bumpFindings();
    throw e;
  }
  const s = useChangesStore.getState();
  // The TTL counts from the answer, not the request: a write slower than it keeps its dedupe.
  s.renewFindingEchoes(tracked);
  opts.onSaved?.(result, s.findingsRevision + 1);
  s.bumpFindings();
  return result;
}
