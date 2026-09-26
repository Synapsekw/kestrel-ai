import { beforeEach, describe, expect, it } from "vitest";
import type { AppEvent } from "@contract/client";
import { useChangesStore } from "./changes";

const ev = (type: AppEvent["type"]): AppEvent => ({ type, payload: {} }) as AppEvent;

describe("changes store: findings, data and migrations", () => {
  beforeEach(() =>
    useChangesStore.setState({
      findingsRevision: 0,
      dataRevision: 0,
      projectsRevision: 0,
      openProjectId: null,
    }),
  );

  it("bumps each revision on its own event only", () => {
    const s = useChangesStore.getState();
    s.applyEvent(ev("findings.changed"));
    s.applyEvent(ev("data.changed"));
    s.applyEvent(ev("migration.changed"));
    s.applyEvent(ev("data.changed"));
    expect(useChangesStore.getState()).toMatchObject({
      findingsRevision: 1,
      dataRevision: 2,
      projectsRevision: 1,
    });
  });

  it("ignores findings and data changes of another project while a project is open", () => {
    const s = useChangesStore.getState();
    const at = (type: AppEvent["type"], project_id: string): AppEvent =>
      ({ type, project_id, payload: {} }) as AppEvent;
    s.setOpenProject("A");
    // A detection job in project B while A is open must not re-read A's Findings or Overview.
    s.applyEvent(at("findings.changed", "B"));
    s.applyEvent(at("data.changed", "B"));
    expect(useChangesStore.getState()).toMatchObject({ findingsRevision: 0, dataRevision: 0 });
    s.applyEvent(at("findings.changed", "A"));
    s.applyEvent(at("data.changed", "A"));
    // App-wide events still apply.
    s.applyEvent(at("migration.changed", "library"));
    expect(useChangesStore.getState()).toMatchObject({
      findingsRevision: 1,
      dataRevision: 1,
      projectsRevision: 1,
    });
    // With no project open, every project's changes apply.
    s.setOpenProject(null);
    s.applyEvent(at("findings.changed", "B"));
    expect(useChangesStore.getState().findingsRevision).toBe(2);
  });

  it("lets this client bump after its own writes", () => {
    useChangesStore.getState().bumpFindings();
    useChangesStore.getState().bumpData();
    expect(useChangesStore.getState()).toMatchObject({ findingsRevision: 1, dataRevision: 1 });
  });
});
