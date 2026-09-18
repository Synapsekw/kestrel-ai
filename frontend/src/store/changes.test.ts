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
