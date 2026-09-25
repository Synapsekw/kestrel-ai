import { describe, expect, it } from "vitest";
import type { AppEvent } from "@contract/client";
import { useChangesStore } from "./changes";

const event = (type: string, payload: Record<string, unknown>) =>
  ({ type, project_id: "p", job_id: null, progress: null, message: "", payload }) as unknown as AppEvent;

describe("surfaces.changed and volumes.changed", () => {
  it("bump their own revisions and nothing else", () => {
    const before = useChangesStore.getState();
    useChangesStore.getState().applyEvent(event("surfaces.changed", { surface_ids: ["s1"] }));
    useChangesStore.getState().applyEvent(event("volumes.changed", { measurement_ids: ["v1"] }));
    const after = useChangesStore.getState();
    expect(after.surfacesRevision).toBe(before.surfacesRevision + 1);
    expect(after.volumesRevision).toBe(before.volumesRevision + 1);
    expect(after.imagesRevision).toBe(before.imagesRevision);
  });
});
