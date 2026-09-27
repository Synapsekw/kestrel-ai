import { beforeEach, describe, expect, it } from "vitest";
import type { AppEvent } from "@contract/client";
import { useChangesStore } from "./changes";

const event = (type: string, payload: Record<string, unknown>, project_id = "p") =>
  ({ type, project_id, job_id: null, progress: null, message: "", payload }) as unknown as AppEvent;

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

describe("surfaces.changed and volumes.changed scoped to the open project", () => {
  beforeEach(() =>
    useChangesStore.setState({ surfacesRevision: 0, volumesRevision: 0, openProjectId: null }),
  );

  it.each([
    {
      type: "surfaces.changed" as const,
      payload: { surface_ids: ["s1"] },
      read: (s: ReturnType<typeof useChangesStore.getState>) => s.surfacesRevision,
    },
    {
      type: "volumes.changed" as const,
      payload: { measurement_ids: ["v1"] },
      read: (s: ReturnType<typeof useChangesStore.getState>) => s.volumesRevision,
    },
  ])(
    "$type: other project ignored, same project applied, no open project applied",
    ({ type, payload, read }) => {
      const at = (project_id: string): AppEvent => event(type, payload, project_id);
      const s = useChangesStore.getState();

      s.setOpenProject("A");
      s.applyEvent(at("B"));
      expect(read(useChangesStore.getState())).toBe(0);

      s.applyEvent(at("A"));
      expect(read(useChangesStore.getState())).toBe(1);

      s.setOpenProject(null);
      s.applyEvent(at("B"));
      expect(read(useChangesStore.getState())).toBe(2);
    },
  );
});
