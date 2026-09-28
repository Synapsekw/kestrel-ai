import { useChangesStore } from "@/store/changes";

export const FINDING_EVENT_WAIT_MS = 3000;

/** The ids of the first `findings.changed` after `afterRevision`, or null after the timeout (R-W4-8). */
export function waitForFindingIds(
  afterRevision: number,
  timeoutMs = FINDING_EVENT_WAIT_MS,
): Promise<string[] | null> {
  return new Promise((resolve) => {
    const now = useChangesStore.getState();
    if (now.findingsRevision > afterRevision && now.lastFindingIds.length) {
      resolve(now.lastFindingIds);
      return;
    }
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, timeoutMs);
    const unsubscribe = useChangesStore.subscribe((s) => {
      if (s.findingsRevision > afterRevision && s.lastFindingIds.length) {
        clearTimeout(timer);
        unsubscribe();
        resolve(s.lastFindingIds);
      }
    });
  });
}
