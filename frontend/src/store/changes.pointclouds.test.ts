import { beforeEach, describe, expect, it } from "vitest";
import type { AppEvent } from "@contract/client";
import { useChangesStore } from "./changes";

const event = (project_id: string) =>
  ({
    type: "pointclouds.changed",
    project_id,
    job_id: null,
    progress: null,
    message: "",
    payload: { cloud_ids: ["c1"] },
  }) as unknown as AppEvent;

describe("pointclouds.changed (C-W1, controller ruling)", () => {
  beforeEach(() =>
    useChangesStore.setState({ pointcloudsRevision: 0, imagesRevision: 0, openProjectId: null }),
  );

  it("bumps its own revision and nothing else", () => {
    useChangesStore.getState().applyEvent(event("p"));
    expect(useChangesStore.getState().pointcloudsRevision).toBe(1);
    expect(useChangesStore.getState().imagesRevision).toBe(0);
  });

  it("is ignored while another project is open", () => {
    useChangesStore.getState().setOpenProject("a");
    useChangesStore.getState().applyEvent(event("b"));
    expect(useChangesStore.getState().pointcloudsRevision).toBe(0);
    useChangesStore.getState().applyEvent(event("a"));
    expect(useChangesStore.getState().pointcloudsRevision).toBe(1);
  });
});
