import { describe, it, expect, beforeEach } from "vitest";
import type { AppEvent } from "@contract/client";
import { useChangesStore } from "./changes";

function ev(type: AppEvent["type"], payload: Record<string, unknown>): AppEvent {
  return { type, project_id: "p", job_id: "j", progress: null, message: "", payload };
}

describe("changes store", () => {
  beforeEach(() => useChangesStore.setState({ imagesRevision: 0, boxesRevision: {} }));

  it("bumps the image revision on images.changed", () => {
    useChangesStore.getState().applyEvent(ev("images.changed", { source_id: "s", count: 50 }));
    expect(useChangesStore.getState().imagesRevision).toBe(1);
  });

  it("bumps per-image box revisions and the image revision on boxes.changed", () => {
    useChangesStore.getState().applyEvent(ev("boxes.changed", { image_ids: ["a", "b"] }));
    useChangesStore.getState().applyEvent(ev("boxes.changed", { image_ids: ["a"] }));
    expect(useChangesStore.getState().boxesRevision).toEqual({ a: 2, b: 1 });
    expect(useChangesStore.getState().imagesRevision).toBe(2);
  });

  it("ignores job events and malformed payloads", () => {
    useChangesStore.getState().applyEvent(ev("job.progress", {}));
    useChangesStore.getState().applyEvent(ev("boxes.changed", {}));
    expect(useChangesStore.getState().imagesRevision).toBe(0);
    expect(useChangesStore.getState().boxesRevision).toEqual({});
  });
});

describe("data and findings revisions", () => {
  it("bumps on data.changed and findings.changed and nothing else", () => {
    useChangesStore.setState({ dataRevision: 0, findingsRevision: 0 });
    const apply = useChangesStore.getState().applyEvent;
    apply(ev("data.changed", {}));
    apply(ev("findings.changed", { ids: ["f1"] }));
    apply(ev("images.changed", {}));
    expect(useChangesStore.getState()).toMatchObject({ dataRevision: 1, findingsRevision: 1 });
  });
});

describe("images.changed and boxes.changed scoped to the open project", () => {
  beforeEach(() => useChangesStore.setState({ imagesRevision: 0, boxesRevision: {}, openProjectId: null }));

  it.each([
    { type: "images.changed" as const, payload: {} },
    { type: "boxes.changed" as const, payload: { image_ids: ["a"] } },
  ])("$type: other project ignored, same project applied, no open project applied", ({ type, payload }) => {
    const at = (project_id: string): AppEvent => ({ ...ev(type, payload), project_id });
    const s = useChangesStore.getState();

    s.setOpenProject("A");
    s.applyEvent(at("B"));
    expect(useChangesStore.getState().imagesRevision).toBe(0);

    s.applyEvent(at("A"));
    expect(useChangesStore.getState().imagesRevision).toBe(1);

    s.setOpenProject(null);
    s.applyEvent(at("B"));
    expect(useChangesStore.getState().imagesRevision).toBe(2);
  });
});

describe("map workspace events (M-W1)", () => {
  it("bumps the workspace revision on workspace, drawing and map changes, and the measurement revision", () => {
    const s = useChangesStore.getState();
    s.setOpenProject("p1");
    const ev = (type: string) =>
      ({
        type,
        project_id: "p1",
        job_id: null,
        progress: null,
        message: "",
        payload: {},
      }) as Parameters<typeof s.applyEvent>[0];
    const w0 = useChangesStore.getState().mapWorkspaceRevision;
    for (const t of ["map_workspace.changed", "drawings.changed", "maps.changed"]) s.applyEvent(ev(t));
    expect(useChangesStore.getState().mapWorkspaceRevision).toBe(w0 + 3);
    const m0 = useChangesStore.getState().mapMeasurementsRevision;
    s.applyEvent(ev("map_measurements.changed"));
    expect(useChangesStore.getState().mapMeasurementsRevision).toBe(m0 + 1);
    s.applyEvent({ ...ev("drawings.changed"), project_id: "other" });
    expect(useChangesStore.getState().mapWorkspaceRevision).toBe(w0 + 3);
  });
});
