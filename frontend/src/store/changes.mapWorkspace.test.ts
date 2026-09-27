import { beforeEach, describe, expect, it } from "vitest";
import type { AppEvent } from "@contract/client";
import { useChangesStore } from "./changes";

const ev = (payload: Record<string, unknown>): AppEvent =>
  ({ type: "map_workspace.changed", project_id: "p1", payload }) as unknown as AppEvent;

const rev = () => useChangesStore.getState().mapWorkspaceRevision;

describe("map_workspace.changed own-write filter (M-B1 hand-off 4)", () => {
  beforeEach(() => useChangesStore.getState().setOpenProject("p1"));

  it("ignores a state-only event: the workspace self-save echo re-reads nothing", () => {
    const r0 = rev();
    useChangesStore.getState().applyEvent(ev({ fields: ["state"] }));
    useChangesStore.getState().applyEvent(ev({ fields: ["state", "state"] }));
    expect(rev()).toBe(r0);
  });

  it.each([
    ["a frame change", { fields: ["frame"] }],
    ["state plus planned surveys", { fields: ["state", "planned_surveys"] }],
    ["an empty fields list", { fields: [] }],
    ["no fields", {}],
    ["a non-array fields", { fields: "state" }],
  ])("bumps on %s", (_name, payload) => {
    const r0 = rev();
    useChangesStore.getState().applyEvent(ev(payload));
    expect(rev()).toBe(r0 + 1);
  });
});
