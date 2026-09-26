import { beforeEach, describe, expect, it } from "vitest";
import type { AppEvent } from "@contract/client";
import { useChangesStore } from "./changes";

const ev = (type: AppEvent["type"]): AppEvent => ({ type, payload: {} }) as AppEvent;

describe("changes store: findings, data and migrations", () => {
  beforeEach(() => useChangesStore.setState({ findingsRevision: 0, dataRevision: 0, projectsRevision: 0 }));

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

  it("lets this client bump after its own writes", () => {
    useChangesStore.getState().bumpFindings();
    useChangesStore.getState().bumpData();
    expect(useChangesStore.getState()).toMatchObject({ findingsRevision: 1, dataRevision: 1 });
  });
});
