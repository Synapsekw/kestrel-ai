import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChangesStore } from "@/store/changes";
import { EMPTY_LEDGER } from "@/store/changesEcho";
import { waitForFindingIds } from "./findingEvents";

const emit = (ids: string[]) =>
  useChangesStore.getState().applyEvent({
    type: "findings.changed",
    project_id: "p",
    payload: { ids },
  } as never);

describe("waitForFindingIds", () => {
  beforeEach(() =>
    useChangesStore.setState({ openProjectId: null, lastFindingIds: [], findingEchoes: EMPTY_LEDGER }),
  );
  afterEach(() => vi.useRealTimers());

  it("resolves with the ids of the next findings.changed", async () => {
    const rev = useChangesStore.getState().findingsRevision;
    const p = waitForFindingIds(rev);
    emit(["f7"]);
    await expect(p).resolves.toEqual(["f7"]);
  });

  it("gives null after the timeout", async () => {
    vi.useFakeTimers();
    const p = waitForFindingIds(useChangesStore.getState().findingsRevision, 3000);
    vi.advanceTimersByTime(3000);
    await expect(p).resolves.toBeNull();
  });

  it("an own finding write in the window does not resolve it with a stale list", async () => {
    vi.useFakeTimers();
    emit(["stale"]);
    const p = waitForFindingIds(useChangesStore.getState().findingsRevision, 3000);
    useChangesStore.getState().bumpFindings();
    vi.advanceTimersByTime(3000);
    await expect(p).resolves.toBeNull();
  });
});
